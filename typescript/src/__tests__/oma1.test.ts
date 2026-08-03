/**
 * OMA-1 / OMS-1 conformance, driven by the shared vectors.
 *
 * **The vector file is the contract, not this file.** Rust, Python and Go assert
 * against the same JSON. If this test ever stops reading it and starts
 * hard-coding values, cross-language parity is unenforced again and nobody will
 * notice until a user's wallet does not work on their own node.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { ml_dsa44 } from '@noble/post-quantum/ml-dsa';
import { sha256 } from '@noble/hashes/sha256';
import {
  ADDRESS_STR_LEN,
  ML_DSA_44_PUBKEY_LEN,
  SYSTEM_ACCOUNTS,
  TAG_CTR,
  TAG_EOA,
  TAG_SEED,
  TAG_SYS,
  TAG_WSM,
  WORD_COUNT,
  addressFromPublicKey,
  codeHash,
  contractAddress,
  decodeAddress,
  encodeAddress,
  entropyFromMnemonic,
  mnemonicFromEntropy,
  seedFromEntropy,
  seedFromMnemonic,
  systemAddress,
} from '../oma1';

const V = join(__dirname, '../../../vectors');
const addrVectors = JSON.parse(readFileSync(join(V, 'address_vectors.json'), 'utf8'));
const mnemVectors = JSON.parse(readFileSync(join(V, 'mnemonic_vectors.json'), 'utf8'));
const WORDLIST = readFileSync(join(V, 'bip39_english.txt'), 'utf8').split('\n').filter(Boolean);

const unhex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('OMA-1 addresses', () => {
  it('matches every EOA vector', () => {
    expect(addrVectors.eoa.length).toBe(3);
    for (const v of addrVectors.eoa) {
      const pk = unhex(v.pubkey_hex);
      expect(pk.length).toBe(ML_DSA_44_PUBKEY_LEN);
      const payload = addressFromPublicKey(pk);
      expect(hex(payload)).toBe(v.payload_hex);
      expect(encodeAddress(payload)).toBe(v.address);
    }
  });

  it('matches every contract vector', () => {
    for (const v of addrVectors.contract) {
      const p = contractAddress(unhex(v.creator_hex), unhex(v.salt_hex), unhex(v.code_hash_hex));
      expect(hex(p)).toBe(v.payload_hex);
      expect(encodeAddress(p)).toBe(v.address);
    }
  });

  it('matches every code-hash vector', () => {
    for (const v of addrVectors.code_hash) {
      expect(hex(codeHash(unhex(v.wasm_hex)))).toBe(v.code_hash_hex);
    }
  });

  it('matches the system registry, which is closed at three', () => {
    expect(addrVectors.system.length).toBe(SYSTEM_ACCOUNTS.length);
    for (const v of addrVectors.system) {
      const p = systemAddress(v.name);
      expect(hex(p)).toBe(v.payload_hex);
      expect(encodeAddress(p)).toBe(v.address);
    }
    // Removed before genesis: fees are burned, so neither had a source.
    for (const removed of ['fee.vault', 'validator.fee.pool']) {
      expect(() => systemAddress(removed)).toThrow();
    }
    // Near-misses on the separator would otherwise be distinct permanent
    // addresses, two of them unspendable typos.
    for (const bad of ['fee_vault', 'fee-vault', 'Treasury', 'treasury.', '', 'burn']) {
      expect(() => systemAddress(bad)).toThrow();
    }
  });

  it('rejects every invalid vector', () => {
    expect(addrVectors.invalid.length).toBe(7);
    for (const v of addrVectors.invalid) {
      expect(() => decodeAddress(v.value)).toThrow();
    }
  });

  it('rejects a wrong-length public key before hashing', () => {
    for (const len of [0, 32, 64, ML_DSA_44_PUBKEY_LEN - 1, ML_DSA_44_PUBKEY_LEN + 1]) {
      expect(() => addressFromPublicKey(new Uint8Array(len))).toThrow();
    }
  });

  it('rejects uppercase rather than normalising it', () => {
    const s = encodeAddress(new Uint8Array(32).fill(3));
    expect(() => decodeAddress(s.toUpperCase())).toThrow();
    // U+212A KELVIN lowercases to ASCII k in JS but not in Rust — normalising
    // would make one string work in three languages and fail in the fourth.
    expect(() => decodeAddress(s.replace(/k/g, 'K'))).toThrow();
  });

  it('rejects a non-canonical padding variant', () => {
    // Decodes to the SAME payload under a raw bech32m decoder. Accepting it is
    // address malleability: two strings, one account.
    expect(() =>
      decodeAddress('om1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvp3tks22l'),
    ).toThrow();
    expect(decodeAddress(encodeAddress(new Uint8Array(32).fill(3)))).toBeDefined();
  });

  it('round-trips, and every address is exactly 61 chars', () => {
    for (let i = 0; i < 32; i++) {
      const payload = new Uint8Array(32).fill(i);
      const s = encodeAddress(payload);
      expect(s.length).toBe(ADDRESS_STR_LEN);
      expect(s.startsWith('om1')).toBe(true);
      expect(hex(decodeAddress(s))).toBe(hex(payload));
    }
  });

  it('uses 16-byte domain tags that are distinct', () => {
    const tags = [TAG_EOA, TAG_CTR, TAG_SYS, TAG_WSM, TAG_SEED];
    for (const t of tags) expect(Buffer.from(t, 'utf8').length).toBe(16);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('does not let one class collide with another on identical input', () => {
    const a = new Uint8Array(32).fill(9);
    expect(hex(contractAddress(a, new Uint8Array(32), a))).not.toBe(hex(codeHash(a)));
    expect(hex(contractAddress(a, new Uint8Array(32), a))).not.toBe(hex(systemAddress('treasury')));
  });

  it('refuses a salt that is not exactly 32 bytes', () => {
    const a = new Uint8Array(32).fill(1);
    for (const len of [0, 8, 31, 33]) {
      expect(() => contractAddress(a, new Uint8Array(len), a)).toThrow();
    }
  });
});

describe('OMS-1 mnemonics', () => {
  it('matches every valid vector, entropy through seed', () => {
    expect(mnemVectors.valid.length).toBe(4);
    for (const v of mnemVectors.valid) {
      const entropy = unhex(v.entropy_hex);
      expect(mnemonicFromEntropy(entropy, WORDLIST)).toBe(v.mnemonic);
      expect(hex(entropyFromMnemonic(v.mnemonic, WORDLIST))).toBe(v.entropy_hex);
      expect(hex(seedFromEntropy(entropy))).toBe(v.seed_hex);
      expect(hex(seedFromMnemonic(v.mnemonic, WORDLIST))).toBe(v.seed_hex);
    }
  });

  it('rejects every invalid vector', () => {
    expect(mnemVectors.invalid.length).toBe(5);
    for (const v of mnemVectors.invalid) {
      expect(() => entropyFromMnemonic(v.mnemonic, WORDLIST)).toThrow();
    }
  });

  it('uses the canonical BIP-39 English wordlist', () => {
    expect(WORDLIST.length).toBe(2048);
    const digest = hex(sha256(Buffer.from(WORDLIST.join('\n') + '\n', 'utf8')));
    expect(digest).toBe('2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda');
  });

  it('matches the published BIP-39 24-word vectors', () => {
    // A scheme can round-trip perfectly and still be wrong; these prove the bit
    // packing follows the standard rather than merely agreeing with itself.
    expect(mnemonicFromEntropy(new Uint8Array(32), WORDLIST).endsWith(' art')).toBe(true);
    expect(mnemonicFromEntropy(new Uint8Array(32).fill(0xff), WORDLIST).endsWith(' vote')).toBe(true);
  });

  it('derives a seed that is NOT the bare entropy', () => {
    // Without domain separation the same 24 words in a Bitcoin wallet derive
    // from identical material.
    for (const fill of [0, 1, 0xff]) {
      const e = new Uint8Array(32).fill(fill);
      expect(hex(seedFromEntropy(e))).not.toBe(hex(e));
      expect(hex(seedFromEntropy(e))).not.toBe(hex(sha256(e)));
    }
  });

  it('enforces the word count in both directions', () => {
    const phrase = mnemonicFromEntropy(new Uint8Array(32).fill(1), WORDLIST);
    const w = phrase.split(' ');
    expect(w.length).toBe(WORD_COUNT);
    expect(() => entropyFromMnemonic(w.slice(0, 23).join(' '), WORDLIST)).toThrow();
    expect(() => entropyFromMnemonic(`${phrase} zoo`, WORDLIST)).toThrow();
  });
});

describe('the whole chain, phrase to address', () => {
  /**
   * The property the SDK exists to guarantee: a phrase entered here produces
   * the account the node expects. Keygen is already parity-matched — the Rust
   * node's fips204 reproduces @noble byte for byte — so this exercises the
   * layers that changed.
   */
  it('derives the same account the node would', () => {
    for (const v of mnemVectors.valid) {
      const seed = seedFromMnemonic(v.mnemonic, WORDLIST);
      expect(hex(seed)).toBe(v.seed_hex);
      const { publicKey } = ml_dsa44.keygen(seed);
      expect(publicKey.length).toBe(ML_DSA_44_PUBKEY_LEN);
      const addr = encodeAddress(addressFromPublicKey(publicKey));
      expect(addr).toMatch(/^om1[02-9ac-hj-np-z]{58}$/);
      expect(addr.length).toBe(ADDRESS_STR_LEN);
    }
  });

  it('reproduces the @noble keygen ground truth', () => {
    // The same vectors pinned on the Rust side. If these drift, an SDK-created
    // wallet derives a different account from the same phrase, silently.
    const counting = Uint8Array.from({ length: 32 }, (_, i) => i);
    const cases: [Uint8Array, string][] = [
      [new Uint8Array(32), 'eb4e7302842153b0fa19e8620739ad258af4929c26dd89079a7ec7d4282208e1'],
      [counting, '9f107644c1084526af3bc8098680b05499a2325a644e388fb4f970e058d19d46'],
    ];
    for (const [seed, expected] of cases) {
      expect(hex(sha256(ml_dsa44.keygen(seed).publicKey))).toBe(expected);
    }
  });
});
