/**
 * Wallet implementation for Omne SDK.
 *
 * Provides mnemonic-based HD wallet support with account derivation,
 * keystore export/import, and signing helpers. Implemented without Node-only
 * primitives so bundles remain browser-compatible.
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { getPublicKey, sign, etc as secpEtc } from '@noble/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';

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

if (!secpEtc.hmacSha256Sync) {
  // Provide a synchronous HMAC implementation so noble's deterministic signing works in browsers
  secpEtc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
    hmac(sha256, key, secpEtc.concatBytes(...msgs));
}

/**
 * Individual account with signing capabilities.
 */
export class WalletAccount {
  public readonly address: string;
  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly path?: string;

  constructor(privateKey: string, path?: string) {
    if (!privateKey.startsWith('0x')) {
      privateKey = `0x${privateKey}`;
    }

    if (privateKey.length !== 66) {
      throw WalletError.invalidPrivateKey(privateKey);
    }

    this.privateKey = privateKey;
    this.path = path;

    const privateKeyBytes = hexToBuffer(privateKey);
    const publicKeyBytes = getPublicKey(privateKeyBytes, false);

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
    const messageBytes = message.startsWith('0x') ? hexToBuffer(message) : utf8ToBytes(message);
    const messageHash = keccak_256(messageBytes);
    const signature = this.signHash(messageHash);
    return bufferToHex(signature);
  }

  async toKeystore(password: string): Promise<Keystore> {
    if (!password) {
      throw new WalletError('Password required for keystore encryption', 'keystore_export');
    }

    const encryptionResult = await secureEncrypt(this.privateKey.slice(2), password, {
      algorithm: 'pbkdf2',
      iterations: 100000,
      saltLength: 32
    });

    const addressBytes = fromOmneAddress(this.address);
    const addressHex = bufferToHex(addressBytes).slice(2);

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
    const addressBytes = publicKey.slice(-20);
    return toOmneAddress(addressBytes);
  }

  private hashTransaction(transaction: Transaction): Uint8Array {
    const txData = JSON.stringify({
      from: transaction.from,
      to: transaction.to,
      value: transaction.value,
      gasLimit: transaction.gasLimit,
      gasPrice: transaction.gasPrice,
      nonce: transaction.nonce,
      data: transaction.data || '0x'
    });

    return keccak_256(utf8ToBytes(txData));
  }

  private signHash(hash: Uint8Array): Uint8Array {
    const privateKeyBytes = hexToBuffer(this.privateKey);
    const signature = sign(hash, privateKeyBytes, { lowS: true });
    const compact = signature.toCompactRawBytes();
    const recoveryId = signature.recovery ?? 0;

    const fullSignature = new Uint8Array(65);
    fullSignature.set(compact);
    fullSignature[64] = recoveryId + 27;

    return fullSignature;
  }

  private generateUUID(): string {
    const bytes = secureRandomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = bufferToHex(bytes).slice(2);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
}

/**
 * HD wallet with BIP39 mnemonic support.
 */
export class Wallet {
  private mnemonic: string;
  private seed: Uint8Array;
  private masterKey: HDKey;
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
    this.masterKey = HDKey.fromMasterSeed(this.seed);
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

    const path = `${this.basePath}/${index}`;
    const derivedKey = this.masterKey.derive(path);

    if (!derivedKey.privateKey) {
      throw new WalletError(`Failed to derive key at path: ${path}`, 'key_derivation');
    }

    const privateKey = bufferToHex(derivedKey.privateKey);
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