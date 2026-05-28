/**
 * Utility functions for Omne SDK
 * 
 * Provides quar-precision arithmetic, address validation,
 * and other helper functions for Omne blockchain integration.
 */

import { getPlatformProviders } from './platform/context';
import Big from 'big.js';
import { utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { bech32m } from '@scure/base';

import { secureRandomBytes } from './secure-crypto';

// Configure Big.js for quar precision
Big.DP = 18; // 18 decimal places for quar precision
Big.RM = 1;  // Round down

// ── om1z address constants ─────────────────────────────────────────────────
// All Omne addresses use bech32m encoding with HRP "om" and witness version 2.
// Witness version 2 maps to character 'z' in the bech32 alphabet, yielding
// the canonical prefix "om1z".  The 32-byte payload is the full SHA-256 digest
// of `"OMNE_PQC_ADDRESS_V1" || ml_dsa_44_pubkey`.  Omne is post-quantum from
// the ground up — addresses are 32 bytes (256-bit) so Grover's algorithm
// leaves a 128-bit second-preimage margin.
const ADDRESS_HRP = 'om';
const ADDRESS_WITNESS_VERSION = 2; // bech32 alphabet index 2 = 'z'
const ADDRESS_PAYLOAD_BYTES = 32;

// Domain-separation tag for ML-DSA-44 address derivation. Must match the
// Rust-side derivation in omne-blockchain (PqcAccountAddress).
const ADDRESS_DOMAIN_TAG = 'OMNE_PQC_ADDRESS_V1';

/**
 * Derive the canonical 32-byte om1z address from an ML-DSA-44 public key.
 *
 * address = SHA-256("OMNE_PQC_ADDRESS_V1" || ml_dsa_44_pubkey)  (full 32 bytes)
 *
 * Single source of truth shared by the wallet and signature verification;
 * must match the Rust-side `PqcAccountAddress::from_public_key`.
 */
export function deriveAddressFromPublicKey(publicKey: Uint8Array): string {
  const tag = utf8ToBytes(ADDRESS_DOMAIN_TAG);
  const payload = new Uint8Array(tag.length + publicKey.length);
  payload.set(tag, 0);
  payload.set(publicKey, tag.length);
  // Full 32-byte digest — no truncation.
  return toOmneAddress(sha256(payload));
}

/**
 * Quar conversion constants
 */
export const QUAR_PER_OMC = new Big('1000000000000000000'); // 10^18
export const QUAR_PER_MICRO_OMC = new Big('1000000000000'); // 10^12
export const QUAR_PER_MILLI_OMC = new Big('1000000000000000'); // 10^15

/**
 * Convert OMC amount to quar (10^-18 OMC precision)
 */
export function toQuar(omcAmount: string | number | Big): string {
  const omc = new Big(omcAmount.toString());
  return omc.mul(QUAR_PER_OMC).toFixed(0);
}

/**
 * Convert quar amount to OMC
 */
export function fromQuar(quarAmount: string | number | Big): Big {
  const quar = new Big(quarAmount.toString());
  return quar.div(QUAR_PER_OMC);
}

/**
 * Convert quar amount to OMC (alias for fromQuar)
 */
export function toOMC(quarAmount: string | number | Big): Big {
  return fromQuar(quarAmount);
}

/**
 * Convert OMC amount to quar (alias for toQuar)
 */
export function fromOMC(omcAmount: string | number | Big): string {
  return toQuar(omcAmount);
}

/**
 * Format quar amount as human-readable OMC string with specified decimals
 */
export function formatBalance(quarAmount: string | number | Big, decimals: number = 6): string {
  const omc = fromQuar(quarAmount);
  return `${omc.toFixed(decimals)} OMC`;
}

/**
 * Encode a 32-byte address as bech32m om1z format.
 *
 * Format: om1z<data><checksum>
 *   - HRP "om" + separator "1" + witness version 2 ('z') + bech32m data
 *   - 32-byte payload → ~59 character address
 */
export function toOmneAddress(addressBytes: Uint8Array): string {
  if (addressBytes.length !== ADDRESS_PAYLOAD_BYTES) {
    throw new Error(`Address must be ${ADDRESS_PAYLOAD_BYTES} bytes, got ${addressBytes.length}`);
  }
  // Convert 8-bit bytes to 5-bit bech32m words, prepend witness version
  const dataWords = bech32m.toWords(addressBytes);
  const words = new Uint8Array([ADDRESS_WITNESS_VERSION, ...dataWords]);
  return bech32m.encode(ADDRESS_HRP, words);
}

/**
 * Decode an om1z bech32m address to its 32-byte payload.
 */
export function fromOmneAddress(address: string): Uint8Array {
  if (!address.startsWith('om1')) {
    throw new Error(`Invalid address format: expected 'om1z' prefix, got '${address.slice(0, 6)}...'`);
  }
  const { prefix, words } = bech32m.decode(address as `${string}1${string}`);
  if (prefix !== ADDRESS_HRP) {
    throw new Error(`Invalid address HRP: expected '${ADDRESS_HRP}', got '${prefix}'`);
  }
  if (words[0] !== ADDRESS_WITNESS_VERSION) {
    throw new Error(`Invalid witness version: expected ${ADDRESS_WITNESS_VERSION}, got ${words[0]}`);
  }
  const bytes = bech32m.fromWords(Array.from(words.slice(1)));
  if (bytes.length !== ADDRESS_PAYLOAD_BYTES) {
    throw new Error(`Invalid address payload: expected ${ADDRESS_PAYLOAD_BYTES} bytes, got ${bytes.length}`);
  }
  return Uint8Array.from(bytes);
}

/**
 * Parse address string to bytes. Accepts om1z bech32m and raw 64-char hex.
 */
export function parseAddress(address: string): { format: 'bech32m' | 'hex', bytes: Uint8Array } {
  if (typeof address !== 'string') {
    throw new Error('Address must be a string');
  }

  if (address.startsWith('om1z') || address.startsWith('om1')) {
    return { format: 'bech32m', bytes: fromOmneAddress(address) };
  }

  // Raw 64-char lowercase hex (no prefix) — 32-byte address.
  if (/^[0-9a-f]{64}$/.test(address)) {
    return { format: 'hex', bytes: hexToBuffer(address) };
  }

  throw new Error(`Unsupported address format: ${address}`);
}

/**
 * Validate address format. Accepts canonical om1z bech32m and raw 64-char
 * (32-byte) hex only. Legacy `omne1` addresses are intentionally rejected —
 * Omne is om1z-only.
 */
export function isValidAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }

  try {
    parseAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate om1z bech32m address format specifically.
 */
export function isValidOmneAddress(address: string): boolean {
  if (typeof address !== 'string' || !address.startsWith('om1z')) {
    return false;
  }

  try {
    fromOmneAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate raw hex address format (64 lowercase hex chars = 32 bytes, no prefix).
 */
export function isValidHexAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }

  return /^[0-9a-f]{64}$/.test(address);
}

/**
 * Normalize any supported address format to canonical om1z bech32m.
 */
export function normalizeAddress(address: string): string {
  const parsed = parseAddress(address);
  return toOmneAddress(parsed.bytes);
}

// ML-DSA-44 (FIPS 204) byte lengths.
const ML_DSA_44_SIGNATURE_BYTES = 2420;
const ML_DSA_44_PUBLIC_KEY_BYTES = 1312;

/**
 * Verify an ML-DSA-44 signature against a message and expected address.
 *
 * ML-DSA does not support public key recovery from a signature alone; the
 * caller supplies the signer's public key so we can verify the signature and
 * confirm the public key maps to the expected om1z address. The message is
 * SHA-256-hashed before verification, matching the signer.
 */
export function verifyMlDsa44Signature(
  message: string,
  signatureHex: string,
  publicKeyHex: string,
  expectedAddress: string
): boolean {
  try {
    const sigBytes = hexToBuffer(signatureHex);
    if (sigBytes.length !== ML_DSA_44_SIGNATURE_BYTES) {
      return false;
    }

    const pubKeyBytes = hexToBuffer(publicKeyHex);
    if (pubKeyBytes.length !== ML_DSA_44_PUBLIC_KEY_BYTES) {
      return false;
    }

    const messageHash = sha256(utf8ToBytes(message));

    // Verify the ML-DSA-44 signature over the message hash.
    if (!ml_dsa44.verify(pubKeyBytes, messageHash, sigBytes)) {
      return false;
    }

    // Confirm the public key maps to the expected om1z address.
    return deriveAddressFromPublicKey(pubKeyBytes) === normalizeAddress(expectedAddress);
  } catch {
    return false;
  }
}

/**
 * Verify a signed message against an expected address.
 *
 * Expects the `signMessage` envelope: the 2420-byte ML-DSA-44 signature
 * followed by the 1312-byte public key (3732 bytes total).
 */
export function verifyMessageSignature(message: string, signature: string, expectedAddress: string): boolean {
  try {
    const combined = hexToBuffer(signature);
    if (combined.length !== ML_DSA_44_SIGNATURE_BYTES + ML_DSA_44_PUBLIC_KEY_BYTES) {
      return false;
    }
    const sigHex = bufferToHex(combined.slice(0, ML_DSA_44_SIGNATURE_BYTES));
    const pubHex = bufferToHex(combined.slice(ML_DSA_44_SIGNATURE_BYTES));
    return verifyMlDsa44Signature(message, sigHex, pubHex, expectedAddress);
  } catch {
    return false;
  }
}

/**
 * Calculate gas cost in quar
 */
export function calculateGasCost(gasUsed: number, gasPriceQuar: string | number | Big): string {
  const gasPrice = new Big(gasPriceQuar.toString());
  const cost = gasPrice.mul(gasUsed);
  return cost.toFixed(0);
}

/**
 * Estimate gas for different transaction types
 */
export function estimateGas(transactionType: 'transfer' | 'tokenTransfer' | 'contractDeploy' | 'orc20Deploy', hasData: boolean = false): number {
  const baseCosts = {
    transfer: 21000,
    tokenTransfer: 50000,
    contractDeploy: 150000,
    orc20Deploy: 150000
  };
  
  let gasEstimate = baseCosts[transactionType];
  
  if (hasData && transactionType === 'transfer') {
    gasEstimate += 20000; // Additional gas for data
  }
  
  return gasEstimate;
}

/**
 * Generate random hex string
 */
export function randomHex(bytes: number): string {
  const randomBytes = secureRandomBytes(bytes);
  return bufferToHex(randomBytes);
}

/**
 * Generate Omne block hash with bh_ prefix
 */
export function generateBlockHash(): string {
  const randomBytes = secureRandomBytes(30); // 30 bytes = 60 hex chars
  return 'bh_' + bufferToHex(randomBytes);
}

/**
 * Generate Omne transaction hash with canonical txn_ prefix
 */
export function generateTransactionHash(): string {
  const randomBytes = secureRandomBytes(32); // 32 bytes = 64 hex chars
  return 'txn_' + bufferToHex(randomBytes);
}

/**
 * Validate Omne block hash format
 */
export function isValidBlockHash(hash: string): boolean {
  if (typeof hash !== 'string' || !hash.startsWith('bh_')) {
    return false;
  }
  
  const hexPart = hash.slice(3); // Remove 'bh_' prefix
  return hexPart.length === 60 && /^[0-9a-fA-F]{60}$/.test(hexPart);
}

/**
 * Validate Omne transaction hash format
 */
export function isValidTransactionHash(hash: string): boolean {
  if (typeof hash !== 'string' || !hash.startsWith('txn_')) {
    return false;
  }
  
  const hexPart = hash.slice(4); // Remove 'txn_' prefix
  return hexPart.length === 64 && /^[0-9a-fA-F]{64}$/.test(hexPart);
}

/**
 * Sleep utility for async operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry utility for network operations
 */
export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      await sleep(delayMs * Math.pow(2, attempt)); // Exponential backoff
    }
  }
  
  throw lastError!;
}

/**
 * Validate transaction parameters
 */
export function validateTransaction(tx: {
  from: string;
  to: string;
  value: string;
  gasLimit: number;
  gasPrice: string;
  nonce: number;
}): void {
  if (!isValidAddress(tx.from)) {
    throw new Error(`Invalid from address: ${tx.from}`);
  }
  
  if (!isValidAddress(tx.to)) {
    throw new Error(`Invalid to address: ${tx.to}`);
  }
  
  if (new Big(tx.value).lt(0)) {
    throw new Error(`Invalid value: ${tx.value} (must be non-negative)`);
  }
  
  if (tx.gasLimit <= 0) {
    throw new Error(`Invalid gas limit: ${tx.gasLimit} (must be positive)`);
  }
  
  if (new Big(tx.gasPrice).lte(0)) {
    throw new Error(`Invalid gas price: ${tx.gasPrice} (must be positive)`);
  }
  
  if (tx.nonce < 0) {
    throw new Error(`Invalid nonce: ${tx.nonce} (must be non-negative)`);
  }
}

/**
 * Parse URL for WebSocket/HTTP detection
 */
export function parseRpcUrl(url: string): {
  protocol: 'ws' | 'wss' | 'http' | 'https';
  host: string;
  port?: number;
  path: string;
} {
  try {
    const parsed = new URL(url);
    
    if (!['ws:', 'wss:', 'http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    
    return {
      protocol: parsed.protocol.slice(0, -1) as any,
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port) : undefined,
      path: parsed.pathname + parsed.search
    };
  } catch (error) {
    throw new Error(`Invalid RPC URL: ${url}`);
  }
}

/**
 * Check if running in browser environment
 */
export function isBrowser(): boolean {
  return getPlatformProviders().env.isBrowser();
}

/**
 * Check if running in Node.js environment
 */
export function isNode(): boolean {
  return getPlatformProviders().env.isNode();
}

/**
 * Safe integer conversion
 */
export function safeInt(value: string | number | undefined, defaultValue: number = 0): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Safe string conversion
 */
export function safeString(value: any, defaultValue: string = ''): string {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value);
}

/**
 * Convert hex string to buffer.
 *
 * Expects raw lowercase hex with no prefix.  This is the Omne convention.
 */
export function hexToBuffer(hex: string): Uint8Array {
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`;
  const buffer = new Uint8Array(normalized.length / 2);

  for (let i = 0; i < normalized.length; i += 2) {
    buffer[i / 2] = parseInt(normalized.substr(i, 2), 16);
  }

  return buffer;
}

/**
 * Convert buffer to hex string.
 *
 * Omne convention: raw lowercase hex with no prefix.  The Omne ecosystem
 * does not use the Ethereum "0x" prefix; addresses use the "om1z…" bech32m form.
 */
export function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate deterministic ID for requests
 */
export function generateRequestId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}
