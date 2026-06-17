"""Omne ABI wire encoding for contract calls.

Port of sdk/typescript/src/contract.ts. Encodes a method call into the binary
wire format the runtime decodes, placed (hex-encoded) in a transaction's `data`
field or an omne_call `data` field:

    MAGIC "OMNE" (4) | VERSION 0x01 (1) | method_len u16 BE | method_utf8
        | arg_count u16 BE | [ type u8 | data_len u32 BE | data ]*

NOTE: ABI integers are BIG-endian here (the codec), distinct from the
LITTLE-endian transaction-hash preimage in transaction.py. Keep them separate.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from .address import parse_address

_ABI_MAGIC = b"OMNE"
_ABI_VERSION = 0x01
_MAX_METHOD_NAME_LEN = 256
_MAX_ARG_COUNT = 64


class ArgType(IntEnum):
    U32 = 0x01
    U64 = 0x02
    I32 = 0x03
    I64 = 0x04
    STRING = 0x05
    BYTES = 0x06
    BOOL = 0x07
    ADDRESS = 0x08
    U128 = 0x09


@dataclass(frozen=True)
class AbiArgument:
    type: ArgType
    data: bytes


class AbiEncode:
    """Convenience builders for typed ABI arguments (big-endian numerics)."""

    @staticmethod
    def u32(value: int) -> AbiArgument:
        return AbiArgument(ArgType.U32, int(value).to_bytes(4, "big"))

    @staticmethod
    def u64(value: int) -> AbiArgument:
        return AbiArgument(ArgType.U64, int(value).to_bytes(8, "big"))

    @staticmethod
    def i32(value: int) -> AbiArgument:
        return AbiArgument(ArgType.I32, int(value).to_bytes(4, "big", signed=True))

    @staticmethod
    def i64(value: int) -> AbiArgument:
        return AbiArgument(ArgType.I64, int(value).to_bytes(8, "big", signed=True))

    @staticmethod
    def u128(value: int) -> AbiArgument:
        return AbiArgument(ArgType.U128, int(value).to_bytes(16, "big"))

    @staticmethod
    def string(value: str) -> AbiArgument:
        return AbiArgument(ArgType.STRING, value.encode("utf-8"))

    @staticmethod
    def bytes_(value: bytes) -> AbiArgument:
        return AbiArgument(ArgType.BYTES, bytes(value))

    @staticmethod
    def bool_(value: bool) -> AbiArgument:
        return AbiArgument(ArgType.BOOL, b"\x01" if value else b"\x00")

    @staticmethod
    def address(omne_address: str) -> AbiArgument:
        payload = parse_address(omne_address)
        if len(payload) != 32:
            raise ValueError(f"Address must be 32 bytes, got {len(payload)}")
        return AbiArgument(ArgType.ADDRESS, payload)

    @staticmethod
    def address_bytes(payload: bytes) -> AbiArgument:
        if len(payload) != 32:
            raise ValueError(f"Address must be 32 bytes, got {len(payload)}")
        return AbiArgument(ArgType.ADDRESS, bytes(payload))


def encode_contract_call(method: str, args: list[AbiArgument] | None = None) -> str:
    """Encode a method call into the Omne ABI wire format; returns bare hex."""
    args = args or []
    method_bytes = method.encode("utf-8")
    if len(method_bytes) > _MAX_METHOD_NAME_LEN:
        raise ValueError(f"Method name exceeds {_MAX_METHOD_NAME_LEN} byte limit")
    if len(args) > _MAX_ARG_COUNT:
        raise ValueError(f"Argument count {len(args)} exceeds maximum of {_MAX_ARG_COUNT}")

    out = bytearray()
    out += _ABI_MAGIC
    out.append(_ABI_VERSION)
    out += len(method_bytes).to_bytes(2, "big")
    out += method_bytes
    out += len(args).to_bytes(2, "big")
    for arg in args:
        out.append(int(arg.type))
        out += len(arg.data).to_bytes(4, "big")
        out += arg.data
    return out.hex()
