/**
 * **Tessera transaction identity.** `Transaction::id` in `node/src/blocks/tx.rs`.
 *
 * The id is SHA-256 over the domain-tagged, length-framed **intent** — chain id,
 * sender, recipient, amount, fee, nonce. The signature and public key are *not*
 * in the preimage, so a client derives the id **locally, before signing and
 * before submitting**, and it is the id the chain will record.
 *
 * ## Not `hash_transaction`
 *
 * The older `hash_transaction` in this package targets the **archived** chain:
 * no domain tag, no length framing, and a different field set
 * (`gasLimit`/`gasPrice`/`data` rather than `fee`). It cannot produce a Tessera
 * id and the two must not be confused.
 *
 * ## Why this file exists
 *
 * Conformance is driven by `vectors/tx_id_v1.json`, shared with the Rust
 * implementation. A divergence here shows a user one transaction id while the
 * chain records another — and neither side would notice.
 */

import { digest } from './oma1';

/** 16-byte domain tag. Note the trailing dot: the tag is padded to 16 bytes. */
export const TAG_TX = 'omne.tx.body.v1.';

export interface TransactionIntent {
  /** The chain's genesis root, 32 bytes. */
  chainId: Uint8Array;
  /** 32-byte raw address. Decode `om1…` forms before calling. */
  sender: Uint8Array;
  recipient: Uint8Array;
  amount: bigint;
  fee: bigint;
  nonce: bigint;
}

/** Little-endian encoding of an unsigned integer into `n` bytes. */
function le(value: bigint, n: number): Uint8Array {
  if (value < 0n) throw new Error('tx-id: negative value');
  const out = new Uint8Array(n);
  let v = value;
  for (let i = 0; i < n; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`tx-id: value does not fit in ${n} bytes`);
  return out;
}

function expect32(b: Uint8Array, what: string): Uint8Array {
  if (b.length !== 32) throw new Error(`tx-id: ${what} must be 32 bytes, got ${b.length}`);
  return b;
}

/**
 * The transaction id a Tessera node will derive for this intent.
 *
 * Field order is normative and matches the Rust preimage exactly.
 */
export function transactionId(tx: TransactionIntent): Uint8Array {
  return digest(TAG_TX, [
    expect32(tx.chainId, 'chainId'),
    expect32(tx.sender, 'sender'),
    expect32(tx.recipient, 'recipient'),
    le(tx.amount, 16),
    le(tx.fee, 16),
    le(tx.nonce, 8),
  ]);
}
