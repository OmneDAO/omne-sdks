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
import { ed25519 } from '@noble/curves/ed25519';

import { secureRandomBytes } from './secure-crypto';

// Configure Big.js for quar precision
Big.DP = 18; // 18 decimal places for quar precision
Big.RM = 1;  // Round down

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
 * Convert 20-byte address to Omne format
 */
export function toOmneAddress(addressBytes: Uint8Array): string {
  if (addressBytes.length !== 20) {
    throw new Error(`Address must be 20 bytes, got ${addressBytes.length}`);
  }
  const hex = bufferToHex(addressBytes).toLowerCase();
  return `omne1${hex}`;
}

/**
 * Convert Omne address to 20-byte array
 */
export function fromOmneAddress(omneAddress: string): Uint8Array {
  if (!omneAddress.startsWith('omne1')) {
    throw new Error(`Invalid Omne address prefix: ${omneAddress}`);
  }
  const hex = omneAddress.slice(5);
  if (hex !== hex.toLowerCase()) {
    throw new Error(`Uppercase characters are not allowed in Omne addresses: ${omneAddress}`);
  }
  if (!/^[0-9a-f]{40}$/.test(hex)) {
    throw new Error(`Invalid Omne address hex payload: ${hex}`);
  }

  return hexToBuffer(hex);
}

/**
 * Parse address — only Omne format (omne1...) and raw 40-char hex are accepted.
 * The Omne ecosystem does not use the Ethereum 0x prefix.
 */
export function parseAddress(address: string): { format: 'hex' | 'omne', bytes: Uint8Array } {
  if (typeof address !== 'string') {
    throw new Error('Address must be a string');
  }

  if (address !== address.toLowerCase()) {
    throw new Error(`Uppercase characters are not allowed in addresses: ${address}`);
  }

  if (address.startsWith('omne1')) {
    return {
      format: 'omne',
      bytes: fromOmneAddress(address)
    };
  } else if (/^[0-9a-f]{40}$/.test(address)) {
    return {
      format: 'hex',
      bytes: hexToBuffer(address)
    };
  } else {
    throw new Error(`Unsupported address format: ${address}`);
  }
}

/**
 * Validate address format (supports both Omne and hex)
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
 * Validate Omne address format specifically
 */
export function isValidOmneAddress(address: string): boolean {
  if (typeof address !== 'string' || !address.startsWith('omne1')) {
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
 * Validate raw hex address format (40 lowercase hex chars, no prefix).
 */
export function isValidHexAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }

  return /^[0-9a-f]{40}$/.test(address);
}

/**
 * Normalize address to Omne format.
 */
export function normalizeAddress(address: string): string {
  const parsed = parseAddress(address);
  
  if (parsed.format === 'omne') {
    return address;
  } else {
    return toOmneAddress(parsed.bytes);
  }
}

/**
 * Verify an ed25519 signature against a message and expected address.
 *
 * Ed25519 does not support public key recovery from a signature alone;
 * instead the caller must supply the signer's public key so we can
 * verify the signature and then check that the public key maps to the
 * expected Omne address.
 */
export function verifyEd25519Signature(
  message: string,
  signatureHex: string,
  publicKeyHex: string,
  expectedAddress: string
): boolean {
  try {
    const sigBytes = hexToBuffer(signatureHex);
    if (sigBytes.length !== 64) {
      return false;
    }

    const pubKeyBytes = hexToBuffer(publicKeyHex);
    if (pubKeyBytes.length !== 32) {
      return false;
    }

    const messageBytes = utf8ToBytes(message);
    const messageHash = sha256(messageBytes);

    // Verify the ed25519 signature.
    const valid = ed25519.verify(sigBytes, messageHash, pubKeyBytes);
    if (!valid) {
      return false;
    }

    // Derive the address from the public key and compare.
    const addrPayload = new Uint8Array(15 + 32);
    addrPayload.set(utf8ToBytes('OMNE_ADDRESS_V1'), 0);
    addrPayload.set(pubKeyBytes, 15);
    const addrHash = sha256(addrPayload);
    const derivedAddress = toOmneAddress(addrHash.slice(0, 20));

    return derivedAddress === normalizeAddress(expectedAddress);
  } catch {
    return false;
  }
}

/**
 * Verify a signed message against an expected address.
 *
 * @deprecated Use verifyEd25519Signature() which takes a public key.
 * This wrapper exists for backward compatibility but requires both
 * signature and public key concatenated (64-byte sig + 32-byte pubkey = 96 bytes).
 */
export function verifyMessageSignature(message: string, signature: string, expectedAddress: string): boolean {
  try {
    const combined = hexToBuffer(signature);
    if (combined.length !== 96) {
      return false;
    }
    const sigHex = bufferToHex(combined.slice(0, 64));
    const pubHex = bufferToHex(combined.slice(64));
    return verifyEd25519Signature(message, sigHex, pubHex, expectedAddress);
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
 * does not use the Ethereum "0x" prefix; addresses use "omne1" instead.
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
