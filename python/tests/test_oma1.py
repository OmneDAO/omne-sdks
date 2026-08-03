"""OMA-1 / OMS-1 conformance, driven by the shared vectors.

The vector file is the contract, not this file. Rust, TypeScript and Go assert
against the same JSON. If this test ever stops reading it and starts hard-coding
values, cross-language parity is unenforced again and nobody notices until a
user's wallet does not work on their own node.
"""
from __future__ import annotations

import hashlib
import json
import pathlib

import pytest

from omne_sdk.oma1 import (
    ADDRESS_STR_LEN,
    ML_DSA_44_PUBKEY_LEN,
    SYSTEM_ACCOUNTS,
    TAG_CTR,
    TAG_EOA,
    TAG_SEED,
    TAG_SYS,
    TAG_WSM,
    WORD_COUNT,
    AddressError,
    MnemonicError,
    address_from_public_key,
    code_hash,
    contract_address,
    decode_address,
    encode_address,
    entropy_from_mnemonic,
    mnemonic_from_entropy,
    seed_from_entropy,
    seed_from_mnemonic,
    system_address,
)

V = pathlib.Path(__file__).resolve().parents[2] / "vectors"
ADDR = json.loads((V / "address_vectors.json").read_text())
MNEM = json.loads((V / "mnemonic_vectors.json").read_text())
WORDLIST = (V / "bip39_english.txt").read_text().split()


# ── OMA-1 ──────────────────────────────────────────────────────────────────

def test_eoa_vectors():
    assert len(ADDR["eoa"]) == 3
    for v in ADDR["eoa"]:
        pk = bytes.fromhex(v["pubkey_hex"])
        assert len(pk) == ML_DSA_44_PUBKEY_LEN
        payload = address_from_public_key(pk)
        assert payload.hex() == v["payload_hex"]
        assert encode_address(payload) == v["address"]


def test_contract_vectors():
    for v in ADDR["contract"]:
        p = contract_address(
            bytes.fromhex(v["creator_hex"]),
            bytes.fromhex(v["salt_hex"]),
            bytes.fromhex(v["code_hash_hex"]),
        )
        assert p.hex() == v["payload_hex"]
        assert encode_address(p) == v["address"]


def test_code_hash_vectors():
    for v in ADDR["code_hash"]:
        assert code_hash(bytes.fromhex(v["wasm_hex"])).hex() == v["code_hash_hex"]


def test_system_registry_is_closed_at_three():
    assert len(ADDR["system"]) == len(SYSTEM_ACCOUNTS) == 3
    for v in ADDR["system"]:
        p = system_address(v["name"])
        assert p.hex() == v["payload_hex"]
        assert encode_address(p) == v["address"]
    # Removed before genesis: fees are burned, so neither had a source.
    for removed in ("fee.vault", "validator.fee.pool"):
        with pytest.raises(AddressError):
            system_address(removed)
    # Separator near-misses would otherwise be distinct permanent addresses.
    for bad in ("fee_vault", "fee-vault", "Treasury", "treasury.", "", "burn"):
        with pytest.raises(AddressError):
            system_address(bad)


def test_invalid_vectors_are_rejected():
    assert len(ADDR["invalid"]) == 7
    for v in ADDR["invalid"]:
        with pytest.raises(AddressError):
            decode_address(v["value"])


def test_wrong_length_pubkey_refused_before_hashing():
    for n in (0, 32, 64, ML_DSA_44_PUBKEY_LEN - 1, ML_DSA_44_PUBKEY_LEN + 1):
        with pytest.raises(AddressError):
            address_from_public_key(bytes(n))


def test_uppercase_is_rejected_not_normalised():
    s = encode_address(bytes([3] * 32))
    with pytest.raises(AddressError):
        decode_address(s.upper())
    # U+212A KELVIN lowercases to ASCII k in Python but not in Rust — any
    # normalisation makes one string work in three languages and fail in one.
    with pytest.raises(AddressError):
        decode_address(s.replace("k", "K"))


def test_non_canonical_padding_is_rejected():
    # Decodes to the SAME payload under a raw bech32m decoder: two strings, one
    # account. That is address malleability.
    with pytest.raises(AddressError):
        decode_address("om1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvp3tks22l")
    assert decode_address(encode_address(bytes([3] * 32))) == bytes([3] * 32)


def test_round_trip_and_length():
    for i in range(32):
        payload = bytes([i] * 32)
        s = encode_address(payload)
        assert len(s) == ADDRESS_STR_LEN and s.startswith("om1")
        assert decode_address(s) == payload


def test_domain_tags_are_sixteen_bytes_and_distinct():
    tags = [TAG_EOA, TAG_CTR, TAG_SYS, TAG_WSM, TAG_SEED]
    assert all(len(t) == 16 for t in tags)
    assert len(set(tags)) == len(tags)


def test_classes_do_not_collide_on_identical_input():
    a = bytes([9] * 32)
    assert contract_address(a, bytes(32), a) != code_hash(a)
    assert contract_address(a, bytes(32), a) != system_address("treasury")


def test_salt_must_be_exactly_32_bytes():
    a = bytes([1] * 32)
    for n in (0, 8, 31, 33):
        with pytest.raises(AddressError):
            contract_address(a, bytes(n), a)


# ── OMS-1 ──────────────────────────────────────────────────────────────────

def test_mnemonic_valid_vectors():
    assert len(MNEM["valid"]) == 4
    for v in MNEM["valid"]:
        entropy = bytes.fromhex(v["entropy_hex"])
        assert mnemonic_from_entropy(entropy, WORDLIST) == v["mnemonic"]
        assert entropy_from_mnemonic(v["mnemonic"], WORDLIST).hex() == v["entropy_hex"]
        assert seed_from_entropy(entropy).hex() == v["seed_hex"]
        assert seed_from_mnemonic(v["mnemonic"], WORDLIST).hex() == v["seed_hex"]


def test_mnemonic_invalid_vectors():
    assert len(MNEM["invalid"]) == 5
    for v in MNEM["invalid"]:
        with pytest.raises(MnemonicError):
            entropy_from_mnemonic(v["mnemonic"], WORDLIST)


def test_wordlist_is_canonical_bip39_english():
    assert len(WORDLIST) == 2048
    digest = hashlib.sha256(("\n".join(WORDLIST) + "\n").encode()).hexdigest()
    assert digest == "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"


def test_matches_published_bip39_vectors():
    # A scheme can round-trip perfectly and still be wrong; these prove the bit
    # packing follows the standard rather than merely agreeing with itself.
    assert mnemonic_from_entropy(bytes(32), WORDLIST).endswith(" art")
    assert mnemonic_from_entropy(bytes([0xFF] * 32), WORDLIST).endswith(" vote")


def test_seed_is_domain_separated_from_entropy():
    for fill in (0, 1, 0xFF):
        e = bytes([fill] * 32)
        assert seed_from_entropy(e) != e
        assert seed_from_entropy(e) != hashlib.sha256(e).digest()


def test_word_count_enforced_both_directions():
    phrase = mnemonic_from_entropy(bytes([1] * 32), WORDLIST)
    words = phrase.split()
    assert len(words) == WORD_COUNT
    with pytest.raises(MnemonicError):
        entropy_from_mnemonic(" ".join(words[:23]), WORDLIST)
    with pytest.raises(MnemonicError):
        entropy_from_mnemonic(phrase + " zoo", WORDLIST)


# ── the whole chain ────────────────────────────────────────────────────────

def test_the_chain_derives_the_account_the_node_expects():
    """Keygen is already parity-matched; this exercises the layers that moved."""
    dilithium = pytest.importorskip("dilithium_py.ml_dsa")
    for v in MNEM["valid"]:
        seed = seed_from_mnemonic(v["mnemonic"], WORDLIST)
        assert seed.hex() == v["seed_hex"]
        pk, _sk = dilithium.ML_DSA_44.key_derive(seed)
        assert len(pk) == ML_DSA_44_PUBKEY_LEN
        addr = encode_address(address_from_public_key(pk))
        assert len(addr) == ADDRESS_STR_LEN and addr.startswith("om1")


def test_reproduces_the_noble_keygen_ground_truth():
    """The same vectors pinned on the Rust and TypeScript sides."""
    dilithium = pytest.importorskip("dilithium_py.ml_dsa")
    cases = [
        (bytes(32), "eb4e7302842153b0fa19e8620739ad258af4929c26dd89079a7ec7d4282208e1"),
        (bytes(range(32)), "9f107644c1084526af3bc8098680b05499a2325a644e388fb4f970e058d19d46"),
    ]
    for seed, expected in cases:
        pk, _ = dilithium.ML_DSA_44.key_derive(seed)
        assert hashlib.sha256(pk).hexdigest() == expected
