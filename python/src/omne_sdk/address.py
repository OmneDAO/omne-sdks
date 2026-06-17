"""Omne address + identifier encoding.

The Omne chain is uniformly 32-byte (post-quantum). Addresses are bech32m
encodings of a 32-byte payload under witness version 2 (``om1z…``), matching
the TypeScript SDK (sdk/typescript/src/utils.ts) and the Rust-side
``PqcAccountAddress`` exactly:

    address = bech32m("om", [2, ...toWords(SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey))])

This module is pure stdlib (hashlib) + an inline bech32m (BIP-350). Every
function here is parity-verified against the TS SDK ground truth (see
tests/test_parity.py).
"""

from __future__ import annotations

import hashlib

ADDRESS_HRP = "om"
ADDRESS_WITNESS_VERSION = 2  # bech32 alphabet index 2 = 'z' -> "om1z…"
ADDRESS_DOMAIN_TAG = b"OMNE_PQC_ADDRESS_V1"
ADDRESS_PAYLOAD_BYTES = 32

_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_CHARSET_REV = {c: i for i, c in enumerate(_CHARSET)}
_BECH32M_CONST = 0x2BC830A3


# ── hex helpers ─────────────────────────────────────────────────────
def to_hex(data: bytes) -> str:
    return data.hex()


def from_hex(value: str) -> bytes:
    return bytes.fromhex(value[2:] if value.startswith("0x") else value)


# ── bech32m (BIP-350) ───────────────────────────────────────────────
def _polymod(values: list[int]) -> int:
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            chk ^= gen[i] if ((top >> i) & 1) else 0
    return chk


def _hrp_expand(hrp: str) -> list[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def _create_checksum(hrp: str, data: list[int]) -> list[int]:
    values = _hrp_expand(hrp) + data
    polymod = _polymod(values + [0] * 6) ^ _BECH32M_CONST
    return [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]


def _verify_checksum(hrp: str, data: list[int]) -> bool:
    return _polymod(_hrp_expand(hrp) + data) == _BECH32M_CONST


def _convert_bits(data: list[int], from_bits: int, to_bits: int, pad: bool) -> list[int]:
    acc = 0
    bits = 0
    out: list[int] = []
    maxv = (1 << to_bits) - 1
    for value in data:
        if value < 0 or value >> from_bits:
            raise ValueError("invalid value in convert_bits")
        acc = (acc << from_bits) | value
        bits += from_bits
        while bits >= to_bits:
            bits -= to_bits
            out.append((acc >> bits) & maxv)
    if pad:
        if bits:
            out.append((acc << (to_bits - bits)) & maxv)
    elif bits >= from_bits or ((acc << (to_bits - bits)) & maxv):
        raise ValueError("invalid padding in convert_bits")
    return out


# ── om1z address codec ──────────────────────────────────────────────
def to_omne_address(address_bytes: bytes) -> str:
    """Encode a 32-byte payload as a canonical ``om1z…`` bech32m address."""
    if len(address_bytes) != ADDRESS_PAYLOAD_BYTES:
        raise ValueError(f"Address must be {ADDRESS_PAYLOAD_BYTES} bytes, got {len(address_bytes)}")
    data = [ADDRESS_WITNESS_VERSION] + _convert_bits(list(address_bytes), 8, 5, True)
    combined = data + _create_checksum(ADDRESS_HRP, data)
    return ADDRESS_HRP + "1" + "".join(_CHARSET[d] for d in combined)


def from_omne_address(address: str) -> bytes:
    """Decode an ``om1z…`` address to its raw 32-byte payload."""
    lowered = address.lower()
    pos = lowered.rfind("1")
    if pos < 1:
        raise ValueError(f"Invalid address (no separator): {address}")
    hrp = lowered[:pos]
    if hrp != ADDRESS_HRP:
        raise ValueError(f"Invalid address HRP: expected '{ADDRESS_HRP}', got '{hrp}'")
    try:
        data = [_CHARSET_REV[c] for c in lowered[pos + 1:]]
    except KeyError as exc:
        raise ValueError(f"Invalid bech32 character in address: {address}") from exc
    if not _verify_checksum(hrp, data):
        raise ValueError(f"Invalid bech32m checksum: {address}")
    payload_words = data[:-6]
    if not payload_words or payload_words[0] != ADDRESS_WITNESS_VERSION:
        raise ValueError("Invalid witness version")
    payload = bytes(_convert_bits(payload_words[1:], 5, 8, False))
    if len(payload) != ADDRESS_PAYLOAD_BYTES:
        raise ValueError(f"Address payload must be {ADDRESS_PAYLOAD_BYTES} bytes, got {len(payload)}")
    return payload


def parse_address(address: str) -> bytes:
    """Alias for :func:`from_omne_address` — returns the 32-byte payload."""
    return from_omne_address(address)


def derive_address_from_public_key(public_key: bytes) -> str:
    """Canonical address derivation, shared with the Rust-side PqcAccountAddress:
    ``to_omne_address(SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey))``.
    """
    digest = hashlib.sha256(ADDRESS_DOMAIN_TAG + public_key).digest()
    return to_omne_address(digest)
