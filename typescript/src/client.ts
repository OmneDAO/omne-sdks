/**
 * Omne Blockchain Client
 * 
 * Main client for interacting with Omne's dual-layer consensus blockchain.
 * Supports JSON-RPC over WebSocket and HTTP with comprehensive error handling.
 */

import WebSocket from 'ws';
import fetch from 'cross-fetch';
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
  TransactionPriority
} from './types';
import { 
  NetworkError, 
  RPCError, 
  TransactionError, 
  ValidationError
} from './errors';
import { 
  generateRequestId, 
  parseRpcUrl, 
  validateTransaction, 
  isValidAddress,
  toQuar,
  retry,
  sleep
} from './utils';
import { 
  SecureRequestManager, 
  RateLimiter
} from './secure-client';

/**
 * Main Omne blockchain client
 */
export class OmneClient {
  private config: Required<ClientConfig>;
  private ws?: WebSocket;
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
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        headers: {}
      };
    } else {
      this.config = {
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        headers: {},
        ...config
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
   * Get network information
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    return await this.request('net_info');
  }

  /**
   * Get account balance
   */
  async getBalance(address: string): Promise<Balance> {
    if (!isValidAddress(address)) {
      throw ValidationError.invalidAddress(address);
    }

    return await this.request('account_balance', [address]);
  }

  /**
   * Get transaction count (nonce) for address
   */
  async getTransactionCount(address: string): Promise<number> {
    if (!isValidAddress(address)) {
      throw ValidationError.invalidAddress(address);
    }

    const result = await this.request('account_info', [address]);
    return result.nonce || 0;
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
    const txHash = await this.request('tx_send', [transaction]);
    
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
    return await this.request('eth_getBlockByNumber', [
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
      return await this.request('tx_receipt', [txHash]);
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
      this.ws = new WebSocket(this.config.url);
      
      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('error', (error) => {
        if (!this.isConnected) {
          reject(NetworkError.connectionFailed(this.config.url, error));
        }
      });

      this.ws.on('close', () => {
        this.isConnected = false;
        this.handleReconnect();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });
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
      const response = await fetch(this.config.url, {
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
