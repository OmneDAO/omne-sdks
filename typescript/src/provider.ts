// Minimal RpcProvider wrapper around OmneClient
// Purpose: present a small, stable interface used by generated contract bindings.
// TODO: adjust imports to match actual OmneClient import path if different.

import { OmneClient } from './client';
import { Transaction, TransactionReceipt } from './types';
import { ValidationError } from './errors';

export interface RpcProviderOptions {
  url: string;
  timeoutMs?: number;
  retries?: number;
}

export class RpcProvider {
  private client: OmneClient;

  constructor(options: RpcProviderOptions) {
    if (!options?.url) throw ValidationError.missingField('url');
    this.client = new OmneClient({ url: options.url, timeout: options.timeoutMs ?? 30000, retries: options.retries ?? 3 });
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.disconnect();
  }

  async getNetworkInfo() {
    return this.client.getNetworkInfo();
  }

  async sendTransaction(tx: Transaction): Promise<TransactionReceipt> {
    return this.client.sendTransaction(tx);
  }

  async callRpc<T = any>(method: string, params?: any[]): Promise<T> {
    // Generic passthrough for contract query / custom RPC methods
    // uses internal client's request API
    // @ts-ignore - internal method used
    return (this.client as any).request(method, params || []);
  }

  getClient(): OmneClient {
    return this.client;
  }
}