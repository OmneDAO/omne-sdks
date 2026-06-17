"""Error types for the Omne Python SDK."""

from __future__ import annotations


class OmneError(Exception):
    """Base class for all Omne SDK errors."""


class WalletError(OmneError):
    """Wallet / key-derivation / signing error."""


class ValidationError(OmneError):
    """Invalid argument or input."""


class RpcError(OmneError):
    """JSON-RPC transport or node-returned error."""

    def __init__(self, message: str, code: int | None = None):
        super().__init__(message)
        self.code = code
