/**
 * Wallet implementation for Omne SDK
 * 
 * BIP39 HD wallet with transaction signing capabilities.
 * Supports mnemonic generation, account derivation, and keystore operations.
 */

import * as bip39 from 'bip39';
import { HDKey } from '@scure/bip32';
import { getPublicKey, sign } from '@noble/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';
import { 
  WalletConfig, 
  Keystore, 
  Transaction 
} from './types';
import { 
  WalletError, 
  ValidationError 
} from './errors';
import { 
  toOmneAddress,
  bufferToHex,
  hexToBuffer 
} from './utils';
import {
  secureEncrypt,
  secureDecrypt,
  secureZero,
  SecureEncryptionResult
} from './secure-crypto';

/**
 * Individual account with signing capabilities
 */
export class WalletAccount {
  public readonly address: string;
  public readonly privateKey: string;
  public readonly publicKey: string;
  public readonly path?: string;

  constructor(privateKey: string, path?: string) {
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }

    if (privateKey.length !== 66) {
      throw WalletError.invalidPrivateKey(privateKey);
    }

    this.privateKey = privateKey;
    this.path = path;

    // Generate public key from private key
  const privateKeyBuffer = hexToBuffer(privateKey);
  const publicKeyBuffer = getPublicKey(privateKeyBuffer, false);
  this.publicKey = bufferToHex(publicKeyBuffer);

    // Generate address from public key
    this.address = this.generateAddress(publicKeyBuffer);
  }

  /**
   * Sign a transaction
   */
  signTransaction(transaction: Transaction): Transaction & { signature: string } {
    const txHash = this.hashTransaction(transaction);
    const signature = this.signHash(txHash);

    return {
      ...transaction,
      signature: bufferToHex(signature)
    };
  }

  /**
   * Sign arbitrary data
   */
  signMessage(message: string): string {
    const messageBytes = message.startsWith('0x')
      ? hexToBuffer(message)
      : utf8ToBytes(message);
    const messageHash = keccak_256(messageBytes);
    const signature = this.signHash(messageHash);
    return bufferToHex(signature);
  }

  /**
   * Export account to keystore format
   */
  async toKeystore(password: string): Promise<Keystore> {
    if (!password) {
      throw new WalletError('Password required for keystore encryption', 'keystore_export');
    }

    // Use secure encryption with proper key derivation
    const encryptionResult = secureEncrypt(
      this.privateKey.slice(2), // Remove 0x prefix
      password,
      { algorithm: 'pbkdf2', iterations: 100000, saltLength: 32 }
    );

    return {
      version: 3,
      id: this.generateUUID(),
      address: this.address.toLowerCase().slice(2),
      crypto: {
        ciphertext: encryptionResult.ciphertext,
        cipherparams: {
          iv: encryptionResult.iv
        },
        cipher: encryptionResult.algorithm,
        kdf: encryptionResult.kdf,
        kdfparams: encryptionResult.kdfParams,
        mac: encryptionResult.mac
      }
    };
  }

  /**
   * Create account from keystore
   */
  static async fromKeystore(keystore: Keystore, password: string): Promise<WalletAccount> {
    if (!password) {
      throw new WalletError('Password required for keystore decryption', 'keystore_import');
    }

    try {
      // Reconstruct the encryption result object for secure decryption
      const encryptionResult: SecureEncryptionResult = {
        ciphertext: keystore.crypto.ciphertext,
        salt: keystore.crypto.kdfparams.salt,
        iv: keystore.crypto.cipherparams.iv,
        algorithm: keystore.crypto.cipher,
        kdf: keystore.crypto.kdf,
        kdfParams: keystore.crypto.kdfparams,
        mac: keystore.crypto.mac
      };

      const decrypted = secureDecrypt(encryptionResult, password);
      const privateKey = '0x' + decrypted.toString('hex');
      
      // Securely zero the decrypted buffer
      secureZero(decrypted);
      
      return new WalletAccount(privateKey);
    } catch (error) {
      throw WalletError.keystoreError('decryption', 'Invalid password or corrupted keystore');
    }
  }

  // Private methods

  private generateAddress(publicKey: Uint8Array): string {
    // Remove the first byte (0x04) for uncompressed public key
    const publicKeyWithoutPrefix = publicKey.slice(1);

  // Hash with Keccak-256
  const hashBytes = keccak_256(publicKeyWithoutPrefix);

  // Take last 20 bytes
  const addressBytes = hashBytes.slice(-20);

    // Convert to Omne address format
    return toOmneAddress(addressBytes);
  }

  private hashTransaction(transaction: Transaction): Uint8Array {
    // Simplified transaction hashing (in production, use proper RLP encoding)
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
    const hashBytes = hash instanceof Uint8Array ? hash : new Uint8Array(hash);

    const signature = sign(hashBytes, privateKeyBytes, { lowS: true });
    const compact = signature.toCompactRawBytes();
    const recoveryId = signature.recovery ?? 0;

    const fullSignature = new Uint8Array(65);
    fullSignature.set(compact);
    fullSignature[64] = recoveryId + 27; // Ethereum recovery ID format

    return fullSignature;
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Create WalletAccount from private key
   */
  static fromPrivateKey(privateKey: string): WalletAccount {
    return new WalletAccount(privateKey);
  }
}

/**
 * HD Wallet implementation with BIP39 mnemonic support
 */
export class Wallet {
  private mnemonic: string;
  private seed: Buffer;
  private masterKey: HDKey;
  private readonly basePath: string = "m/44'/60'/0'/0"; // Ethereum derivation path

  constructor(config?: WalletConfig) {
    if (config?.mnemonic) {
      this.mnemonic = config.mnemonic;
      
      if (!bip39.validateMnemonic(this.mnemonic)) {
        throw WalletError.invalidMnemonic(this.mnemonic);
      }
    } else {
      // Generate new mnemonic
      this.mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words
    }

    // Generate seed from mnemonic
  this.seed = bip39.mnemonicToSeedSync(this.mnemonic, config?.password);

  // Create master key using browser-friendly BIP32 implementation
  this.masterKey = HDKey.fromMasterSeed(new Uint8Array(this.seed));
  }

  /**
   * Generate new wallet with random mnemonic
   */
  static generate(): Wallet {
    return new Wallet();
  }

  /**
   * Create wallet from existing mnemonic
   */
  static fromMnemonic(mnemonic: string, password?: string): Wallet {
    return new Wallet({ mnemonic, password });
  }

  /**
   * Create wallet from private key
   */
  static fromPrivateKey(privateKey: string): WalletAccount {
    return new WalletAccount(privateKey);
  }

  /**
   * Get mnemonic phrase
   */
  getMnemonic(): string {
    return this.mnemonic;
  }

  /**
   * Get mnemonic words as array
   */
  getMnemonicWords(): string[] {
    return this.mnemonic.split(' ');
  }

  /**
   * Derive account at specific index
   */
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

  /**
   * Get primary account (index 0)
   */
  get address(): string {
    return this.getAccount(0).address;
  }

  /**
   * Get accounts in batch
   */
  getAccounts(count: number, startIndex: number = 0): WalletAccount[] {
    if (count <= 0) {
      throw new ValidationError(`Account count must be positive: ${count}`, 'count', count);
    }
    if (startIndex < 0) {
      throw new ValidationError(`Start index must be non-negative: ${startIndex}`, 'startIndex', startIndex);
    }

    const accounts: WalletAccount[] = [];
    for (let i = 0; i < count; i++) {
      accounts.push(this.getAccount(startIndex + i));
    }
    return accounts;
  }

  /**
   * Sign transaction with specific account
   */
  signTransaction(transaction: Transaction, accountIndex: number = 0): Transaction & { signature: string } {
    const account = this.getAccount(accountIndex);
    return account.signTransaction(transaction);
  }

  /**
   * Export wallet to encrypted JSON
   */
  async exportWallet(password: string): Promise<{
    mnemonic: string;
    accounts: Keystore[];
  }> {
    if (!password) {
      throw new WalletError('Password required for wallet export', 'wallet_export');
    }

    // Export first 5 accounts by default
    const accounts = this.getAccounts(5);
    const keystores = await Promise.all(
      accounts.map(account => account.toKeystore(password))
    );

    return {
      mnemonic: this.mnemonic, // In production, encrypt this too
      accounts: keystores
    };
  }
}

/**
 * Wallet manager for handling multiple wallets
 */
export class WalletManager {
  private wallets = new Map<string, Wallet>();
  private accounts = new Map<string, WalletAccount>();

  /**
   * Create new wallet
   */
  createWallet(id?: string): Wallet {
    const wallet = Wallet.generate();
    const walletId = id || wallet.address;
    this.wallets.set(walletId, wallet);
    return wallet;
  }

  /**
   * Import wallet from mnemonic
   */
  importWallet(mnemonic: string, id?: string, password?: string): Wallet {
    const wallet = Wallet.fromMnemonic(mnemonic, password);
    const walletId = id || wallet.address;
    this.wallets.set(walletId, wallet);
    return wallet;
  }

  /**
   * Import account from private key
   */
  importAccount(privateKey: string, id?: string): WalletAccount {
    const account = WalletAccount.fromPrivateKey(privateKey);
    const accountId = id || account.address;
    this.accounts.set(accountId, account);
    return account;
  }

  /**
   * Get wallet by ID
   */
  getWallet(id: string): Wallet | undefined {
    return this.wallets.get(id);
  }

  /**
   * Get account by ID
   */
  getAccount(id: string): WalletAccount | undefined {
    return this.accounts.get(id);
  }

  /**
   * List all wallet IDs
   */
  listWallets(): string[] {
    return Array.from(this.wallets.keys());
  }

  /**
   * List all account IDs
   */
  listAccounts(): string[] {
    return Array.from(this.accounts.keys());
  }

  /**
   * Remove wallet
   */
  removeWallet(id: string): boolean {
    return this.wallets.delete(id);
  }

  /**
   * Remove account
   */
  removeAccount(id: string): boolean {
    return this.accounts.delete(id);
  }

  /**
   * Clear all wallets and accounts
   */
  clear(): void {
    this.wallets.clear();
    this.accounts.clear();
  }
}

