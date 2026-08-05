/**
 * OMA-1 and OMS-1 — the canonical Omne address and mnemonic schemes.
 *
 * These replace the pre-genesis derivation entirely. The differences from the
 * old `om1z…` scheme are not cosmetic — every one of them changes the bytes:
 *
 *   old: address = SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey), bech32m with
 *        witness version 2, ~59 chars
 *   new: address = SHA-256(TAG_EOA || u32le(len) || pubkey), PLAIN bech32m
 *        with no witness version, exactly 61 chars
 *
 * Three reasons the old form is gone:
 *
 *   - The tag was not length-framed, so field boundaries in the preimage were a
 *     convention rather than a fact.
 *   - The witness version made the address a segwit-shaped thing it is not; a
 *     32-byte payload with no version is simply a payload.
 *   - `OMNE_PQC_ADDRESS_V1` is 19 bytes. All OMA-1 tags are exactly 16, which
 *     makes them pairwise prefix-free by construction rather than by luck.
 *
 * The ML-DSA-44 keygen underneath is UNCHANGED and already parity-matched: the
 * Rust node's `fips204` reproduces `@noble`'s public keys byte for byte, which
 * is pinned as a test on both sides. Only the address and the mnemonic moved.
 *
 * Conformance is asserted against the shared vectors in `../../vectors/`, which
 * are copied from tessera. Reimplementing the spec and testing against your own
 * output proves only self-consistency.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bech32m } from '@scure/base';
import { utf8ToBytes } from '@noble/hashes/utils';

/** Human-readable part. Every network — see below. */
export const HRP = 'om';

/** Exact encoded length: `om1` + 58. */
export const ADDRESS_STR_LEN = 61;

/** FIPS 204 ML-DSA-44 public key length. */
export const ML_DSA_44_PUBKEY_LEN = 1312;

/** Domain tags. Every one exactly 16 ASCII bytes. */
export const TAG_EOA = 'omne.addr.eoa.v1';
export const TAG_CTR = 'omne.addr.ctr.v1';
export const TAG_SYS = 'omne.addr.sys.v1';
export const TAG_WSM = 'omne.code.wsm.v1';
/** OMS-1 seed derivation tag. */
export const TAG_SEED = 'omne.seed.mld.v1';

/**
 * The closed registry of protocol-reserved accounts. **Three, not five.**
 *
 * `fee.vault` and `validator.fee.pool` were removed before genesis: both
 * presuppose fees flow somewhere, and fees are burned. Neither had a source.
 */
export const SYSTEM_ACCOUNTS = ['treasury', 'gas.paymaster', 'slash.sink'] as const;

/** OMS-1: words in a phrase. */
export const WORD_COUNT = 24;

/**
 * `u32le(len) || bytes` — the only way a field is ever written.
 *
 * The exemption is what kills you: "this one is always 32 bytes so the prefix is
 * redundant" holds right until a second fixed-width field sits beside it, at
 * which point two different pairs share one preimage.
 */
function frame(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true); // little-endian
  out.set(bytes, 4);
  return out;
}

/**
 * SHA-256 over a 16-byte domain tag followed by length-framed fields.
 *
 * **Exported so there is exactly ONE framing implementation in this package.**
 * §R0.2 requires a single implementation of a canonical preimage; a second copy
 * in a transaction module would be pinned by a test that can only fail *after*
 * someone edits one side.
 */
export function digest(tag: string, fields: Uint8Array[]): Uint8Array {
  const tagBytes = utf8ToBytes(tag);
  if (tagBytes.length !== 16) throw new Error(`domain tag must be 16 bytes: ${tag}`);
  const parts = [tagBytes, ...fields.map(frame)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const pre = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    pre.set(p, o);
    o += p.length;
  }
  return sha256(pre);
}

/**
 * Encode a 32-byte payload as `om1…`.
 *
 * PLAIN bech32m — the bytes are converted 8→5 directly, with **no witness
 * version symbol**. Not `bech32m.encode(hrp, [2, ...toWords(b)])`, which is what
 * produced the old `om1z` prefix.
 *
 * One HRP for every network (Primum, Testum, Ignis). The same key controls the
 * same account on every chain, so encoding the network would make one key
 * produce three strings for one account; replay is answered by `chain_id` in the
 * transaction signing preimage, where it actually binds.
 */
export function encodeAddress(payload: Uint8Array): string {
  if (payload.length !== 32) throw new Error(`payload must be 32 bytes, got ${payload.length}`);
  return bech32m.encode(HRP, bech32m.toWords(payload), ADDRESS_STR_LEN + 8);
}

/**
 * Decode an `om1…` address, rejecting anything non-canonical.
 *
 * **Uppercase is rejected, never normalised.** bech32 permits an all-uppercase
 * form and the reflex is to lowercase it — do not. `U+212A KELVIN SIGN`
 * lowercases to ASCII `k` in JavaScript, Python and Go but *not* in Rust, so a
 * normalisation step makes one string decode in three languages and fail in the
 * fourth.
 *
 * The re-encode check is what makes the mapping bijective. It is not
 * defensive dead code: `bech32m` decoders accept a payload whose trailing pad
 * bits are non-zero and return the same bytes, so without this two different
 * strings name one account — address malleability.
 */
export function decodeAddress(s: string): Uint8Array {
  if (/[A-Z]/.test(s)) throw new Error('address must be lowercase; uppercase is not normalised');
  if (s.length !== ADDRESS_STR_LEN) throw new Error(`address must be ${ADDRESS_STR_LEN} chars, got ${s.length}`);
  const { prefix, words } = bech32m.decode(s as `${string}1${string}`, ADDRESS_STR_LEN + 8);
  if (prefix !== HRP) throw new Error(`wrong HRP: ${prefix}`);
  const payload = bech32m.fromWords(words);
  if (payload.length !== 32) throw new Error(`payload must be 32 bytes, got ${payload.length}`);
  const out = Uint8Array.from(payload);
  if (encodeAddress(out) !== s) throw new Error('address is not canonical');
  return out;
}

/**
 * Derive an externally-owned account address from an ML-DSA-44 public key.
 *
 * The length check precedes the hash deliberately: a seed, a secret key, or a
 * hex *string* would each hash happily into a well-formed address for an account
 * nobody can ever sign for.
 */
export function addressFromPublicKey(pk: Uint8Array): Uint8Array {
  if (pk.length !== ML_DSA_44_PUBKEY_LEN) {
    throw new Error(`ML-DSA-44 public key must be ${ML_DSA_44_PUBKEY_LEN} bytes, got ${pk.length}`);
  }
  return digest(TAG_EOA, [pk]);
}

/** `SHA-256(TAG_WSM || u32le(len) || wasm)` — a code hash, **not** an address. */
export function codeHash(wasm: Uint8Array): Uint8Array {
  return digest(TAG_WSM, [wasm]);
}

/**
 * Derive a contract address. The preimage is always exactly 124 bytes.
 *
 * `salt` must be exactly 32 bytes and is **never** padded from an integer —
 * padding rules are where two implementations silently disagree.
 */
export function contractAddress(creator: Uint8Array, salt: Uint8Array, code: Uint8Array): Uint8Array {
  if (creator.length !== 32) throw new Error('creator must be a 32-byte payload');
  if (salt.length !== 32) throw new Error('salt must be exactly 32 bytes; do not pad an integer');
  if (code.length !== 32) throw new Error('code_hash must be 32 bytes');
  return digest(TAG_CTR, [creator, salt, code]);
}

/**
 * Derive a protocol-reserved address from its registry name.
 *
 * `.` is the only separator: `fee.vault`, `fee_vault` and `fee-vault` would
 * otherwise be three distinct permanent addresses, two of them unspendable
 * typos.
 */
export function systemAddress(name: string): Uint8Array {
  if (!(SYSTEM_ACCOUNTS as readonly string[]).includes(name)) {
    throw new Error(`unknown system account: ${name}`);
  }
  return digest(TAG_SYS, [utf8ToBytes(name)]);
}

// ── OMS-1 ───────────────────────────────────────────────────────────────────

/**
 * Derive the ML-DSA-44 seed from 32 bytes of mnemonic entropy.
 *
 * **Domain-separated, not the bare entropy.** Without the tag, the same 24 words
 * entered into a Bitcoin wallet derive from identical material — one phrase
 * silently meaning two things across two ecosystems.
 *
 * Note this is NOT BIP-39's seed: there is no PBKDF2 and no passphrase. BIP-39
 * stretches to make low-entropy passphrases expensive to brute-force; against
 * 256 bits of true entropy there is nothing to stretch, its 64-byte output would
 * need truncating to 32 (one more choice to disagree about), and a passphrase is
 * a second secret that can be lost independently of the phrase.
 */
export function seedFromEntropy(entropy: Uint8Array): Uint8Array {
  if (entropy.length !== 32) throw new Error(`entropy must be 32 bytes, got ${entropy.length}`);
  return digest(TAG_SEED, [entropy]);
}

/**
 * Recover 32 bytes of entropy from a 24-word phrase, verifying the checksum.
 *
 * The checksum is what catches a mis-transcribed word — the realistic failure
 * when copying a phrase off a metal plate by hand.
 */
export function entropyFromMnemonic(mnemonic: string, wordlist: string[]): Uint8Array {
  if (/[A-Z]/.test(mnemonic)) throw new Error('mnemonic must be lowercase; uppercase is not normalised');
  const words = mnemonic.split(/\s+/).filter((w) => w.length > 0);
  if (words.length !== WORD_COUNT) throw new Error(`mnemonic must be ${WORD_COUNT} words, got ${words.length}`);

  const bits: number[] = [];
  words.forEach((w, i) => {
    const idx = wordlist.indexOf(w);
    if (idx < 0) throw new Error(`unknown word at position ${i}: ${w}`);
    for (let b = 10; b >= 0; b--) bits.push((idx >> b) & 1);
  });

  const entropy = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    entropy[i] = bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0);
  }
  const checksum = bits.slice(256).reduce((a, b) => (a << 1) | b, 0);
  if (checksum !== sha256(entropy)[0]) throw new Error('mnemonic checksum failed');
  return entropy;
}

/** Encode 32 bytes of entropy as a 24-word phrase. */
export function mnemonicFromEntropy(entropy: Uint8Array, wordlist: string[]): string {
  if (entropy.length !== 32) throw new Error(`entropy must be 32 bytes, got ${entropy.length}`);
  const bits: number[] = [];
  for (const byte of [...entropy, sha256(entropy)[0]]) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  const out: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    out.push(wordlist[bits.slice(i, i + 11).reduce((a, b) => (a << 1) | b, 0)]);
  }
  return out.join(' ');
}

/** Phrase straight to seed, checksum verified on the way. */
export function seedFromMnemonic(mnemonic: string, wordlist: string[]): Uint8Array {
  return seedFromEntropy(entropyFromMnemonic(mnemonic, wordlist));
}
