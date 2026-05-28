# Changelog

All notable changes to `@omne/sdk` will be documented in this file.

## [Unreleased]

### Changed — BREAKING: total post-quantum migration (ML-DSA-44)
- **Signing algorithm is now ML-DSA-44 (FIPS 204)**, replacing Ed25519. Wallet
  public keys are 1312 bytes (2624 hex), signatures are 2420 bytes (4840 hex).
  The portable secret remains a 32-byte seed; the ML-DSA-44 keypair is
  deterministically expanded from it via `ml_dsa44.keygen(seed)`, so keystores
  still store only the 32-byte seed.
- **Addresses are now 32 bytes** (was 20). Derivation is
  `SHA-256("OMNE_PQC_ADDRESS_V1" || ml_dsa_44_pubkey)` (full digest, no
  truncation) — matching the Rust-side `PqcAccountAddress`. The `om1z` bech32m
  payload is 32 bytes; raw-hex addresses are 64 chars. Addresses derived by an
  earlier SDK version are **not** compatible.
- HD derivation uses an HMAC-SHA512 hierarchical KDF (hardened-only) to produce
  each account's 32-byte ML-DSA-44 seed (was SLIP-0010 ed25519). Addresses for a
  given mnemonic differ from prior versions.
- `verifyEd25519Signature(...)` renamed to `verifyMlDsa44Signature(...)`.
  `verifyMessageSignature` envelope is now `signature(2420) || publicKey(1312)`.
- `AbiEncode.address` / `AbiEncode.addressBytes` now require 32-byte addresses.
- `sendRawTransaction` validates 4840-hex signatures and 2624-hex public keys.
- Validation is `om1z`-only; legacy `omne1` addresses are rejected.

### Added
- `deriveAddressFromPublicKey(pubkey)` — canonical 32-byte `om1z` address
  derivation, the single source of truth shared by the wallet and verification.
- `@noble/post-quantum@0.4.1` dependency (pairs with the existing
  `@noble/hashes@1.8.0`).

### Removed
- Unused classical-crypto dependencies: `@noble/curves`, `@noble/secp256k1`,
  `@scure/bip32`.

### Note
- Contract-deployment/compiler **plan** signatures are a separate signing path
  still on Ed25519 (node-side `plan_signature.rs`); their migration is tracked
  separately from this wallet/transaction migration.

## [1.1.0] - 2026-04-23

### Added
- **`OmneClient.rpcCall<T>(method, params?)`** — generic JSON-RPC escape hatch for calling any node RPC method not yet wrapped by a typed client method (e.g. `faucet_request`, custom node extensions, experimental methods). Prefer typed methods when available; this is the escape hatch when they are not.

### Changed
- `SDK_VERSION` constant updated to `'1.1.0'` (was stale at `'0.3.0'` after package.json version bump)
- `DEFAULT_NETWORK_CONFIGS.primum.url` changed from `ws://localhost:8545` (Ethereum default) to `ws://localhost:9944` (Omne node default; matches `omne-node` binary default)
- Expanded documentation comment on `DEFAULT_NETWORK_CONFIGS` to clarify SDK role keys (`primum`/`testum`/`principalis`) vs. deployed-network codenames (Ignis / Testum / Primum)

### Flagged — requires decision
- `DEFAULT_NETWORK_CONFIGS.testum.url` (`wss://testnet.omne.org`) and `principalis.url` (`wss://mainnet.omne.org`) are placeholders; the Testum testnet is forming and Primum mainnet has not launched. Consumers should pass an explicit URL until these networks go live.
- To connect to the live **Ignis devnet**, construct the client directly with the RPC URL — `new OmneClient('wss://rpc.ignis.omnechain.network')` — rather than the `createClient(role)` factory. Ignis is a deployed public network, not an SDK environment role.

## [1.0.0] - (publish date not recorded)

Major-version release. Changelog entry not captured at publish time; this placeholder
exists so version history stays continuous. Reconstructing from `git log v0.3.1..v1.0.0`
is recommended before producing any retrospective release notes.

## [0.3.1] - (publish date not recorded)

Patch release. Changelog entry not captured at publish time; see note above.

## [0.3.0] - 2026-03-18

### Added
- TypeScript declaration files (`.d.ts`) now ship with the package
- Modern `exports` field in `package.json` for proper ESM/CJS resolution
- LICENSE file (MIT)
- `.npmignore` for clean publishes

### Changed
- `@noble/curves` added as explicit dependency (`^1.9.0`)
- `express` moved from dependencies to devDependencies (not needed at runtime by SDK consumers)
- SDK_VERSION constant updated to `0.3.0`

### Fixed
- Declaration files were not emitted during build (rollup config fix)
- `express` moved from dependencies to devDependencies (not needed at runtime by SDK consumers)

## [0.2.0] - 2024-12-19

### Added
- Initial public release on npm
- Wallet, Signer, Client, Contract abstractions
- ORC-20 token support
- Deployment plan API
- Service registry
- Runtime guardrails
- Browser and Node.js platform abstraction
- CLI: `omne-sdk-verify-runtime`
