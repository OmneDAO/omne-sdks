"""Mnemonic-based HD wallet + ML-DSA-44 (FIPS 204) signing for Omne.

Port of sdk/typescript/src/wallet.ts. Omne is post-quantum from the ground up:
all signing is ML-DSA-44 (FIPS 204). A 32-byte seed is the portable secret; the
keypair (1312-byte public key, 2560-byte secret key) is deterministically
expanded from it via ML-DSA-44 KeyGen_internal.

Key derivation is an HMAC-SHA512 hierarchical KDF (hardened-only) over the
BIP39 seed, identical to the TS wallet — so the same mnemonic yields the same
addresses across both SDKs (parity-verified in tests/test_parity.py).

ML-DSA-44 keygen/sign come from `dilithium-py` (pinned), whose public
`key_derive(xi)` is byte-identical to the TS SDK's `@noble/post-quantum`
`ml_dsa44.keygen(seed)` (verified). Signatures cross-verify in both directions
and are accepted by the node's verify path.
"""

from __future__ import annotations

import hashlib
import hmac
import unicodedata

from dilithium_py.ml_dsa import ML_DSA_44

from .address import derive_address_from_public_key, from_omne_address
from .errors import WalletError
from .transaction import hash_transaction

_BASE_PATH = "m/44'/60'/0'/0"
_HD_MASTER_KEY = b"omne ml-dsa44 seed"


# ── BIP39 mnemonic -> 64-byte seed ──────────────────────────────────
def mnemonic_to_seed(mnemonic: str, passphrase: str = "") -> bytes:
    """BIP39 seed: PBKDF2-HMAC-SHA512(NFKD(mnemonic), "mnemonic"+passphrase, 2048)."""
    m = unicodedata.normalize("NFKD", mnemonic).encode("utf-8")
    salt = unicodedata.normalize("NFKD", "mnemonic" + passphrase).encode("utf-8")
    return hashlib.pbkdf2_hmac("sha512", m, salt, 2048, dklen=64)


# ── Omne HD KDF (hardened-only HMAC-SHA512) ─────────────────────────
def _hd_master(seed: bytes) -> tuple[bytes, bytes]:
    i = hmac.new(_HD_MASTER_KEY, seed, hashlib.sha512).digest()
    return i[:32], i[32:]


def _hd_child(parent_seed: bytes, parent_chain: bytes, index: int) -> tuple[bytes, bytes]:
    hardened = (index | 0x80000000) & 0xFFFFFFFF
    data = b"\x00" + parent_seed + hardened.to_bytes(4, "big")
    i = hmac.new(parent_chain, data, hashlib.sha512).digest()
    return i[:32], i[32:]


def _hd_derive_path(seed: bytes, path: str) -> bytes:
    segments = [s for s in path.replace("m/", "").split("/") if s]
    cur_seed, cur_chain = _hd_master(seed)
    for seg in segments:
        try:
            idx = int(seg.replace("'", ""))
        except ValueError as exc:
            raise WalletError(f"Invalid derivation path segment: {seg}") from exc
        cur_seed, cur_chain = _hd_child(cur_seed, cur_chain, idx)
    return cur_seed


class WalletAccount:
    """A single account: a 32-byte seed expanded to an ML-DSA-44 keypair."""

    def __init__(self, private_key: str, path: str | None = None):
        if len(private_key) != 64 or any(c not in "0123456789abcdef" for c in private_key.lower()):
            raise WalletError("Invalid private key: expected 64 hex chars (32-byte ML-DSA-44 seed)")
        self.private_key = private_key.lower()
        self.path = path
        seed = bytes.fromhex(self.private_key)
        # key_derive(xi) is dilithium-py's PUBLIC, documented (FIPS 204 §6.1)
        # deterministic keygen from a 32-byte seed — byte-identical to the TS
        # SDK's @noble ml_dsa44.keygen(seed). Public API (not the _keygen_internal
        # private method) so it is part of the lib's stability contract.
        public_key, secret_key = ML_DSA_44.key_derive(seed)
        self._secret_key = secret_key  # 2560 bytes, never exported
        self.public_key = public_key.hex()
        self.address = derive_address_from_public_key(public_key)

    @classmethod
    def from_private_key(cls, private_key: str) -> "WalletAccount":
        return cls(private_key)

    def sign_hash(self, digest: bytes) -> bytes:
        """ML-DSA-44 signature (2420 bytes, empty context — matches the node)."""
        return ML_DSA_44.sign(self._secret_key, digest, ctx=b"")

    def sign_message(self, message: str) -> str:
        """Sign SHA-256(message); appends the 1312-byte pubkey (ML-DSA has no recovery)."""
        digest = hashlib.sha256(message.encode("utf-8")).digest()
        signature = self.sign_hash(digest)
        return (signature + bytes.fromhex(self.public_key)).hex()

    def sign_transaction(self, transaction: dict, chain_id: int | None = None) -> dict:
        """Sign a transaction. Returns the tx augmented with chainId, signature, publicKey.

        The hash preimage matches the Rust-side hash_transaction() and the TS
        wallet: canonical field concat with little-endian numbers.
        """
        resolved = chain_id if chain_id is not None else transaction.get("chainId")
        if resolved is None:
            raise WalletError("chainId required for signing (e.g. 3 for Ignis)")
        normalized = {**transaction, "chainId": resolved}
        tx_hash = hash_transaction(normalized)
        signature = self.sign_hash(tx_hash)
        return {
            **normalized,
            "signature": signature.hex(),
            "publicKey": self.public_key,
        }


class Wallet:
    """HD wallet with BIP39 mnemonic support (hardened-only HMAC-SHA512 KDF)."""

    def __init__(self, mnemonic: str, passphrase: str = ""):
        # NOTE: mnemonic checksum validation against the BIP39 wordlist is a
        # follow-up; seed derivation (the parity-critical path) is exact.
        self.mnemonic = mnemonic
        self._seed = mnemonic_to_seed(mnemonic, passphrase)

    @classmethod
    def from_mnemonic(cls, mnemonic: str, passphrase: str = "") -> "Wallet":
        return cls(mnemonic, passphrase)

    @classmethod
    def from_private_key(cls, private_key: str) -> WalletAccount:
        return WalletAccount.from_private_key(private_key)

    def get_account(self, index: int = 0) -> WalletAccount:
        if index < 0:
            raise WalletError(f"Account index must be non-negative: {index}")
        path = f"{_BASE_PATH}/{index}"
        seed = _hd_derive_path(self._seed, path)
        return WalletAccount(seed.hex(), path)

    @property
    def address(self) -> str:
        return self.get_account(0).address
