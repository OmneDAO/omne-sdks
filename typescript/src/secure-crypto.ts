/**
 * Secure cryptographic utilities for Omne TypeScript SDK
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync, scryptSync } from 'crypto';
import * as sha3 from 'js-sha3';

export interface SecureKeyDerivationOptions {
  algorithm?: 'pbkdf2' | 'scrypt';
  iterations?: number;
  saltLength?: number;
  keyLength?: number;
  scryptOptions?: {
    N: number;
    r: number;
    p: number;
  };
}

export interface SecureEncryptionResult {
  ciphertext: string;
  salt: string;
  iv: string;
  algorithm: string;
  kdf: string;
  kdfParams: any;
  mac: string;
}

/**
 * Secure key derivation using PBKDF2 or scrypt
 */
export function deriveKey(
  password: string,
  salt: Buffer,
  options: SecureKeyDerivationOptions = {}
): Buffer {
  const {
    algorithm = 'pbkdf2',
    iterations = 100000,
    keyLength = 32,
    scryptOptions = { N: 262144, r: 8, p: 1 }
  } = options;

  if (algorithm === 'pbkdf2') {
    return pbkdf2Sync(password, salt, iterations, keyLength, 'sha256');
  } else if (algorithm === 'scrypt') {
    return scryptSync(password, salt, keyLength, scryptOptions);
  } else {
    throw new Error(`Unsupported key derivation algorithm: ${algorithm}`);
  }
}

/**
 * Secure encryption using AES-256-CTR with authenticated MAC
 */
export function secureEncrypt(
  data: string | Buffer,
  password: string,
  options: SecureKeyDerivationOptions = {}
): SecureEncryptionResult {
  const {
    algorithm = 'pbkdf2',
    iterations = 100000,
    saltLength = 32
  } = options;

  // Generate cryptographically secure salt and IV
  const salt = randomBytes(saltLength);
  const iv = randomBytes(16);

  // Derive encryption key
  const derivedKey = deriveKey(password, salt, options);

  // Convert data to buffer if string
  const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'hex') : data;

  // Encrypt using AES-256-CTR
  const cipher = createCipheriv('aes-256-ctr', derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(dataBuffer),
    cipher.final()
  ]);

    // Generate MAC key and verify integrity
  const macKey = sha3.keccak256(Buffer.concat([derivedKey, Buffer.from('mac')]));
  const mac = sha3.keccak256(Buffer.concat([encrypted, iv, salt, Buffer.from(macKey, 'hex')]));

  // Zero out sensitive data
  derivedKey.fill(0);

  const kdfParams = algorithm === 'pbkdf2' 
    ? { dklen: 32, salt: salt.toString('hex'), c: iterations }
    : { dklen: 32, salt: salt.toString('hex'), n: options.scryptOptions?.N || 262144, r: options.scryptOptions?.r || 8, p: options.scryptOptions?.p || 1 };

  return {
    ciphertext: encrypted.toString('hex'),
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    algorithm: 'aes-256-ctr',
    kdf: algorithm,
    kdfParams,
    mac
  };
}

/**
 * Secure decryption with MAC verification
 */
export function secureDecrypt(
  encryptionResult: SecureEncryptionResult,
  password: string
): Buffer {
  const { ciphertext, salt, iv, kdf, kdfParams, mac } = encryptionResult;

  // Parse hex strings back to buffers
  const saltBuffer = Buffer.from(salt, 'hex');
  const ivBuffer = Buffer.from(iv, 'hex');
  const encryptedBuffer = Buffer.from(ciphertext, 'hex');

  // Derive decryption key
  const options: SecureKeyDerivationOptions = {
    algorithm: kdf as 'pbkdf2' | 'scrypt',
    iterations: kdfParams.c,
    keyLength: kdfParams.dklen
  };

  if (kdf === 'scrypt') {
    options.scryptOptions = {
      N: kdfParams.n,
      r: kdfParams.r,
      p: kdfParams.p
    };
  }

  const derivedKey = deriveKey(password, saltBuffer, options);

  // Verify MAC
  const macKey = sha3.keccak256(Buffer.concat([derivedKey, Buffer.from('mac')]));
  const expectedMac = sha3.keccak256(Buffer.concat([encryptedBuffer, ivBuffer, saltBuffer, Buffer.from(macKey, 'hex')]));

  if (mac !== expectedMac) {
    // Zero out key before throwing
    derivedKey.fill(0);
    throw new Error('Invalid password or corrupted keystore');
  }

  // Decrypt
  const decipher = createDecipheriv('aes-256-ctr', derivedKey, ivBuffer);
  const decrypted = Buffer.concat([
    decipher.update(encryptedBuffer),
    decipher.final()
  ]);

  // Zero out sensitive data
  derivedKey.fill(0);

  return decrypted;
}

/**
 * Generate cryptographically secure random ID
 */
export function generateSecureId(): string {
  const timestamp = Date.now();
  const randomPart = randomBytes(8);
  const combined = Buffer.concat([
    Buffer.from(timestamp.toString(16), 'hex'),
    randomPart
  ]);
  return combined.toString('hex');
}

/**
 * Generate secure random string
 */
export function generateSecureRandom(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Secure memory clearing (best effort in JavaScript)
 */
export function secureZero(buffer: Buffer): void {
  if (buffer && buffer.length > 0) {
    // Fill with random data first
    const random = randomBytes(buffer.length);
    random.copy(buffer);
    // Then zero
    buffer.fill(0);
  }
}

/**
 * Create secure random bytes
 */
export function secureRandomBytes(size: number): Buffer {
  return randomBytes(size);
}