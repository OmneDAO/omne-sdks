> **Archived 2026-09-07.** This repository describes an earlier design of Omne
> and is kept for the record, not for use. Omne was restarted from its intent
> statement on 2026-08-16; nothing here should be read as current. The current
> description is the research statement at <https://omne.foundation/statement>,
> and the reason it exists is at <https://omne.foundation/why>.

---

# Omne SDKs

Official client SDKs for the [Omne](https://omne.foundation) network — a post-quantum L1. Each SDK provides the same core surface: ML-DSA-44 (FIPS 204) wallet + key handling, contract ABI encoding/decoding, and a JSON-RPC client for reading state and submitting signed transactions.

No wallet extension, no gas token in the developer's face — you hold a key, sign a payload, and call an endpoint.

## Languages

| Language | Package | Install |
|----------|---------|---------|
| TypeScript | [`@omne/sdk`](https://www.npmjs.com/package/@omne/sdk) | `npm install @omne/sdk` |
| Go | `github.com/OmneDAO/omne-sdks/go` | `go get github.com/OmneDAO/omne-sdks/go@latest` |
| Python | [`omne-sdk`](https://pypi.org/project/omne-sdk/) | `pip install omne-sdk` |

## Parity

The TypeScript SDK is the reference implementation. Go and Python are held to it via a cross-language parity gate (ML-DSA-44 keygen-from-seed must be byte-identical, and each SDK is validated live against a node — build an account, sign, and confirm the node accepts the signature). See [`SDK_PARITY.md`](./SDK_PARITY.md) for current status; TypeScript is the most complete, with Go and Python covering the core wallet / ABI / RPC surface.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
