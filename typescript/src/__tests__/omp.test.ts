/**
 * OMP Client — unit tests
 *
 * Tests the client-side hashing, chunking, merkle root computation,
 * and the RPC interaction flow using a mocked fetch.
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  OmpClient,
  OMP_CHUNK_SIZE,
} from '../omp';

// ── Helpers ────────────────────────────────────────────────────────────

/** Build deterministic test data of a given size. */
function makeTestData(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = i % 256;
  }
  return data;
}

/** SHA-256 hex of a Uint8Array. */
function sha256hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/** Compute the expected binary merkle root from chunk hash bytes. */
function expectedMerkleRoot(chunkHashBytes: Uint8Array[]): string {
  if (chunkHashBytes.length === 0) return bytesToHex(new Uint8Array(32));
  let level = chunkHashBytes.map((h) => h.slice());
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      const combined = new Uint8Array(left.length + right.length);
      combined.set(left, 0);
      combined.set(right, left.length);
      next.push(sha256(combined));
    }
    level = next;
  }
  return bytesToHex(level[0]);
}

// ── prepareAsset Tests ─────────────────────────────────────────────────

describe('OmpClient.prepareAsset', () => {
  const client = new OmpClient('http://localhost:26657');

  it('computes correct content hash for small data', () => {
    const data = new TextEncoder().encode('hello omne');
    const prepared = client.prepareAsset(data);

    expect(prepared.contentHash).toBe(sha256hex(data));
    expect(prepared.totalSize).toBe(data.length);
    // Small data fits in a single chunk
    expect(prepared.chunkCount).toBe(1);
    expect(prepared.chunks).toHaveLength(1);
    expect(prepared.chunks[0].index).toBe(0);
    expect(prepared.chunks[0].size).toBe(data.length);
    expect(prepared.chunks[0].hash).toBe(sha256hex(data));
  });

  it('single chunk merkle root is the chunk hash itself', () => {
    const data = new TextEncoder().encode('single chunk');
    const prepared = client.prepareAsset(data);

    // For a single chunk, merkle root = hash(chunk_hash || chunk_hash)
    // because the odd-element rule hashes with itself
    const chunkHash = sha256(data);
    const expected = expectedMerkleRoot([chunkHash]);
    expect(prepared.merkleRoot).toBe(expected);
  });

  it('correctly chunks data larger than OMP_CHUNK_SIZE', () => {
    // 2.5 chunks worth of data
    const size = OMP_CHUNK_SIZE * 2 + OMP_CHUNK_SIZE / 2;
    const data = makeTestData(size);
    const prepared = client.prepareAsset(data);

    expect(prepared.totalSize).toBe(size);
    expect(prepared.chunkCount).toBe(3);
    expect(prepared.chunks).toHaveLength(3);

    // Verify chunk sizes
    expect(prepared.chunks[0].size).toBe(OMP_CHUNK_SIZE);
    expect(prepared.chunks[1].size).toBe(OMP_CHUNK_SIZE);
    expect(prepared.chunks[2].size).toBe(OMP_CHUNK_SIZE / 2);

    // Verify each chunk hash independently
    for (const chunk of prepared.chunks) {
      const start = chunk.index * OMP_CHUNK_SIZE;
      const end = Math.min(start + OMP_CHUNK_SIZE, size);
      const expected = sha256hex(data.subarray(start, end));
      expect(chunk.hash).toBe(expected);
    }
  });

  it('merkle root matches hand-computed root for 2 chunks', () => {
    const data = makeTestData(OMP_CHUNK_SIZE + 100);
    const prepared = client.prepareAsset(data);

    expect(prepared.chunkCount).toBe(2);

    const h0 = sha256(data.subarray(0, OMP_CHUNK_SIZE));
    const h1 = sha256(data.subarray(OMP_CHUNK_SIZE));
    const expected = expectedMerkleRoot([h0, h1]);

    expect(prepared.merkleRoot).toBe(expected);
  });

  it('merkle root matches for 3 chunks (odd count)', () => {
    const data = makeTestData(OMP_CHUNK_SIZE * 3 - 1);
    const prepared = client.prepareAsset(data);

    expect(prepared.chunkCount).toBe(3);

    const hashes = [
      sha256(data.subarray(0, OMP_CHUNK_SIZE)),
      sha256(data.subarray(OMP_CHUNK_SIZE, OMP_CHUNK_SIZE * 2)),
      sha256(data.subarray(OMP_CHUNK_SIZE * 2)),
    ];
    const expected = expectedMerkleRoot(hashes);

    expect(prepared.merkleRoot).toBe(expected);
  });

  it('supports custom chunk size', () => {
    const data = makeTestData(1000);
    const prepared = client.prepareAsset(data, 300);

    // 1000 / 300 = ceil 4 chunks: 300, 300, 300, 100
    expect(prepared.chunkCount).toBe(4);
    expect(prepared.chunks[0].size).toBe(300);
    expect(prepared.chunks[3].size).toBe(100);
  });

  it('throws on empty data', () => {
    expect(() => client.prepareAsset(new Uint8Array(0))).toThrow('empty');
  });
});

// ── storeBytes RPC flow Tests ──────────────────────────────────────────

describe('OmpClient.storeBytes', () => {
  let client: OmpClient;
  let mockFetch: jest.MockedFunction<typeof fetch>;
  let rpcCalls: Array<{ method: string; params: unknown[] }>;

  beforeEach(() => {
    rpcCalls = [];

    // Mock fetch to capture RPC calls and return success responses
    mockFetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      rpcCalls.push({ method: body.method, params: body.params });

      let result: unknown;
      switch (body.method) {
        case 'omne_ompStoreAsset':
          result = { assetId: body.params[0].assetId, status: 'uploading', chunkCount: body.params[0].chunkCount, redundancy: body.params[0].redundancy, escrowOgt: body.params[0].escrowOgt };
          break;
        case 'omne_ompAddChunk':
          result = { assetId: body.params[0].assetId, chunkIndex: body.params[0].index, status: 'accepted' };
          break;
        case 'omne_ompFinalizeAsset':
          result = { assetId: body.params[0], status: 'finalized' };
          break;
        default:
          return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -1, message: 'unknown method' }, id: body.id }), { status: 200 });
      }

      return new Response(JSON.stringify({ jsonrpc: '2.0', result, id: body.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as jest.MockedFunction<typeof fetch>;

    // Replace globalThis.fetch
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    client = new OmpClient('http://localhost:26657');
  });

  it('calls StoreAsset, AddChunk × N, FinalizeAsset in order', async () => {
    const data = makeTestData(OMP_CHUNK_SIZE + 100); // 2 chunks

    const result = await client.storeBytes(data, {
      owner: 'omne1testowner',
      escrowOgt: 5,
    });

    // Should have made exactly 4 RPC calls: store + 2 addChunk + finalize
    expect(rpcCalls).toHaveLength(4);
    expect(rpcCalls[0].method).toBe('omne_ompStoreAsset');
    expect(rpcCalls[1].method).toBe('omne_ompAddChunk');
    expect(rpcCalls[2].method).toBe('omne_ompAddChunk');
    expect(rpcCalls[3].method).toBe('omne_ompFinalizeAsset');

    // Verify the store params
    const storeParams = rpcCalls[0].params[0] as Record<string, unknown>;
    expect(storeParams.owner).toBe('omne1testowner');
    expect(storeParams.escrowOgt).toBe(5);
    expect(storeParams.chunkCount).toBe(2);
    expect(storeParams.redundancy).toBe(2);
    expect((storeParams.contentHash as string).length).toBe(64);
    expect((storeParams.merkleRoot as string).length).toBe(64);

    // Verify chunk params
    const chunk0 = rpcCalls[1].params[0] as Record<string, unknown>;
    expect(chunk0.index).toBe(0);
    expect(chunk0.size).toBe(OMP_CHUNK_SIZE);
    expect((chunk0.chunkHash as string).length).toBe(64);

    const chunk1 = rpcCalls[2].params[0] as Record<string, unknown>;
    expect(chunk1.index).toBe(1);
    expect(chunk1.size).toBe(100);

    // Verify result
    expect(result.status).toBe('finalized');
    expect(result.chunkCount).toBe(2);
    expect(result.totalSize).toBe(OMP_CHUNK_SIZE + 100);
  });

  it('fires onProgress callback for each chunk', async () => {
    const data = makeTestData(OMP_CHUNK_SIZE * 3);
    const progress: Array<[number, number]> = [];

    await client.storeBytes(data, {
      owner: 'omne1testowner',
      escrowOgt: 10,
      onProgress: (i, total) => progress.push([i, total]),
    });

    expect(progress).toEqual([[0, 3], [1, 3], [2, 3]]);
  });

  it('uses provided assetId when given', async () => {
    const data = makeTestData(100);

    const result = await client.storeBytes(data, {
      assetId: 'my-custom-id',
      owner: 'omne1testowner',
      escrowOgt: 1,
    });

    expect(result.assetId).toBe('my-custom-id');
    const storeParams = rpcCalls[0].params[0] as Record<string, unknown>;
    expect(storeParams.assetId).toBe('my-custom-id');
  });

  it('rejects redundancy outside valid range', async () => {
    const data = makeTestData(100);

    await expect(
      client.storeBytes(data, { owner: 'o', escrowOgt: 1, redundancy: 1 })
    ).rejects.toThrow('redundancy');

    await expect(
      client.storeBytes(data, { owner: 'o', escrowOgt: 1, redundancy: 10 })
    ).rejects.toThrow('redundancy');
  });
});

// ── verifyBytes Tests ──────────────────────────────────────────────────

describe('OmpClient.verifyBytes', () => {
  let client: OmpClient;
  const testData = makeTestData(OMP_CHUNK_SIZE + 100);
  let preparedContentHash: string;
  let preparedMerkleRoot: string;
  let preparedChunkCount: number;

  beforeEach(() => {
    // Compute expected values
    const tempClient = new OmpClient('http://localhost:26657');
    const prepared = tempClient.prepareAsset(testData);
    preparedContentHash = prepared.contentHash;
    preparedMerkleRoot = prepared.merkleRoot;
    preparedChunkCount = prepared.chunkCount;

    // Mock fetch to return a matching manifest
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          assetId: 'test-asset',
          owner: 'omne1test',
          contentHash: preparedContentHash,
          merkleRoot: preparedMerkleRoot,
          totalSize: testData.length,
          chunkCount: preparedChunkCount,
          status: 'Finalized',
          storageTier: 'Hot',
          redundancy: 2,
          escrowOgt: 5,
          createdAt: 1000,
          finalizedAt: 2000,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    client = new OmpClient('http://localhost:26657');
  });

  it('returns true when file matches manifest', async () => {
    const result = await client.verifyBytes(testData, 'test-asset');
    expect(result).toBe(true);
  });

  it('throws when content hash does not match', async () => {
    const tamperedData = makeTestData(OMP_CHUNK_SIZE + 100);
    tamperedData[0] = 0xff; // alter first byte

    await expect(
      client.verifyBytes(tamperedData, 'test-asset')
    ).rejects.toThrow('Content hash mismatch');
  });
});
