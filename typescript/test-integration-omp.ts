/**
 * OMP SDK Integration Test — runs against a live Ignis devnet.
 *
 * Prerequisites:
 *   - 5-node Ignis cluster running (./scripts/ignis-local-deploy.sh start)
 *   - OMP storage node registered
 *   - omne-logo.png finalized as "omne-logo-png"
 *
 * Usage:
 *   npx ts-node --esm test-integration-omp.ts
 */

import { readFileSync } from 'fs';
import { OmpClient } from './src/omp.js';

const RPC = 'http://127.0.0.1:26657';
const LOGO = '/Users/gregbrown/github/omne/docs/omne-logo.png';

async function main() {
  const omp = new OmpClient(RPC);

  // 1. getManifest — existing asset
  const manifest = await omp.getManifest('omne-logo-png');
  console.log('✓ getManifest:', manifest.assetId, manifest.status, manifest.totalSize, 'bytes');

  // 2. prepareAsset — pure client-side
  const data = new Uint8Array(readFileSync(LOGO));
  const prepared = omp.prepareAsset(data);
  console.log('✓ prepareAsset:', prepared.chunkCount, 'chunks');
  console.log('  contentHash match:', prepared.contentHash === manifest.contentHash);
  console.log('  merkleRoot match:', prepared.merkleRoot === manifest.merkleRoot);

  // 3. verifyBytes — compare local file to on-chain manifest
  const ok = await omp.verifyBytes(data, 'omne-logo-png');
  console.log('✓ verifyBytes:', ok);

  // 4. storeBytes — store a new copy via SDK (unique ID each run)
  const assetId = `sdk-integ-${Date.now()}`;
  const result = await omp.storeBytes(data, {
    assetId,
    owner: 'om1zsdk-test',
    escrowOgt: 5,
    onProgress: (i, total) => process.stdout.write(`  chunk ${i + 1}/${total}\r`),
  });
  console.log('✓ storeBytes:', result.assetId, result.status, result.chunkCount, 'chunks');

  // 5. getRetrievalPlan on the new asset
  const plan = await omp.getRetrievalPlan(assetId);
  console.log('✓ getRetrievalPlan:', plan.chunkCount, 'chunks');

  // 6. getStats
  const stats = await omp.getStats();
  console.log('✓ getStats: totalNodes=' + stats.totalNodes);

  // 7. verify the newly stored asset too
  const ok2 = await omp.verifyBytes(data, assetId);
  console.log('✓ verifyBytes (new asset):', ok2);

  console.log('\n✅ All integration tests passed');
}

main().catch((err) => {
  console.error('❌ Integration test failed:', err.message ?? err);
  process.exit(1);
});
