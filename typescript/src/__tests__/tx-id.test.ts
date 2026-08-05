/**
 * Tessera transaction-id conformance, driven by the shared vectors.
 *
 * **The vector file is the contract, not this file.** Rust, Python and Go assert
 * against the same JSON. A transaction id is computed **client-side, before
 * submission** — so a divergence here shows a user one id while the chain
 * records another, and neither side finds out.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { TAG_TX, transactionId } from '../tx-id';

const V = join(__dirname, '../../../vectors');
const vectors = JSON.parse(readFileSync(join(V, 'tx_id_v1.json'), 'utf8'));

const hex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const toHex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('Tessera transaction id', () => {
  it('the domain tag is exactly 16 bytes and matches the vector file', () => {
    expect(TAG_TX.length).toBe(16);
    expect(vectors.domain_tag).toBe(TAG_TX);
  });

  it.each(vectors.cases.map((c: any) => [c.name, c]))('matches vector %s', (_name, c: any) => {
    const got = transactionId({
      chainId: hex(c.chain_id),
      sender: hex(c.sender),
      recipient: hex(c.recipient),
      // Decimal STRINGS in the vector: u128 does not survive JSON numbers, and a
      // silently truncated amount would change the id.
      amount: BigInt(c.amount),
      fee: BigInt(c.fee),
      nonce: BigInt(c.nonce),
    });
    expect(toHex(got)).toBe(c.tx_id);
  });

  it('every vector id is distinct', () => {
    const ids = vectors.cases.map((c: any) => c.tx_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects an address that is not 32 bytes rather than hashing it anyway', () => {
    const ok = {
      chainId: new Uint8Array(32),
      sender: new Uint8Array(32),
      recipient: new Uint8Array(32),
      amount: 0n,
      fee: 0n,
      nonce: 0n,
    };
    expect(() => transactionId({ ...ok, sender: new Uint8Array(31) })).toThrow();
    expect(() => transactionId({ ...ok, chainId: new Uint8Array(33) })).toThrow();
  });

  it('rejects a value too large for its field instead of silently truncating', () => {
    const ok = {
      chainId: new Uint8Array(32),
      sender: new Uint8Array(32),
      recipient: new Uint8Array(32),
      amount: 0n,
      fee: 0n,
      nonce: 0n,
    };
    expect(() => transactionId({ ...ok, amount: 1n << 128n })).toThrow();
    expect(() => transactionId({ ...ok, nonce: 1n << 64n })).toThrow();
  });
});
