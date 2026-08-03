// OMA-1 / OMS-1 conformance, driven by the shared vectors.
//
// The vector file is the contract, not this file. Rust, TypeScript and Python
// assert against the same JSON. If this test ever stops reading it and starts
// hard-coding values, cross-language parity is unenforced again and nobody
// notices until a user's wallet does not work on their own node.
package omne

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type addrVectors struct {
	EOA []struct {
		Label      string `json:"label"`
		PubkeyHex  string `json:"pubkey_hex"`
		PayloadHex string `json:"payload_hex"`
		Address    string `json:"address"`
	} `json:"eoa"`
	Contract []struct {
		CreatorHex  string `json:"creator_hex"`
		SaltHex     string `json:"salt_hex"`
		CodeHashHex string `json:"code_hash_hex"`
		PayloadHex  string `json:"payload_hex"`
		Address     string `json:"address"`
	} `json:"contract"`
	System []struct {
		Name       string `json:"name"`
		PayloadHex string `json:"payload_hex"`
		Address    string `json:"address"`
	} `json:"system"`
	CodeHash []struct {
		WasmHex     string `json:"wasm_hex"`
		CodeHashHex string `json:"code_hash_hex"`
	} `json:"code_hash"`
	Invalid []struct {
		Label string `json:"label"`
		Value string `json:"value"`
	} `json:"invalid"`
}

type mnemVectors struct {
	Valid []struct {
		Label      string `json:"label"`
		EntropyHex string `json:"entropy_hex"`
		Mnemonic   string `json:"mnemonic"`
		SeedHex    string `json:"seed_hex"`
	} `json:"valid"`
	Invalid []struct {
		Label    string `json:"label"`
		Mnemonic string `json:"mnemonic"`
	} `json:"invalid"`
}

func load(t *testing.T) (addrVectors, mnemVectors, []string) {
	t.Helper()
	dir := filepath.Join("..", "vectors")
	var a addrVectors
	var m mnemVectors
	b, err := os.ReadFile(filepath.Join(dir, "address_vectors.json"))
	if err != nil {
		t.Fatalf("address vectors: %v", err)
	}
	if err := json.Unmarshal(b, &a); err != nil {
		t.Fatalf("address vectors: %v", err)
	}
	b, err = os.ReadFile(filepath.Join(dir, "mnemonic_vectors.json"))
	if err != nil {
		t.Fatalf("mnemonic vectors: %v", err)
	}
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("mnemonic vectors: %v", err)
	}
	w, err := os.ReadFile(filepath.Join(dir, "bip39_english.txt"))
	if err != nil {
		t.Fatalf("wordlist: %v", err)
	}
	return a, m, strings.Fields(string(w))
}

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex: %v", err)
	}
	return b
}

func TestEOAVectors(t *testing.T) {
	a, _, _ := load(t)
	if len(a.EOA) != 3 {
		t.Fatalf("expected 3 EOA vectors, got %d", len(a.EOA))
	}
	for _, v := range a.EOA {
		pk := unhex(t, v.PubkeyHex)
		if len(pk) != MLDSA44PubkeyLen {
			t.Fatalf("%s: pubkey len %d", v.Label, len(pk))
		}
		p, err := AddressFromPublicKey(pk)
		if err != nil {
			t.Fatalf("%s: %v", v.Label, err)
		}
		if got := hex.EncodeToString(p); got != v.PayloadHex {
			t.Errorf("%s payload: got %s want %s", v.Label, got, v.PayloadHex)
		}
		s, _ := EncodeAddress(p)
		if s != v.Address {
			t.Errorf("%s address: got %s want %s", v.Label, s, v.Address)
		}
	}
}

func TestContractAndCodeHashVectors(t *testing.T) {
	a, _, _ := load(t)
	for _, v := range a.Contract {
		p, err := ContractAddress(unhex(t, v.CreatorHex), unhex(t, v.SaltHex), unhex(t, v.CodeHashHex))
		if err != nil {
			t.Fatal(err)
		}
		if hex.EncodeToString(p) != v.PayloadHex {
			t.Errorf("contract payload mismatch")
		}
		if s, _ := EncodeAddress(p); s != v.Address {
			t.Errorf("contract address mismatch")
		}
	}
	for _, v := range a.CodeHash {
		if hex.EncodeToString(CodeHash(unhex(t, v.WasmHex))) != v.CodeHashHex {
			t.Errorf("code hash mismatch")
		}
	}
}

func TestSystemRegistryIsClosedAtThree(t *testing.T) {
	a, _, _ := load(t)
	if len(a.System) != len(SystemAccounts) || len(SystemAccounts) != 3 {
		t.Fatalf("registry must be closed at 3, got %d vectors / %d names", len(a.System), len(SystemAccounts))
	}
	for _, v := range a.System {
		p, err := SystemAddress(v.Name)
		if err != nil {
			t.Fatalf("%s: %v", v.Name, err)
		}
		if hex.EncodeToString(p) != v.PayloadHex {
			t.Errorf("%s payload mismatch", v.Name)
		}
		if s, _ := EncodeAddress(p); s != v.Address {
			t.Errorf("%s address mismatch", v.Name)
		}
	}
	// Removed before genesis: fees are burned, so neither had a source.
	for _, removed := range []string{"fee.vault", "validator.fee.pool"} {
		if _, err := SystemAddress(removed); err == nil {
			t.Errorf("%s must not resolve", removed)
		}
	}
	// Separator near-misses would otherwise be distinct permanent addresses.
	for _, bad := range []string{"fee_vault", "fee-vault", "Treasury", "treasury.", "", "burn"} {
		if _, err := SystemAddress(bad); err == nil {
			t.Errorf("%q must not resolve", bad)
		}
	}
}

func TestInvalidVectorsAreRejected(t *testing.T) {
	a, _, _ := load(t)
	if len(a.Invalid) != 7 {
		t.Fatalf("expected 7 invalid vectors, got %d", len(a.Invalid))
	}
	for _, v := range a.Invalid {
		if _, err := DecodeAddress(v.Value); err == nil {
			t.Errorf("%s must not decode", v.Label)
		}
	}
}

func TestUppercaseRejectedAndNonCanonicalRejected(t *testing.T) {
	payload := make([]byte, 32)
	for i := range payload {
		payload[i] = 3
	}
	s, _ := EncodeAddress(payload)
	if _, err := DecodeAddress(strings.ToUpper(s)); err == nil {
		t.Error("uppercase must be rejected, not normalised")
	}
	// Same payload under a raw decoder: two strings, one account.
	const nonCanonical = "om1qvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvpsxqcrqvp3tks22l"
	if _, err := DecodeAddress(nonCanonical); err == nil {
		t.Error("non-canonical padding must be rejected — that is address malleability")
	}
}

func TestRoundTripAndLength(t *testing.T) {
	for i := 0; i < 32; i++ {
		payload := make([]byte, 32)
		for j := range payload {
			payload[j] = byte(i)
		}
		s, err := EncodeAddress(payload)
		if err != nil {
			t.Fatal(err)
		}
		if len(s) != AddressStrLen || !strings.HasPrefix(s, "om1") {
			t.Fatalf("bad shape: %s", s)
		}
		got, err := DecodeAddress(s)
		if err != nil || hex.EncodeToString(got) != hex.EncodeToString(payload) {
			t.Fatalf("round trip failed for %s: %v", s, err)
		}
	}
}

func TestDomainTagsAreSixteenBytesAndDistinct(t *testing.T) {
	tags := [][]byte{TagEOA, TagCTR, TagSYS, TagWSM, TagSeed}
	seen := map[string]bool{}
	for _, tag := range tags {
		if len(tag) != 16 {
			t.Errorf("tag %q is %d bytes, must be 16", tag, len(tag))
		}
		if seen[string(tag)] {
			t.Errorf("duplicate tag %q", tag)
		}
		seen[string(tag)] = true
	}
}

func TestWrongLengthsAreRefused(t *testing.T) {
	for _, n := range []int{0, 32, 64, MLDSA44PubkeyLen - 1, MLDSA44PubkeyLen + 1} {
		if _, err := AddressFromPublicKey(make([]byte, n)); err == nil {
			t.Errorf("pubkey of %d bytes must be refused", n)
		}
	}
	a := make([]byte, 32)
	for _, n := range []int{0, 8, 31, 33} {
		if _, err := ContractAddress(a, make([]byte, n), a); err == nil {
			t.Errorf("salt of %d bytes must be refused", n)
		}
	}
}

// ── OMS-1 ──────────────────────────────────────────────────────────────────

func TestMnemonicVectors(t *testing.T) {
	_, m, wl := load(t)
	if len(m.Valid) != 4 || len(m.Invalid) != 5 {
		t.Fatalf("vector counts changed: %d valid, %d invalid", len(m.Valid), len(m.Invalid))
	}
	for _, v := range m.Valid {
		entropy := unhex(t, v.EntropyHex)
		got, err := MnemonicFromEntropy(entropy, wl)
		if err != nil || got != v.Mnemonic {
			t.Errorf("%s: mnemonic mismatch", v.Label)
		}
		back, err := EntropyFromMnemonic(v.Mnemonic, wl)
		if err != nil || hex.EncodeToString(back) != v.EntropyHex {
			t.Errorf("%s: entropy mismatch", v.Label)
		}
		seed, err := SeedFromMnemonic(v.Mnemonic, wl)
		if err != nil || hex.EncodeToString(seed) != v.SeedHex {
			t.Errorf("%s: seed mismatch", v.Label)
		}
	}
	for _, v := range m.Invalid {
		if _, err := EntropyFromMnemonic(v.Mnemonic, wl); err == nil {
			t.Errorf("%s must be rejected", v.Label)
		}
	}
}

func TestWordlistIsCanonical(t *testing.T) {
	_, _, wl := load(t)
	if len(wl) != 2048 {
		t.Fatalf("wordlist has %d words", len(wl))
	}
	sum := sha256.Sum256([]byte(strings.Join(wl, "\n") + "\n"))
	const want = "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda"
	if hex.EncodeToString(sum[:]) != want {
		t.Errorf("wordlist is not the canonical BIP-39 English list")
	}
}

func TestMatchesPublishedBIP39Vectors(t *testing.T) {
	// A scheme can round-trip perfectly and still be wrong; these prove the bit
	// packing follows the standard rather than merely agreeing with itself.
	_, _, wl := load(t)
	zero, _ := MnemonicFromEntropy(make([]byte, 32), wl)
	if !strings.HasSuffix(zero, " art") {
		t.Errorf("all-zero phrase must end in 'art', got %q", zero)
	}
	ff := make([]byte, 32)
	for i := range ff {
		ff[i] = 0xFF
	}
	all, _ := MnemonicFromEntropy(ff, wl)
	if !strings.HasSuffix(all, " vote") {
		t.Errorf("all-ff phrase must end in 'vote', got %q", all)
	}
}

func TestSeedIsDomainSeparated(t *testing.T) {
	// Without the tag, the same 24 words in a Bitcoin wallet derive from
	// identical material.
	for _, fill := range []byte{0, 1, 0xFF} {
		e := make([]byte, 32)
		for i := range e {
			e[i] = fill
		}
		seed, err := SeedFromEntropy(e)
		if err != nil {
			t.Fatal(err)
		}
		if hex.EncodeToString(seed) == hex.EncodeToString(e) {
			t.Error("seed must not be the bare entropy")
		}
		bare := sha256.Sum256(e)
		if hex.EncodeToString(seed) == hex.EncodeToString(bare[:]) {
			t.Error("seed must not be a bare hash of the entropy")
		}
	}
}
