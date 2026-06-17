"""Omne Python SDK — post-quantum (ML-DSA-44) wallet, ABI, and RPC client.

Parity-matched with the TypeScript SDK (sdk/typescript): the same mnemonic
yields the same om1z addresses, and Python-produced signatures are accepted by
the node's verify path. See tests/test_parity.py for the proof vectors.
"""

from .address import (
    derive_address_from_public_key,
    from_omne_address,
    parse_address,
    to_omne_address,
)
from .abi import AbiArgument, AbiEncode, ArgType, encode_contract_call
from .errors import OmneError, RpcError, ValidationError, WalletError
from .rpc import OmneClient
from .transaction import build_transaction, hash_transaction
from .wallet import Wallet, WalletAccount, mnemonic_to_seed

__version__ = "0.1.0"

__all__ = [
    "Wallet",
    "WalletAccount",
    "mnemonic_to_seed",
    "OmneClient",
    "AbiEncode",
    "AbiArgument",
    "ArgType",
    "encode_contract_call",
    "build_transaction",
    "hash_transaction",
    "to_omne_address",
    "from_omne_address",
    "parse_address",
    "derive_address_from_public_key",
    "OmneError",
    "WalletError",
    "ValidationError",
    "RpcError",
    "__version__",
]
