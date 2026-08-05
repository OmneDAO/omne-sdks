"""Tessera transaction identity — ``Transaction::id`` in ``node/src/blocks/tx.rs``.

The id is SHA-256 over the domain-tagged, length-framed **intent**: chain id,
sender, recipient, amount, fee, nonce. The signature and public key are *not* in
the preimage, so a client derives the id **locally, before signing and before
submitting**, and it is the id the chain will record.

Not :func:`omne_sdk.transaction.hash_transaction`
------------------------------------------------
That function targets the **archived** chain: no domain tag, no length framing,
and a different field set (``gasLimit``/``gasPrice``/``data`` rather than
``fee``). It cannot produce a Tessera id and the two must not be confused.

Conformance is driven by ``vectors/tx_id_v1.json``, shared with the Rust
implementation. A divergence shows a user one transaction id while the chain
records another, and neither side finds out.
"""

from __future__ import annotations

# Reuse OMA-1's framing rather than writing a second one: §R0.2 requires exactly
# one implementation of a canonical preimage, and two copies can only be kept in
# step by a test that fails *after* someone edits one of them.
from .oma1 import _digest

#: 16-byte domain tag. The trailing dot pads it to 16.
TAG_TX = b"omne.tx.body.v1."

_U128_MAX = (1 << 128) - 1
_U64_MAX = (1 << 64) - 1


def _le(value: int, num_bytes: int) -> bytes:
    if value < 0:
        raise ValueError("tx_id: negative value")
    try:
        return int(value).to_bytes(num_bytes, "little")
    except OverflowError as exc:  # pragma: no cover - message clarity only
        raise ValueError(
            f"tx_id: value does not fit in {num_bytes} bytes"
        ) from exc


def _expect32(b: bytes, what: str) -> bytes:
    if len(b) != 32:
        raise ValueError(f"tx_id: {what} must be 32 bytes, got {len(b)}")
    return b


def transaction_id(
    *,
    chain_id: bytes,
    sender: bytes,
    recipient: bytes,
    amount: int,
    fee: int,
    nonce: int,
) -> bytes:
    """The transaction id a Tessera node will derive for this intent.

    Field order is normative and matches the Rust preimage exactly. Addresses are
    raw 32-byte forms — decode ``om1…`` before calling.
    """
    return _digest(
        TAG_TX,
        _expect32(chain_id, "chain_id"),
        _expect32(sender, "sender"),
        _expect32(recipient, "recipient"),
        _le(amount, 16),
        _le(fee, 16),
        _le(nonce, 8),
    )
