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
  generateDeploymentNonce,
  normaliseBearerToken
} from './secure-client';
import {
  DeploymentErrorResponse,
  DeploymentPlan,
  DeploymentPlanDetails,
  DeploymentPlanList,
  DeploymentPlanPagination,
  DeploymentPlanSummary,
  DeploymentNonceProvenance,
  DeploymentSubmissionResponse,
  ensureSignedCompilerAttachment
} from './signer';
import { assertRuntimeGuardrails } from './runtime-guardrails';

let cachedFetch: typeof fetch | null = null;
let cachedFetchSource: typeof globalThis.fetch | null = null;
let fetchPromise: Promise<typeof fetch> | null = null;

async function resolveFetch(): Promise<typeof fetch> {
  if (cachedFetch && cachedFetchSource === globalThis.fetch) {
    return cachedFetch;
  }

  if (typeof globalThis.fetch === 'function') {
    cachedFetch = globalThis.fetch.bind(globalThis);
    cachedFetchSource = globalThis.fetch;
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
          cachedFetchSource = null;
          return boundFetch;
        } catch (error) {
          cachedFetch = null;
          cachedFetchSource = null;
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
  metadataBaseUrl: string;
}

export interface DeploymentRequestOptions {
  authToken?: string;
  nonce?: string;
  headers?: Record<string, string>;
}

export interface DeploymentPlanListQuery {
  page?: number;
  pageSize?: number;
  network?: string;
  operatorId?: string;
  signerKey?: string;
  service?: string;
  digest?: string;
}

interface RawPlanSummary {
  plan_id?: unknown;
  network?: unknown;
  operator_id?: unknown;
  signer_key?: unknown;
  compiler_signer?: unknown;
  digest?: unknown;
  services?: unknown;
  deployment_nonce?: unknown;
  submitted_at?: unknown;
}

interface RawPagination {
  page?: unknown;
  page_size?: unknown;
  total?: unknown;
  next_page?: unknown;
}

interface RawPlanList {
  plans?: unknown;
  pagination?: unknown;
}

interface RawPlanDetails {
  plan?: unknown;
  plan_body?: unknown;
  submitted_at?: unknown;
}

interface RawNonceProvenance {
  nonce_hash?: unknown;
  plan_id?: unknown;
  operator_id?: unknown;
  signer_key?: unknown;
  compiler_signer?: unknown;
  digest?: unknown;
  first_seen_at?: unknown;
}

function serializePlanListQuery(query: DeploymentPlanListQuery): Record<string, string> {
  const params: Record<string, string> = {};

  if (typeof query.page === 'number' && Number.isFinite(query.page)) {
    params['page'] = Math.max(1, Math.trunc(query.page)).toString();
  }

  if (typeof query.pageSize === 'number' && Number.isFinite(query.pageSize)) {
    params['page_size'] = Math.max(1, Math.trunc(query.pageSize)).toString();
  }

  const maybeSet = (key: string, value?: string) => {
    if (value) {
      const trimmed = value.trim();
      if (trimmed) {
        params[key] = trimmed;
      }
    }
  };

  maybeSet('network', query.network);
  maybeSet('operator_id', query.operatorId);
  maybeSet('signer_key', query.signerKey);
  maybeSet('service', query.service);
  maybeSet('digest', query.digest);

  return params;
}

function normaliseString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return fallback;
  }
  return String(value);
}

function normaliseOptionalString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const str = normaliseString(value);
  return str ? str : null;
}

function normaliseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry as string);
}

function mapPlanSummary(raw: RawPlanSummary): DeploymentPlanSummary {
  return {
    planId: normaliseString(raw.plan_id),
    network: normaliseString(raw.network),
    operatorId: normaliseString(raw.operator_id),
    signerKey: normaliseString(raw.signer_key),
    compilerSigner: normaliseOptionalString(raw.compiler_signer),
    digest: normaliseString(raw.digest),
    services: toStringArray(raw.services),
    deploymentNonce: normaliseString(raw.deployment_nonce),
    submittedAt: normaliseString(raw.submitted_at),
  };
}

function mapPagination(raw: RawPagination | unknown): DeploymentPlanPagination {
  const pagination = (raw ?? {}) as RawPagination;
  return {
    page: Math.max(1, normaliseNumber(pagination.page, 1)),
    pageSize: Math.max(1, normaliseNumber(pagination.page_size, 50)),
    total: Math.max(0, normaliseNumber(pagination.total, 0)),
    nextPage: normaliseOptionalString(pagination.next_page),
  };
}

function mapPlanList(raw: RawPlanList | unknown): DeploymentPlanList {
  const payload = (raw ?? {}) as RawPlanList;
  const plansSource = Array.isArray(payload.plans) ? payload.plans : [];
  const plans = plansSource.map((entry) => mapPlanSummary(entry as RawPlanSummary));
  return {
    plans,
    pagination: mapPagination(payload.pagination),
  };
}

function mapPlanDetails(raw: RawPlanDetails | unknown): DeploymentPlanDetails {
  const payload = (raw ?? {}) as RawPlanDetails;
  if (!payload.plan || typeof payload.plan !== 'object') {
    throw new Error('Plan metadata response is missing plan summary');
  }

  return {
    plan: mapPlanSummary(payload.plan as RawPlanSummary),
    planBody: (payload.plan_body ?? {}) as DeploymentPlan,
    submittedAt: normaliseString(payload.submitted_at),
  };
}

function mapNonceProvenance(raw: RawNonceProvenance | unknown): DeploymentNonceProvenance {
  const payload = (raw ?? {}) as RawNonceProvenance;
  return {
    nonceHash: normaliseString(payload.nonce_hash),
    planId: normaliseString(payload.plan_id),
    operatorId: normaliseString(payload.operator_id),
    signerKey: normaliseString(payload.signer_key),
    compilerSigner: normaliseOptionalString(payload.compiler_signer),
    digest: normaliseString(payload.digest),
    firstSeenAt: normaliseString(payload.first_seen_at),
  };
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

function deriveMetadataBaseUrl(deploymentUrl: string): string {
  try {
    const parsed = new URL(deploymentUrl);
    const trimmed = parsed.pathname.replace(/\/+$/, '');
    if (trimmed.endsWith('/deployments')) {
      parsed.pathname = `${trimmed.slice(0, -'/deployments'.length)}/`;
    } else {
      parsed.pathname = trimmed ? `${trimmed.replace(/\/+$/, '')}/` : '/';
    }
    return parsed.toString();
  } catch {
    const withoutDeployments = deploymentUrl.replace(/\/deployments\/?$/, '/');
    if (withoutDeployments.endsWith('/')) {
      return withoutDeployments;
    }
    return `${withoutDeployments}/`;
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
      const deploymentUrl = deriveDeploymentUrl(config);
      this.config = {
        url: config,
        deploymentUrl,
        timeout: 30000,
        retries: 3,
        retryDelay: 1000,
        headers: {},
        nonceFactory: generateDeploymentNonce,
        metadataBaseUrl: deriveMetadataBaseUrl(deploymentUrl),
      };
    } else {
      const resolvedUrl = config.url;
      const deploymentUrl = deriveDeploymentUrl(resolvedUrl, config.deploymentUrl);
      this.config = {
        url: resolvedUrl,
        deploymentUrl,
        timeout: config.timeout ?? 30000,
        retries: config.retries ?? 3,
        retryDelay: config.retryDelay ?? 1000,
        headers: config.headers ?? {},
        authToken: config.authToken,
        nonceFactory: config.nonceFactory ?? generateDeploymentNonce,
        metadataBaseUrl: deriveMetadataBaseUrl(deploymentUrl),
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

    assertRuntimeGuardrails(
      plan.execution.tier,
      plan.execution.config ?? {},
      plan.execution.preview_summary ?? null
    );

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

  async listDeploymentPlans(query: DeploymentPlanListQuery = {}): Promise<DeploymentPlanList> {
    const parameters = serializePlanListQuery(query);
    const { response, url } = await this.fetchMetadata('plans', parameters);
    const payload = await this.parseJsonPayload(response);

    if (response.status === 200) {
      try {
        return mapPlanList(payload);
      } catch (error) {
        throw new NetworkError(
          'Deployment metadata endpoint returned malformed response payload',
          response.status,
          payload,
          {
            url,
            originalError: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (response.status === 501) {
      throw new GuardrailError('Deployment metadata endpoint is not enabled on this node.', {
        statusCode: response.status,
        url,
      });
    }

    throw NetworkError.fromResponse(response, payload);
  }

  async getDeploymentPlan(planId: string): Promise<DeploymentPlanDetails | null> {
    if (!planId || typeof planId !== 'string') {
      throw new ValidationError('planId must be a non-empty string', 'planId', planId);
    }

    const { response, url } = await this.fetchMetadata(`plans/${encodeURIComponent(planId)}`);
    const payload = await this.parseJsonPayload(response);

    if (response.status === 200) {
      try {
        return mapPlanDetails(payload);
      } catch (error) {
        throw new NetworkError(
          'Deployment metadata endpoint returned malformed response payload',
          response.status,
          payload,
          {
            url,
            originalError: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (response.status === 404) {
      return null;
    }

    if (response.status === 501) {
      throw new GuardrailError('Deployment metadata endpoint is not enabled on this node.', {
        statusCode: response.status,
        url,
      });
    }

    throw NetworkError.fromResponse(response, payload);
  }

  async getDeploymentPlanByDigest(digest: string): Promise<DeploymentPlanDetails | null> {
    if (!digest || typeof digest !== 'string') {
      throw new ValidationError('digest must be a non-empty string', 'digest', digest);
    }

    const { response, url } = await this.fetchMetadata(`plans/digest/${encodeURIComponent(digest)}`);
    const payload = await this.parseJsonPayload(response);

    if (response.status === 200) {
      try {
        return mapPlanDetails(payload);
      } catch (error) {
        throw new NetworkError(
          'Deployment metadata endpoint returned malformed response payload',
          response.status,
          payload,
          {
            url,
            originalError: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (response.status === 404) {
      return null;
    }

    if (response.status === 501) {
      throw new GuardrailError('Deployment metadata endpoint is not enabled on this node.', {
        statusCode: response.status,
        url,
      });
    }

    throw NetworkError.fromResponse(response, payload);
  }

  async getNonceProvenance(nonceHash: string): Promise<DeploymentNonceProvenance | null> {
    if (!nonceHash || typeof nonceHash !== 'string') {
      throw new ValidationError('nonceHash must be a non-empty string', 'nonceHash', nonceHash);
    }

    const { response, url } = await this.fetchMetadata(`provenance/${encodeURIComponent(nonceHash)}`);
    const payload = await this.parseJsonPayload(response);

    if (response.status === 200) {
      try {
        return mapNonceProvenance(payload);
      } catch (error) {
        throw new NetworkError(
          'Deployment metadata endpoint returned malformed response payload',
          response.status,
          payload,
          {
            url,
            originalError: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    if (response.status === 404) {
      return null;
    }

    if (response.status === 501) {
      throw new GuardrailError('Deployment metadata endpoint is not enabled on this node.', {
        statusCode: response.status,
        url,
      });
    }

    throw NetworkError.fromResponse(response, payload);
  }

  private async fetchMetadata(
    path: string,
    query?: Record<string, string>
  ): Promise<{ response: Response; url: string }> {
    const fetchFn = await resolveFetch();
    const requestUrl = this.buildMetadataUrl(path, query);
    const headers = this.buildMetadataHeaders();

    const response = await fetchFn(requestUrl, {
      method: 'GET',
      headers,
    });

    return { response, url: requestUrl };
  }

  private buildMetadataUrl(path: string, query?: Record<string, string>): string {
    const base = this.config.metadataBaseUrl;
    const normalisedPath = path.startsWith('/') ? path.slice(1) : path;

    try {
      const url = new URL(normalisedPath, base);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          if (value !== undefined) {
            url.searchParams.set(key, value);
          }
        }
      }
      return url.toString();
    } catch {
      let prefix = base.endsWith('/') ? base : `${base}/`;
      let fullPath = `${prefix}${normalisedPath}`;
      if (query && Object.keys(query).length > 0) {
        const params = new URLSearchParams(query);
        fullPath = `${fullPath}?${params.toString()}`;
      }
      return fullPath;
    }
  }

  private buildMetadataHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...this.config.headers };
    const authToken = this.config.authToken;
    if (authToken && !headers['Authorization']) {
      const normalised = normaliseBearerToken(authToken);
      if (normalised) {
        headers['Authorization'] = normalised;
      }
    }
    return headers;
  }

  private async parseJsonPayload(response: Response): Promise<any> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return undefined;
    }

    try {
      return await response.json();
    } catch {
      return undefined;
    }
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
