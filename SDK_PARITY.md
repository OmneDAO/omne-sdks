# Omne SDK cross-language parity

> **OMA-1 / OMS-1 supersede everything below about addresses and mnemonics.**
> The `om1z…` scheme described further down is the PRE-GENESIS form and is gone:
> `SHA-256("OMNE_PQC_ADDRESS_V1" ‖ pk)` with a witness-version byte is replaced by
> `SHA-256(TAG_EOA ‖ u32le(len) ‖ pk)` in PLAIN bech32m, giving a fixed 61-char
> address. Mnemonics are 24 words used as raw entropy with a domain-separated
> seed — no PBKDF2, no passphrase, no derivation paths.
>
> **The ML-DSA-44 keygen below is unchanged and still authoritative.** It is what
> makes the port safe: the Rust node's `fips204` reproduces `@noble`'s public
> keys byte for byte, verified against the two seed vectors in this document, so
> only the address and mnemonic layers moved.
>
> Conformance now lives in `vectors/`, copied from `OmneDAO/tessera`. Rust,
> TypeScript, Python and Go all read those files rather than their own
> reimplementations — a spec change is one diff and four failing suites, not a
> silent divergence discovered when a wallet does not work.
>
> | | |
> |---|---|
> | Rust | `crates/omne-consensus-types/src/address.rs`, `mnemonic.rs` |
> | TypeScript | `typescript/src/oma1.ts` |
> | Python | `python/src/omne_sdk/oma1.py` |
> | Go | `go/oma1.go` |


The TypeScript SDK (`sdk/typescript`, `@omne/sdk`) is the reference. Any other
language SDK must reproduce the identity stack **byte-for-byte** so the same
mnemonic yields the same `om1z` address and signatures are accepted by the
node's verify path. This is a hard requirement: an address is
`SHA-256("OMNE_PQC_ADDRESS_V1" ‖ pubkey)`, so a one-byte pubkey difference is a
different account.

## The gate: ML-DSA-44 keygen-from-seed parity
FIPS 204 `KeyGen_internal(ξ)` is deterministic and standardized, so any two
compliant libs expand the same 32-byte seed to the same key. Verify it against
the TS reference (`@noble/post-quantum` `ml_dsa44.keygen(seed)`) before trusting
a lib. Ground-truth vectors — **public-key SHA-256** for fixed seeds:

| seed (32 bytes) | pubkey SHA-256 |
|---|---|
| all `0x00` | `eb4e7302842153b0fa19e8620739ad258af4929c26dd89079a7ec7d4282208e1` |
| `0x00,0x01,…,0x1f` | `9f107644c1084526af3bc8098680b05499a2325a644e388fb4f970e058d19d46` |

Pubkey length 1312, signature length 2420, secret/seed-key 2560. Sign with an
**empty context** (`ctx = b""`) to match `@noble` and the node.

Full-chain vector (canonical BIP39 test mnemonic `abandon …× 11… about`,
account 0):
- HD seed `d6f8deee4da4c94e81c8e0e53a61f584bf15a540b48516273fc1bfe27006612d`
- pubkey SHA-256 `a875fccc8fd28539d6249741acef4e3c6333822707e39ed019c49d0fc1fcc5fc`
- address `om1z6n2ydj89l7e6wq3eravk35er4jx66r63q48wfgh4ql6x0p566rvsj22jgp`

Everything else is standard + fully specified: BIP39 (PBKDF2-HMAC-SHA512), the
hardened HMAC-SHA512 HD KDF (`wallet.ts`), bech32m address codec, the
little-endian tx-hash preimage (`wallet.ts` / Rust `hash_transaction`), and the
big-endian ABI codec (`contract.ts`).

## Status

### Python — `sdk/python` (scaffolded)
- Crypto: **`dilithium-py`** (`ML_DSA_44._keygen_internal(ξ)`) — byte-identical
  to `@noble` on both vectors; sign/verify cross-verify both ways; node verify
  accepts a Python signature. ✅
- Scaffold complete: `address`, `wallet`, `transaction`, `abi`, `rpc`.
  `tests/test_parity.py` passes offline (6/6).
- **Validated live (2026-06-17):** a Python account built → ML-DSA-44 signed →
  minted against the live `cinchor_permissions` contract on a 4-validator mesh;
  node accepted the Python signature, `get_status==1`, `get_principal` decoded
  back to the principal om1z. ✅  See `sdk/python/examples/live_mint.py`.

### Go — `sdk/go` (implemented + validated)
- Crypto: **CIRCL** `github.com/cloudflare/circl/sign/mldsa/mldsa44`
  (`NewKeyFromSeed(*[32]byte)`) — byte-identical to `@noble` on both vectors;
  node verify (`@noble`) accepts a CIRCL signature; empty ctx. ✅
- Package complete: `address`, `wallet`, `transaction`, `abi`, `rpc`. `go test`
  passes offline, including `TestTxHashParity` — the signing preimage matches
  the Python SDK byte-for-byte. (Original keygen spike kept at `sdk/go/spike`.)
- **Validated live (2026-06-17):** a Go account built → ML-DSA-44 signed →
  minted against the live `cinchor_permissions` contract on a 4-validator mesh;
  node accepted the Go signature, `get_status==1`, `get_principal` decoded back
  to the principal om1z. ✅  See `sdk/go/examples/live_mint`.

## Bespoke keygen package?
Not needed for correctness in either language — `dilithium-py` and CIRCL both
match `@noble` out of the box. A vendored/native backend (liboqs/PQClean) is a
**drop-in optimization** behind the same keygen/sign interface, justified only
by throughput, supply-chain control, or packaging — not by parity.
