# Omne Python SDK (`omne-sdk`)

Post-quantum Python SDK for the Omne L1 — ML-DSA-44 (FIPS 204) wallet, ABI
encoding, and JSON-RPC client. Parity-matched with the
[TypeScript SDK](../typescript): the same mnemonic produces the same `om1z`
addresses, and Python-produced signatures are accepted by the node's verify
path.

> **Status:** scaffold. Offline crypto/address parity is covered by
> `tests/test_parity.py`. The live-mesh integration test (a Python account
> minting/enforcing against the Cinchor contract) is the next milestone.

## Install

```bash
pip install -e ".[dev]"   # from sdk/python/
```

The only runtime dependency is [`dilithium-py`](https://pypi.org/project/dilithium-py/)
(pure-Python FIPS 204). Its `_keygen_internal(ξ)` is byte-identical to the TS
SDK's `@noble/post-quantum` `ml_dsa44.keygen(seed)` — verified across multiple
seeds, which is why addresses match. Everything else (BIP39, the HD KDF, bech32m,
the tx hash, the ABI codec) is stdlib.

## Quickstart

```python
from omne_sdk import Wallet, OmneClient, AbiEncode

wallet  = Wallet.from_mnemonic("abandon abandon ... about")
account = wallet.get_account(0)
print(account.address)            # om1z…

client = OmneClient("http://127.0.0.1:26657", chain_id=3)

# read-only query (reference-typed returns come back as 0x-hex)
res = client.query_contract(
    "om1z<contract>", "get_principal",
    [AbiEncode.address("om1z<capabilityId>")],
)

# state-modifying call: build → sign (ML-DSA-44) → submit
tx_hash = client.send_contract_call(
    account, "om1z<contract>", "mint_permission",
    [AbiEncode.address("om1z<id>"), AbiEncode.u128(100)],
)
receipt = client.wait_for_receipt(tx_hash)
```

## Layout

| Module | Mirrors (TS) | Responsibility |
|---|---|---|
| `address.py` | `utils.ts` | bech32m `om1z` codec, `derive_address_from_public_key`, hex |
| `wallet.py` | `wallet.ts` | BIP39 + hardened HMAC-SHA512 HD KDF, ML-DSA-44 keygen/sign |
| `transaction.py` | `wallet.ts` (hash) | tx build + canonical **little-endian** signing preimage |
| `abi.py` | `contract.ts` | `ArgType` / `AbiEncode` / `encode_contract_call` (**big-endian** wire) |
| `rpc.py` | `client.ts` | JSON-RPC: `omne_sendTransaction` wire, `omne_call`, nonce, receipt |

## Parity vectors

`tests/test_parity.py` pins:
- ML-DSA-44 keygen public-key SHA-256 for fixed seeds (vs `@noble`),
- mnemonic → HD seed → pubkey → `om1z` address for the canonical BIP39 test
  mnemonic,
- address bech32m round-trip, sign→verify, and ABI call shape.

Run: `pytest -q` (offline; no node required).

## Notes / follow-ups
- BIP39 mnemonic **checksum validation** against the English wordlist is a
  follow-up; seed derivation (the parity-critical path) is exact.
- `dilithium-py` is pure-Python (keygen ~8 ms, sign ~46 ms). Fine for a client
  SDK; a native backend (liboqs/PQClean) is a drop-in optimization behind the
  same keygen/sign interface if high-throughput signing is ever needed.
