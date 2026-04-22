/**
 * Tests for OmneClient.sendRawTransaction — the pre-signed submission path
 * used when the signer and the relayer are different actors (e.g. a customer
 * signs locally under a passkey-gated key and a merchant backend relays).
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ValidationError } from '../errors';
import { OmneClient } from '../client';
import { WalletAccount } from '../wallet';
import { Transaction } from '../types';

describe('OmneClient.sendRawTransaction', () => {
  const privateKey = 'a'.repeat(64);
  const account = WalletAccount.fromPrivateKey(privateKey);
  const recipient = WalletAccount.fromPrivateKey('b'.repeat(64));

  const baseTx = (): Transaction => ({
    from: account.address,
    to: recipient.address,
    value: '1000000000000000000',
    gasLimit: 21000,
    gasPrice: '1000',
    nonce: 0,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  test('submits pre-signed transaction with nested signature shape', async () => {
    const signed = account.signTransaction(baseTx(), { chainId: 3 });
    const txHash = 'txn_' + 'a'.repeat(64);
    const fetchMock = mockSequence([
      { result: { transactionHash: txHash, status: 'pending' } },
      { result: { transactionHash: txHash, status: 'confirmed', blockNumber: 42, gasUsed: 21000, logs: [] } },
    ]);
    (globalThis as any).fetch = fetchMock;

    const client = new OmneClient({ url: 'http://127.0.0.1:8545' });
    const receipt = await client.sendRawTransaction(signed);

    expect(receipt.transactionHash).toBe(txHash);
    expect(fetchMock).toHaveBeenCalled();

    const submitCall = fetchMock.mock.calls[0] as [RequestInfo, RequestInit | undefined];
    const body = JSON.parse((submitCall[1]?.body as string) ?? '{}');
    expect(body.method).toBe('omne_sendTransaction');
    const payload = body.params[0];
    // Addresses pass through as om1z — same canonical form the wallet signed.
    expect(payload.from).toBe(signed.from);
    expect(payload.to).toBe(signed.to);
    expect(payload.chainId).toBe(3);
    expect(payload.value).toBe(signed.value);
    expect(payload.nonce).toBe(signed.nonce);
    // Flat {signature, publicKey} is repackaged into nested wire shape the node expects.
    expect(payload.signature).toEqual({
      signature: signed.signature,
      publicKey: signed.publicKey,
    });
  });

  test('rejects unsigned transaction', async () => {
    const client = new OmneClient({ url: 'http://127.0.0.1:8545' });
    await expect(
      client.sendRawTransaction(baseTx() as any)
    ).rejects.toThrow(ValidationError);
  });

  test('rejects transaction missing chainId', async () => {
    const signed = account.signTransaction(baseTx(), { chainId: 3 });
    const noChainId = { ...signed, chainId: undefined };
    const client = new OmneClient({ url: 'http://127.0.0.1:8545' });
    await expect(
      client.sendRawTransaction(noChainId as any)
    ).rejects.toThrow(/chainId/);
  });

  test('rejects malformed signature hex', async () => {
    const signed = account.signTransaction(baseTx(), { chainId: 3 });
    const bad = { ...signed, signature: 'not-hex' };
    const client = new OmneClient({ url: 'http://127.0.0.1:8545' });
    await expect(
      client.sendRawTransaction(bad)
    ).rejects.toThrow(/signature/);
  });

  test('does not re-sign — preserves signature byte-for-byte', async () => {
    const signed = account.signTransaction(baseTx(), { chainId: 3 });
    const originalSig = signed.signature;
    const txHash = 'txn_' + 'c'.repeat(64);
    (globalThis as any).fetch = mockSequence([
      { result: { transactionHash: txHash, status: 'pending' } },
      { result: { transactionHash: txHash, status: 'confirmed', blockNumber: 1, gasUsed: 21000, logs: [] } },
    ]);

    const client = new OmneClient({ url: 'http://127.0.0.1:8545' });
    await client.sendRawTransaction(signed);

    const call = ((globalThis as any).fetch as jest.Mock).mock.calls[0] as [RequestInfo, RequestInit | undefined];
    const body = JSON.parse((call[1]?.body as string) ?? '{}');
    expect(body.params[0].signature.signature).toBe(originalSig);
  });
});

function mockSequence(responses: Array<{ result?: unknown; error?: unknown }>): jest.Mock {
  let i = 0;
  return jest.fn(async () => {
    const payload = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: '1', ...payload }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  });
}
