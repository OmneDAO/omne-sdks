# Changelog

All notable changes to `@omne/sdk` will be documented in this file.

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
