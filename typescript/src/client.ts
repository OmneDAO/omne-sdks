/**
 * Omne Blockchain Client
 * 
 * Main client for interacting with Omne's dual-layer consensus blockchain.
 * Supports JSON-RPC over WebSocket and HTTP with comprehensive error handling.
 */

import { 
  NetworkInfo, 
  Balance, 
  Transaction, 
  TransactionReceipt, 
  Block,
  ORC20Token,
  ORC20TokenConfig,
  ComputationalJob,
  ComputationalJobRequest,
  ClientConfig,
  RPCRequest,
  RPCResponse,
  EventType,
  EventCallback,
  Subscription,
  TransactionPriority,
  DynamicStakeInfo,
  FeeEstimation,
  ValidatorPerformance,
  ServiceRegistrySnapshot
} from './types';
import { normalizeServiceRegistrySnapshot } from './service-registry';
import { 
  NetworkError, 
  RPCError, 
  TransactionError, 
  ValidationError,
  GuardrailError
} from './errors';
import { 
  generateRequestId, 
  parseRpcUrl, 
  validateTransaction, 
  isValidAddress,
  toQuar,
  fromQuar,
  retry,
  sleep,
  parseAddress,
  bufferToHex
} from './utils';
import { 
  SecureRequestManager, 
  RateLimiter,
  buildDeploymentHeaders,
  generateDeploymentNonce
} from './secure-client';
import {
  DeploymentErrorResponse,
  DeploymentPlan,
  DeploymentSubmissionResponse,
  ensureSignedCompilerAttachment
} from './signer';

let cachedFetch: typeof fetch | null = null;
let fetchPromise: Promise<typeof fetch> | null = null;

async function resolveFetch(): Promise<typeof fetch> {
  if (cachedFetch) {
    return cachedFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    cachedFetch = globalThis.fetch.bind(globalThis);
    return cachedFetch;
  }

  if (typeof process !== 'undefined' && process.release?.name === 'node') {
    if (!fetchPromise) {
      fetchPromise = (async () => {
        try {
          const mod: any = await import('node-fetch');
          const candidate = mod?.default ?? mod;

          if (typeof candidate !== 'function') {
            throw new Error('node-fetch did not expose a fetch function');
          }

          const boundFetch = candidate.bind(globalThis) as typeof fetch;
          cachedFetch = boundFetch;
          return boundFetch;
        } catch (error) {
          cachedFetch = null;
          fetchPromise = null;

          throw new NetworkError(
            'Global fetch is not available. Install node-fetch when running on Node.js < 18.',
            undefined,
            undefined,
            {
              originalError: error instanceof Error ? error.message : String(error)
            }
          );
        }
      })();
    }

    return fetchPromise!;
  }

  throw new NetworkError('Global fetch is not available. Provide a fetch polyfill when running outside browser environments.');
}

interface ResolvedClientConfig {
  url: string;
  deploymentUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  headers: Record<string, string>;
  authToken?: string;
  nonceFactory: () => string;
}

export interface DeploymentRequestOptions {
  authToken?: string;
  nonce?: string;
  headers?: Record<string, string>;
}

function deriveDeploymentUrl(baseUrl: string, explicit?: string): string {
  if (explicit) {
    return explicit;
  }

  try {
    const parsed = new URL(baseUrl);
    let protocol = parsed.protocol;
    if (protocol === 'ws:') {
      protocol = 'http:';
    } else if (protocol === 'wss:') {
      protocol = 'https:';
    }

    const origin = `${protocol}//${parsed.host}`;
    const resolved = new URL('/v1/deployments', origin);
    return resolved.toString();
  } catch {
    return baseUrl;
  }
}

function normalizeAddressToHex(address: string): string {
  const parsed = parseAddress(address);
  return bufferToHex(parsed.bytes);
}

function parseRpcBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return 0n;
    }
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0n;
    }
    if (trimmed === 'latest') {
      return 0n;
    }
    if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
      try {
        return BigInt(trimmed);
      } catch {
        return 0n;
      }
    }
    if (trimmed.includes('.')) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return BigInt(Math.trunc(numeric));
      }
      return 0n;
    }
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }

  return 0n;
}

function parseRpcNumber(value: unknown): number {
  return Number(parseRpcBigInt(value));
}

/**
 * Main Omne blockchain client
 */
export class OmneClient {
  private config: ResolvedClientConfig;
  private ws?: any; // Universal WebSocket type
  private isConnected: boolean = false;
  private secureRequestManager: SecureRequestManager;
  private rateLimiter: RateLimiter;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  private subscriptions = new Map<string, Subscription>();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;

  constructor(config: string | ClientConfig) {
    if (typeof config === 'string') {
      this.config = {
        url: config,
        deploymentUrl: deriveDeploymentUrl(config),
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        headers: {},
        nonceFactory: generateDeploymentNonce,
      };
    } else {
      const resolvedUrl = config.url;
      this.config = {
        url: resolvedUrl,
        deploymentUrl: deriveDeploymentUrl(resolvedUrl, config.deploymentUrl),
        timeout: config.timeout ?? 30000,
        retries: config.retries ?? 3,
        retryDelay: config.retryDelay ?? 1000,
        headers: config.headers ?? {},
        authToken: config.authToken,
        nonceFactory: config.nonceFactory ?? generateDeploymentNonce,
      };
    }

    // Initialize secure components
    this.secureRequestManager = new SecureRequestManager();
    this.rateLimiter = new RateLimiter({
      requestsPerSecond: 100,
      burstLimit: 10,
      windowMs: 1000
    });

    // Validate URL
    try {
      parseRpcUrl(this.config.url);
    } catch (error) {
      throw new ValidationError(`Invalid RPC URL: ${this.config.url}`, 'url', this.config.url);
    }
  }

  /**
   * Connect to the Omne node
   */
  async connect(): Promise<void> {
    const urlInfo = parseRpcUrl(this.config.url);
    
    if (urlInfo.protocol === 'ws' || urlInfo.protocol === 'wss') {
      await this.connectWebSocket();
    }
    // HTTP connections don't need persistent connection
  }

  /**
   * Disconnect from the Omne node
   */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.isConnected = false;
    
    // Clear pending requests
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new NetworkError('Client disconnected'));
    }
    this.pendingRequests.clear();
  }

  /**
   * Submit a hardened execution plan to the deployment API.
   */
  async deployExecutionPlan(
    plan: DeploymentPlan,
    options: DeploymentRequestOptions = {}
  ): Promise<DeploymentSubmissionResponse> {
    ensureSignedCompilerAttachment(plan);

    const planNonce = plan.contract?.deployment_nonce;
    if (!planNonce && !options.nonce) {
      throw new GuardrailError('Execution plan is missing the deployment nonce field', {
        reason: 'deployment_nonce_missing',
      });
    }

    const nonce = options.nonce ?? planNonce ?? this.config.nonceFactory();
    const authToken = options.authToken ?? this.config.authToken;
    const headerOverrides = {
      ...this.config.headers,
      ...(options.headers ?? {}),
    };

    const headers = buildDeploymentHeaders({
      nonce,
      authToken,
      headers: headerOverrides,
    });

    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchFn = await resolveFetch();
    const response = await fetchFn(this.config.deploymentUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(plan),
    });

    const contentType = response.headers.get('content-type') ?? '';
    let payload: any = undefined;

    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
    } else if (contentType) {
      payload = await response.text();
    }

    if (response.status === 202) {
      if (!payload || typeof payload !== 'object') {
        throw new NetworkError('Deployment endpoint returned malformed response payload', response.status, payload, {
          url: this.config.deploymentUrl,
        });
      }
      return payload as DeploymentSubmissionResponse;
    }

    const errorDetail =
      typeof payload === 'object' && payload !== null ? (payload as DeploymentErrorResponse).detail : undefined;

    if (response.status === 429) {
      const retryAfter =
        typeof payload === 'object' && payload !== null
          ? (payload as DeploymentErrorResponse).retry_after_seconds
          : undefined;
      const message = retryAfter
        ? `Deployment rejected: rate limit exceeded. Retry after ${retryAfter}s or request a higher limit.`
        : 'Deployment rejected: rate limit exceeded. Retry later or request a higher limit.';
      throw new GuardrailError(message, {
        statusCode: response.status,
        retry_after_seconds: retryAfter,
        response: payload,
      });
    }

    if (response.status === 403) {
      const message = errorDetail
        ? `Deployment rejected: access forbidden (${errorDetail}). Verify authentication token and permissions.`
        : 'Deployment rejected: access forbidden. Verify authentication token and permissions.';
      throw new GuardrailError(message, {
        statusCode: response.status,
        response: payload,
      });
    }

    if (response.status === 401) {
      const message = errorDetail
        ? `Deployment rejected: ${errorDetail}`
        : 'Deployment rejected: authentication token missing or invalid.';
      throw new GuardrailError(message, {
        statusCode: response.status,
        response: payload,
      });
    }

    if (response.status === 409) {
      throw new GuardrailError('Deployment rejected: duplicate nonce detected. Generate a new plan and retry.', {
        statusCode: response.status,
        response: payload,
      });
    }

    if (response.status === 400) {
      const message = errorDetail
        ? `Deployment rejected: ${errorDetail}`
        : 'Deployment rejected: invalid submission payload.';
      throw new GuardrailError(message, {
        statusCode: response.status,
        response: payload,
      });
    }

    if (response.status === 501) {
      throw new GuardrailError('Deployment API is not enabled on this node.', {
        statusCode: response.status,
        response: payload,
      });
    }

    throw NetworkError.fromResponse(response, payload);
  }

  /**
   * Get network information
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    return await this.request('omne_networkInfo');
  }

  /**
   * Fetch the hardened service registry snapshot.
   */
  async getServiceRegistry(): Promise<ServiceRegistrySnapshot> {
    const result = await this.request<any>('omne_getServiceRegistry', []);
    return normalizeServiceRegistrySnapshot(result);
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<Balance> {
    if (!isValidAddress(address)) {
      throw ValidationError.invalidAddress(address);
    }
    const hexAddress = normalizeAddressToHex(address);
    const result = await this.request<any>('omne_getBalance', [hexAddress]);

    const balanceQuarCandidate = result?.balanceQuar ?? result?.balance ?? '0';
    const balanceQuar = typeof balanceQuarCandidate === 'string'
      ? balanceQuarCandidate
      : String(balanceQuarCandidate ?? '0');

    const lastUpdatedCandidate = result?.lastUpdated ?? result?.blockNumber ?? 0;
    const lastUpdated = parseRpcNumber(lastUpdatedCandidate);

    return {
      address,
      balance: balanceQuar,
      balanceQuar,
      balanceOMC: fromQuar(balanceQuar).toString(),
      lastUpdated
    };
  }

  /**
   * Get transaction count (nonce) for address
   */
  async getTransactionCount(address: string): Promise<number> {
    if (!isValidAddress(address)) {
      throw ValidationError.invalidAddress(address);
    }
    const hexAddress = normalizeAddressToHex(address);
    const result = await this.request<any>('omne_getTransactionCount', [hexAddress]);

    if (typeof result === 'number') {
      return result;
    }
    if (typeof result === 'string') {
      return parseRpcNumber(result);
    }
    if (result && typeof result === 'object' && 'nonce' in result) {
      return parseRpcNumber((result as any).nonce);
    }
    return 0;
  }

  /**
   * Send a transaction
   */
  async sendTransaction(transaction: Transaction): Promise<TransactionReceipt> {
    // Validate transaction
    validateTransaction(transaction);

    // Set default priority if not specified
    if (!transaction.priority) {
      transaction.priority = 'standard';
    }

    // Submit transaction
    const normalizedTransaction: Transaction = {
      ...transaction,
      from: normalizeAddressToHex(transaction.from),
      to: normalizeAddressToHex(transaction.to)
    };

    const txHash = await this.request('omne_sendTransaction', [normalizedTransaction]);
    
    // Wait for confirmation
    return await this.waitForTransaction(txHash);
  }

  /**
   * Create and send a simple transfer transaction
   */
  async transfer(params: {
    from: string;
    to: string;
    valueOMC: string | number;
    gasLimit?: number;
    gasPriceQuar?: string;
    nonce?: number;
    priority?: TransactionPriority;
  }): Promise<TransactionReceipt> {
    if (!isValidAddress(params.from)) {
      throw ValidationError.invalidAddress(params.from);
    }
    if (!isValidAddress(params.to)) {
      throw ValidationError.invalidAddress(params.to);
    }

    const nonce = params.nonce ?? await this.getTransactionCount(params.from);
    const gasLimit = params.gasLimit ?? 21000;
    const gasPriceQuar = params.gasPriceQuar ?? '1000'; // Default 1000 quar per gas

    const transaction: Transaction = {
      from: params.from,
      to: params.to,
      value: toQuar(params.valueOMC),
      gasLimit,
      gasPrice: gasPriceQuar,
      nonce,
      priority: params.priority || 'standard'
    };

    return await this.sendTransaction(transaction);
  }

  /**
   * Deploy an ORC-20 token
   */
  async deployORC20Token(params: {
    name: string;
    symbol: string;
    totalSupply: string | number;
    decimals?: number;
    from: string;
    config?: Partial<ORC20TokenConfig>;
    gasLimit?: number;
    gasPriceQuar?: string;
    nonce?: number;
  }): Promise<{ token: ORC20Token; receipt: TransactionReceipt }> {
    if (!isValidAddress(params.from)) {
      throw ValidationError.invalidAddress(params.from);
    }

    const tokenConfig: ORC20TokenConfig = {
      inheritsMicroscopicFees: true,
      mintable: false,
      burnable: false,
      ...params.config
    };

    const deploymentData = {
      name: params.name,
      symbol: params.symbol,
      totalSupply: params.totalSupply.toString(),
      decimals: params.decimals ?? 18,
      config: tokenConfig
    };

    const result = await this.request('token_deploy', [
      params.from,
      deploymentData,
      {
        gasLimit: params.gasLimit ?? 150000,
        gasPrice: params.gasPriceQuar ?? '1000',
        nonce: params.nonce
      }
    ]);

    return {
      token: result.token,
      receipt: result.receipt
    };
  }

  /**
   * Get ORC-20 token information
   */
  async getTokenInfo(tokenAddress: string): Promise<ORC20Token> {
    if (!isValidAddress(tokenAddress)) {
      throw ValidationError.invalidAddress(tokenAddress);
    }

    return await this.request('token_info', [tokenAddress]);
  }

  /**
   * Get ORC-20 token balance for address
   */
  async getTokenBalance(tokenAddress: string, holderAddress: string): Promise<string> {
    if (!isValidAddress(tokenAddress)) {
      throw ValidationError.invalidAddress(tokenAddress);
    }
    if (!isValidAddress(holderAddress)) {
      throw ValidationError.invalidAddress(holderAddress);
    }

    const result = await this.request('token_balance', [tokenAddress, holderAddress]);
    return result.balance;
  }

  /**
   * Submit a computational job to OON
   */
  async submitComputationalJob(jobRequest: ComputationalJobRequest): Promise<ComputationalJob> {
    // Validate job request
    if (!jobRequest.jobType) {
      throw ValidationError.missingField('jobType');
    }
    if (!jobRequest.dataSource) {
      throw ValidationError.missingField('dataSource');
    }

    return await this.request('compute_submit', [jobRequest]);
  }

  /**
   * Get computational job status
   */
  async getJobStatus(jobId: string): Promise<ComputationalJob> {
    if (!jobId) {
      throw ValidationError.missingField('jobId');
    }

    return await this.request('compute_status', [jobId]);
  }

  /**
   * Get block information
   */
  async getBlock(blockNumber: number | 'latest'): Promise<Block> {
    return await this.request('omne_getBlockByNumber', [
      blockNumber === 'latest' ? 'latest' : `0x${blockNumber.toString(16)}`,
      false
    ]);
  }

  /**
   * Get transaction receipt
   */
  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    if (!txHash.startsWith('0x') || txHash.length !== 66) {
      throw ValidationError.invalidField('txHash', txHash);
    }

    try {
  return await this.request('omne_getTransactionReceipt', [txHash]);
    } catch (error) {
      if (error instanceof RPCError && error.rpcCode === -32000) {
        // Transaction not found
        return null;
      }
      throw error;
    }
  }

  /**
   * Wait for transaction confirmation
   */
  async waitForTransaction(
    txHash: string, 
    timeoutMs: number = 60000,
    pollingIntervalMs: number = 1000
  ): Promise<TransactionReceipt> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const receipt = await this.getTransactionReceipt(txHash);
      
      if (receipt) {
        if (receipt.status === 'failed') {
          throw TransactionError.failed(txHash, 'Transaction execution failed');
        }
        return receipt;
      }

      await sleep(pollingIntervalMs);
    }

    throw TransactionError.timeout(txHash, timeoutMs);
  }

  /**
   * Subscribe to events (WebSocket only)
   */
  async subscribe(eventType: EventType, callback: EventCallback): Promise<Subscription> {
    if (!this.isConnected || !this.ws) {
      throw new NetworkError('WebSocket connection required for subscriptions');
    }

    const subscriptionId = generateRequestId();
    const subscription: Subscription = {
      id: subscriptionId,
      eventType,
      callback,
      unsubscribe: async () => {
        await this.unsubscribe(subscriptionId);
      }
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Send subscription request
    await this.request('eth_subscribe', [eventType]);

    return subscription;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new ValidationError(`Subscription not found: ${subscriptionId}`);
    }

    this.subscriptions.delete(subscriptionId);
    
    if (this.isConnected && this.ws) {
      await this.request('eth_unsubscribe', [subscriptionId]);
    }
  }

  // Private methods

  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use browser WebSocket or Node.js WebSocket based on environment
      let WebSocketClass: any;
      
      if (typeof window !== 'undefined' && window.WebSocket) {
        // Browser environment
        WebSocketClass = window.WebSocket;
      } else {
        // Node.js environment
        try {
          WebSocketClass = require('ws');
        } catch (error) {
          throw new NetworkError('WebSocket not available in this environment');
        }
      }
      
      this.ws = new WebSocketClass(this.config.url);
      
      // Handle both browser and Node.js WebSocket APIs
      const onOpen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      };

      const onError = (event: any) => {
        if (!this.isConnected) {
          reject(NetworkError.connectionFailed(this.config.url, event.error || new Error('WebSocket connection failed')));
        }
      };

      const onClose = () => {
        this.isConnected = false;
        this.handleReconnect();
      };

      const onMessage = (event: any) => {
        const data = event.data || event; // Handle both browser and Node.js formats
        this.handleMessage(typeof data === 'string' ? data : data.toString());
      };
      
      // Attach listeners based on environment
      if (typeof window !== 'undefined' && window.WebSocket) {
        // Browser API
        this.ws.onopen = onOpen;
        this.ws.onerror = onError;
        this.ws.onclose = onClose;
        this.ws.onmessage = onMessage;
      } else {
        // Node.js API
        this.ws.on('open', onOpen);
        this.ws.on('error', onError);
        this.ws.on('close', onClose);
        this.ws.on('message', onMessage);
      }
    });
  }

  private async handleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.pow(2, this.reconnectAttempts) * 1000; // Exponential backoff

    await sleep(delay);

    try {
      await this.connectWebSocket();
    } catch (error) {
      // Reconnection failed, will try again on next close event
    }
  }

  private handleMessage(message: string): void {
    try {
      const data = JSON.parse(message);
      
      if (data.id) {
        // Response to a request
        const pending = this.pendingRequests.get(data.id.toString());
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(data.id.toString());
          
          if (data.error) {
            pending.reject(RPCError.fromRPCResponse(data.error));
          } else {
            pending.resolve(data.result);
          }
        }
      } else if (data.method === 'eth_subscription') {
        // Event notification
        this.handleEvent(data.params);
      }
    } catch (error) {
      // Invalid JSON, ignore
    }
  }

  private handleEvent(params: any): void {
    const subscriptionId = params.subscription;
    const eventData = params.result;
    
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      try {
        subscription.callback(eventData);
      } catch (error) {
        // Callback error, log but don't break
        console.error('Error in event callback:', error);
      }
    }
  }

  private async request<T = any>(method: string, params?: any[]): Promise<T> {
    // Check rate limiting
    if (!this.rateLimiter.isAllowed()) {
      const delay = this.rateLimiter.getRetryDelay();
      throw new Error(`Rate limit exceeded. Retry after ${delay}ms`);
    }

    const requestId = this.secureRequestManager.generateRequestId();
    const request: RPCRequest = {
      jsonrpc: '2.0',
      method,
      params: params || [],
      id: requestId
    };

    return await retry(
      async () => await this.sendRequest<T>(request),
      this.config.retries,
      this.config.retryDelay
    );
  }

  private async sendRequest<T>(request: RPCRequest): Promise<T> {
    const urlInfo = parseRpcUrl(this.config.url);
    
    if (urlInfo.protocol === 'ws' || urlInfo.protocol === 'wss') {
      return await this.sendWebSocketRequest<T>(request);
    } else {
      return await this.sendHttpRequest<T>(request);
    }
  }

  private async sendWebSocketRequest<T>(request: RPCRequest): Promise<T> {
    if (!this.isConnected || !this.ws) {
      throw new NetworkError('WebSocket not connected');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id.toString());
        reject(NetworkError.timeout(this.config.url, this.config.timeout));
      }, this.config.timeout);

      this.pendingRequests.set(request.id.toString(), {
        resolve,
        reject,
        timeout
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  private async sendHttpRequest<T>(request: RPCRequest): Promise<T> {
    try {
      const fetchFn = await resolveFetch();
  const response = await fetchFn(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const responseBody = await response.text();
        throw NetworkError.fromResponse(response, responseBody);
      }

      const data: RPCResponse<T> = await response.json();
      
      if (data.error) {
        throw RPCError.fromRPCResponse(data.error);
      }

      return data.result!;
    } catch (error) {
      if (error instanceof NetworkError || error instanceof RPCError) {
        throw error;
      }
      throw NetworkError.connectionFailed(this.config.url, error as Error);
    }
  }

  // === Dynamic Stake and Fee Estimation - BREAKTHROUGH OPTIMIZATION ===

  /**
   * Get current dynamic stake requirements based on network conditions
   */
  async getDynamicStakeInfo(): Promise<DynamicStakeInfo> {
    return this.request('omne_getDynamicStakeInfo', []);
  }

  /**
   * Estimate transaction fees with intelligent cross-subsidization
   */
  async estimateFees(transaction: Partial<Transaction>): Promise<FeeEstimation> {
    return this.request('omne_estimateFees', [transaction]);
  }

  /**
   * Get validator performance metrics for bonus calculations
   */
  async getValidatorPerformance(validatorAddress: string): Promise<ValidatorPerformance> {
    if (!isValidAddress(validatorAddress)) {
      throw ValidationError.invalidField('validatorAddress', validatorAddress);
    }
    return this.request('omne_getValidatorPerformance', [validatorAddress]);
  }

  /**
   * Calculate potential validator rewards including performance and longevity bonuses
   */
  async calculateValidatorRewards(validatorAddress: string, baseReward?: string): Promise<{
    baseReward: string;
    performanceBonus: string;
    longevityBonus: string;
    totalReward: string;
    bonusPercentage: number;
  }> {
    const params = baseReward ? [validatorAddress, baseReward] : [validatorAddress];
    return this.request('omne_calculateValidatorRewards', params);
  }

  /**
   * Get network utilization metrics for dynamic calculations
   */
  async getNetworkMetrics(): Promise<{
    utilization: number;
    activeValidators: number;
    averageStake: string;
    totalStaked: string;
    networkHealth: number;
    crossSubsidyRate: number;
    computationalRevenue: string;
  }> {
    return this.request('omne_getNetworkMetrics', []);
  }

  /**
   * Estimate optimal stake amount for validator registration
   */
  async estimateOptimalStake(targetPerformance?: number): Promise<{
    recommendedStake: string;
    minimumRequired: string;
    expectedReturns: {
      monthly: string;
      annual: string;
    };
    riskFactors: string[];
  }> {
    const params = targetPerformance ? [targetPerformance] : [];
    return this.request('omne_estimateOptimalStake', params);
  }
}

// Extend TransactionError for timeout
declare module './errors' {
  namespace TransactionError {
    function timeout(txHash: string, timeoutMs: number): TransactionError;
  }
}

TransactionError.timeout = function(txHash: string, timeoutMs: number): TransactionError {
  return new TransactionError(
    `Transaction confirmation timeout after ${timeoutMs}ms`,
    txHash,
    undefined,
    { timeout: timeoutMs, operation: 'confirmation_wait' }
  );
};

// Extend ValidationError for invalid field
declare module './errors' {
  namespace ValidationError {
    function invalidField(field: string, value: any): ValidationError;
  }
}

ValidationError.invalidField = function(field: string, value: any): ValidationError {
  return new ValidationError(
    `Invalid ${field}: ${value}`,
    field,
    value
  );
};
