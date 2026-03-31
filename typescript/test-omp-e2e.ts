/**
 * OMP End-to-End Test: Upload + Retrieve media on ignis devnet.
 *
 * This script exercises the full OMP lifecycle:
 *   1. Fund a test account via faucet_request
 *   2. Store a small file (raw bytes → chunk → upload with data)
 *   3. Verify the on-chain manifest
 *   4. Retrieve the file by downloading chunks from the HTTP endpoint
 *   5. Verify the retrieved bytes match the original
 *
 * Usage:
 *   npx tsx test-omp-e2e.ts
 */

import { OmpClient } from './src/omp';

const RPC_URL = 'https://rpc.ignis.omnechain.network';
const AUTH_HEADERS = {
  Authorization: 'Bearer devnet-open',
  'X-Omne-Nonce': `e2e-${Date.now()}`,
};

const TEST_OWNER = 'omne1e2e_test_omp_owner_address_00001';

/** Manual JSON-RPC call helper (for faucet, which isn't in OmpClient). */
async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...AUTH_HEADERS,
      'X-Omne-Nonce': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
  return json.result;
}

async function main() {
  console.log('=== OMP E2E Test ===\n');

  // ── Step 1: Faucet ──────────────────────────────────────────────────
  console.log('1. Requesting faucet drip...');
  const faucetResult = await rpcCall('faucet_request', [{ address: TEST_OWNER }]);
  console.log('   Faucet result:', faucetResult);

  // ── Step 2: Create test data ────────────────────────────────────────
  // Generate a small "media" payload (~500 bytes of structured content).
  const testContent = `
=== OMP E2E Test Media File ===
Timestamp: ${new Date().toISOString()}
This is a test file used to verify end-to-end OMP upload and retrieval.
It contains enough data to be meaningful but is small enough for a quick test.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
commodo consequat. Duis aute irure dolor in reprehenderit in voluptate
velit esse cillum dolore eu fugiat nulla pariatur.

Random bytes: ${crypto.getRandomValues(new Uint8Array(32)).toString()}
=== End of test file ===
`.trim();

  const testData = new TextEncoder().encode(testContent);
  console.log(`\n2. Test data prepared: ${testData.length} bytes`);

  // ── Step 3: Upload via OmpClient ────────────────────────────────────
  console.log('\n3. Uploading via OmpClient.storeBytes()...');
  const omp = new OmpClient({
    rpcUrl: RPC_URL,
    headers: AUTH_HEADERS,
  });

  const storeResult = await omp.storeBytes(testData, {
    owner: TEST_OWNER,
    escrowOgt: 1,
    redundancy: 2,
    storageTier: 'hot',
    onProgress: (idx, total) => console.log(`   Chunk ${idx + 1}/${total} uploaded`),
  });

  console.log('   Store result:', {
    assetId: storeResult.assetId,
    contentHash: storeResult.contentHash,
    merkleRoot: storeResult.merkleRoot,
    chunkCount: storeResult.chunkCount,
    status: storeResult.status,
  });

  // ── Step 4: Verify manifest ─────────────────────────────────────────
  console.log('\n4. Verifying on-chain manifest...');
  const manifest = await omp.getManifest(storeResult.assetId);
  console.log('   Manifest:', {
    assetId: manifest.assetId,
    status: manifest.status,
    contentHash: manifest.contentHash,
    chunkCount: manifest.chunkCount,
    totalSize: manifest.totalSize,
  });

  if (manifest.status !== 'Finalized') {
    throw new Error(`Expected Finalized, got ${manifest.status}`);
  }
  if (manifest.contentHash !== storeResult.contentHash) {
    throw new Error('Content hash mismatch between store result and manifest');
  }

  // ── Step 5: Retrieve via chunk download ─────────────────────────────
  console.log('\n5. Retrieving asset via chunk download...');
  const retrieved = await omp.retrieveBytes(storeResult.assetId);
  console.log(`   Retrieved ${retrieved.length} bytes`);

  // ── Step 6: Verify retrieved data matches original ──────────────────
  console.log('\n6. Verifying retrieved data...');
  if (retrieved.length !== testData.length) {
    throw new Error(`Size mismatch: original=${testData.length}, retrieved=${retrieved.length}`);
  }

  let match = true;
  for (let i = 0; i < testData.length; i++) {
    if (testData[i] !== retrieved[i]) {
      match = false;
      console.error(`   Byte mismatch at offset ${i}: expected ${testData[i]}, got ${retrieved[i]}`);
      break;
    }
  }

  if (!match) {
    throw new Error('Retrieved data does not match original');
  }

  const retrievedText = new TextDecoder().decode(retrieved);
  console.log('   ✓ Retrieved data matches original');
  console.log(`   First 80 chars: "${retrievedText.slice(0, 80)}..."`);

  // ── Step 7: Verify using SDK verify method ──────────────────────────
  console.log('\n7. Verifying with OmpClient.verifyBytes()...');
  await omp.verifyBytes(retrieved, storeResult.assetId);
  console.log('   ✓ SDK verification passed');

  console.log('\n=== OMP E2E Test PASSED ===');
}

main().catch((err) => {
  console.error('\n❌ E2E Test FAILED:', err.message || err);
  process.exit(1);
});
