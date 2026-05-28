/**
 * Multi-chunk OMP E2E test: verifies chunking + reassembly with 2 chunks.
 *
 * Usage: npx tsx test-omp-multichunk.ts
 */
import { OmpClient, OMP_CHUNK_SIZE } from './src/omp';

const RPC_URL = 'https://rpc.ignis.omnechain.network';
const omp = new OmpClient({
  rpcUrl: RPC_URL,
  headers: {
    Authorization: 'Bearer devnet-open',
    'X-Omne-Nonce': `multi-${Date.now()}`,
  },
});

async function main() {
  // Generate data larger than one chunk (257 KiB > 256 KiB chunk size)
  const totalSize = OMP_CHUNK_SIZE + 1024;
  const largeData = new Uint8Array(totalSize);
  // crypto.getRandomValues has a 64 KiB per-call limit, so fill in chunks
  for (let offset = 0; offset < totalSize; offset += 65536) {
    const len = Math.min(65536, totalSize - offset);
    crypto.getRandomValues(largeData.subarray(offset, offset + len));
  }
  const expectedChunks = Math.ceil(largeData.length / OMP_CHUNK_SIZE);
  console.log(`Data size: ${largeData.length} bytes (${expectedChunks} chunks)`);

  console.log('Uploading...');
  const result = await omp.storeBytes(largeData, {
    owner: 'om1zmulti_chunk_test_owner_0001',
    escrowOgt: 1,
    onProgress: (i, t) => console.log(`  Chunk ${i + 1}/${t}`),
  });
  console.log(`Stored: ${result.assetId} (${result.chunkCount} chunks)`);

  console.log('Retrieving...');
  const retrieved = await omp.retrieveBytes(result.assetId);
  console.log(`Retrieved: ${retrieved.length} bytes`);

  if (retrieved.length !== largeData.length) {
    throw new Error(`Size mismatch: ${largeData.length} vs ${retrieved.length}`);
  }

  let ok = true;
  for (let i = 0; i < largeData.length; i++) {
    if (largeData[i] !== retrieved[i]) {
      console.error(`Mismatch at byte ${i}`);
      ok = false;
      break;
    }
  }

  console.log(ok ? '✓ Multi-chunk E2E PASSED' : '✗ Multi-chunk E2E FAILED');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
