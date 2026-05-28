/**
 * Wallet implementation for Omne SDK.
 *
 * Provides mnemonic-based HD wallet support with account derivation,
 * keystore export/import, and signing helpers.  All signing uses ML-DSA-44
 * (FIPS 204) — Omne is post-quantum from the ground up.
 *
 * Key model: a 32-byte seed is the portable secret (what keystores store and
 * what HD derivation produces). The ML-DSA-44 keypair (1312-byte public key,
 * 2560-byte secret key) is deterministically expanded from that seed via
 * `ml_dsa44.keygen(seed)`, so keystores stay small and imports are reproducible.
 *
 * HD derivation uses an HMAC-SHA512 hierarchical KDF over the BIP39 seed
 * (hardened-only paths) to produce each account's 32-byte ML-DSA-44 seed.
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { utf8ToBytes } from '@noble/hashes/utils';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

import { WalletConfig, Keystore, Transaction, SignTransactionOptions } from './types';
import { WalletError, ValidationError } from './errors';
import { bufferToHex, hexToBuffer, fromOmneAddress, deriveAddressFromPublicKey } from './utils';
import {
  secureEncrypt,
  secureDecrypt,
  secureZero,
  secureRandomBytes,
  SecureEncryptionResult
} from './secure-crypto';

/**
 * Individual account with signing capabilities.
 */
export class WalletAccount {
  public readonly address: string;
  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly path?: string;

  /** Expanded 2560-byte ML-DSA-44 secret key (kept in memory, never exported). */
  private readonly secretKeyBytes: Uint8Array;

  constructor(privateKey: string, path?: string) {
    // The portable secret is a 32-byte ML-DSA-44 seed (64 hex chars, raw hex).
    if (privateKey.length !== 64 || !/^[0-9a-f]{64}$/.test(privateKey)) {
      throw WalletError.invalidPrivateKey(privateKey);
    }

    this.privateKey = privateKey;
    this.path = path;

    // Deterministically expand the seed into an ML-DSA-44 keypair
    // (public key 1312 bytes, secret key 2560 bytes).
    const seedBytes = hexToBuffer(privateKey);
    const { publicKey, secretKey } = ml_dsa44.keygen(seedBytes);

    this.secretKeyBytes = secretKey;
    this.publicKey = bufferToHex(publicKey);
    this.address = this.generateAddress(publicKey);
  }

  signTransaction(
    transaction: Transaction,
    opts?: SignTransactionOptions
  ): Transaction & { signature: string; publicKey: string; chainId: number } {
    const chainId = resolveChainId(transaction, opts);
    const normalized: Transaction = { ...transaction, chainId };
    const txHash = this.hashTransaction(normalized);
    const signature = this.signHash(txHash);

    return {
      ...normalized,
      chainId,
      signature: bufferToHex(signature),
      publicKey: this.publicKey
    };
  }

  signMessage(message: string): string {
    const messageBytes = utf8ToBytes(message);
    // Hash the message with SHA-256 before signing.
    const messageHash = sha256(messageBytes);
    const signature = this.signHash(messageHash);
    // ML-DSA has no key recovery, so we concatenate the 1312-byte public key
    // after the 2420-byte signature so verifiers can derive the signer address.
    const pubKeyBytes = hexToBuffer(this.publicKey);
    const combined = new Uint8Array(signature.length + pubKeyBytes.length);
    combined.set(signature, 0);
    combined.set(pubKeyBytes, signature.length);
    return bufferToHex(combined);
  }

  async toKeystore(password: string): Promise<Keystore> {
    if (!password) {
      throw new WalletError('Password required for keystore encryption', 'keystore_export');
    }

    const encryptionResult = await secureEncrypt(this.privateKey, password, {
      algorithm: 'pbkdf2',
      iterations: 100000,
      saltLength: 32
    });

    const addressBytes = fromOmneAddress(this.address);
    const addressHex = bufferToHex(addressBytes);

    return {
      version: 3,
      id: this.generateUUID(),
      address: addressHex,
      crypto: {
        ciphertext: encryptionResult.ciphertext,
        cipherparams: { iv: encryptionResult.iv },
        cipher: encryptionResult.algorithm,
        kdf: encryptionResult.kdf,
        kdfparams: encryptionResult.kdfParams,
        mac: encryptionResult.mac
      }
    };
  }

  static async fromKeystore(keystore: Keystore, password: string): Promise<WalletAccount> {
    if (!password) {
      throw new WalletError('Password required for keystore decryption', 'keystore_import');
    }

    try {
      const encryptionResult: SecureEncryptionResult = {
        ciphertext: keystore.crypto.ciphertext,
        salt: keystore.crypto.kdfparams.salt,
        iv: keystore.crypto.cipherparams.iv,
        algorithm: keystore.crypto.cipher,
        kdf: keystore.crypto.kdf,
        kdfParams: keystore.crypto.kdfparams,
        mac: keystore.crypto.mac
      };

      const decrypted = await secureDecrypt(encryptionResult, password);
      const privateKey = bufferToHex(decrypted);

      secureZero(decrypted);

      return new WalletAccount(privateKey);
    } catch (error) {
      throw WalletError.keystoreError('decryption', 'Invalid password or corrupted keystore');
    }
  }

  static fromPrivateKey(privateKey: string): WalletAccount {
    return new WalletAccount(privateKey);
  }

  private generateAddress(publicKey: Uint8Array): string {
    // Canonical 32-byte om1z derivation, shared with verification and the
    // Rust-side PqcAccountAddress: SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey).
    return deriveAddressFromPublicKey(publicKey);
  }

  private hashTransaction(transaction: Transaction): Uint8Array {
    // Canonical transaction hash matching the Rust-side hash_transaction()
    // in omne-blockchain/src/rpc/wallet.rs. Fields are hashed in the same
    // order and encoding (little-endian numbers). chain_id is a per-tx
    // field here and on the Rust side — callers must set it before signing.
    if (transaction.chainId === undefined) {
      throw new WalletError(
        'chainId must be set on Transaction before signing (e.g. 3 for Ignis)',
        'sign_transaction'
      );
    }
    const fromBytes = fromOmneAddress(transaction.from);
    const toBytes = transaction.to ? fromOmneAddress(transaction.to) : new Uint8Array(0);

    // Encode numbers as little-endian bytes matching Rust's to_le_bytes().
    const valueBuf = le128(BigInt(transaction.value));
    const gasLimitBuf = le64(BigInt(transaction.gasLimit));
    const gasPriceBuf = le64(BigInt(transaction.gasPrice));
    const nonceBuf = le64(BigInt(transaction.nonce));
    const chainIdBuf = le64(BigInt(transaction.chainId));
    const dataBuf = transaction.data
      ? hexToBuffer(transaction.data)
      : new Uint8Array(0);

    // Concatenate fields and hash.
    const totalLen = fromBytes.length + toBytes.length + valueBuf.length +
      gasLimitBuf.length + gasPriceBuf.length + nonceBuf.length +
      chainIdBuf.length + dataBuf.length;
    const buf = new Uint8Array(totalLen);
    let offset = 0;
    for (const part of [fromBytes, toBytes, valueBuf, gasLimitBuf, gasPriceBuf, nonceBuf, chainIdBuf, dataBuf]) {
      buf.set(part, offset);
      offset += part.length;
    }
    return sha256(buf);
  }

  private signHash(hash: Uint8Array): Uint8Array {
    // ML-DSA-44 signature: 2420 bytes, no recovery.
    return ml_dsa44.sign(this.secretKeyBytes, hash);
  }

  private generateUUID(): string {
    const bytes = secureRandomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bufferToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/**
 * Resolve the chainId used when signing a transaction. Resolution order:
 *   1. opts.chainId (explicit per-call override)
 *   2. transaction.chainId (per-tx field)
 *   3. throw — no silent default. Callers must pick a chain explicitly.
 */
function resolveChainId(
  transaction: Transaction,
  opts?: SignTransactionOptions
): number {
  const chainId = opts?.chainId ?? transaction.chainId;
  if (chainId === undefined) {
    throw new WalletError(
      'chainId required for signing — pass opts.chainId or set Transaction.chainId (e.g. 3 for Ignis)',
      'sign_transaction'
    );
  }
  if (!Number.isInteger(chainId) || chainId < 0) {
    throw new WalletError(
      `Invalid chainId: ${chainId} — must be a non-negative integer`,
      'sign_transaction'
    );
  }
  return chainId;
}

/**
 * Encode a BigInt as a little-endian 8-byte (u64) buffer.
 */
function le64(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

/**
 * Encode a BigInt as a little-endian 16-byte (u128) buffer.
 */
function le128(n: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

/**
 * HMAC-SHA512 hierarchical seed derivation (SLIP-0010 structure, hardened-only).
 *
 * Each node yields a 32-byte seed + 32-byte chain code. The leaf 32-byte seed
 * is fed to `ml_dsa44.keygen` to produce the account's ML-DSA-44 keypair. The
 * master node is HMAC-SHA512("omne ml-dsa44 seed", BIP39 seed); children chain
 * via HMAC-SHA512(chainCode, 0x00 || parentSeed || index_be) at hardened
 * indices only.
 */
interface HdNode {
  seed: Uint8Array;       // 32 bytes — ML-DSA-44 keygen seed at this node
  chainCode: Uint8Array;  // 32 bytes
}

function hdMaster(seed: Uint8Array): HdNode {
  const I = hmac(sha512, utf8ToBytes('omne ml-dsa44 seed'), seed);
  return { seed: I.slice(0, 32), chainCode: I.slice(32) };
}

function hdDeriveChild(parent: HdNode, index: number): HdNode {
  // Hardened-only derivation (high bit set).
  const hardenedIndex = (index | 0x80000000) >>> 0;
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parent.seed, 1);
  // Big-endian index.
  data[33] = (hardenedIndex >>> 24) & 0xff;
  data[34] = (hardenedIndex >>> 16) & 0xff;
  data[35] = (hardenedIndex >>> 8) & 0xff;
  data[36] = hardenedIndex & 0xff;

  const I = hmac(sha512, parent.chainCode, data);
  return { seed: I.slice(0, 32), chainCode: I.slice(32) };
}

/**
 * Derive a node at a BIP-44 path using the hardened HMAC-SHA512 KDF.
 * Path format: m / purpose' / coin_type' / account' / change' / index'
 * (all levels are hardened).
 */
function hdDerivePath(seed: Uint8Array, path: string): HdNode {
  const segments = path
    .replace(/^m\/?/, '')
    .split('/')
    .filter(Boolean);

  let node = hdMaster(seed);
  for (const seg of segments) {
    const idx = parseInt(seg.replace("'", ''), 10);
    if (isNaN(idx)) {
      throw new WalletError(`Invalid derivation path segment: ${seg}`, 'key_derivation');
    }
    node = hdDeriveChild(node, idx);
  }
  return node;
}

/**
 * HD wallet with BIP39 mnemonic support.
 *
 * Uses an HMAC-SHA512 hierarchical KDF (hardened-only paths) to derive each
 * account's 32-byte ML-DSA-44 seed.
 */
export class Wallet {
  private mnemonic: string;
  private seed: Uint8Array;
  private readonly basePath = "m/44'/60'/0'/0";

  constructor(config?: WalletConfig) {
    if (config?.mnemonic) {
      this.mnemonic = config.mnemonic;

      if (!validateMnemonic(this.mnemonic, englishWordlist)) {
        throw WalletError.invalidMnemonic(this.mnemonic);
      }
    } else {
      this.mnemonic = generateMnemonic(englishWordlist, 128);
    }

    this.seed = mnemonicToSeedSync(this.mnemonic, config?.password);
  }

  static generate(): Wallet {
    return new Wallet();
  }

  static fromMnemonic(mnemonic: string, password?: string): Wallet {
    return new Wallet({ mnemonic, password });
  }

  static fromPrivateKey(privateKey: string): WalletAccount {
    return new WalletAccount(privateKey);
  }

  getMnemonic(): string {
    return this.mnemonic;
  }

  getMnemonicWords(): string[] {
    return this.mnemonic.split(' ');
  }

  getAccount(index: number = 0): WalletAccount {
    if (index < 0) {
      throw new ValidationError(`Account index must be non-negative: ${index}`, 'index', index);
    }

    // Hardened-only HMAC-SHA512 path derivation.
    const path = `${this.basePath}/${index}`;
    const derived = hdDerivePath(this.seed, path);

    const privateKey = bufferToHex(derived.seed);
    return new WalletAccount(privateKey, path);
  }

  get address(): string {
    return this.getAccount(0).address;
  }

  getAccounts(count: number, startIndex: number = 0): WalletAccount[] {
    if (count <= 0) {
      throw new ValidationError(`Account count must be positive: ${count}`, 'count', count);
    }

    if (startIndex < 0) {
      throw new ValidationError(`Start index must be non-negative: ${startIndex}`, 'startIndex', startIndex);
    }

    const accounts: WalletAccount[] = [];
    for (let i = 0; i < count; i += 1) {
      accounts.push(this.getAccount(startIndex + i));
    }
    return accounts;
  }

  signTransaction(
    transaction: Transaction,
    accountIndex: number = 0,
    opts?: SignTransactionOptions
  ): Transaction & { signature: string; publicKey: string; chainId: number } {
    const account = this.getAccount(accountIndex);
    return account.signTransaction(transaction, opts);
  }

  async exportWallet(password: string): Promise<{ mnemonic: string; accounts: Keystore[] }> {
    if (!password) {
      throw new WalletError('Password required for wallet export', 'wallet_export');
    }

    const accounts = this.getAccounts(5);
    const keystores = await Promise.all(accounts.map((account) => account.toKeystore(password)));

    return {
      mnemonic: this.mnemonic,
      accounts: keystores
    };
  }
}

/**
 * Wallet manager for handling multiple wallets/accounts.
 */
export class WalletManager {
  private wallets = new Map<string, Wallet>();
  private accounts = new Map<string, WalletAccount>();

  createWallet(id?: string): Wallet {
    const wallet = Wallet.generate();
    const walletId = id ?? wallet.address;
    this.wallets.set(walletId, wallet);
    return wallet;
  }

  importWallet(mnemonic: string, id?: string, password?: string): Wallet {
    const wallet = Wallet.fromMnemonic(mnemonic, password);
    const walletId = id ?? wallet.address;
    this.wallets.set(walletId, wallet);
    return wallet;
  }

  importAccount(privateKey: string, id?: string): WalletAccount {
    const account = WalletAccount.fromPrivateKey(privateKey);
    const accountId = id ?? account.address;
    this.accounts.set(accountId, account);
    return account;
  }

  getWallet(id: string): Wallet | undefined {
    return this.wallets.get(id);
  }

  getAccount(id: string): WalletAccount | undefined {
    return this.accounts.get(id);
  }

  listWallets(): string[] {
    return Array.from(this.wallets.keys());
  }

  listAccounts(): string[] {
    return Array.from(this.accounts.keys());
  }

  removeWallet(id: string): boolean {
    return this.wallets.delete(id);
  }

  removeAccount(id: string): boolean {
    return this.accounts.delete(id);
  }

  clear(): void {
    this.wallets.clear();
    this.accounts.clear();
  }
}