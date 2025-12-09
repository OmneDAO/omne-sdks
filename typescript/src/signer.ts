// Signer interface & adapters
// Provide a minimal Signer abstraction used by bindings and TxBuilder.

import { Transaction } from './types';

export interface Signer {
  // return address in Omne format (e.g., 'omne1...')
  getAddress(): Promise<string>;
  // sign a transaction object and return a signed transaction or signature blob
  signTransaction(tx: Transaction): Promise<Transaction & { signature?: string }>;
  // sign arbitrary message
  signMessage(message: string | Uint8Array): Promise<string>;
}

// Adapter for the built-in WalletAccount
import { WalletAccount } from './wallet';

export class WalletAccountSigner implements Signer {
  private account: WalletAccount;

  constructor(account: WalletAccount) {
    this.account = account;
  }

  async getAddress(): Promise<string> {
    return this.account.address;
  }

  async signTransaction(tx: Transaction): Promise<Transaction & { signature: string }> {
    return this.account.signTransaction(tx);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const toSign = typeof message === 'string' ? message : Buffer.from(message).toString('hex');
    return this.account.signMessage(toSign);
  }
}