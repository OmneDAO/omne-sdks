/**
 * Wallet implementation for Omne SDK.
 *
 * Provides mnemonic-based HD wallet support with account derivation,
 * keystore export/import, and signing helpers.  All signing uses ed25519 —
 * the sole algorithm across the Omne ecosystem.
 *
 * HD derivation follows SLIP-0010 (ed25519 curve, hardened-only paths).
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519';
import { utf8ToBytes } from '@noble/hashes/utils';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

import { WalletConfig, Keystore, Transaction } from './types';
import { WalletError, ValidationError } from './errors';
import { toOmneAddress, bufferToHex, hexToBuffer, fromOmneAddress } from './utils';
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

  constructor(privateKey: string, path?: string) {
    // ed25519 private key seed is 32 bytes (64 hex chars, raw hex, no prefix).
    if (privateKey.length !== 64 || !/^[0-9a-f]{64}$/.test(privateKey)) {
      throw WalletError.invalidPrivateKey(privateKey);
    }

    this.privateKey = privateKey;
    this.path = path;

    // Derive the ed25519 public key (32 bytes) from the private key seed.
    const privateKeyBytes = hexToBuffer(privateKey);
    const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);

    this.publicKey = bufferToHex(publicKeyBytes);
    this.address = this.generateAddress(publicKeyBytes);
  }

  signTransaction(transaction: Transaction): Transaction & { signature: string } {
    const txHash = this.hashTransaction(transaction);
    const signature = this.signHash(txHash);

    return {
      ...transaction,
      signature: bufferToHex(signature)
    };
  }

  signMessage(message: string): string {
    const messageBytes = utf8ToBytes(message);
    // Hash the message with SHA-256 (consistent with ed25519 ecosystem choice).
    const messageHash = sha256(messageBytes);
    const signature = this.signHash(messageHash);
    // ed25519 has no key recovery, so we concatenate the 32-byte public key
    // after the 64-byte signature so verifiers can derive the signer address.
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
    // Omne address derivation: SHA-256("OMNE_ADDRESS_V1" || ed25519_pubkey)[0..20]
    // Must match the Rust-side derive_address() in wallet.rs.
    const payload = new Uint8Array(15 + 32);
    payload.set(utf8ToBytes('OMNE_ADDRESS_V1'), 0);
    payload.set(publicKey, 15);
    const hash = sha256(payload);
    const addressBytes = hash.slice(0, 20);
    return toOmneAddress(addressBytes);
  }

  private hashTransaction(transaction: Transaction): Uint8Array {
    // Canonical transaction hash matching the Rust-side hash_transaction().
    // Fields are hashed in the same order and encoding (little-endian numbers).
    const fromBytes = fromOmneAddress(transaction.from);
    const toBytes = transaction.to ? fromOmneAddress(transaction.to) : new Uint8Array(0);

    // Encode numbers as little-endian bytes matching Rust's to_le_bytes().
    const valueBuf = le128(BigInt(transaction.value));
    const gasLimitBuf = le64(BigInt(transaction.gasLimit));
    const gasPriceBuf = le64(BigInt(transaction.gasPrice));
    const nonceBuf = le64(BigInt(transaction.nonce));
    const chainIdBuf = le64(BigInt(1)); // chain_id = 1 (matches Rust)
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
    // ed25519 signature: 64 bytes, no recovery ID.
    const privateKeyBytes = hexToBuffer(this.privateKey);
    return ed25519.sign(hash, privateKeyBytes);
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
 * SLIP-0010 ed25519 HD key derivation.
 *
 * Derives a child private key from a parent key + chain code at a
 * hardened-only index.  The master key is obtained via
 * HMAC-SHA512("ed25519 seed", BIP39 seed).
 */
interface Slip0010Key {
  privateKey: Uint8Array; // 32 bytes
  chainCode: Uint8Array;  // 32 bytes
}

function slip0010Master(seed: Uint8Array): Slip0010Key {
  const I = hmac(sha512, utf8ToBytes('ed25519 seed'), seed);
  return { privateKey: I.slice(0, 32), chainCode: I.slice(32) };
}

function slip0010DeriveChild(parent: Slip0010Key, index: number): Slip0010Key {
  // SLIP-0010 ed25519 only supports hardened derivation.
  const hardenedIndex = (index | 0x80000000) >>> 0;
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parent.privateKey, 1);
  // Big-endian index.
  data[33] = (hardenedIndex >>> 24) & 0xff;
  data[34] = (hardenedIndex >>> 16) & 0xff;
  data[35] = (hardenedIndex >>> 8) & 0xff;
  data[36] = hardenedIndex & 0xff;

  const I = hmac(sha512, parent.chainCode, data);
  return { privateKey: I.slice(0, 32), chainCode: I.slice(32) };
}

/**
 * Derive a key at a BIP-44 path using SLIP-0010 ed25519 hardened derivation.
 * Path format: m / purpose' / coin_type' / account' / change' / index'
 * (all levels are hardened for ed25519).
 */
function slip0010DerivePath(seed: Uint8Array, path: string): Slip0010Key {
  const segments = path
    .replace(/^m\/?/, '')
    .split('/')
    .filter(Boolean);

  let key = slip0010Master(seed);
  for (const seg of segments) {
    const idx = parseInt(seg.replace("'", ''), 10);
    if (isNaN(idx)) {
      throw new WalletError(`Invalid derivation path segment: ${seg}`, 'key_derivation');
    }
    key = slip0010DeriveChild(key, idx);
  }
  return key;
}

/**
 * HD wallet with BIP39 mnemonic support.
 *
 * Uses SLIP-0010 for ed25519 HD key derivation (hardened-only paths).
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

    // SLIP-0010 ed25519 uses all-hardened paths.
    const path = `${this.basePath}/${index}`;
    const derived = slip0010DerivePath(this.seed, path);

    const privateKey = bufferToHex(derived.privateKey);
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

  signTransaction(transaction: Transaction, accountIndex: number = 0): Transaction & { signature: string } {
    const account = this.getAccount(accountIndex);
    return account.signTransaction(transaction);
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