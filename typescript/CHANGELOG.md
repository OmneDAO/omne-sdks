# Changelog

All notable changes to `@omne/sdk` will be documented in this file.

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
