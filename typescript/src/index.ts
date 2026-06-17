/**
 * Omne TypeScript SDK
 * 
 * Official TypeScript/JavaScript SDK for Omne Blockchain
 * Commerce-first blockchain with dual-layer consensus and microscopic fees
 */

import { OmneClient } from './client';

// Core client and wallet exports
export { OmneClient } from './client';
export type { DeploymentRequestOptions, DeploymentPlanListQuery } from './client';
export { Wallet, WalletAccount, WalletManager } from './wallet';

// Contract abstraction
export {
  OmneContract,
  AbiEncode,
  ArgType,
  encodeContractCall,
  isAbiEncoded,
} from './contract';
export type {
  AbiArgument,
  ContractCallOptions,
  ContractQueryResult,
} from './contract';

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
  deriveAddressFromPublicKey,
  verifyMlDsa44Signature,
  verifyMessageSignature,
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

export {
  generateDeploymentNonce,
  buildDeploymentHeaders,
  normaliseBearerToken,
} from './secure-client';

export {
  ensureSignedCompilerAttachment,
  type CompilerAttachment,
  type CompilerMetadata,
  type CompilerMetadataSignature,
  type HardenedExecutionConfig,
  type ExecutionPreviewSummary,
  type DeploymentPlan,
  type DeploymentSubmissionResponse,
  type DeploymentPlanSummary,
  type DeploymentPlanList,
  type DeploymentPlanDetails,
  type DeploymentPlanPagination,
  type DeploymentNonceProvenance,
} from './signer';

export {
  assertRuntimeGuardrails,
  runtimeGuardrailsForTier,
  RUNTIME_GUARDRAILS,
  type RuntimeGuardrails,
  type RuntimeTier,
} from './runtime-guardrails';

// Service registry helpers
export {
  fetchServiceRegistrySnapshotFromUrl,
  normalizeServiceRegistrySnapshot,
  normalizeServiceRegistryEntry,
  canonicalServiceId,
  enforceAllowedServices
} from './service-registry';

// OMP (Omne Media Protocol) storage client
export {
  OmpClient,
  OMP_CHUNK_SIZE,
  OMP_MIN_REDUNDANCY,
  OMP_MAX_REDUNDANCY,
  OMP_DEFAULT_REDUNDANCY,
} from './omp';
export type {
  OmpClientConfig,
  OmpStoreOptions,
  OmpStoreResult,
  OmpPreparedAsset,
  OmpManifest,
  OmpRetrievalPlan,
  OmpRetrievalChunk,
  OmpStorageStats,
  OmpChunkInfo,
  OmpStorageTier,
  OmpErasureCodec,
  OmpAssetStatus,
  OmpRegisterNodeOptions,
  OmpStorageCapabilities,
  OmpNodeContactInfo,
} from './omp';

export { setPlatformProviders } from './platform/context';
export type { PlatformProviders } from './platform/providers';

// SDK version and metadata
export const SDK_VERSION = '2.0.1';
export const SUPPORTED_NETWORKS = ['primum', 'testum', 'principalis'] as const;

/**
 * Default configuration for different networks.
 *
 * Note the deliberate separation between SDK environment-role keys
 * (`primum`, `testum`, `principalis`) and deployed-network codenames
 * (Ignis devnet, Testum testnet, Primum mainnet). To connect to the live
 * **Ignis** devnet, construct the client directly with the RPC URL:
 *   new OmneClient('wss://rpc.ignis.omnechain.network')
 *
 * The `createClient(role)` factory targets role defaults; override URLs
 * for deployed networks as needed.
 */
export const DEFAULT_NETWORK_CONFIGS = {
  primum: {
    chainId: 0,
    url: 'ws://localhost:9944',
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
