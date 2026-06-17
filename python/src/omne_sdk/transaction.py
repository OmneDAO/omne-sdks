"""Transaction building + canonical hashing.

The signing preimage matches the Rust-side hash_transaction() in
omne-blockchain/src/rpc/wallet.rs and the TS wallet: fields are concatenated in
a fixed order with little-endian numeric encoding, then SHA-256'd. The node
reconstructs this exact preimage from the wire payload to verify the signature,
so every signed field must round-trip byte-for-byte.

    SHA-256( from(32) ‖ to(32) ‖ value(LE128) ‖ gasLimit(LE64) ‖ gasPrice(LE64)
             ‖ nonce(LE64) ‖ chainId(LE64) ‖ data )

Addresses are decoded from their om1z form to 32 raw bytes for the preimage.
`data` is the hex-encoded ABI calldata (see abi.encode_contract_call).
"""

from __future__ import annotations

import hashlib

from .address import from_omne_address, from_hex

DEFAULT_GAS_LIMIT = 200_000
DEFAULT_GAS_PRICE = "5000"


def _le(value: int, num_bytes: int) -> bytes:
    return int(value).to_bytes(num_bytes, "little")


def hash_transaction(transaction: dict) -> bytes:
    """Canonical 32-byte transaction hash used as the ML-DSA-44 signing message."""
    if transaction.get("chainId") is None:
        raise ValueError("chainId must be set on the transaction before hashing")

    from_bytes = from_omne_address(transaction["from"])
    to = transaction.get("to")
    to_bytes = from_omne_address(to) if to else b""

    data = transaction.get("data") or ""
    data_bytes = from_hex(data) if data else b""

    preimage = b"".join(
        [
            from_bytes,
            to_bytes,
            _le(int(transaction["value"]), 16),
            _le(int(transaction["gasLimit"]), 8),
            _le(int(transaction["gasPrice"]), 8),
            _le(int(transaction["nonce"]), 8),
            _le(int(transaction["chainId"]), 8),
            data_bytes,
        ]
    )
    return hashlib.sha256(preimage).digest()


def build_transaction(
    *,
    sender: str,
    to: str,
    data: str = "",
    value: int | str = 0,
    gas_limit: int = DEFAULT_GAS_LIMIT,
    gas_price: str = DEFAULT_GAS_PRICE,
    nonce: int = 0,
    chain_id: int | None = None,
) -> dict:
    """Build an unsigned transaction dict ready for WalletAccount.sign_transaction."""
    tx: dict = {
        "from": sender,
        "to": to,
        "value": str(value),
        "gasLimit": gas_limit,
        "gasPrice": gas_price,
        "nonce": nonce,
        "data": data,
    }
    if chain_id is not None:
        tx["chainId"] = chain_id
    return tx
