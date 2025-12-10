/**
 * Omne TypeScript SDK
 * 
 * Official TypeScript/JavaScript SDK for Omne Blockchain
 * Commerce-first blockchain with dual-layer consensus and microscopic fees
 */

import { OmneClient } from './client';

// Core client and wallet exports
export { OmneClient } from './client';
export { Wallet, WalletAccount, WalletManager } from './wallet';

// Type definitions (interfaces and types only)
export type * from './types';

// Error classes (concrete implementations override type interfaces)
export {
  OmneSDKError,
  NetworkError,
  TransactionError,
  ValidationError,
  WalletError,
  GuardrailError,
  RPCError
} from './errors';

// Utility functions (be specific to avoid QUAR_PER_OMC conflict)
export {
  toQuar,
  fromQuar,
  formatBalance,
  isValidAddress,
  isValidOmneAddress,
  isValidHexAddress,
  normalizeAddress,
  toOmneAddress,
  fromOmneAddress,
  parseAddress,
  toChecksumAddress,
  calculateGasCost,
  estimateGas,
  randomHex,
  generateBlockHash,
  generateTransactionHash,
  isValidBlockHash,
  isValidTransactionHash,
  retry,
  sleep,
  generateRequestId,
  parseRpcUrl,
  validateTransaction,
  isBrowser,
  isNode,
  safeInt
} from './utils';

// Service registry helpers
export {
  fetchServiceRegistrySnapshotFromUrl,
  normalizeServiceRegistrySnapshot,
  normalizeServiceRegistryEntry,
  canonicalServiceId,
  enforceAllowedServices
} from './service-registry';

// SDK version and metadata
export const SDK_VERSION = '0.1.0';
export const SUPPORTED_NETWORKS = ['primum', 'testum', 'principalis'] as const;

/**
 * Default configuration for different networks
 */
export const DEFAULT_NETWORK_CONFIGS = {
  primum: {
    chainId: 0,
    url: 'ws://localhost:8545',
    gasPrice: '1000', // 1000 quar per gas
    features: {
      dualLayerConsensus: true,
      microscopicFees: true,
      instantFinality: true,
      computationalOrchestration: true
    }
  },
  testum: {
    chainId: 1,
    url: 'wss://testnet.omne.org',
    gasPrice: '500', // 500 quar per gas
    features: {
      dualLayerConsensus: true,
      microscopicFees: true,
      instantFinality: true,
      computationalOrchestration: false
    }
  },
  principalis: {
    chainId: 42,
    url: 'wss://mainnet.omne.org',
    gasPrice: '1000', // 1000 quar per gas
    features: {
      dualLayerConsensus: true,
      microscopicFees: true,
      instantFinality: true,
      computationalOrchestration: true
    }
  }
} as const;

/**
 * Create OmneClient with network defaults
 */
export function createClient(network: 'primum' | 'testum' | 'principalis' | string): OmneClient {
  if (network in DEFAULT_NETWORK_CONFIGS) {
    const config = DEFAULT_NETWORK_CONFIGS[network as keyof typeof DEFAULT_NETWORK_CONFIGS];
    return new OmneClient(config.url);
  }
  
  // Custom URL
  return new OmneClient(network);
}

/**
 * SDK information and feature detection
 */
export const SDK_INFO = {
  name: '@omne/sdk',
  version: SDK_VERSION,
  description: 'Official TypeScript/JavaScript SDK for Omne Blockchain',
  features: [
    'Dual-layer consensus support',
    'Microscopic fee calculations',
    'BIP39 HD wallets',
    'ORC-20 token operations',
    'Computational job submission',
    'Real-time event subscriptions',
    'Type-safe API bindings'
  ],
  compatibility: {
    node: '>=16.0.0',
    browsers: ['Chrome >= 80', 'Firefox >= 80', 'Safari >= 14', 'Edge >= 80']
  }
} as const;
