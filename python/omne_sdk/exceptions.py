"""
Exception classes for the Omne Python SDK
"""

from typing import Optional, Dict, Any


class OmneSDKError(Exception):
    """Base exception for all Omne SDK errors"""
    
    def __init__(self, message: str, code: Optional[int] = None, data: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.data = data or {}


class NetworkError(OmneSDKError):
    """Network communication errors"""
    pass


class TransactionError(OmneSDKError):
    """Transaction execution errors"""
    
    def __init__(self, message: str, tx_hash: Optional[str] = None, **kwargs):
        super().__init__(message, **kwargs)
        self.tx_hash = tx_hash


class ValidationError(OmneSDKError):
    """Input validation errors"""
    pass


class GasEstimationError(OmneSDKError):
    """Gas estimation errors"""
    pass


class InsufficientFundsError(TransactionError):
    """Insufficient funds for transaction"""
    pass


class JobExecutionError(OmneSDKError):
    """Computational job execution errors"""
    
    def __init__(self, message: str, job_id: Optional[str] = None, **kwargs):
        super().__init__(message, **kwargs)
        self.job_id = job_id


class ContractError(OmneSDKError):
    """Smart contract interaction errors"""
    
    def __init__(self, message: str, contract_address: Optional[str] = None, **kwargs):
        super().__init__(message, **kwargs)
        self.contract_address = contract_address


class WalletError(OmneSDKError):
    """Wallet and key management errors"""
    pass


class AuthenticationError(OmneSDKError):
    """Authentication and authorization errors"""
    pass
