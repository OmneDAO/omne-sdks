// Central transaction builder to canonicalize gas/nonce/priority handling
import { Transaction, TransactionPriority } from './types';
import { RpcProvider } from './provider';
import { Signer } from './signer';
import { toQuar } from './utils';

export interface TxBuildOptions {
  from: string;
  to: string;
  valueOMC?: string | number;
  data?: string;
  priority?: TransactionPriority;
  gasLimit?: number;
  gasPriceQuar?: string;
  nonce?: number;
  layer?: 'commerce' | 'security';
}

export class TxBuilder {
  private provider: RpcProvider;
  constructor(provider: RpcProvider) {
    this.provider = provider;
  }

  async build(txOpts: TxBuildOptions): Promise<Transaction> {
    const nonce = txOpts.nonce ?? await this.provider.getClient().getTransactionCount(txOpts.from);
    const gasLimit = txOpts.gasLimit ?? 21000;
    const gasPriceQuar = txOpts.gasPriceQuar ?? '1000';
    const value = txOpts.valueOMC ? toQuar(txOpts.valueOMC) : '0';

    return {
      from: txOpts.from,
      to: txOpts.to,
      value,
      gasLimit,
      gasPrice: gasPriceQuar,
      nonce,
      data: txOpts.data ?? '',
      priority: txOpts.priority ?? 'standard',
      layer: txOpts.layer
    } as Transaction;
  }

  async signAndSend(builderOpts: TxBuildOptions, signer: Signer) {
    const tx = await this.build(builderOpts);
    const signed = await signer.signTransaction(tx);
    // If signer returns signature wrapper, ensure tx contains signature field accepted by provider
    // Provider expects Transaction with core fields; real integration may require raw tx broadcast API
    return this.provider.sendTransaction(signed as Transaction);
  }
}