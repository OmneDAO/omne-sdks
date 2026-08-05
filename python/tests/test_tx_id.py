"""Tessera transaction-id conformance, driven by the shared vectors.

**The vector file is the contract, not this file.** Rust, TypeScript and Go
assert against the same JSON.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from omne_sdk.tx_id import TAG_TX, transaction_id

VECTORS = json.loads(
    (pathlib.Path(__file__).parents[2] / "vectors" / "tx_id_v1.json").read_text()
)
CASES = VECTORS["cases"]


def test_domain_tag_is_sixteen_bytes_and_matches_the_vector_file():
    assert len(TAG_TX) == 16
    assert VECTORS["domain_tag"] == TAG_TX.decode()


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_matches_vector(case):
    got = transaction_id(
        chain_id=bytes.fromhex(case["chain_id"]),
        sender=bytes.fromhex(case["sender"]),
        recipient=bytes.fromhex(case["recipient"]),
        # Decimal STRINGS: u128 does not survive JSON numbers, and a silently
        # truncated amount would change the id.
        amount=int(case["amount"]),
        fee=int(case["fee"]),
        nonce=int(case["nonce"]),
    )
    assert got.hex() == case["tx_id"]


def test_every_vector_id_is_distinct():
    ids = [c["tx_id"] for c in CASES]
    assert len(set(ids)) == len(ids)


def test_rejects_a_short_address_rather_than_hashing_it_anyway():
    base = dict(
        chain_id=bytes(32),
        sender=bytes(32),
        recipient=bytes(32),
        amount=0,
        fee=0,
        nonce=0,
    )
    with pytest.raises(ValueError):
        transaction_id(**{**base, "sender": bytes(31)})
    with pytest.raises(ValueError):
        transaction_id(**{**base, "chain_id": bytes(33)})


def test_rejects_an_oversized_value_instead_of_truncating():
    base = dict(
        chain_id=bytes(32),
        sender=bytes(32),
        recipient=bytes(32),
        amount=0,
        fee=0,
        nonce=0,
    )
    with pytest.raises(ValueError):
        transaction_id(**{**base, "amount": 1 << 128})
    with pytest.raises(ValueError):
        transaction_id(**{**base, "nonce": 1 << 64})
