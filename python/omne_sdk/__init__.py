"""
Omne Python SDK - Official Python SDK for Omne Blockchain

A comprehensive, type-safe SDK for interacting with Omne's commerce-first blockchain
featuring dual-layer consensus, microscopic fees, and computational revenue integration.
"""

# Core utilities and types (no external dependencies)
from .utils import to_quar, from_quar, to_omc, from_omc, is_valid_address, to_omne_address, from_omne_address

# Try to import full types (with pydantic), fall back to basic types
try:
    from .types import (
        NetworkInfo,
        Balance,
        Transaction,
        TransactionReceipt,
        Block,
        ORC20Token,
        ORC20TokenConfig,
        ComputationalJob,
        JobStatus,
        JobType,
        NetworkType,
        TransactionStatus,
    )
except ImportError:
    from .types_basic import (
        NetworkInfo,
        Balance,
        Transaction,
        TransactionReceipt,
        Block,
        ORC20Token,
        ORC20TokenConfig,
        ComputationalJob,
        JobStatus,
        JobType,
        NetworkType,
        TransactionStatus,
    )

from .exceptions import (
    OmneSDKError,
    NetworkError,
    TransactionError,
    ValidationError,
)

# Optional imports (require external dependencies)
try:
    from .client import OmneClient
except ImportError:
    OmneClient = None

try:
    from .wallet import Wallet, Account
except ImportError:
    Wallet = None
    Account = None

__version__ = "0.1.0"
__author__ = "OmneDAO"
__email__ = "dev@omne.org"

__all__ = [
    # Utilities (always available)
    "to_quar",
    "from_quar", 
    "to_omc",
    "from_omc",
    "is_valid_address",
    "to_omne_address",
    "from_omne_address",
    
    # Data types (always available)
    "NetworkInfo",
    "Balance",
    "Transaction",
    "TransactionReceipt", 
    "Block",
    "ORC20Token",
    "ORC20TokenConfig",
    "ComputationalJob",
    "JobStatus",
    "JobType",
    "NetworkType",
    "TransactionStatus",
    
    # Exceptions (always available)
    "OmneSDKError",
    "NetworkError",
    "TransactionError",
    "ValidationError",
    
    # Optional components (require dependencies)
    "OmneClient",  # Requires aiohttp, websockets
    "Wallet",      # Requires mnemonic, eth-keys, cryptography
    "Account",     # Requires mnemonic, eth-keys, cryptography
]
