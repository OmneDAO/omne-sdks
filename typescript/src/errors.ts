/**
 * Error classes for Omne SDK
 * 
 * Comprehensive error handling for blockchain operations,
 * network communication, and wallet management.
 */

/**
 * Base error class for all Omne SDK errors
 */
export class OmneSDKError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(message: string, code: string = 'OMNE_SDK_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'OmneSDKError';
    this.code = code;
    this.details = details;
    
    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OmneSDKError);
    }
  }
}

/**
 * Network communication errors
 */
export class NetworkError extends OmneSDKError {
  public readonly statusCode?: number;
  public readonly response?: any;

  constructor(
    message: string, 
    statusCode?: number, 
    response?: any, 
    details?: Record<string, any>
  ) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
    this.response = response;
  }

  /**
   * Create NetworkError from fetch response
   */
  static fromResponse(response: Response, responseBody?: any): NetworkError {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return new NetworkError(
      `Network request failed: ${response.status} ${response.statusText}`,
      response.status,
      responseBody,
      {
        url: response.url,
        headers
      }
    );
  }

  /**
   * Create NetworkError from connection failure
   */
  static connectionFailed(url: string, originalError?: Error): NetworkError {
    return new NetworkError(
      `Failed to connect to ${url}`,
      undefined,
      undefined,
      {
        url,
        originalError: originalError?.message
      }
    );
  }

  /**
   * Create NetworkError from timeout
   */
  static timeout(url: string, timeoutMs: number): NetworkError {
    return new NetworkError(
      `Request timeout after ${timeoutMs}ms`,
      408,
      undefined,
      {
        url,
        timeout: timeoutMs
      }
    );
  }
}

/**
 * Transaction-related errors
 */
export class TransactionError extends OmneSDKError {
  public readonly txHash?: string;
  public readonly gasUsed?: number;

  constructor(
    message: string, 
    txHash?: string, 
    gasUsed?: number, 
    details?: Record<string, any>
  ) {
    super(message, 'TRANSACTION_ERROR', details);
    this.name = 'TransactionError';
    this.txHash = txHash;
    this.gasUsed = gasUsed;
  }

  /**
   * Create TransactionError for failed transaction
   */
  static failed(txHash: string, reason: string, gasUsed?: number): TransactionError {
    return new TransactionError(
      `Transaction failed: ${reason}`,
      txHash,
      gasUsed,
      { reason }
    );
  }

  /**
   * Create TransactionError for gas estimation failure
   */
  static gasEstimationFailed(reason: string): TransactionError {
    return new TransactionError(
      `Gas estimation failed: ${reason}`,
      undefined,
      undefined,
      { reason, operation: 'gas_estimation' }
    );
  }

  /**
   * Create TransactionError for insufficient funds
   */
  static insufficientFunds(required: string, available: string): TransactionError {
    return new TransactionError(
      `Insufficient funds: required ${required} OMC, available ${available} OMC`,
      undefined,
      undefined,
      { required, available, operation: 'fund_check' }
    );
  }

  /**
   * Create TransactionError for nonce issues
   */
  static invalidNonce(expectedNonce: number, providedNonce: number): TransactionError {
    return new TransactionError(
      `Invalid nonce: expected ${expectedNonce}, provided ${providedNonce}`,
      undefined,
      undefined,
      { expectedNonce, providedNonce, operation: 'nonce_validation' }
    );
  }
}

/**
 * Validation errors for input parameters
 */
export class ValidationError extends OmneSDKError {
  public readonly field?: string;
  public readonly value?: any;

  constructor(
    message: string, 
    field?: string, 
    value?: any, 
    details?: Record<string, any>
  ) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }

  /**
   * Create ValidationError for invalid address
   */
  static invalidAddress(address: string): ValidationError {
    return new ValidationError(
      `Invalid address format: ${address}`,
      'address',
      address,
      { expectedFormat: 'omne1 followed by 40 hex characters, or 40-char raw hex' }
    );
  }

  /**
   * Create ValidationError for invalid amount
   */
  static invalidAmount(amount: any, field: string = 'amount'): ValidationError {
    return new ValidationError(
      `Invalid amount: ${amount}`,
      field,
      amount,
      { expectedType: 'positive number or string' }
    );
  }

  /**
   * Create ValidationError for missing required field
   */
  static missingField(field: string): ValidationError {
    return new ValidationError(
      `Missing required field: ${field}`,
      field,
      undefined,
      { operation: 'field_validation' }
    );
  }

  /**
   * Create ValidationError for invalid enum value
   */
  static invalidEnum(field: string, value: any, validValues: any[]): ValidationError {
    return new ValidationError(
      `Invalid value for ${field}: ${value}. Valid values: ${validValues.join(', ')}`,
      field,
      value,
      { validValues }
    );
  }
}

/**
 * Guardrail enforcement errors for deployment workflows
 */
export class GuardrailError extends OmneSDKError {
  public readonly allowed?: string[];
  public readonly serviceId?: string;

  constructor(message: string, details?: Record<string, any>) {
    super(message, 'GUARDRAIL_ERROR', details);
    this.name = 'GuardrailError';
    this.allowed = details?.allowed;
    this.serviceId = details?.serviceId;
  }

  static serviceNotAllowed(serviceId: string, allowed: string[]): GuardrailError {
    return new GuardrailError(`Service '${serviceId}' is not in the allow-list`, {
      serviceId,
      allowed
    });
  }

  static duplicateService(serviceId: string): GuardrailError {
    return new GuardrailError(`Duplicate service identifier '${serviceId}' detected`, {
      serviceId
    });
  }
}

/**
 * Wallet and cryptographic operation errors
 */
export class WalletError extends OmneSDKError {
  public readonly operation?: string;

  constructor(
    message: string, 
    operation?: string, 
    details?: Record<string, any>
  ) {
    super(message, 'WALLET_ERROR', details);
    this.name = 'WalletError';
    this.operation = operation;
  }

  /**
   * Create WalletError for mnemonic validation failure
   */
  static invalidMnemonic(mnemonic: string): WalletError {
    return new WalletError(
      'Invalid mnemonic phrase',
      'mnemonic_validation',
      { 
        wordCount: mnemonic.split(' ').length,
        expectedWordCount: [12, 15, 18, 21, 24]
      }
    );
  }

  /**
   * Create WalletError for private key issues
   */
  static invalidPrivateKey(key: string): WalletError {
    return new WalletError(
      'Invalid private key format',
      'private_key_validation',
      { 
        keyLength: key.length,
        expectedLength: 64, // 64 hex chars, raw hex, no prefix
        providedKey: key.substring(0, 10) + '...' // First 10 chars for debugging
      }
    );
  }

  /**
   * Create WalletError for signing failures
   */
  static signingFailed(reason: string): WalletError {
    return new WalletError(
      `Transaction signing failed: ${reason}`,
      'transaction_signing',
      { reason }
    );
  }

  /**
   * Create WalletError for keystore operations
   */
  static keystoreError(operation: string, reason: string): WalletError {
    return new WalletError(
      `Keystore ${operation} failed: ${reason}`,
      `keystore_${operation}`,
      { reason }
    );
  }
}

/**
 * JSON-RPC specific errors
 */
export class RPCError extends OmneSDKError {
  public readonly rpcCode?: number;
  public readonly rpcData?: any;

  constructor(
    message: string, 
    rpcCode?: number, 
    rpcData?: any, 
    details?: Record<string, any>
  ) {
    super(message, 'RPC_ERROR', details);
    this.name = 'RPCError';
    this.rpcCode = rpcCode;
    this.rpcData = rpcData;
  }

  /**
   * Create RPCError from JSON-RPC error response
   */
  static fromRPCResponse(error: { code: number; message: string; data?: any }): RPCError {
    return new RPCError(
      error.message,
      error.code,
      error.data,
      { rpcError: error }
    );
  }

  /**
   * Common RPC error codes
   */
  static readonly CODES = {
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603
  } as const;
}

/**
 * Contract interaction errors
 */
export class ContractError extends OmneSDKError {
  public readonly contractAddress?: string;
  public readonly method?: string;

  constructor(
    message: string, 
    contractAddress?: string, 
    method?: string, 
    details?: Record<string, any>
  ) {
    super(message, 'CONTRACT_ERROR', details);
    this.name = 'ContractError';
    this.contractAddress = contractAddress;
    this.method = method;
  }

  /**
   * Create ContractError for deployment failure
   */
  static deploymentFailed(reason: string): ContractError {
    return new ContractError(
      `Contract deployment failed: ${reason}`,
      undefined,
      'deploy',
      { reason }
    );
  }

  /**
   * Create ContractError for method call failure
   */
  static methodCallFailed(contractAddress: string, method: string, reason: string): ContractError {
    return new ContractError(
      `Contract method call failed: ${method} on ${contractAddress} - ${reason}`,
      contractAddress,
      method,
      { reason }
    );
  }
}

/**
 * Error utility functions
 */
export class ErrorUtils {
  /**
   * Check if error is a specific Omne SDK error type
   */
  static isOmneError(error: any, errorType?: typeof OmneSDKError): boolean {
    if (errorType) {
      return error instanceof errorType;
    }
    return error instanceof OmneSDKError;
  }

  /**
   * Extract error message from various error types
   */
  static extractMessage(error: any): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error.message === 'string') {
      return error.message;
    }
    return 'Unknown error occurred';
  }

  /**
   * Create error from unknown source
   */
  static fromUnknown(error: any, defaultMessage: string = 'Unknown error'): OmneSDKError {
    if (error instanceof OmneSDKError) {
      return error;
    }

    const message = ErrorUtils.extractMessage(error) || defaultMessage;
    
    return new OmneSDKError(message, 'UNKNOWN_ERROR', {
      originalError: error,
      originalErrorType: typeof error,
      originalErrorConstructor: error?.constructor?.name
    });
  }

  /**
   * Wrap async operation with error handling
   */
  static async wrapAsync<T>(
    operation: () => Promise<T>,
    errorContext: string
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof OmneSDKError) {
        throw error;
      }
      
      throw ErrorUtils.fromUnknown(error, `Error in ${errorContext}`);
    }
  }
}
