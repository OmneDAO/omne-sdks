import { GuardrailError } from './errors';

export type RuntimeTier = 'fastvm' | 'standard' | 'compute';

export interface RuntimeGuardrails {
  tier: RuntimeTier;
  maxCallDepth: number;
  storageBudgetBytes: number;
}

export const RUNTIME_GUARDRAILS: Record<RuntimeTier, RuntimeGuardrails> = {
  fastvm: {
    tier: 'fastvm',
    maxCallDepth: 32,
    storageBudgetBytes: 64 * 1024,
  },
  standard: {
    tier: 'standard',
    maxCallDepth: 128,
    storageBudgetBytes: 512 * 1024,
  },
  compute: {
    tier: 'compute',
    maxCallDepth: 512,
    storageBudgetBytes: 2 * 1024 * 1024,
  },
};

export function runtimeGuardrailsForTier(tier: string): RuntimeGuardrails {
  const normalised = tier.toLowerCase();
  switch (normalised) {
    case 'fastvm':
      return RUNTIME_GUARDRAILS.fastvm;
    case 'standard':
    case 'standardvm':
      return RUNTIME_GUARDRAILS.standard;
    case 'compute':
    case 'computevm':
      return RUNTIME_GUARDRAILS.compute;
    default:
      throw new GuardrailError(`Unknown runtime tier '${tier}'`, {
        reason: 'unknown_runtime_tier',
        tier,
      });
  }
}

export function assertRuntimeGuardrails(
  tier: string,
  config: { max_call_depth?: unknown; storage_budget_bytes?: unknown },
  previewSummary?: Record<string, unknown> | null
): void {
  const guardrails = runtimeGuardrailsForTier(tier);
  const maxCallDepth = Number(config.max_call_depth);
  const storageBudgetBytes = Number(config.storage_budget_bytes);

  if (!Number.isFinite(maxCallDepth) || maxCallDepth <= 0) {
    throw new GuardrailError(
      `Execution plan for tier '${tier}' must include a positive max_call_depth guardrail`,
      {
        reason: 'invalid_max_call_depth',
        tier,
        max_call_depth: config.max_call_depth,
      }
    );
  }

  if (maxCallDepth > guardrails.maxCallDepth) {
    throw new GuardrailError(
      `max_call_depth ${maxCallDepth} exceeds ${guardrails.maxCallDepth} for tier '${guardrails.tier}'`,
      {
        reason: 'max_call_depth_exceeded',
        tier,
        max_call_depth: maxCallDepth,
        limit: guardrails.maxCallDepth,
      }
    );
  }

  if (!Number.isFinite(storageBudgetBytes) || storageBudgetBytes <= 0) {
    throw new GuardrailError(
      `Execution plan for tier '${tier}' must include a positive storage_budget_bytes guardrail`,
      {
        reason: 'invalid_storage_budget',
        tier,
        storage_budget_bytes: config.storage_budget_bytes,
      }
    );
  }

  if (storageBudgetBytes > guardrails.storageBudgetBytes) {
    throw new GuardrailError(
      `storage_budget_bytes ${storageBudgetBytes} exceeds ${guardrails.storageBudgetBytes} for tier '${guardrails.tier}'`,
      {
        reason: 'storage_budget_exceeded',
        tier,
        storage_budget_bytes: storageBudgetBytes,
        limit: guardrails.storageBudgetBytes,
      }
    );
  }

  if (previewSummary) {
    const observedDepthRaw =
      previewSummary.call_depth_used ?? previewSummary.callDepthUsed ?? previewSummary.max_call_depth ?? previewSummary.maxCallDepth;
    const observedDepth = Number(observedDepthRaw);
    if (Number.isFinite(observedDepth) && observedDepth > guardrails.maxCallDepth) {
      throw new GuardrailError(
        `Preview call depth ${observedDepth} exceeds ${guardrails.maxCallDepth} for tier '${guardrails.tier}'`,
        {
          reason: 'preview_call_depth_exceeded',
          tier,
          call_depth_used: observedDepth,
          limit: guardrails.maxCallDepth,
        }
      );
    }

    const storageWrittenRaw =
      previewSummary.storage_bytes_written ??
      previewSummary.storageBytesWritten ??
      previewSummary.storage_budget_bytes_used ??
      previewSummary.storageBudgetBytesUsed;
    const storageWritten = Number(storageWrittenRaw);
    if (Number.isFinite(storageWritten) && storageWritten > guardrails.storageBudgetBytes) {
      throw new GuardrailError(
        `Preview storage usage ${storageWritten} exceeds ${guardrails.storageBudgetBytes} for tier '${guardrails.tier}'`,
        {
          reason: 'preview_storage_budget_exceeded',
          tier,
          storage_bytes_written: storageWritten,
          limit: guardrails.storageBudgetBytes,
        }
      );
    }
  }
}
