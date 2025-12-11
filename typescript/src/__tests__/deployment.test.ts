/**
 * Tests for hardened deployment helpers and OmneClient submission flow.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GuardrailError } from '../errors';
import { OmneClient } from '../client';
import { buildDeploymentHeaders, generateDeploymentNonce } from '../secure-client';
import {
  DeploymentPlan,
  ensureSignedCompilerAttachment,
} from '../signer';

describe('deployment helpers', () => {
  test('generateDeploymentNonce produces 32-byte hex strings', () => {
    const nonce = generateDeploymentNonce();
    expect(nonce).toHaveLength(16 * 2);
    expect(/^[0-9a-f]+$/.test(nonce)).toBe(true);
    const second = generateDeploymentNonce();
    expect(second).not.toEqual(nonce);
  });

  test('buildDeploymentHeaders normalises bearer tokens', () => {
    const headers = buildDeploymentHeaders({
      nonce: '1234',
      authToken: 'example-token',
    });
    expect(headers['X-Omne-Nonce']).toBe('1234');
    expect(headers.Authorization).toBe('Bearer example-token');
  });

  test('ensureSignedCompilerAttachment validates compiler payload', () => {
    const plan = makePlan();
    const attachment = ensureSignedCompilerAttachment(plan);
    expect(attachment.metadata.wasm_sha256).toBe(plan.contract.wasm_sha256);
  });

  test('ensureSignedCompilerAttachment rejects unsigned metadata', () => {
    const plan = makePlan();
    if (plan.contract?.metadata?.compiler) {
      plan.contract.metadata.compiler.signature = null;
    }
    expect(() => ensureSignedCompilerAttachment(plan)).toThrow(GuardrailError);
  });
});

describe('OmneClient.deployExecutionPlan', () => {
  const submission = {
    status: 'accepted',
    plan_id: 'pln_123456',
    digest: 'deadbeef',
    signer: 'aa'.repeat(32),
    compiler_signer: 'bb'.repeat(32),
    operator_id: 'operator_1',
    nonce_provenance: 'nonce_1',
    submitted_at: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  test('submits plan with nonce header and returns response', async () => {
    const plan = makePlan();
    const response = new Response(JSON.stringify(submission), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    });

    const fetchMock = jest.fn(async (_input: RequestInfo, _init?: RequestInit) => response.clone());

    (globalThis as any).fetch = fetchMock;

    const client = new OmneClient({
      url: 'http://127.0.0.1:8545',
      deploymentUrl: 'http://127.0.0.1:8545/v1/deployments',
      authToken: 'Bearer preset-token',
    });

    const result = await client.deployExecutionPlan(plan);

    expect(result.plan_id).toBe(submission.plan_id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [RequestInfo, RequestInit | undefined];
    const requestInit = call[1] ?? ({} as RequestInit);
    const headers = (requestInit.headers ?? {}) as Record<string, string>;
    expect(headers['X-Omne-Nonce']).toBe(plan.contract.deployment_nonce);
    expect(headers.Authorization).toBe('Bearer preset-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('throws when deployment nonce missing and not provided', async () => {
    const plan = makePlan();
    plan.contract.deployment_nonce = '';
    const client = new OmneClient('http://127.0.0.1:8545');

    await expect(client.deployExecutionPlan(plan)).rejects.toThrow(GuardrailError);
  });
});

function makePlan(): DeploymentPlan {
  const wasmSha = 'ab'.repeat(32);
  const verifyingKey = 'cd'.repeat(32);
  const signature = 'ef'.repeat(64);
  const digest = '01'.repeat(32);

  return {
    generated_at: new Date().toISOString(),
    network: {
      name: 'testnet',
      chain_id: 1337,
      rpc_endpoint: 'http://127.0.0.1:8545',
      ws_endpoint: 'ws://127.0.0.1:8546',
      explorer_url: 'http://127.0.0.1:3000',
    },
    contract: {
      path: 'Demo.wasm',
      wasm_size_bytes: 4,
      wasm_sha256: wasmSha,
      wasm_base64: Buffer.from('demo').toString('base64'),
      deployment_nonce: generateDeploymentNonce(),
      entry: {
        contract: 'Demo',
        function: 'init',
        selector: 'Demo::init',
        export: 'axiom_contract::Demo::init',
        legacy_export: null,
      },
      metadata: {
        has_axiom_entry_main: true,
        has_legacy_entry_main: false,
        methods: [],
        compiler: {
          metadata: {
            metadata_version: '1.0',
            compiler_version: 'test-suite',
            generated_at: new Date().toISOString(),
            source_path: 'contracts/demo.rs',
            wasm_sha256: wasmSha,
            wasm_size_bytes: 4,
            contracts: [],
            free_functions: [],
            host_functions: [],
          },
          signature: {
            algorithm: 'ed25519',
            public_key_hex: verifyingKey,
            signature_hex: signature,
            digest_hex: digest,
            signed_at: new Date().toISOString(),
          },
        },
      },
    },
    execution: {
      tier: 'standard',
      config: {
        gas_limit: 100000,
      },
      preview: null,
      preview_summary: null,
    },
    services: [],
    signature: {
      algorithm: 'ed25519',
      public_key_hex: verifyingKey,
      signature_hex: signature,
    },
  };
}
