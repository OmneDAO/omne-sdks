"""OMA-1 and OMS-1 — the canonical Omne address and mnemonic schemes.

These replace the pre-genesis derivation entirely. The differences from the old
``om1z…`` scheme are not cosmetic — every one changes the bytes::

    old: address = SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey), bech32m with
         witness version 2, ~59 chars
    new: address = SHA-256(TAG_EOA || u32le(len) || pubkey), PLAIN bech32m
         with no witness version, exactly 61 chars

Three reasons the old form is gone:

* The tag was not length-framed, so field boundaries in the preimage were a
  convention rather than a fact.
* The witness version made the address a segwit-shaped thing it is not; a
  32-byte payload with no version is simply a payload.
* ``OMNE_PQC_ADDRESS_V1`` is 19 bytes. All OMA-1 tags are exactly 16, which
  makes them pairwise prefix-free by construction rather than by luck.

The ML-DSA-44 keygen underneath is UNCHANGED and already parity-matched. Only
the address and the mnemonic moved.

Conformance is asserted against the shared vectors in ``../../vectors/``, which
are copied from tessera. Reimplementing the spec and testing against your own
output proves only self-consistency.
"""

from __future__ import annotations

import hashlib
import re

HRP = "om"
ADDRESS_STR_LEN = 61
ML_DSA_44_PUBKEY_LEN = 1312
WORD_COUNT = 24

# Domain tags. Every one exactly 16 ASCII bytes.
TAG_EOA = b"omne.addr.eoa.v1"
TAG_CTR = b"omne.addr.ctr.v1"
TAG_SYS = b"omne.addr.sys.v1"
TAG_WSM = b"omne.code.wsm.v1"
TAG_SEED = b"omne.seed.mld.v1"

#: The closed registry of protocol-reserved accounts. **Three, not five.**
#:
#: ``fee.vault`` and ``validator.fee.pool`` were removed before genesis: both
#: presuppose fees flow somewhere, and fees are burned. Neither had a source.
SYSTEM_ACCOUNTS = ("treasury", "gas.paymaster", "slash.sink")

_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_GEN = (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)
_BECH32M_CONST = 0x2BC830A3
_ADDRESS_RE = re.compile(r"^om1[02-9ac-hj-np-z]{58}$")


class AddressError(ValueError):
    """An address could not be derived or decoded."""


class MnemonicError(ValueError):
    """A mnemonic could not be parsed."""


def _frame(b: bytes) -> bytes:
    """``u32le(len) || bytes`` — the only way a field is ever written.

    The exemption is what kills you: "this one is always 32 bytes so the prefix
    is redundant" holds right until a second fixed-width field sits beside it,
    at which point two different pairs share one preimage.
    """
    return len(b).to_bytes(4, "little") + b


def _digest(tag: bytes, *fields: bytes) -> bytes:
    if len(tag) != 16:
        raise AddressError(f"domain tag must be 16 bytes: {tag!r}")
    return hashlib.sha256(tag + b"".join(_frame(f) for f in fields)).digest()


def _polymod(values):
    chk = 1
    for v in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            chk ^= _GEN[i] if (top >> i) & 1 else 0
    return chk


def _hrp_expand(hrp: str):
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def _convertbits(data, frm, to, pad=True):
    acc = bits = 0
    ret = []
    maxv = (1 << to) - 1
    for value in data:
        acc = (acc << frm) | value
        bits += frm
        while bits >= to:
            bits -= to
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (to - bits)) & maxv)
    elif not pad and (bits >= frm or ((acc << (to - bits)) & maxv)):
        return None
    return ret


def encode_address(payload: bytes) -> str:
    """Encode a 32-byte payload as ``om1…``.

    PLAIN bech32m — the bytes are converted 8→5 directly, with **no witness
    version symbol**. That symbol is what produced the old ``om1z`` prefix.

    One HRP for every network (Primum, Testum, Ignis). The same key controls the
    same account on every chain, so encoding the network would make one key
    produce three strings for one account; replay is answered by ``chain_id`` in
    the transaction signing preimage, where it actually binds.
    """
    if len(payload) != 32:
        raise AddressError(f"payload must be 32 bytes, got {len(payload)}")
    data = _convertbits(payload, 8, 5)
    chk = _polymod(_hrp_expand(HRP) + data + [0] * 6) ^ _BECH32M_CONST
    checksum = [(chk >> 5 * (5 - i)) & 31 for i in range(6)]
    return HRP + "1" + "".join(_CHARSET[d] for d in data + checksum)


def decode_address(s: str) -> bytes:
    """Decode an ``om1…`` address, rejecting anything non-canonical.

    **Uppercase is rejected, never normalised.** bech32 permits an all-uppercase
    form and the reflex is to lowercase it — do not. ``U+212A KELVIN SIGN``
    lowercases to ASCII ``k`` in Python, Go and JavaScript but *not* in Rust, so
    a normalisation step makes one string decode in three languages and fail in
    the fourth.

    The re-encode check makes the mapping bijective. It is not defensive dead
    code: a raw bech32m decoder accepts a payload whose trailing pad bits are
    non-zero and returns the same bytes, so without it two different strings
    name one account — address malleability.
    """
    if any(c.isupper() for c in s):
        raise AddressError("address must be lowercase; uppercase is not normalised")
    if len(s) != ADDRESS_STR_LEN or not _ADDRESS_RE.match(s):
        raise AddressError(f"address must be {ADDRESS_STR_LEN} lowercase bech32m chars")
    body = s[3:]
    try:
        values = [_CHARSET.index(c) for c in body]
    except ValueError as exc:
        raise AddressError("character outside the bech32 charset") from exc
    if _polymod(_hrp_expand(HRP) + values) != _BECH32M_CONST:
        raise AddressError("bad checksum")
    payload = _convertbits(values[:-6], 5, 8, pad=False)
    if payload is None or len(payload) != 32:
        raise AddressError("payload must be 32 bytes")
    out = bytes(payload)
    if encode_address(out) != s:
        raise AddressError("address is not canonical")
    return out


def address_from_public_key(pk: bytes) -> bytes:
    """Derive an externally-owned account address from an ML-DSA-44 public key.

    The length check precedes the hash deliberately: a seed, a secret key, or a
    hex *string* would each hash happily into a well-formed address for an
    account nobody can ever sign for.
    """
    if len(pk) != ML_DSA_44_PUBKEY_LEN:
        raise AddressError(
            f"ML-DSA-44 public key must be {ML_DSA_44_PUBKEY_LEN} bytes, got {len(pk)}"
        )
    return _digest(TAG_EOA, pk)


def code_hash(wasm: bytes) -> bytes:
    """``SHA-256(TAG_WSM || u32le(len) || wasm)`` — a code hash, **not** an address."""
    return _digest(TAG_WSM, wasm)


def contract_address(creator: bytes, salt: bytes, code: bytes) -> bytes:
    """Derive a contract address. The preimage is always exactly 124 bytes.

    ``salt`` must be exactly 32 bytes and is **never** padded from an integer —
    padding rules are where two implementations silently disagree.
    """
    if len(creator) != 32:
        raise AddressError("creator must be a 32-byte payload")
    if len(salt) != 32:
        raise AddressError("salt must be exactly 32 bytes; do not pad an integer")
    if len(code) != 32:
        raise AddressError("code_hash must be 32 bytes")
    return _digest(TAG_CTR, creator, salt, code)


def system_address(name: str) -> bytes:
    """Derive a protocol-reserved address from its registry name.

    ``.`` is the only separator: ``fee.vault``, ``fee_vault`` and ``fee-vault``
    would otherwise be three distinct permanent addresses, two of them
    unspendable typos.
    """
    if name not in SYSTEM_ACCOUNTS:
        raise AddressError(f"unknown system account: {name}")
    return _digest(TAG_SYS, name.encode())


# ── OMS-1 ──────────────────────────────────────────────────────────────────


def seed_from_entropy(entropy: bytes) -> bytes:
    """Derive the ML-DSA-44 seed from 32 bytes of mnemonic entropy.

    **Domain-separated, not the bare entropy.** Without the tag, the same 24
    words entered into a Bitcoin wallet derive from identical material — one
    phrase silently meaning two things across two ecosystems.

    This is NOT BIP-39's seed: no PBKDF2 and no passphrase. BIP-39 stretches to
    make low-entropy passphrases expensive to brute-force; against 256 bits of
    true entropy there is nothing to stretch, its 64-byte output would need
    truncating to 32 (one more choice to disagree about), and a passphrase is a
    second secret that can be lost independently of the phrase.
    """
    if len(entropy) != 32:
        raise MnemonicError(f"entropy must be 32 bytes, got {len(entropy)}")
    return _digest(TAG_SEED, entropy)


def mnemonic_from_entropy(entropy: bytes, wordlist) -> str:
    """Encode 32 bytes of entropy as a 24-word phrase."""
    if len(entropy) != 32:
        raise MnemonicError(f"entropy must be 32 bytes, got {len(entropy)}")
    checksum = hashlib.sha256(entropy).digest()[0]
    bits = "".join(f"{b:08b}" for b in entropy) + f"{checksum:08b}"
    return " ".join(wordlist[int(bits[i : i + 11], 2)] for i in range(0, 264, 11))


def entropy_from_mnemonic(mnemonic: str, wordlist) -> bytes:
    """Recover 32 bytes of entropy from a 24-word phrase, verifying the checksum.

    The checksum catches a mis-transcribed word — the realistic failure when
    copying a phrase off a metal plate by hand.
    """
    if any(c.isupper() for c in mnemonic):
        raise MnemonicError("mnemonic must be lowercase; uppercase is not normalised")
    words = mnemonic.split()
    if len(words) != WORD_COUNT:
        raise MnemonicError(f"mnemonic must be {WORD_COUNT} words, got {len(words)}")
    bits = ""
    for i, w in enumerate(words):
        try:
            idx = wordlist.index(w)
        except ValueError as exc:
            raise MnemonicError(f"unknown word at position {i}: {w}") from exc
        bits += f"{idx:011b}"
    entropy = bytes(int(bits[i : i + 8], 2) for i in range(0, 256, 8))
    if int(bits[256:], 2) != hashlib.sha256(entropy).digest()[0]:
        raise MnemonicError("mnemonic checksum failed")
    return entropy


def seed_from_mnemonic(mnemonic: str, wordlist) -> bytes:
    """Phrase straight to seed, checksum verified on the way."""
    return seed_from_entropy(entropy_from_mnemonic(mnemonic, wordlist))
