// Signer interface & adapters
// Provide a minimal Signer abstraction used by bindings and TxBuilder.

import { GuardrailError } from './errors';
import { Transaction } from './types';

export interface Signer {
  // return address in Omne format (e.g., 'om1z...')
  getAddress(): Promise<string>;
  // sign a transaction object and return a signed transaction or signature blob
  signTransaction(tx: Transaction): Promise<Transaction & { signature?: string }>;
  // sign arbitrary message
  signMessage(message: string | Uint8Array): Promise<string>;
}

export interface CompilerFunctionParamMetadata {
  name: string;
  ty: string;
}

export interface CompilerContractMethodMetadata {
  name: string;
  selector: string;
  export: string;
  params: CompilerFunctionParamMetadata[];
  return_type?: string | null;
}

export interface CompilerContractMetadata {
  name: string;
  params: CompilerFunctionParamMetadata[];
  storage: Array<{ name: string; ty: string }>;
  methods: CompilerContractMethodMetadata[];
}

export interface CompilerFreeFunctionMetadata {
  name: string;
  export: string;
  params: CompilerFunctionParamMetadata[];
  return_type?: string | null;
}

export interface CompilerMetadata {
  metadata_version: string;
  compiler_version: string;
  generated_at: string;
  source_path?: string | null;
  wasm_sha256: string;
  wasm_size_bytes: number;
  contracts: CompilerContractMetadata[];
  free_functions: CompilerFreeFunctionMetadata[];
  host_functions: string[];
}

export interface CompilerMetadataSignature {
  algorithm: string;
  public_key_hex: string;
  signature_hex: string;
  digest_hex: string;
  signed_at: string;
}

export interface CompilerAttachment {
  metadata: CompilerMetadata;
  signature?: CompilerMetadataSignature | null;
}

export interface DeploymentPlanContractMetadata {
  has_axiom_entry_main: boolean;
  has_legacy_entry_main: boolean;
  methods: Array<Record<string, any>>;
  compiler?: CompilerAttachment | null;
}

export interface DeploymentPlanContractEntry {
  contract: string;
  function: string;
  selector: string;
  export: string;
  legacy_export?: string | null;
}

export interface DeploymentPlanContract {
  path?: string | null;
  wasm_size_bytes: number;
  wasm_sha256: string;
  wasm_base64: string;
  deployment_nonce: string;
  entry: DeploymentPlanContractEntry;
  metadata?: DeploymentPlanContractMetadata | null;
}

export interface DeploymentPlanNetwork {
  name: string;
  chain_id: number;
  rpc_endpoint: string;
  ws_endpoint: string;
  explorer_url: string;
}

export interface HardenedExecutionConfig {
  function_name?: string;
  arguments?: unknown[];
  gas_limit: number;
  timeout?: {
    secs: number;
    nanos: number;
  };
  max_call_depth?: number;
  storage_budget_bytes?: number;
  [key: string]: unknown;
}

export interface ExecutionPreviewSummary {
  execution_time_ms?: number;
  gas_consumed?: number;
  return_value?: unknown;
  deterministic_state?: string;
  call_depth_used?: number;
  storage_bytes_written?: number;
  [key: string]: unknown;
}

export interface DeploymentPlanExecution {
  tier: string;
  config: HardenedExecutionConfig;
  preview?: Record<string, any> | null;
  preview_summary?: ExecutionPreviewSummary | null;
}

export interface DeploymentPlanSignature {
  algorithm: string;
  public_key_hex: string;
  signature_hex: string;
}

export interface DeploymentPlan {
  generated_at?: string | null;
  network?: DeploymentPlanNetwork | null;
  contract: DeploymentPlanContract;
  execution: DeploymentPlanExecution;
  services: string[];
  signature?: DeploymentPlanSignature | null;
}

export interface DeploymentSubmissionResponse {
  status: string;
  plan_id: string;
  digest: string;
  signer: string;
  compiler_signer?: string | null;
  operator_id: string;
  nonce_provenance: string;
  submitted_at: string;
}

export interface DeploymentErrorResponse {
  error: string;
  detail?: string;
  retry_after_seconds?: number;
}

export interface DeploymentPlanSummary {
  planId: string;
  network: string;
  operatorId: string;
  signerKey: string;
  compilerSigner?: string | null;
  digest: string;
  services: string[];
  deploymentNonce: string;
  submittedAt: string;
}

export interface DeploymentPlanPagination {
  page: number;
  pageSize: number;
  total: number;
  nextPage?: string | null;
}

export interface DeploymentPlanList {
  plans: DeploymentPlanSummary[];
  pagination: DeploymentPlanPagination;
}

export interface DeploymentPlanDetails {
  plan: DeploymentPlanSummary;
  planBody: DeploymentPlan;
  submittedAt: string;
}

export interface DeploymentNonceProvenance {
  nonceHash: string;
  planId: string;
  operatorId: string;
  signerKey: string;
  compilerSigner?: string | null;
  digest: string;
  firstSeenAt: string;
}

export function ensureSignedCompilerAttachment(plan: DeploymentPlan): CompilerAttachment {
  const metadata = plan.contract?.metadata;
  if (!metadata || !metadata.compiler) {
    throw new GuardrailError('Execution plan is missing the compiler metadata attachment', {
      reason: 'compiler_metadata_missing',
    });
  }

  const attachment = metadata.compiler;
  if (!attachment.signature) {
    throw new GuardrailError('Compiler metadata must include a detached signature', {
      reason: 'compiler_signature_missing',
    });
  }

  const { metadata: compilerMetadata, signature } = attachment;
  if (!compilerMetadata) {
    throw new GuardrailError('Compiler metadata payload is empty', {
      reason: 'compiler_metadata_empty',
    });
  }

  if (compilerMetadata.wasm_sha256 !== plan.contract.wasm_sha256) {
    throw new GuardrailError('Compiler metadata wasm hash does not match execution plan artefact', {
      reason: 'compiler_metadata_mismatch',
      expected: plan.contract.wasm_sha256,
      provided: compilerMetadata.wasm_sha256,
    });
  }

  if (compilerMetadata.wasm_size_bytes !== plan.contract.wasm_size_bytes) {
    throw new GuardrailError('Compiler metadata size does not match execution plan artefact', {
      reason: 'compiler_size_mismatch',
      expected: plan.contract.wasm_size_bytes,
      provided: compilerMetadata.wasm_size_bytes,
    });
  }

  if (!signature.digest_hex) {
    throw new GuardrailError('Compiler signature digest is missing', {
      reason: 'compiler_signature_digest_missing',
    });
  }

  if (!signature.public_key_hex) {
    throw new GuardrailError('Compiler signer public key is required', {
      reason: 'compiler_signature_key_missing',
    });
  }

  if (!signature.signature_hex) {
    throw new GuardrailError('Compiler signature payload is missing the signature bytes', {
      reason: 'compiler_signature_bytes_missing',
    });
  }

  return {
    metadata: compilerMetadata,
    signature,
  };
}

// Adapter for the built-in WalletAccount
import { WalletAccount } from './wallet';

export class WalletAccountSigner implements Signer {
  private account: WalletAccount;

  constructor(account: WalletAccount) {
    this.account = account;
  }

  async getAddress(): Promise<string> {
    return this.account.address;
  }

  async signTransaction(tx: Transaction): Promise<Transaction & { signature: string }> {
    return this.account.signTransaction(tx);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const toSign = typeof message === 'string' ? message : Buffer.from(message).toString('hex');
    return this.account.signMessage(toSign);
  }
}

export type {
  DeploymentPlan as HardenedDeploymentPlan,
  DeploymentSubmissionResponse as HardenedDeploymentResponse,
};