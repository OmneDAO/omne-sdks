# Omne Go SDK

Post-quantum Go SDK for the Omne L1 — ML-DSA-44 (FIPS 204) wallet, ABI
encoding, and JSON-RPC client. Parity-matched with the
[TypeScript](../typescript) and [Python](../python) SDKs: the same mnemonic
yields the same `om1z` address, and Go-produced signatures are accepted by the
node's verify path (see [`SDK_PARITY.md`](../SDK_PARITY.md)).

```
import omne "github.com/OmneDAO/omne-sdks/sdk/go"
```

The only dependency is [CIRCL](https://github.com/cloudflare/circl)
(`sign/mldsa/mldsa44`); `NewKeyFromSeed` is byte-identical to the TS SDK's
`@noble/post-quantum` `ml_dsa44.keygen(seed)` (verified — that byte-parity is
what makes the addresses match). Everything else (BIP39 via stdlib
`crypto/pbkdf2`, the hardened HMAC-SHA512 HD KDF, bech32m, the tx hash, the ABI
codec) is the standard library.

## Quickstart

```go
w, _ := omne.WalletFromMnemonic("abandon abandon ... about", "")
acct, _ := w.Account(0)
fmt.Println(acct.Address) // om1z…

client := omne.NewOmneClient("http://127.0.0.1:26657", 3)

// read-only query (reference returns come back as 0x-hex)
arg, _ := omne.ArgAddress("om1z<capabilityId>")
res, _ := client.QueryContract("om1z<contract>", "cinchor_permissions::get_status",
	[]omne.AbiArgument{arg}, "")

// state-modifying call: build → ML-DSA-44 sign → submit
txHash, _ := client.SendContractCall(acct, "om1z<contract>", "cinchor_permissions::mint_permission",
	args, big.NewInt(0), 0, "", nil)
client.WaitForReceipt(txHash, 60*time.Second, time.Second)
```

## Layout

| File | Mirrors | Responsibility |
|---|---|---|
| `address.go` | `utils.ts` | bech32m `om1z` codec, `DeriveAddressFromPublicKey`, hex |
| `wallet.go` | `wallet.ts` | BIP39 + hardened HMAC-SHA512 HD KDF, ML-DSA-44 (CIRCL) keygen/sign |
| `transaction.go` | `wallet.ts` (hash) | tx build + canonical **little-endian** signing preimage |
| `abi.go` | `contract.ts` | `ArgType` / `Arg*` builders / `EncodeContractCall` (**big-endian** wire) |
| `rpc.go` | `client.ts` | JSON-RPC: `omne_sendTransaction` wire, `omne_call`, nonce, receipt |

## Calling pysub contracts
The ABI method name is the contract-qualified selector `"<contract>::<method>"`
(e.g. `cinchor_permissions::get_status`) — the SDK passes the selector through
verbatim, so qualify it at the call site. Reference (address/bytes) returns come
back as a `0x`-hex `returnValue`; decode addresses with
`omne.ToOmneAddress(bytes)` after `omne.FromHex`.

## Tests
- `go test ./...` — offline cross-SDK parity (keygen vs `@noble`,
  mnemonic→address, sign→verify, ABI shape).
- `examples/live_mint` — live-mesh proof: a Go account mints against a deployed
  `cinchor_permissions` contract and reads it back.
  `cd examples/live_mint && go run . <rpc> <contract> <wallets.json>`

## Notes / follow-ups
- BIP39 mnemonic **checksum validation** and NFKD normalization of non-ASCII
  passphrases are follow-ups; seed derivation (the parity-critical path) is exact.
