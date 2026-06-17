"""Cross-SDK parity tests.

These pin the Python SDK to byte-for-byte agreement with the TypeScript SDK
(@omne/sdk + @noble/post-quantum). Vectors were captured from the TS SDK:
  * keygen vectors: ml_dsa44.keygen(seed) public-key SHA-256 for fixed seeds.
  * chain vector: Wallet.fromMnemonic(<canonical BIP39 test mnemonic>)
    .getAccount(0) -> HD seed, pubkey SHA-256, om1z address.

No node required — pure crypto/address parity. The live-mesh proof (a Python
account minting/enforcing against Cinchor) is the integration test run on a mesh.
"""

import hashlib

from dilithium_py.ml_dsa import ML_DSA_44

from omne_sdk import Wallet, AbiEncode, encode_contract_call
from omne_sdk.address import from_omne_address, to_omne_address

# Canonical BIP39 test mnemonic (public, not a real key) — vector from the TS SDK.
TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
EXPECTED_HD_SEED = "d6f8deee4da4c94e81c8e0e53a61f584bf15a540b48516273fc1bfe27006612d"
EXPECTED_PUBKEY_SHA256 = "a875fccc8fd28539d6249741acef4e3c6333822707e39ed019c49d0fc1fcc5fc"
EXPECTED_ADDRESS = "om1z6n2ydj89l7e6wq3eravk35er4jx66r63q48wfgh4ql6x0p566rvsj22jgp"


def _pk_sha256(seed: bytes) -> str:
    pk, _ = ML_DSA_44.key_derive(seed)  # public seed-keygen the SDK uses
    return hashlib.sha256(pk).hexdigest()


def test_keygen_zero_seed_matches_noble():
    assert _pk_sha256(bytes(32)) == "eb4e7302842153b0fa19e8620739ad258af4929c26dd89079a7ec7d4282208e1"


def test_keygen_iota_seed_matches_noble():
    assert _pk_sha256(bytes(range(32))) == "9f107644c1084526af3bc8098680b05499a2325a644e388fb4f970e058d19d46"


def test_full_chain_mnemonic_to_address():
    account = Wallet.from_mnemonic(TEST_MNEMONIC).get_account(0)
    assert account.private_key == EXPECTED_HD_SEED
    assert hashlib.sha256(bytes.fromhex(account.public_key)).hexdigest() == EXPECTED_PUBKEY_SHA256
    assert account.address == EXPECTED_ADDRESS


def test_address_roundtrip():
    payload = from_omne_address(EXPECTED_ADDRESS)
    assert len(payload) == 32
    assert to_omne_address(payload) == EXPECTED_ADDRESS


def test_sign_then_verify():
    account = Wallet.from_mnemonic(TEST_MNEMONIC).get_account(0)
    digest = hashlib.sha256(b"omne-parity-test").digest()
    sig = account.sign_hash(digest)
    assert len(sig) == 2420  # ML-DSA-44 signature length
    pk = bytes.fromhex(account.public_key)
    assert ML_DSA_44.verify(pk, digest, sig, ctx=b"") is True


def test_abi_encode_contract_call_shape():
    data = encode_contract_call("get_principal", [AbiEncode.address(EXPECTED_ADDRESS)])
    assert data.startswith("4f4d4e45")  # "OMNE" magic
    assert bytes.fromhex(data)[4] == 0x01  # version
