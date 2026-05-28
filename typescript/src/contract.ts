/**
 * Omne Contract Abstraction
 *
 * Provides a high-level interface for deploying, calling, and querying
 * smart contracts on the Omne blockchain.  Uses the Omne ABI encoding
 * format (binary wire protocol) to encode method calls in the `data` field
 * of transactions.
 *
 * @example
 * ```typescript
 * import { OmneClient, OmneContract, AbiEncode } from '@omne/sdk';
 *
 * const client = new OmneClient({ url: 'http://localhost:8545' });
 *
 * // Interact with a deployed contract
 * const token = new OmneContract(client, 'om1zabc...def');
 *
 * // Read-only query — does not consume gas or modify state
 * const result = await token.query('balanceOf', [
 *   AbiEncode.address('om1zuser...')
 * ]);
 *
 * // State-modifying call — sent as a signed transaction
 * const receipt = await token.call({
 *   from: 'om1zsender...',
 *   method: 'transfer',
 *   args: [
 *     AbiEncode.address('om1zrecipient...'),
 *     AbiEncode.u128(1000n)
 *   ],
 *   gasLimit: 100_000,
 * });
 * ```
 */

import type { OmneClient } from './client';
import type { TransactionReceipt } from './types';
import { parseAddress } from './utils';

// ── Omne ABI Wire Format Constants ──────────────────────────────

/** Magic prefix identifying Omne ABI-encoded calldata */
const ABI_MAGIC = new Uint8Array([0x4f, 0x4d, 0x4e, 0x45]); // "OMNE"

/** Current ABI encoding version */
const ABI_VERSION = 0x01;

/** Maximum method name length in bytes */
const MAX_METHOD_NAME_LEN = 256;

/** Maximum number of arguments per call */
const MAX_ARG_COUNT = 64;

// ── ArgType Tags ────────────────────────────────────────────────

/** Argument type discriminants matching the Rust ABI codec */
export enum ArgType {
  U32 = 0x01,
  U64 = 0x02,
  I32 = 0x03,
  I64 = 0x04,
  String = 0x05,
  Bytes = 0x06,
  Bool = 0x07,
  Address = 0x08,
  U128 = 0x09,
}

/** A single typed argument in the Omne ABI encoding */
export interface AbiArgument {
  type: ArgType;
  data: Uint8Array;
}

// ── AbiEncode — Argument Builders ───────────────────────────────

/** Convenience builders for creating typed ABI arguments */
export const AbiEncode = {
  u32(value: number): AbiArgument {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setUint32(0, value, false); // big-endian
    return { type: ArgType.U32, data: new Uint8Array(buf) };
  },

  u64(value: bigint): AbiArgument {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigUint64(0, value, false);
    return { type: ArgType.U64, data: new Uint8Array(buf) };
  },

  i32(value: number): AbiArgument {
    const buf = new ArrayBuffer(4);
    new DataView(buf).setInt32(0, value, false);
    return { type: ArgType.I32, data: new Uint8Array(buf) };
  },

  i64(value: bigint): AbiArgument {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigInt64(0, value, false);
    return { type: ArgType.I64, data: new Uint8Array(buf) };
  },

  string(value: string): AbiArgument {
    const encoder = new TextEncoder();
    return { type: ArgType.String, data: encoder.encode(value) };
  },

  bytes(value: Uint8Array): AbiArgument {
    return { type: ArgType.Bytes, data: value };
  },

  bool(value: boolean): AbiArgument {
    return { type: ArgType.Bool, data: new Uint8Array([value ? 0x01 : 0x00]) };
  },

  /** Encode an Omne address (32 bytes) from its om1z... string form */
  address(omneAddress: string): AbiArgument {
    const parsed = parseAddress(omneAddress);
    if (parsed.bytes.length !== 32) {
      throw new Error(`Address must be 32 bytes, got ${parsed.bytes.length}`);
    }
    return { type: ArgType.Address, data: parsed.bytes };
  },

  /** Encode an address directly from 32 raw bytes */
  addressBytes(bytes: Uint8Array): AbiArgument {
    if (bytes.length !== 32) {
      throw new Error(`Address must be 32 bytes, got ${bytes.length}`);
    }
    return { type: ArgType.Address, data: bytes };
  },

  u128(value: bigint): AbiArgument {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    // Big-endian 128-bit: write high 64 bits first, then low 64 bits
    view.setBigUint64(0, value >> 64n, false);
    view.setBigUint64(8, value & 0xFFFFFFFFFFFFFFFFn, false);
    return { type: ArgType.U128, data: new Uint8Array(buf) };
  },
};

// ── Encoding / Decoding ─────────────────────────────────────────

/** Encode a contract method call into the Omne ABI wire format */
export function encodeContractCall(method: string, args: AbiArgument[] = []): string {
  const encoder = new TextEncoder();
  const methodBytes = encoder.encode(method);

  if (methodBytes.length > MAX_METHOD_NAME_LEN) {
    throw new Error(`Method name exceeds ${MAX_METHOD_NAME_LEN} byte limit`);
  }
  if (args.length > MAX_ARG_COUNT) {
    throw new Error(`Argument count ${args.length} exceeds maximum of ${MAX_ARG_COUNT}`);
  }

  // Calculate total size
  let totalSize = 4 + 1 + 2 + methodBytes.length + 2;
  for (const arg of args) {
    totalSize += 1 + 4 + arg.data.length;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;

  // MAGIC
  bytes.set(ABI_MAGIC, offset); offset += 4;
  // VERSION
  view.setUint8(offset, ABI_VERSION); offset += 1;
  // METHOD_LEN + METHOD_NAME
  view.setUint16(offset, methodBytes.length, false); offset += 2;
  bytes.set(methodBytes, offset); offset += methodBytes.length;
  // ARG_COUNT
  view.setUint16(offset, args.length, false); offset += 2;
  // Arguments
  for (const arg of args) {
    view.setUint8(offset, arg.type); offset += 1;
    view.setUint32(offset, arg.data.length, false); offset += 4;
    bytes.set(arg.data, offset); offset += arg.data.length;
  }

  return bytesToHex(bytes);
}

/** Check if hex-encoded data starts with the Omne ABI magic */
export function isAbiEncoded(hexData: string): boolean {
  if (hexData.length < 10) return false; // 4 magic + 1 version = 5 bytes = 10 hex
  const prefix = hexData.slice(0, 8).toLowerCase();
  return prefix === '4f4d4e45'; // "OMNE"
}

// ── Contract Instance ───────────────────────────────────────────

/** Options for a state-modifying contract call */
export interface ContractCallOptions {
  from: string;
  method: string;
  args?: AbiArgument[];
  gasLimit?: number;
  gasPrice?: string;
  nonce?: number;
  value?: string;
}

/** Result of a read-only contract query */
export interface ContractQueryResult {
  gasUsed: number;
  executionTime: string;
  returnValue: string | null;
  deterministicState: string;
}

/**
 * High-level contract abstraction.
 *
 * Wraps an OmneClient and a deployed contract address, providing
 * `call()` for state-modifying transactions and `query()` for
 * read-only execution.
 */
export class OmneContract {
  private client: OmneClient;
  private address: string;

  constructor(client: OmneClient, contractAddress: string) {
    this.client = client;
    this.address = contractAddress;
  }

  /** The deployed contract address */
  get contractAddress(): string {
    return this.address;
  }

  /**
   * Execute a read-only query against the contract (omne_call).
   * Does not modify state or consume gas beyond estimation.
   */
  async query(method: string, args: AbiArgument[] = [], from?: string): Promise<ContractQueryResult> {
    const data = encodeContractCall(method, args);
    const callObj: Record<string, string> = {
      to: this.address,
      data,
    };
    if (from) {
      callObj.from = from;
    }

    const result = await (this.client as any).request('omne_call', [callObj]);
    return result as ContractQueryResult;
  }

  /**
   * Send a state-modifying transaction to the contract.
   * The `data` field is automatically ABI-encoded from the method + args.
   */
  async call(options: ContractCallOptions): Promise<TransactionReceipt> {
    const data = encodeContractCall(options.method, options.args ?? []);

    const transaction = {
      from: options.from,
      to: this.address,
      value: options.value ?? '0',
      gasLimit: options.gasLimit ?? 100_000,
      gasPrice: options.gasPrice ?? '1000',
      nonce: options.nonce ?? 0,
      data,
    };

    return await (this.client as any).sendTransaction(transaction);
  }
}

// ── Hex Utilities ───────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
