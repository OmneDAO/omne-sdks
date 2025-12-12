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

  test('rejects execution plans that exceed runtime guardrails', async () => {
    const plan = makePlan();
    plan.execution.config.max_call_depth = 10_000;

    const client = new OmneClient('http://127.0.0.1:8545');
    await expect(client.deployExecutionPlan(plan)).rejects.toThrow(GuardrailError);
  });

  test('rejects plans when preview metrics exceed runtime guardrails', async () => {
    const plan = makePlan();
    plan.execution.preview_summary = {
      execution_time_ms: 120,
      gas_consumed: 10_000,
      call_depth_used: 512,
      storage_bytes_written: 2 * 512 * 1024,
      deterministic_state: 'over-limit',
    };

    const client = new OmneClient('http://127.0.0.1:8545');
    await expect(client.deployExecutionPlan(plan)).rejects.toThrow(GuardrailError);
  });

  test('requires guardrail fields to be present', async () => {
    const plan = makePlan();
    delete (plan.execution.config as any).max_call_depth;

    const client = new OmneClient('http://127.0.0.1:8545');
    await expect(client.deployExecutionPlan(plan)).rejects.toThrow(GuardrailError);
  });
});

describe('OmneClient metadata endpoints', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  test('lists deployment plans with query parameters', async () => {
    const payload = {
      plans: [
        {
          plan_id: 'plan_A',
          network: 'testnet',
          operator_id: 'operator_42',
          signer_key: 'signer_hex',
          compiler_signer: 'compiler_hex',
          digest: 'digest_hex',
          services: ['settlement'],
          deployment_nonce: 'nonce_123',
          submitted_at: '2024-01-01T00:00:00.000Z',
        },
      ],
      pagination: {
        page: 2,
        page_size: 5,
        total: 11,
        next_page: '3',
      },
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    const fetchMock = jest.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith('/v1/plans')).toBe(true);
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('page_size')).toBe('5');
      expect(url.searchParams.get('network')).toBe('testnet');
      expect(url.searchParams.get('operator_id')).toBe('operator_42');
      expect(init?.headers && (init.headers as Record<string, string>).Authorization).toBe('Bearer preset-token');
      return response.clone();
    });

    (globalThis as any).fetch = fetchMock;

    const client = new OmneClient({
      url: 'http://127.0.0.1:8545',
      deploymentUrl: 'http://127.0.0.1:8545/v1/deployments',
      authToken: 'preset-token',
    });

    const result = await client.listDeploymentPlans({
      page: 2,
      pageSize: 5,
      network: ' testnet ',
      operatorId: 'operator_42',
    });

    expect(result.plans).toHaveLength(1);
    expect(result.pagination.page).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('returns null when deployment plan is not found', async () => {
    const response = new Response('', {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });

    (globalThis as any).fetch = jest.fn(async () => response.clone());

    const client = new OmneClient('http://127.0.0.1:8545');
    const result = await client.getDeploymentPlan('missing-plan');

    expect(result).toBeNull();
  });

  test('fetches deployment plan by digest', async () => {
    const payload = {
      plan: {
        plan_id: 'pln_alpha',
        network: 'testnet',
        operator_id: 'operator-7',
        signer_key: 'signer',
        compiler_signer: null,
        digest: 'digest123',
        services: ['alpha'],
        deployment_nonce: 'nonce_x',
        submitted_at: '2024-01-01T00:00:00.000Z',
      },
      plan_body: {
        services: [],
      },
      submitted_at: '2024-01-01T00:00:00.000Z',
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    (globalThis as any).fetch = jest.fn(async (input: RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith('/v1/plans/digest/digest123')).toBe(true);
      return response.clone();
    });

    const client = new OmneClient('http://127.0.0.1:8545');
    const result = await client.getDeploymentPlanByDigest('digest123');

    expect(result?.plan.digest).toBe('digest123');
  });

  test('throws guardrail error when metadata endpoint disabled', async () => {
    const response = new Response('', {
      status: 501,
      headers: { 'content-type': 'application/json' },
    });

    (globalThis as any).fetch = jest.fn(async () => response.clone());

    const client = new OmneClient('http://127.0.0.1:8545');
    await expect(client.listDeploymentPlans()).rejects.toThrow(GuardrailError);
  });

  test('fetches nonce provenance metadata', async () => {
    const payload = {
      nonce_hash: 'hash_1',
      plan_id: 'plan_1',
      operator_id: 'operator_1',
      signer_key: 'signer_1',
      compiler_signer: 'compiler_1',
      digest: 'digest_1',
      first_seen_at: '2024-01-01T00:00:00.000Z',
    };

    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    (globalThis as any).fetch = jest.fn(async (input: RequestInfo) => {
      const url = new URL(String(input));
      expect(url.pathname.endsWith('/v1/provenance/hash_1')).toBe(true);
      return response.clone();
    });

    const client = new OmneClient('http://127.0.0.1:8545');
    const result = await client.getNonceProvenance('hash_1');

    expect(result?.planId).toBe('plan_1');
    expect(result?.nonceHash).toBe('hash_1');
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
        function_name: 'axiom_entry_main',
        arguments: [],
        gas_limit: 100000,
        timeout: { secs: 3, nanos: 0 },
        max_call_depth: 128,
        storage_budget_bytes: 512 * 1024,
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
