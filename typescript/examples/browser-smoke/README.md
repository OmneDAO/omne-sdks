# Browser Smoke Test Guide

This example shows how to exercise the SDK in a modern browser bundle using Vite. The goal is to confirm that the wallet, secure crypto utilities, and HD derivation work end-to-end without Node polyfills.

## 1. Scaffold a Vite sandbox (one-time)

```bash
npm create vite@latest omne-sdk-browser -- --template vanilla-ts
cd omne-sdk-browser
npm install
```

## 2. Link the local SDK build

From the Vite project root, install the local TypeScript SDK as a dependency. The relative path below assumes the Vite project sits next to this repository; adjust if needed.

```bash
npm install ../sdk/typescript
```

## 3. Drop in the smoke-test entry point

Replace the generated `src/main.ts` with the contents of [`main.ts`](./main.ts). The script:

- Generates a wallet from a mnemonic.
- Signs a message and displays the signature.
- Exports a keystore, re-imports it, and validates private key parity.
- Writes structured output into the DOM and the browser console.

## 4. Run the dev server

```bash
npm run dev -- --host
```

Open `http://localhost:5173` in a browser. You should see wallet details rendered on the page and matching logs in the console. If anything fails, the error banner will contain the stack trace.

## 5. Optional: bundle verification

To ensure production builds succeed, run:

```bash
npm run build
```

This confirms Rollup (via Vite) can tree-shake the SDK without Node fallbacks.

---

If you hit bundler warnings about the SDK entry points, double-check that `npm run build` has been executed in `sdk/typescript` so `dist/` exists before linking. For other issues, capture the console output and we can iterate further.
