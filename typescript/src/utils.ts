/**
 * Utility functions for Omne SDK
 * 
 * Provides quar-precision arithmetic, address validation,
 * and other helper functions for Omne blockchain integration.
 */

import Big from 'big.js';
import { createHash } from 'crypto';

// Configure Big.js for quar precision
Big.DP = 18; // 18 decimal places for quar precision
Big.RM = 1;  // Round down

/**
 * Quar conversion constants
 */
export const QUAR_PER_OMC = new Big('1000000000000000000'); // 10^18
export const QUAR_PER_MICRO_OMC = new Big('1000000000000'); // 10^12
export const QUAR_PER_MILLI_OMC = new Big('1000000000000000'); // 10^15

// Omne address encoding alphabet (excludes 0, O, I, L)
const OMNE_ALPHABET = '123456789abcdefghjkmnpqrstuvwxyz';

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
 * Encode bytes to Omne base32 format
 */
function omneEncode(data: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
    bits += 8;

    while (bits >= 5) {
      result += OMNE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += OMNE_ALPHABET[(value << (5 - bits)) & 31];
  }

  return result;
}

/**
 * Decode Omne base32 format to bytes
 */
function omneDecode(encoded: string): Uint8Array {
  const values = new Array(encoded.length);
  
  for (let i = 0; i < encoded.length; i++) {
    const char = encoded[i];
    const value = OMNE_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid character in Omne address: ${char}`);
    }
    values[i] = value;
  }

  let bits = 0;
  let value = 0;
  const result: number[] = [];

  for (let i = 0; i < values.length; i++) {
    value = (value << 5) | values[i];
    bits += 5;

    if (bits >= 8) {
      result.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(result);
}

/**
 * Convert 20-byte address to Omne format
 */
export function toOmneAddress(addressBytes: Uint8Array): string {
  if (addressBytes.length !== 20) {
    throw new Error(`Address must be 20 bytes, got ${addressBytes.length}`);
  }
  return 'omne1' + omneEncode(addressBytes);
}

/**
 * Convert Omne address to 20-byte array
 */
export function fromOmneAddress(omneAddress: string): Uint8Array {
  if (!omneAddress.startsWith('omne1')) {
    throw new Error(`Invalid Omne address prefix: ${omneAddress}`);
  }
  
  const encoded = omneAddress.slice(5); // Remove 'omne1' prefix
  const decoded = omneDecode(encoded);
  
  if (decoded.length !== 20) {
    throw new Error(`Invalid Omne address length: expected 20 bytes, got ${decoded.length}`);
  }
  
  return decoded;
}

/**
 * Parse address - supports both hex (0x...) and Omne (omne1...) formats
 */
export function parseAddress(address: string): { format: 'hex' | 'omne', bytes: Uint8Array } {
  if (address.startsWith('omne1')) {
    return {
      format: 'omne',
      bytes: fromOmneAddress(address)
    };
  } else if (address.toLowerCase().startsWith('0x')) {
    const hex = address.slice(2);
    if (hex.length !== 40) {
      throw new Error(`Invalid hex address length: ${address}`);
    }
    return {
      format: 'hex',
      bytes: new Uint8Array(Buffer.from(hex, 'hex'))
    };
  } else if (/^[0-9a-fA-F]{40}$/.test(address)) {
    // Handle hex addresses without 0x prefix
    return {
      format: 'hex',
      bytes: new Uint8Array(Buffer.from(address, 'hex'))
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
 * Validate Ethereum-compatible address format (legacy)
 */
export function isValidHexAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }

  // Remove 0x or 0X prefix if present (case insensitive)
  const cleanAddress = address.toLowerCase().startsWith('0x') ? address.slice(2) : address;
  
  // Check length (40 hex characters = 20 bytes)
  if (cleanAddress.length !== 40) {
    return false;
  }
  
  // Check hex format (case insensitive)
  return /^[0-9a-fA-F]{40}$/i.test(cleanAddress);
}

/**
 * Normalize address to standard format
 */
export function normalizeAddress(address: string): string {
  const parsed = parseAddress(address);
  
  if (parsed.format === 'omne') {
    return address; // Already in Omne format
  } else {
    // Convert hex to Omne format
    return toOmneAddress(parsed.bytes);
  }
}

/**
 * Generate checksum address (EIP-55) - deprecated, use Omne format instead
 * @deprecated Use Omne address format instead
 */
export function toChecksumAddress(address: string): string {
  // For backward compatibility, convert to hex first if it's Omne format
  const parsed = parseAddress(address);
  
  if (parsed.format === 'omne') {
    // Convert Omne to hex for checksum
    const hexAddress = '0x' + Buffer.from(parsed.bytes).toString('hex');
    const hash = createHash('sha3-256').update(hexAddress.slice(2)).digest('hex');
    
    let checksumAddress = '0x';
    for (let i = 0; i < hexAddress.length - 2; i++) {
      const char = hexAddress[i + 2];
      checksumAddress += parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char.toLowerCase();
    }
    
    return checksumAddress;
  } else {
    // Original hex format
    const hexAddress = '0x' + Buffer.from(parsed.bytes).toString('hex');
    const hash = createHash('sha3-256').update(hexAddress.slice(2)).digest('hex');
    
    let checksumAddress = '0x';
    for (let i = 0; i < hexAddress.length - 2; i++) {
      const char = hexAddress[i + 2];
      checksumAddress += parseInt(hash[i], 16) >= 8 ? char.toUpperCase() : char.toLowerCase();
    }
    
    return checksumAddress;
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
  const randomBytes = new Uint8Array(bytes);
  if (typeof window !== 'undefined' && window.crypto) {
    // Browser environment
    window.crypto.getRandomValues(randomBytes);
  } else {
    // Node.js environment
    const crypto = require('crypto');
    crypto.randomFillSync(randomBytes);
  }
  
  return '0x' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate Omne block hash with bh_ prefix
 */
export function generateBlockHash(): string {
  const randomBytes = new Uint8Array(30); // 30 bytes = 60 hex chars
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    const crypto = require('crypto');
    crypto.randomFillSync(randomBytes);
  }
  
  return 'bh_' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate Omne transaction hash with tx_ prefix
 */
export function generateTransactionHash(): string {
  const randomBytes = new Uint8Array(30); // 30 bytes = 60 hex chars
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(randomBytes);
  } else {
    const crypto = require('crypto');
    crypto.randomFillSync(randomBytes);
  }
  
  return 'tx_' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
  if (typeof hash !== 'string' || !hash.startsWith('tx_')) {
    return false;
  }
  
  const hexPart = hash.slice(3); // Remove 'tx_' prefix
  return hexPart.length === 60 && /^[0-9a-fA-F]{60}$/.test(hexPart);
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
  return typeof window !== 'undefined' && typeof window.document !== 'undefined';
}

/**
 * Check if running in Node.js environment
 */
export function isNode(): boolean {
  return typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
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
 * Convert hex string to buffer (Node.js compatible)
 */
export function hexToBuffer(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const buffer = new Uint8Array(cleanHex.length / 2);
  
  for (let i = 0; i < cleanHex.length; i += 2) {
    buffer[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  
  return buffer;
}

/**
 * Convert buffer to hex string
 */
export function bufferToHex(buffer: Uint8Array): string {
  return '0x' + Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate deterministic ID for requests
 */
export function generateRequestId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}
