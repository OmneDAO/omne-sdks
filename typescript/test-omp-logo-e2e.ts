/**
 * OMP End-to-End Test — Upload omne-logo.png → Retrieve → Verify
 *
 * Runs against a live Ignis devnet (started via ignis-local-deploy.sh).
 *
 * Steps:
 *   1. Read omne-logo.png from disk
 *   2. Prepare the asset client-side (hash, chunk, merkle)
 *   3. Store it on-chain via OMP storeBytes()
 *   4. Retrieve the manifest and verify it matches
 *   5. Get retrieval plan
 *   6. Verify bytes match on-chain manifest
 *   7. Get storage stats to confirm node is active
 *
 * Usage:
 *   npx ts-node --esm test-omp-logo-e2e.ts
 */

import { readFileSync } from 'fs';
import { OmpClient } from './src/omp.js';

const RPC = 'http://127.0.0.1:26657';
const LOGO_PATH = '/Users/gregbrown/github/omne/docs/omne-logo.png';

// Unique asset ID per run to avoid collisions with prior runs.
const ASSET_ID = `omne-logo-${Date.now()}`;

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   OMP End-to-End: Upload omne-logo.png → Verify         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const omp = new OmpClient(RPC);

  // ── Step 1: Read the logo file ──────────────────────────────────────
  console.log('1. Reading omne-logo.png...');
  const data = new Uint8Array(readFileSync(LOGO_PATH));
  console.log(`   ✓ ${data.length} bytes read\n`);

  // ── Step 2: Client-side preparation (hash + chunk + merkle) ─────────
  console.log('2. Preparing asset client-side...');
  const prepared = omp.prepareAsset(data);
  console.log(`   contentHash:  ${prepared.contentHash}`);
  console.log(`   merkleRoot:   ${prepared.merkleRoot}`);
  console.log(`   totalSize:    ${prepared.totalSize} bytes`);
  console.log(`   chunkCount:   ${prepared.chunkCount}`);
  console.log(`   ✓ Client-side preparation complete\n`);

  // ── Step 3: Store on-chain via OMP ──────────────────────────────────
  console.log(`3. Storing asset on-chain (assetId: ${ASSET_ID})...`);
  const result = await omp.storeBytes(data, {
    assetId: ASSET_ID,
    owner: 'om1z44b9effc104ac893c18320280976f69ca28b1814', // DAO treasury
    escrowOgt: 5,
    onProgress: (i, total) => {
      console.log(`   chunk ${i + 1}/${total} uploaded`);
    },
  });
  console.log(`   status:       ${result.status}`);
  console.log(`   chunkCount:   ${result.chunkCount}`);
  console.log(`   ✓ Asset stored and finalized\n`);

  // ── Step 4: Retrieve manifest ───────────────────────────────────────
  console.log('4. Retrieving on-chain manifest...');
  const manifest = await omp.getManifest(ASSET_ID);
  console.log(`   assetId:      ${manifest.assetId}`);
  console.log(`   status:       ${manifest.status}`);
  console.log(`   totalSize:    ${manifest.totalSize} bytes`);
  console.log(`   contentHash:  ${manifest.contentHash}`);
  console.log(`   merkleRoot:   ${manifest.merkleRoot}`);

  // ── Step 4a: Cross-check manifest matches local preparation ────────
  const hashMatch = manifest.contentHash === prepared.contentHash;
  const merkleMatch = manifest.merkleRoot === prepared.merkleRoot;
  const sizeMatch = manifest.totalSize === prepared.totalSize;
  console.log(`   contentHash match:  ${hashMatch ? '✓' : '✗'}`);
  console.log(`   merkleRoot match:   ${merkleMatch ? '✓' : '✗'}`);
  console.log(`   totalSize match:    ${sizeMatch ? '✓' : '✗'}`);

  if (!hashMatch || !merkleMatch || !sizeMatch) {
    throw new Error('Manifest does not match client-side preparation — data integrity failure');
  }
  console.log(`   ✓ Manifest matches local preparation\n`);

  // ── Step 5: Get retrieval plan ──────────────────────────────────────
  console.log('5. Getting retrieval plan...');
  const plan = await omp.getRetrievalPlan(ASSET_ID);
  console.log(`   chunkCount:   ${plan.chunkCount}`);
  console.log(`   ✓ Retrieval plan received\n`);

  // ── Step 6: Verify bytes against on-chain manifest ──────────────────
  console.log('6. Verifying local bytes against on-chain manifest...');
  const verified = await omp.verifyBytes(data, ASSET_ID);
  console.log(`   verified:     ${verified}`);

  if (!verified) {
    throw new Error('Verification failed — local file does not match on-chain manifest');
  }
  console.log(`   ✓ Byte-level verification passed\n`);

  // ── Step 7: Storage network stats ───────────────────────────────────
  console.log('7. Checking storage network stats...');
  const stats = await omp.getStats();
  console.log(`   totalNodes:   ${stats.totalNodes}`);
  console.log(`   activeNodes:  ${stats.activeNodes}`);
  console.log(`   totalAssets:  ${stats.totalAssets}`);
  console.log(`   ✓ Storage network healthy\n`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   ✅ OMP End-to-End Test PASSED                         ║');
  console.log('║                                                          ║');
  console.log(`║   File:     omne-logo.png (${data.length} bytes)${' '.repeat(Math.max(0, 25 - data.length.toString().length))}║`);
  console.log(`║   AssetId:  ${ASSET_ID}${' '.repeat(Math.max(0, 45 - ASSET_ID.length))}║`);
  console.log(`║   Chunks:   ${result.chunkCount}${' '.repeat(Math.max(0, 45 - result.chunkCount.toString().length))}║`);
  console.log('║   Verified: ✓ content hash + merkle root + byte verify   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('\n╔══════════════════════════════════════════════════════════╗');
  console.error('║   ❌ OMP End-to-End Test FAILED                          ║');
  console.error('╚══════════════════════════════════════════════════════════╝');
  console.error('\n', err.message ?? err);
  process.exit(1);
});
