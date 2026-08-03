# Cross-language conformance vectors

**These files are copied from `OmneDAO/tessera` and that repo is the source of
truth.** They are vendored here so every SDK asserts against identical bytes
rather than against its own reimplementation of the spec.

| file | spec |
|---|---|
| `address_vectors.json` | OMA-1 — `crates/omne-consensus-types/address_vectors.json` |
| `mnemonic_vectors.json` | OMS-1 — `crates/omne-consensus-types/mnemonic_vectors.json` |
| `bip39_english.txt` | canonical BIP-39 English wordlist, SHA-256 `2f5eed53…3b24dbda` |

## Why vendored rather than fetched

A test that downloads its own fixtures passes when the network is down and the
cache is stale. Vendoring makes a spec change a visible diff in this repository,
which is the point: if these files move, every SDK's tests change in the same
commit or the divergence is obvious in review.

## Updating

Re-copy from tessera and run every SDK's test suite. If any language fails, the
port is wrong — **not the vectors**. The vectors are generated from the spec and
cross-checked against an independent implementation before they land there.
