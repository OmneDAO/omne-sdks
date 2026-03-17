/**
 * Secure cryptographic utilities for Omne TypeScript SDK
 *
 * AES implementation uses aes-js in Node/Jest and WebCrypto as fallback.
 * Keeps KDF and MAC semantics compatible with existing keystore tests:
 *  - cipher name: "aes-256-ctr"
 *  - MAC computed as keccak( encrypted || iv || salt || keccak(derivedKey || "mac") )
 *
 * NOTE: This file is a corrected replacement for the earlier secure-crypto.ts
 * that avoided importing '@noble/ciphers/aes' to prevent Jest ESM resolution issues.
 */

import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { scrypt } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  bytesToHex,
  hexToBytes,
  randomBytes as nobleRandomBytes,
  utf8ToBytes
} from '@noble/hashes/utils';
import { getPlatformProviders } from './platform/context';

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
  algorithm: string; // e.g. 'aes-256-ctr'
  kdf: string;
  kdfParams: any;
  mac: string;
}

const DEFAULT_SCRYPT_OPTIONS = { N: 262144, r: 8, p: 1 };
const MAC_LABEL = utf8ToBytes('mac');

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

function normalizeHex(value: string): string {
  return value.length % 2 === 0 ? value : `0${value}`;
}

function hexToBytesSafe(value: string): Uint8Array {
  return hexToBytes(normalizeHex(value));
}

function randomBytes(size: number): Uint8Array {
  return nobleRandomBytes(size);
}

function cryptoProvider() {
  return getPlatformProviders().crypto;
}

export async function deriveKey(
  password: string,
  salt: Uint8Array,
  options: SecureKeyDerivationOptions = {}
): Promise<Uint8Array> {
  const algorithm = options.algorithm ?? 'pbkdf2';
  const iterations = options.iterations ?? 100000;
  const keyLength = options.keyLength ?? 32;
  const scryptOptions = options.scryptOptions ?? DEFAULT_SCRYPT_OPTIONS;

  const passwordBytes = utf8ToBytes(password);

  if (algorithm === 'pbkdf2') {
    return pbkdf2(sha256, passwordBytes, salt, { c: iterations, dkLen: keyLength });
  }

  if (algorithm === 'scrypt') {
    return await scrypt(passwordBytes, salt, {
      N: scryptOptions.N,
      r: scryptOptions.r,
      p: scryptOptions.p,
      dkLen: keyLength
    });
  }

  throw new Error(`Unsupported key derivation algorithm: ${algorithm}`);
}

export async function secureEncrypt(
  data: string | Uint8Array,
  password: string,
  options: SecureKeyDerivationOptions = {}
): Promise<SecureEncryptionResult> {
  const algorithm = options.algorithm ?? 'pbkdf2';
  const iterations = options.iterations ?? 100000;
  const saltLength = options.saltLength ?? 32;
  const keyLength = options.keyLength ?? 32;
  const scryptOptions = options.scryptOptions ?? DEFAULT_SCRYPT_OPTIONS;

  const salt = randomBytes(saltLength);
  const iv = randomBytes(16); // 128-bit IV for CTR
  const derivedKey = await deriveKey(password, salt, {
    algorithm,
    iterations,
    keyLength,
    scryptOptions
  });

  const dataBytes =
    typeof data === 'string' ? hexToBytesSafe(data) : data instanceof Uint8Array ? data : new Uint8Array(data);

  // Encrypt with AES-CTR
  const encrypted = await cryptoProvider().aesCtrEncrypt(derivedKey, iv, dataBytes);

  // Compute MAC: macKey = keccak(derivedKey || MAC_LABEL)
  const macKey = keccakHex(concatBytes(derivedKey, MAC_LABEL));
  // mac = keccak(encrypted || iv || salt || hexToBytes(macKey))
  const mac = keccakHex(concatBytes(encrypted, iv, salt, hexToBytesSafe(macKey)));

  // Zero sensitive buffers
  derivedKey.fill(0);

  const kdfParams =
    algorithm === 'pbkdf2'
      ? { dklen: keyLength, salt: bytesToHex(salt), c: iterations }
      : {
          dklen: keyLength,
          salt: bytesToHex(salt),
          n: scryptOptions.N,
          r: scryptOptions.r,
          p: scryptOptions.p
        };

  return {
    ciphertext: bytesToHex(encrypted),
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    algorithm: 'aes-256-ctr',
    kdf: algorithm,
    kdfParams,
    mac
  };
}

export async function secureDecrypt(
  encryptionResult: SecureEncryptionResult,
  password: string
): Promise<Uint8Array> {
  const { ciphertext, salt, iv, kdf, kdfParams, mac } = encryptionResult;

  const saltBytes = hexToBytesSafe(salt);
  const ivBytes = hexToBytesSafe(iv);
  const encryptedBytes = hexToBytesSafe(ciphertext);

  const keyLength = kdfParams?.dklen ?? 32;
  const iterations = kdf === 'pbkdf2' ? kdfParams?.c ?? 100000 : undefined;
  const scryptOptions =
    kdf === 'scrypt'
      ? {
          N: kdfParams?.n ?? DEFAULT_SCRYPT_OPTIONS.N,
          r: kdfParams?.r ?? DEFAULT_SCRYPT_OPTIONS.r,
          p: kdfParams?.p ?? DEFAULT_SCRYPT_OPTIONS.p
        }
      : undefined;

  const derivedKey = await deriveKey(password, saltBytes, {
    algorithm: kdf as 'pbkdf2' | 'scrypt',
    iterations,
    keyLength,
    scryptOptions
  });

  // Recompute MAC and verify
  const macKey = keccakHex(concatBytes(derivedKey, MAC_LABEL));
  const expectedMac = keccakHex(concatBytes(encryptedBytes, ivBytes, saltBytes, hexToBytesSafe(macKey)));

  if (mac !== expectedMac) {
    derivedKey.fill(0);
    throw new Error('Invalid password or corrupted keystore');
  }

  const decrypted = await cryptoProvider().aesCtrDecrypt(derivedKey, ivBytes, encryptedBytes);

  derivedKey.fill(0);

  return decrypted;
}

export function generateSecureId(): string {
  const timestampBytes = new Uint8Array(8);
  const view = new DataView(timestampBytes.buffer);
  view.setBigUint64(0, BigInt(Date.now()));

  const randomPart = randomBytes(8);
  return bytesToHex(concatBytes(timestampBytes, randomPart));
}

export function generateSecureRandom(bytes: number = 32): string {
  return bytesToHex(randomBytes(bytes));
}

export function secureZero(buffer: Uint8Array): void {
  if (!buffer || buffer.length === 0) {
    return;
  }

  const random = randomBytes(buffer.length);
  buffer.set(random);
  buffer.fill(0);
}

export function secureRandomBytes(size: number): Uint8Array {
  return randomBytes(size);
}

function keccakHex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  return bytesToHex(keccak_256(bytes));
}