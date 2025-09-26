/**
 * Type definitions for Omne SDK
 * 
 * Comprehensive type system supporting Omne's dual-layer consensus,
 * microscopic fee architecture, and ORC-20 token standard.
 */

import Big from 'big.js';

// === Core Blockchain Types ===

/**
 * Network types supported by Omne
 */
export type NetworkType = 'primum' | 'testum' | 'principalis';

/**
 * Transaction status enumeration
 */
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Transaction priority levels for dual-layer consensus
 */
export type TransactionPriority = 'commerce' | 'standard' | 'compute';

/**
 * Consensus layer types
 */
export type ConsensusLayer = 'commerce' | 'security';

/**
 * Network information structure
 */
export interface NetworkInfo {
  chainId: number;
  networkType: NetworkType;
  latestBlock: number;
  gasPrice: {
    base: string;      // Base gas price in quar
    commerce: string;  // Commerce layer gas price in quar  
    compute: string;   // Compute layer gas price in quar
  };
  features: {
    dualLayerConsensus: boolean;
    microscopicFees: boolean;
    instantFinality: boolean;
    computationalOrchestration: boolean;
  };
}

/**
 * Account balance information
 */
export interface Balance {
  address: string;
  balance: string;        // Balance in quar (10^-18 OMC precision)
  balanceOMC: string;     // Human-readable balance in OMC
  lastUpdated: number;    // Block number of last update
}

/**
 * Transaction structure compatible with Omne's dual-layer consensus
 */
export interface Transaction {
  hash?: string;
  from: string;
  to: string;
  value: string;          // Value in quar
  gasLimit: number;
  gasPrice: string;       // Gas price in quar
  nonce: number;
  data?: string;
  priority?: TransactionPriority;
  layer?: ConsensusLayer;
}

/**
 * Transaction receipt with execution details
 */
export interface TransactionReceipt {
  transactionHash: string;
  blockNumber: number;
  gasUsed: number;
  status: TransactionStatus;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
  contractAddress?: string;
  effectiveGasPrice: string;  // Actual gas price paid in quar
  layer: ConsensusLayer;      // Which layer processed the transaction
  confirmationTime: number;   // Time to confirmation in milliseconds
}

/**
 * Block information for dual-layer consensus
 */
export interface Block {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  gasLimit: number;
  gasUsed: number;
  transactionCount: number;
  transactions: string[];
  layer: ConsensusLayer;     // 'commerce' or 'security'
  consensusInfo: {
    blockTime: number;       // 3000ms for commerce, 540000ms for security
    finalityType: 'instant' | 'standard';
  };
}

// === ORC-20 Token Types ===

/**
 * ORC-20 token configuration
 */
export interface ORC20TokenConfig {
  maxSupply?: number;
  mintable?: boolean;
  burnable?: boolean;
  governanceEnabled?: boolean;
  transferFeeRate?: number;
  feeRecipient?: string;
  platformFeeSharing?: boolean;
  inheritsMicroscopicFees?: boolean;  // Inherit 50% fee discount
}

/**
 * ORC-20 token information
 */
export interface ORC20Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;      // Total supply in token units
  description?: string;
  applicationType?: string;
  features: string[];
  config: ORC20TokenConfig;
}

/**
 * Token balance information
 */
export interface TokenBalance {
  address: string;
  token: string;
  balance: string;
  decimals: number;
}

// === Dynamic Stake and Fee Estimation Types - BREAKTHROUGH OPTIMIZATION ===

/**
 * Dynamic stake requirements based on network conditions
 */
export interface DynamicStakeInfo {
  currentRequirement: string;  // Current dynamic stake requirement in OGT
  minimumStake: string;        // Absolute minimum stake in OGT
  maximumStake: string;        // Absolute maximum stake in OGT
  networkUtilization: number;  // Current network utilization (0-1)
  activeValidators: number;    // Number of active validators
  utilizationFactor: number;   // Applied utilization multiplier
  validatorDensityFactor: number; // Applied validator density multiplier
  lastUpdated: number;         // Block height of last calculation
}

/**
 * Comprehensive fee estimation for transactions
 */
export interface FeeEstimation {
  baseFee: string;            // Base transaction fee in quar
  crossSubsidyAmount: string; // Cross-subsidization discount in quar
  finalFee: string;          // Final fee after subsidization in quar
  subsidyRate: number;       // Applied subsidy rate (0.25-0.30)
  networkUtilization: number; // Current network utilization
  estimatedConfirmationTime: number; // Estimated confirmation time in ms
  feeBreakdown: {
    execution: string;        // Execution cost in quar
    storage: string;         // Storage cost in quar
    networkFee: string;      // Network maintenance fee in quar
    computationalRevenue: string; // Revenue generation component in quar
  };
}

/**
 * Validator performance metrics for bonus calculations
 */
export interface ValidatorPerformance {
  address: string;
  uptime: number;             // Uptime percentage (0-100)
  blockAccuracy: number;      // Block production accuracy (0-100)
  jobCompletionRate: number;  // Computational job completion rate (0-100)
  avgResponseTime: number;    // Average response time in milliseconds
  revenueGenerated: string;   // Total revenue generated in quar
  performanceBonus: string;   // Current performance bonus in quar
  longevityBonus: string;     // Current longevity bonus in quar
  totalReward: string;        // Total reward including bonuses in quar
  registrationBlock: number;  // Block height when validator registered
}

// === Computational Services Types ===

/**
 * Computational job types supported by OON
 */
export type JobType = 'ml_training' | 'rendering_3d' | 'data_processing' | 'custom';

/**
 * Job status enumeration
 */
export type JobStatus = 'submitted' | 'assigned' | 'processing' | 'completed' | 'failed';

/**
 * Computational job request
 */
export interface ComputationalJobRequest {
  jobType: JobType;
  dataSource: string;       // Data source URL or reference
  parameters: Record<string, any>;
  maxCostOMC: string;       // Maximum cost in OMC
  timeoutMinutes: number;
  priority: number;         // 1-10 priority level
  requirements: Record<string, any>;
}

/**
 * Computational job information
 */
export interface ComputationalJob {
  jobId: string;
  status: JobStatus;
  request: ComputationalJobRequest;
  assignedNode?: string;
  progress?: number;        // 0-100 completion percentage
  result?: {
    outputUrl: string;
    metadata: Record<string, any>;
    proofOfWork: string;    // Cryptographic proof of completion
  };
  costs: {
    estimated: string;      // Estimated cost in OMC
    actual?: string;        // Actual cost in OMC
  };
  timestamps: {
    submitted: number;
    assigned?: number;
    completed?: number;
  };
}

// === Wallet and Account Types ===

/**
 * Account information
 */
export interface Account {
  address: string;
  privateKey: string;       // Hex-encoded private key
  publicKey: string;        // Hex-encoded public key
  path?: string;            // BIP44 derivation path
}

/**
 * Wallet configuration
 */
export interface WalletConfig {
  mnemonic?: string;        // BIP39 mnemonic phrase
  password?: string;        // Optional password for mnemonic
  path?: string;            // Custom derivation path
  wordlist?: string[];      // Custom wordlist (default: English)
}

/**
 * Keystore format for wallet export/import
 */
export interface Keystore {
  version: number;
  id: string;
  address: string;
  crypto: {
    ciphertext: string;
    cipherparams: {
      iv: string;
    };
    cipher: string;
    kdf: string;
    kdfparams: {
      dklen: number;
      salt: string;
      n: number;
      r: number;
      p: number;
    };
    mac: string;
  };
}

// === Error Types ===

/**
 * Base error class for Omne SDK
 */
export interface OmneSDKError extends Error {
  code: string;
  details?: Record<string, any>;
}

/**
 * Network-related errors
 */
export interface NetworkError extends OmneSDKError {
  code: 'NETWORK_ERROR';
  statusCode?: number;
  response?: any;
}

/**
 * Transaction-related errors
 */
export interface TransactionError extends OmneSDKError {
  code: 'TRANSACTION_ERROR';
  txHash?: string;
  gasUsed?: number;
}

/**
 * Validation errors
 */
export interface ValidationError extends OmneSDKError {
  code: 'VALIDATION_ERROR';
  field?: string;
  value?: any;
}

/**
 * Wallet-related errors
 */
export interface WalletError extends OmneSDKError {
  code: 'WALLET_ERROR';
  operation?: string;
}

// === RPC Method Types ===

/**
 * JSON-RPC request structure
 */
export interface RPCRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any[];
  id: string | number;
}

/**
 * JSON-RPC response structure
 */
export interface RPCResponse<T = any> {
  jsonrpc: '2.0';
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

// === Utility Types ===

/**
 * Configuration options for OmneClient
 */
export interface ClientConfig {
  url: string;              // WebSocket or HTTP RPC URL
  timeout?: number;         // Request timeout in milliseconds
  retries?: number;         // Number of retry attempts
  retryDelay?: number;      // Delay between retries in milliseconds
  headers?: Record<string, string>;
}

/**
 * Event subscription types
 */
export type EventType = 'newBlock' | 'newTransaction' | 'tokenTransfer' | 'jobUpdate';

/**
 * Event callback function
 */
export type EventCallback<T = any> = (data: T) => void;

/**
 * Subscription management
 */
export interface Subscription {
  id: string;
  eventType: EventType;
  callback: EventCallback;
  unsubscribe: () => Promise<void>;
}

// === Constants ===

/**
 * Quar precision constants
 */
export const QUAR_PRECISION = 18;
export const QUAR_PER_OMC = Big('1000000000000000000'); // 10^18

/**
 * Default gas limits for different transaction types
 */
export const DEFAULT_GAS_LIMITS = {
  transfer: 21000,
  tokenTransfer: 50000,
  contractDeploy: 150000,
  orc20Deploy: 150000,
  computeJob: 100000
} as const;

/**
 * Default gas prices in quar
 */
export const DEFAULT_GAS_PRICES = {
  commerce: '500',    // 500 quar per gas
  standard: '1000',   // 1000 quar per gas  
  compute: '2000'     // 2000 quar per gas
} as const;
