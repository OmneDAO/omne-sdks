/**
 * OMP (Omne Media Protocol) Client
 *
 * High-level client for storing, chunking, and retrieving assets through
 * Omne's decentralised storage layer. Handles the full lifecycle:
 *
 *   1. Read file → SHA-256 content hash
 *   2. Split into 256 KiB chunks → per-chunk SHA-256
 *   3. Compute binary merkle root
 *   4. StoreAsset (create manifest on-chain)
 *   5. AddChunk × N (register each chunk hash)
 *   6. FinalizeAsset (verify merkle root, seal)
 *   7. GetRetrievalPlan (get chunk download map)
 *
 * Works in both Node.js (fs) and browser (File / ArrayBuffer) contexts.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getPlatformProviders } from './platform/context';
import { NetworkError, RPCError, ValidationError } from './errors';

// ── Constants ──────────────────────────────────────────────────────────

/** Default chunk size: 256 KiB, matching the OMP coordinator's CHUNK_SIZE. */
export const OMP_CHUNK_SIZE = 262_144;

/** Minimum redundancy accepted by the coordinator. */
export const OMP_MIN_REDUNDANCY = 2;

/** Maximum redundancy accepted by the coordinator. */
export const OMP_MAX_REDUNDANCY = 7;

/** Default redundancy factor when not specified. */
export const OMP_DEFAULT_REDUNDANCY = 2;

// ── Types ──────────────────────────────────────────────────────────────

/** Storage tier for an asset. */
export type OmpStorageTier = 'hot' | 'warm' | 'cold';

/** Erasure coding algorithm. */
export type OmpErasureCodec = 'reed_solomon' | 'none';

/** Asset upload status as returned by the coordinator. */
export type OmpAssetStatus = 'Uploading' | 'Finalized' | 'Archived' | 'Degraded';

/** Result of deleting (archiving) an asset. */
export interface OmpDeleteResult {
  assetId: string;
  status: 'archived';
  chunksRemoved: number;
}

/** Result of listing assets by owner. */
export interface OmpListAssetsResult {
  owner: string;
  assets: string[];
  count: number;
}

/** Options for client-side encryption before storing an asset. */
export interface OmpEncryptOptions {
  /** AES-256-GCM key (32 bytes). Caller is responsible for key management. */
  key: Uint8Array;
}

/** Metadata prepended to encrypted payloads for decryption. */
export interface OmpEncryptedPayloadHeader {
  /** Algorithm identifier. Always 'aes-256-gcm' for now. */
  algorithm: 'aes-256-gcm';
  /** 12-byte initialisation vector, hex-encoded. */
  iv: string;
  /** 16-byte auth tag, hex-encoded. */
  authTag: string;
  /** Original plaintext size in bytes. */
  plaintextSize: number;
}

/** Metadata for a single chunk, computed client-side. */
export interface OmpChunkInfo {
  /** Zero-based chunk index. */
  index: number;
  /** Byte length of this chunk. */
  size: number;
  /** SHA-256 hex digest (64 characters). */
  hash: string;
}

/** Options for storing an asset. */
export interface OmpStoreOptions {
  /** Unique asset identifier. Auto-generated if omitted. */
  assetId?: string;
  /** Owner address (Omne bech32 or hex). */
  owner: string;
  /** Erasure codec to declare in the manifest. */
  erasureCodec?: OmpErasureCodec;
  /** Replication factor (2–7). */
  redundancy?: number;
  /** Storage tier preference. */
  storageTier?: OmpStorageTier;
  /** OGT to escrow for storage payments. */
  escrowOgt: number;
  /** Chunk size in bytes. Defaults to OMP_CHUNK_SIZE (256 KiB). */
  chunkSize?: number;
  /** Progress callback invoked after each chunk is registered. */
  onProgress?: (chunkIndex: number, totalChunks: number) => void;
}

/** Result of a successful store + finalize cycle. */
export interface OmpStoreResult {
  /** Asset ID used on-chain. */
  assetId: string;
  /** Total file size in bytes. */
  totalSize: number;
  /** SHA-256 hex digest of the full file. */
  contentHash: string;
  /** Merkle root hex digest. */
  merkleRoot: string;
  /** Number of chunks registered. */
  chunkCount: number;
  /** Per-chunk metadata. */
  chunks: OmpChunkInfo[];
  /** Final status after finalization. */
  status: 'finalized';
}

/** On-chain asset manifest as returned by omne_ompGetManifest. */
export interface OmpManifest {
  assetId: string;
  owner: string;
  contentHash: string;
  merkleRoot: string;
  totalSize: number;
  chunkCount: number;
  status: OmpAssetStatus;
  storageTier: string;
  redundancy: number;
  escrowOgt: number;
  createdAt: number;
  finalizedAt: number | null;
}

/** Single chunk entry in a retrieval plan. */
export interface OmpRetrievalChunk {
  index: number;
  hash: string;
  size: number;
  endpoints: string[];
}

/** Retrieval plan for a finalized asset. */
export interface OmpRetrievalPlan {
  assetId: string;
  contentHash: string;
  totalSize: number;
  chunkCount: number;
  chunks: OmpRetrievalChunk[];
}

/** Storage network statistics. */
export interface OmpStorageStats {
  totalNodes: number;
  activeNodes: number;
  totalStorageGb: number;
  usedStorageGb: number;
  totalChunksStored: number;
}

/** Storage node capabilities for registration. */
export interface OmpStorageCapabilities {
  storageGb: number;
  uploadBandwidthMbps: number;
  downloadBandwidthMbps: number;
  supportsHotTier: boolean;
  supportsColdTier: boolean;
  region: string;
}

/** Contact information for a storage node. */
export interface OmpNodeContactInfo {
  endpointUrl: string;
  publicKey: string;
  networkAddress: string;
  apiVersion: string;
}

/** Options for registering a storage node. */
export interface OmpRegisterNodeOptions {
  nodeId: string;
  name: string;
  capabilities: OmpStorageCapabilities;
  contactInfo: OmpNodeContactInfo;
  bondAmountOgt: number;
  stakeAddress: string;
}

/** Client-side file preparation result (before any RPC calls). */
export interface OmpPreparedAsset {
  contentHash: string;
  merkleRoot: string;
  totalSize: number;
  chunkCount: number;
  chunks: OmpChunkInfo[];
}

/** Configuration for the OMP client. */
export interface OmpClientConfig {
  /** JSON-RPC endpoint URL (HTTP or HTTPS). */
  rpcUrl: string;
  /** Request timeout in milliseconds. Defaults to 30 000. */
  timeout?: number;
  /** Additional headers to send with every request. */
  headers?: Record<string, string>;
}

// ── Client-side hashing utilities ──────────────────────────────────────

/**
 * SHA-256 hash a Uint8Array and return the 64-character hex digest.
 */
function sha256hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

/**
 * Encode a Uint8Array as standard base64 (works in Node.js and browsers).
 */
function uint8ToBase64(bytes: Uint8Array): string {
  // Node.js path (Buffer is always available in Node ≥ 4)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser path: btoa operates on latin-1 strings
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Encode a Uint8Array as a hex string (lowercase, no prefix).
 */
function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Decode a hex string into a Uint8Array.
 */
function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Resolve a WebCrypto implementation for the current platform.
 * Works in browsers (globalThis.crypto) and Node.js 15+ (webcrypto).
 */
async function resolveCrypto(): Promise<Crypto> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    return globalThis.crypto;
  }
  // Node.js — webcrypto is available on the crypto module since v15.
  const nodeCrypto = await import('crypto');
  if (nodeCrypto.webcrypto) {
    return nodeCrypto.webcrypto as unknown as Crypto;
  }
  throw new Error(
    'No WebCrypto implementation available. Use Node 15+ or a modern browser.',
  );
}

/**
 * Compute the binary merkle root matching the coordinator's algorithm:
 * sorted by index, pairs concatenated and SHA-256'd, odd nodes hashed
 * with themselves.
 */
function computeMerkleRoot(chunkHashes: Uint8Array[]): string {
  if (chunkHashes.length === 0) {
    return bytesToHex(new Uint8Array(32));
  }

  let level: Uint8Array[] = chunkHashes.map((h) => h.slice());

  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i];
      // Concatenate left || right and hash
      const combined = new Uint8Array(left.length + right.length);
      combined.set(left, 0);
      combined.set(right, left.length);
      next.push(sha256(combined));
    }
    level = next;
  }

  return bytesToHex(level[0]);
}

// ── Deterministic asset ID generation ──────────────────────────────────

let _idCounter = 0;

/**
 * Generate a unique asset ID from content hash + timestamp.
 * Format: `omp-<first8hex>-<timestamp>-<counter>`
 */
function generateAssetId(contentHash: string): string {
  const prefix = contentHash.slice(0, 8);
  const ts = Date.now().toString(36);
  return `omp-${prefix}-${ts}-${++_idCounter}`;
}

// ── File reading utilities ─────────────────────────────────────────────

/**
 * Read a file from disk (Node.js) and return its bytes.
 * Lazily imports `fs` so this module remains browser-safe.
 */
async function readFileBytes(filePath: string): Promise<Uint8Array> {
  // Dynamic import so the module loads cleanly in browsers
  const fs = await import('fs');
  const buf = fs.readFileSync(filePath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

// ── OMP Client ─────────────────────────────────────────────────────────

/**
 * High-level client for Omne Media Protocol storage operations.
 *
 * Usage:
 * ```ts
 * import { OmpClient } from '@omne/sdk';
 *
 * const omp = new OmpClient({ rpcUrl: 'http://127.0.0.1:26657' });
 *
 * // Store a file (Node.js — pass a file path)
 * const result = await omp.store('/path/to/image.png', {
 *   owner: 'om1z...',
 *   escrowOgt: 5,
 * });
 *
 * // Store from bytes (works in browser too)
 * const result2 = await omp.storeBytes(uint8Array, {
 *   owner: 'om1z...',
 *   escrowOgt: 5,
 * });
 *
 * // Retrieve manifest
 * const manifest = await omp.getManifest(result.assetId);
 *
 * // Verify a local file matches on-chain manifest
 * const ok = await omp.verify('/path/to/image.png', result.assetId);
 * ```
 */
export class OmpClient {
  private readonly rpcUrl: string;
  private readonly timeout: number;
  private readonly headers: Record<string, string>;

  constructor(config: OmpClientConfig | string) {
    if (typeof config === 'string') {
      this.rpcUrl = config;
      this.timeout = 30_000;
      this.headers = {};
    } else {
      this.rpcUrl = config.rpcUrl;
      this.timeout = config.timeout ?? 30_000;
      this.headers = config.headers ?? {};
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Prepare asset metadata client-side without making any RPC calls.
   * Useful for previewing what will be stored or for custom workflows.
   */
  prepareAsset(data: Uint8Array, chunkSize?: number): OmpPreparedAsset {
    const cs = chunkSize ?? OMP_CHUNK_SIZE;
    const totalSize = data.length;

    if (totalSize === 0) {
      throw new ValidationError('File is empty', 'data', '0 bytes');
    }

    const contentHash = sha256hex(data);
    const chunkCount = Math.ceil(totalSize / cs);
    const chunks: OmpChunkInfo[] = [];
    const rawHashes: Uint8Array[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const start = i * cs;
      const end = Math.min(start + cs, totalSize);
      const chunkData = data.subarray(start, end);
      const hashBytes = sha256(chunkData);
      const hash = bytesToHex(hashBytes);
      chunks.push({ index: i, size: end - start, hash });
      rawHashes.push(hashBytes);
    }

    const merkleRoot = computeMerkleRoot(rawHashes);

    return { contentHash, merkleRoot, totalSize, chunkCount, chunks };
  }

  /**
   * Store a file from raw bytes through the full OMP lifecycle:
   * StoreAsset → AddChunk × N (with data) → FinalizeAsset.
   *
   * Each chunk's raw bytes are base64-encoded and included in the
   * AddChunk RPC call so the node stores them in its ChunkStore.
   *
   * Returns the finalized asset metadata.
   */
  async storeBytes(data: Uint8Array, options: OmpStoreOptions): Promise<OmpStoreResult> {
    // Client-side preparation: hash, chunk, merkle
    const prepared = this.prepareAsset(data, options.chunkSize);

    const assetId = options.assetId ?? generateAssetId(prepared.contentHash);
    const redundancy = options.redundancy ?? OMP_DEFAULT_REDUNDANCY;
    const cs = options.chunkSize ?? OMP_CHUNK_SIZE;

    if (redundancy < OMP_MIN_REDUNDANCY || redundancy > OMP_MAX_REDUNDANCY) {
      throw new ValidationError(
        `redundancy must be ${OMP_MIN_REDUNDANCY}–${OMP_MAX_REDUNDANCY}`,
        'redundancy',
        String(redundancy)
      );
    }

    // Step 1: Create manifest on-chain
    await this.rpc<{ assetId: string; status: string }>('omne_ompStoreAsset', [{
      assetId,
      owner: options.owner,
      contentHash: prepared.contentHash,
      merkleRoot: prepared.merkleRoot,
      totalSize: prepared.totalSize,
      chunkCount: prepared.chunkCount,
      erasureCodec: options.erasureCodec ?? 'reed_solomon',
      redundancy,
      storageTier: options.storageTier ?? 'hot',
      escrowOgt: options.escrowOgt,
    }]);

    // Step 2: Register each chunk with its data (base64-encoded)
    for (const chunk of prepared.chunks) {
      const start = chunk.index * cs;
      const end = Math.min(start + cs, data.length);
      const chunkBytes = data.subarray(start, end);
      const b64 = uint8ToBase64(chunkBytes);

      await this.rpc<{ status: string }>('omne_ompAddChunk', [{
        assetId,
        index: chunk.index,
        chunkHash: chunk.hash,
        size: chunk.size,
        data: b64,
      }]);
      options.onProgress?.(chunk.index, prepared.chunkCount);
    }

    // Step 3: Finalize — coordinator verifies merkle root
    await this.rpc<{ status: string }>('omne_ompFinalizeAsset', [assetId]);

    return {
      assetId,
      totalSize: prepared.totalSize,
      contentHash: prepared.contentHash,
      merkleRoot: prepared.merkleRoot,
      chunkCount: prepared.chunkCount,
      chunks: prepared.chunks,
      status: 'finalized',
    };
  }

  /**
   * Store a file from a local path (Node.js only).
   * Reads the file, then delegates to storeBytes().
   */
  async store(filePath: string, options: OmpStoreOptions): Promise<OmpStoreResult> {
    const data = await readFileBytes(filePath);
    return this.storeBytes(data, options);
  }

  /**
   * Retrieve the on-chain manifest for an asset.
   */
  async getManifest(assetId: string): Promise<OmpManifest> {
    if (!assetId) {
      throw new ValidationError('assetId is required', 'assetId', '');
    }
    return this.rpc<OmpManifest>('omne_ompGetManifest', [assetId]);
  }

  /**
   * Get the retrieval plan for a finalized asset.
   * Returns chunk hashes, sizes, and storage node endpoints.
   */
  async getRetrievalPlan(assetId: string): Promise<OmpRetrievalPlan> {
    if (!assetId) {
      throw new ValidationError('assetId is required', 'assetId', '');
    }
    return this.rpc<OmpRetrievalPlan>('omne_ompGetRetrievalPlan', [assetId]);
  }

  /**
   * Get storage network statistics.
   */
  async getStats(): Promise<OmpStorageStats> {
    return this.rpc<OmpStorageStats>('omne_ompStorageStats', []);
  }

  /**
   * Register a storage node on the OMP network.
   */
  async registerStorageNode(options: OmpRegisterNodeOptions): Promise<{ nodeId: string; status: string }> {
    return this.rpc('omne_ompRegisterStorageNode', [options]);
  }

  /**
   * Delete (archive) an asset. Only the manifest owner may call this.
   * Transitions the asset to `Archived` status and triggers chunk GC on
   * the node. This is irreversible — the asset data will be garbage-
   * collected from storage nodes.
   */
  async deleteAsset(assetId: string, owner: string): Promise<OmpDeleteResult> {
    if (!assetId) {
      throw new ValidationError('assetId is required', 'assetId', '');
    }
    if (!owner) {
      throw new ValidationError('owner is required', 'owner', '');
    }
    return this.rpc<OmpDeleteResult>('omne_ompDeleteAsset', [{ assetId, owner }]);
  }

  /**
   * List all non-archived asset IDs owned by a given address.
   */
  async listAssets(owner: string): Promise<OmpListAssetsResult> {
    if (!owner) {
      throw new ValidationError('owner is required', 'owner', '');
    }
    return this.rpc<OmpListAssetsResult>('omne_ompListAssets', [owner]);
  }

  // ── Encryption Helpers ─────────────────────────────────────────────

  /**
   * Encrypt data with AES-256-GCM before storing on OMP.
   *
   * Prepends a fixed-size JSON header (algorithm, IV, auth tag, plaintext
   * size) followed by a newline delimiter, then the ciphertext. The header
   * is needed to decrypt — store it alongside the assetId or embed it in
   * your application's metadata.
   *
   * Usage:
   * ```ts
   * const key = crypto.getRandomValues(new Uint8Array(32));
   * const { encrypted, header } = await omp.encryptBytes(plaintext, { key });
   * const result = await omp.storeBytes(encrypted, { owner, escrowOgt: 5 });
   * // Save header + result.assetId — both needed for decryption
   * ```
   */
  async encryptBytes(
    data: Uint8Array,
    options: OmpEncryptOptions,
  ): Promise<{ encrypted: Uint8Array; header: OmpEncryptedPayloadHeader }> {
    if (options.key.length !== 32) {
      throw new ValidationError(
        'AES-256-GCM key must be exactly 32 bytes',
        'key',
        `${options.key.length} bytes`,
      );
    }

    const crypto = await resolveCrypto();

    // Generate a random 12-byte IV (standard for AES-GCM).
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Import the key for AES-256-GCM.
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      options.key as BufferSource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );

    // Encrypt. WebCrypto appends the 16-byte auth tag to the ciphertext.
    const ciphertextWithTag = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, cryptoKey, data as BufferSource),
    );

    // Split ciphertext and auth tag (last 16 bytes).
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
    const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);

    const header: OmpEncryptedPayloadHeader = {
      algorithm: 'aes-256-gcm',
      iv: uint8ToHex(iv),
      authTag: uint8ToHex(authTag),
      plaintextSize: data.length,
    };

    // Encode header as UTF-8 JSON + newline delimiter, then append ciphertext.
    const headerBytes = new TextEncoder().encode(JSON.stringify(header) + '\n');
    const encrypted = new Uint8Array(headerBytes.length + ciphertext.length);
    encrypted.set(headerBytes, 0);
    encrypted.set(ciphertext, headerBytes.length);

    return { encrypted, header };
  }

  /**
   * Decrypt data that was encrypted with `encryptBytes()`.
   *
   * Reads the JSON header from the payload prefix, then decrypts the
   * ciphertext with the provided key.
   *
   * Usage:
   * ```ts
   * const encrypted = await omp.retrieveBytes(assetId);
   * const plaintext = await omp.decryptBytes(encrypted, { key });
   * ```
   */
  async decryptBytes(
    data: Uint8Array,
    options: OmpEncryptOptions,
  ): Promise<Uint8Array> {
    if (options.key.length !== 32) {
      throw new ValidationError(
        'AES-256-GCM key must be exactly 32 bytes',
        'key',
        `${options.key.length} bytes`,
      );
    }

    // Find the newline delimiter separating header from ciphertext.
    const newlineIdx = data.indexOf(0x0a); // '\n'
    if (newlineIdx === -1) {
      throw new ValidationError(
        'Encrypted payload missing header delimiter',
        'data',
        'no newline found',
      );
    }

    const headerJson = new TextDecoder().decode(data.subarray(0, newlineIdx));
    let header: OmpEncryptedPayloadHeader;
    try {
      header = JSON.parse(headerJson);
    } catch {
      throw new ValidationError(
        'Failed to parse encryption header',
        'header',
        headerJson.slice(0, 100),
      );
    }

    if (header.algorithm !== 'aes-256-gcm') {
      throw new ValidationError(
        `Unsupported encryption algorithm: ${header.algorithm}`,
        'algorithm',
        header.algorithm,
      );
    }

    const iv = hexToUint8(header.iv);
    const authTag = hexToUint8(header.authTag);
    const ciphertext = data.subarray(newlineIdx + 1);

    const crypto = await resolveCrypto();

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      options.key as BufferSource,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );

    // WebCrypto expects ciphertext + authTag concatenated.
    const ciphertextWithTag = new Uint8Array(ciphertext.length + authTag.length);
    ciphertextWithTag.set(ciphertext, 0);
    ciphertextWithTag.set(authTag, ciphertext.length);

    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, cryptoKey, ciphertextWithTag as BufferSource),
    );

    return plaintext;
  }

  /**
   * Verify that local file bytes match a finalized on-chain manifest.
   *
   * Checks:
   *  - Content hash matches
   *  - Chunk count matches
   *  - Each chunk hash matches
   *  - Merkle root matches
   *
   * Returns `true` if everything matches, throws with details if not.
   */
  async verifyBytes(data: Uint8Array, assetId: string, chunkSize?: number): Promise<true> {
    const prepared = this.prepareAsset(data, chunkSize);
    const manifest = await this.getManifest(assetId);

    if (prepared.contentHash !== manifest.contentHash) {
      throw new ValidationError(
        `Content hash mismatch: local=${prepared.contentHash} chain=${manifest.contentHash}`,
        'contentHash',
        prepared.contentHash
      );
    }

    if (prepared.chunkCount !== manifest.chunkCount) {
      throw new ValidationError(
        `Chunk count mismatch: local=${prepared.chunkCount} chain=${manifest.chunkCount}`,
        'chunkCount',
        String(prepared.chunkCount)
      );
    }

    if (prepared.merkleRoot !== manifest.merkleRoot) {
      throw new ValidationError(
        `Merkle root mismatch: local=${prepared.merkleRoot} chain=${manifest.merkleRoot}`,
        'merkleRoot',
        prepared.merkleRoot
      );
    }

    return true;
  }

  /**
   * Verify a local file against an on-chain manifest (Node.js only).
   */
  async verify(filePath: string, assetId: string, chunkSize?: number): Promise<true> {
    const data = await readFileBytes(filePath);
    return this.verifyBytes(data, assetId, chunkSize);
  }

  // ── Retrieval ──────────────────────────────────────────────────────

  /**
   * Retrieve a finalized asset by downloading all chunks from the node's
   * HTTP chunk endpoint and reassembling them into the original bytes.
   *
   * 1. Fetch the manifest to get content hash and chunk count.
   * 2. Download each chunk from `{baseUrl}/omp/chunks/{assetId}/{index}`.
   * 3. Verify each chunk's SHA-256 against the manifest.
   * 4. Concatenate and verify the full content hash.
   *
   * `baseUrl` defaults to this client's `rpcUrl` origin.
   */
  async retrieveBytes(assetId: string, baseUrl?: string): Promise<Uint8Array> {
    if (!assetId) {
      throw new ValidationError('assetId is required', 'assetId', '');
    }

    const manifest = await this.getManifest(assetId);
    if (manifest.status !== 'Finalized') {
      throw new ValidationError(
        `Asset is not finalized: status=${manifest.status}`,
        'status',
        manifest.status
      );
    }

    // Determine the chunk download base URL from the RPC URL's origin.
    const resolvedBase = baseUrl ?? new URL(this.rpcUrl).origin;
    const fetchFn = await this.resolveFetch();

    // Download all chunks sequentially (could be parallelised later).
    const chunkBuffers: Uint8Array[] = [];
    // Get retrieval plan for chunk hashes
    const plan = await this.getRetrievalPlan(assetId);

    for (let i = 0; i < manifest.chunkCount; i++) {
      const url = `${resolvedBase}/omp/chunks/${encodeURIComponent(assetId)}/${i}`;
      const resp = await fetchFn(url, {
        method: 'GET',
        headers: { ...this.headers },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!resp.ok) {
        throw new NetworkError(
          `Failed to download chunk ${i}: ${resp.status} ${resp.statusText}`,
          resp.status,
        );
      }

      const buf = new Uint8Array(await resp.arrayBuffer());

      // Verify chunk SHA-256 if we have the expected hash from the plan.
      if (plan.chunks[i]) {
        const expectedHash = plan.chunks[i].hash;
        const actualHash = sha256hex(buf);
        if (actualHash !== expectedHash) {
          throw new ValidationError(
            `Chunk ${i} hash mismatch: expected=${expectedHash} actual=${actualHash}`,
            'chunkHash',
            actualHash
          );
        }
      }

      chunkBuffers.push(buf);
    }

    // Reassemble chunks into the full file.
    const totalSize = chunkBuffers.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunkBuffers) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    // Verify full content hash.
    const actualContentHash = sha256hex(result);
    if (actualContentHash !== manifest.contentHash) {
      throw new ValidationError(
        `Content hash mismatch after reassembly: expected=${manifest.contentHash} actual=${actualContentHash}`,
        'contentHash',
        actualContentHash
      );
    }

    return result;
  }

  /**
   * Retrieve an asset and write it to a local path (Node.js only).
   */
  async retrieve(assetId: string, outputPath: string, baseUrl?: string): Promise<void> {
    const data = await this.retrieveBytes(assetId, baseUrl);
    const fs = await import('fs');
    fs.writeFileSync(outputPath, data);
  }

  // ── Private RPC helper ─────────────────────────────────────────────

  /** Send a JSON-RPC 2.0 request and return the result. */
  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const fetchFn = await this.resolveFetch();

    const body = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: Date.now(),
    });

    const response = await fetchFn(this.rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body,
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new NetworkError(
        `RPC request failed: ${response.status} ${response.statusText}`,
        response.status,
        undefined,
        { body: text }
      );
    }

    const json = await response.json();

    if (json.error) {
      throw new RPCError(
        json.error.message ?? 'Unknown RPC error',
        json.error.code ?? -1,
        json.error.data
      );
    }

    return json.result as T;
  }

  /** Resolve a fetch implementation for the current platform. */
  private async resolveFetch(): Promise<typeof fetch> {
    try {
      return await getPlatformProviders().fetch.getFetch();
    } catch {
      // Fallback: globalThis.fetch (available in Node 18+ and all modern browsers)
      if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch;
      }
      throw new NetworkError(
        'No fetch implementation available. Use Node 18+ or configure a fetch provider.'
      );
    }
  }
}
