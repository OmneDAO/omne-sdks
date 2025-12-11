/**
 * Secure client utilities for TypeScript SDK
 */

import { generateSecureRandom } from './secure-crypto';
import { hexToBuffer } from './utils';

export interface DeploymentHeaderOptions {
  nonce?: string;
  authToken?: string;
  headers?: SecurityHeaders;
  extra?: Record<string, string>;
}

export function generateDeploymentNonce(): string {
  return generateSecureRandom(16);
}

export function normaliseBearerToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  const bearerMatch = trimmed.match(/^bearer\s+(.+)$/i);
  if (bearerMatch) {
    return `Bearer ${bearerMatch[1].trim()}`;
  }

  return `Bearer ${trimmed}`;
}

export function buildDeploymentHeaders(options: DeploymentHeaderOptions): SecurityHeaders {
  const nonce = options.nonce ?? generateDeploymentNonce();

  const base: SecurityHeaders = {
    'X-Omne-Nonce': nonce,
  };

  const normalisedToken = normaliseBearerToken(options.authToken);
  if (normalisedToken) {
    base['Authorization'] = normalisedToken;
  }

  if (options.headers) {
    Object.assign(base, options.headers);
  }

  if (options.extra) {
    Object.assign(base, options.extra);
  }

  return base;
}

export class SecureRequestManager {
  private requestCounter: number = 0;

  /**
   * Generate cryptographically secure request ID
   */
  generateRequestId(): string {
    // Combine secure random with timestamp and counter
    const timestamp = Date.now().toString(16);
    const randomPart = generateSecureRandom(8);
    const counter = (++this.requestCounter).toString(16).padStart(4, '0');
    
    return `${timestamp}-${randomPart}-${counter}`;
  }

  /**
   * Generate numeric request ID for JSON-RPC
   */
  generateNumericRequestId(): number {
    // Use secure random for numeric ID
  const randomBytes = hexToBuffer(generateSecureRandom(4));
  const view = new DataView(randomBytes.buffer, randomBytes.byteOffset, randomBytes.byteLength);
  let id = view.getUint32(0, false);
    
    // Ensure positive number
    id = Math.abs(id);
    
    // Ensure non-zero
    if (id === 0) {
      id = 1;
    }
    
    return id;
  }
}

export interface RateLimitConfig {
  requestsPerSecond: number;
  burstLimit: number;
  windowMs: number;
}

export class RateLimiter {
  private requests: number[] = [];
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  /**
   * Check if request is allowed under rate limit
   */
  isAllowed(): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(timestamp => timestamp > windowStart);
    
    // Check if under rate limit
    if (this.requests.length < this.config.requestsPerSecond) {
      this.requests.push(now);
      return true;
    }
    
    return false;
  }

  /**
   * Get delay until next request is allowed
   */
  getRetryDelay(): number {
    if (this.requests.length === 0) {
      return 0;
    }
    
    const oldestRequest = this.requests[0];
    const windowEnd = oldestRequest + this.config.windowMs;
    const now = Date.now();
    
    return Math.max(0, windowEnd - now);
  }

  /**
   * Reset rate limiter
   */
  reset(): void {
    this.requests = [];
  }
}

export interface SecurityHeaders {
  [key: string]: string;
}

/**
 * Get security headers for HTTP requests
 */
export function getSecurityHeaders(): SecurityHeaders {
  return {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'none'; connect-src 'self'"
  };
}

/**
 * Secure WebSocket connection options
 */
export interface SecureWebSocketOptions {
  rejectUnauthorized: boolean;
  checkServerIdentity?: (servername: string, cert: any) => Error | undefined;
  protocols?: string[];
  headers?: SecurityHeaders;
}

/**
 * Get secure WebSocket options
 */
export function getSecureWebSocketOptions(options: Partial<SecureWebSocketOptions> = {}): SecureWebSocketOptions {
  return {
    rejectUnauthorized: true,
    protocols: ['omne-v1'],
    headers: getSecurityHeaders(),
    ...options
  };
}