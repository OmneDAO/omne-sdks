// OMA-1 and OMS-1 — the canonical Omne address and mnemonic schemes.
//
// These replace the pre-genesis derivation entirely. The differences from the
// old om1z… scheme are not cosmetic — every one changes the bytes:
//
//	old: address = SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey), bech32m with
//	     witness version 2, ~59 chars
//	new: address = SHA-256(TAG_EOA || u32le(len) || pubkey), PLAIN bech32m
//	     with no witness version, exactly 61 chars
//
// Three reasons the old form is gone: the tag was not length-framed, so field
// boundaries in the preimage were a convention rather than a fact; the witness
// version made the address a segwit-shaped thing it is not; and
// OMNE_PQC_ADDRESS_V1 is 19 bytes, where all OMA-1 tags are exactly 16, which
// makes them pairwise prefix-free by construction rather than by luck.
//
// ML-DSA-44 keygen underneath is UNCHANGED and already parity-matched. Only the
// address and the mnemonic moved.
package omne

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"strings"
)

const (
	// HRP is the human-readable part — every network, deliberately.
	HRP = "om"
	// AddressStrLen is the exact encoded length: "om1" + 58.
	AddressStrLen = 61
	// MLDSA44PubkeyLen is the FIPS 204 ML-DSA-44 public key length.
	MLDSA44PubkeyLen = 1312
	// WordCount is the number of words in an OMS-1 phrase.
	WordCount = 32 - 8 // 24

)

// Domain tags. Every one exactly 16 ASCII bytes.
var (
	TagEOA  = []byte("omne.addr.eoa.v1")
	TagCTR  = []byte("omne.addr.ctr.v1")
	TagSYS  = []byte("omne.addr.sys.v1")
	TagWSM  = []byte("omne.code.wsm.v1")
	TagSeed = []byte("omne.seed.mld.v1")
)

// SystemAccounts is the closed registry of protocol-reserved accounts.
//
// Three, not five: fee.vault and validator.fee.pool were removed before
// genesis. Both presuppose fees flow somewhere, and fees are burned — neither
// had a source.
var SystemAccounts = []string{"treasury", "gas.paymaster", "slash.sink"}

// ErrAddress and ErrMnemonic classify failures for callers that care.
var (
	ErrAddress  = errors.New("oma1: address")
	ErrMnemonic = errors.New("oms1: mnemonic")
)

// frame writes u32le(len) || bytes — the only way a field is ever written.
//
// The exemption is what kills you: "this one is always 32 bytes so the prefix
// is redundant" holds right until a second fixed-width field sits beside it, at
// which point two different pairs share one preimage.
func frame(b []byte) []byte {
	out := make([]byte, 4+len(b))
	binary.LittleEndian.PutUint32(out[:4], uint32(len(b)))
	copy(out[4:], b)
	return out
}

func digest(tag []byte, fields ...[]byte) []byte {
	if len(tag) != 16 {
		panic("oma1: domain tag must be 16 bytes")
	}
	h := sha256.New()
	h.Write(tag)
	for _, f := range fields {
		h.Write(frame(f))
	}
	return h.Sum(nil)
}

func oma1Polymod(values []int) int {
	gen := []int{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}
	chk := 1
	for _, v := range values {
		top := chk >> 25
		chk = ((chk & 0x1ffffff) << 5) ^ v
		for i := 0; i < 5; i++ {
			if (top>>uint(i))&1 == 1 {
				chk ^= gen[i]
			}
		}
	}
	return chk
}

func oma1HrpExpand(hrp string) []int {
	out := make([]int, 0, len(hrp)*2+1)
	for _, c := range hrp {
		out = append(out, int(c)>>5)
	}
	out = append(out, 0)
	for _, c := range hrp {
		out = append(out, int(c)&31)
	}
	return out
}

func oma1ConvertBits(data []int, from, to uint, pad bool) ([]int, error) {
	acc, bits := 0, uint(0)
	maxv := (1 << to) - 1
	var ret []int
	for _, v := range data {
		acc = (acc << from) | v
		bits += from
		for bits >= to {
			bits -= to
			ret = append(ret, (acc>>bits)&maxv)
		}
	}
	if pad {
		if bits > 0 {
			ret = append(ret, (acc<<(to-bits))&maxv)
		}
	} else if bits >= from || ((acc<<(to-bits))&maxv) != 0 {
		return nil, fmt.Errorf("%w: non-zero padding", ErrAddress)
	}
	return ret, nil
}

// EncodeAddress encodes a 32-byte payload as om1….
//
// PLAIN bech32m — the bytes are converted 8→5 directly, with no witness version
// symbol. That symbol is what produced the old om1z prefix.
//
// One HRP for every network. The same key controls the same account on every
// chain, so encoding the network would make one key produce three strings for
// one account; replay is answered by chain_id in the signing preimage.
func EncodeAddress(payload []byte) (string, error) {
	if len(payload) != 32 {
		return "", fmt.Errorf("%w: payload must be 32 bytes, got %d", ErrAddress, len(payload))
	}
	ints := make([]int, len(payload))
	for i, b := range payload {
		ints[i] = int(b)
	}
	data, err := oma1ConvertBits(ints, 8, 5, true)
	if err != nil {
		return "", err
	}
	chk := oma1Polymod(append(append(oma1HrpExpand(HRP), data...), 0, 0, 0, 0, 0, 0)) ^ bech32mConst
	var sb strings.Builder
	sb.WriteString(HRP + "1")
	for _, d := range data {
		sb.WriteByte(bech32Charset[d])
	}
	for i := 0; i < 6; i++ {
		sb.WriteByte(bech32Charset[(chk>>uint(5*(5-i)))&31])
	}
	return sb.String(), nil
}

// DecodeAddress decodes an om1… address, rejecting anything non-canonical.
//
// Uppercase is REJECTED, never normalised. U+212A KELVIN SIGN lowercases to
// ASCII k in Go, Python and JavaScript but not in Rust, so a normalisation step
// makes one string decode in three languages and fail in the fourth.
//
// The re-encode check makes the mapping bijective. It is not defensive dead
// code: a raw bech32m decoder accepts a payload whose trailing pad bits are
// non-zero and returns the same bytes, so without it two different strings name
// one account — address malleability.
func DecodeAddress(s string) ([]byte, error) {
	if strings.ToLower(s) != s {
		return nil, fmt.Errorf("%w: must be lowercase; uppercase is not normalised", ErrAddress)
	}
	if len(s) != AddressStrLen || !strings.HasPrefix(s, HRP+"1") {
		return nil, fmt.Errorf("%w: must be %d chars with an om1 prefix", ErrAddress, AddressStrLen)
	}
	body := s[3:]
	values := make([]int, 0, len(body))
	for i := 0; i < len(body); i++ {
		idx := strings.IndexByte(bech32Charset, body[i])
		if idx < 0 {
			return nil, fmt.Errorf("%w: character outside the bech32 charset", ErrAddress)
		}
		values = append(values, idx)
	}
	if oma1Polymod(append(oma1HrpExpand(HRP), values...)) != bech32mConst {
		return nil, fmt.Errorf("%w: bad checksum", ErrAddress)
	}
	payloadInts, err := oma1ConvertBits(values[:len(values)-6], 5, 8, false)
	if err != nil {
		return nil, err
	}
	if len(payloadInts) != 32 {
		return nil, fmt.Errorf("%w: payload must be 32 bytes, got %d", ErrAddress, len(payloadInts))
	}
	out := make([]byte, 32)
	for i, v := range payloadInts {
		out[i] = byte(v)
	}
	if re, err := EncodeAddress(out); err != nil || re != s {
		return nil, fmt.Errorf("%w: not canonical", ErrAddress)
	}
	return out, nil
}

// AddressFromPublicKey derives an EOA address from an ML-DSA-44 public key.
//
// The length check precedes the hash deliberately: a seed, a secret key, or a
// hex string would each hash happily into a well-formed address for an account
// nobody can ever sign for.
func AddressFromPublicKey(pk []byte) ([]byte, error) {
	if len(pk) != MLDSA44PubkeyLen {
		return nil, fmt.Errorf("%w: pubkey must be %d bytes, got %d", ErrAddress, MLDSA44PubkeyLen, len(pk))
	}
	return digest(TagEOA, pk), nil
}

// CodeHash is SHA-256(TagWSM || u32le(len) || wasm) — a code hash, not an address.
func CodeHash(wasm []byte) []byte { return digest(TagWSM, wasm) }

// ContractAddress derives a contract address. The preimage is always 124 bytes.
//
// salt must be exactly 32 bytes and is never padded from an integer — padding
// rules are where two implementations silently disagree.
func ContractAddress(creator, salt, code []byte) ([]byte, error) {
	if len(creator) != 32 {
		return nil, fmt.Errorf("%w: creator must be a 32-byte payload", ErrAddress)
	}
	if len(salt) != 32 {
		return nil, fmt.Errorf("%w: salt must be exactly 32 bytes; do not pad an integer", ErrAddress)
	}
	if len(code) != 32 {
		return nil, fmt.Errorf("%w: code_hash must be 32 bytes", ErrAddress)
	}
	return digest(TagCTR, creator, salt, code), nil
}

// SystemAddress derives a protocol-reserved address from its registry name.
//
// "." is the only separator: fee.vault, fee_vault and fee-vault would otherwise
// be three distinct permanent addresses, two of them unspendable typos.
func SystemAddress(name string) ([]byte, error) {
	for _, s := range SystemAccounts {
		if s == name {
			return digest(TagSYS, []byte(name)), nil
		}
	}
	return nil, fmt.Errorf("%w: unknown system account %q", ErrAddress, name)
}

// ── OMS-1 ──────────────────────────────────────────────────────────────────

// SeedFromEntropy derives the ML-DSA-44 seed from 32 bytes of mnemonic entropy.
//
// Domain-separated, NOT the bare entropy: without the tag, the same 24 words
// entered into a Bitcoin wallet derive from identical material.
//
// This is not BIP-39's seed — no PBKDF2 and no passphrase. BIP-39 stretches to
// make low-entropy passphrases expensive to brute-force; against 256 bits of
// true entropy there is nothing to stretch, its 64-byte output would need
// truncating to 32, and a passphrase is a second secret that can be lost.
func SeedFromEntropy(entropy []byte) ([]byte, error) {
	if len(entropy) != 32 {
		return nil, fmt.Errorf("%w: entropy must be 32 bytes, got %d", ErrMnemonic, len(entropy))
	}
	return digest(TagSeed, entropy), nil
}

// MnemonicFromEntropy encodes 32 bytes of entropy as a 24-word phrase.
func MnemonicFromEntropy(entropy []byte, wordlist []string) (string, error) {
	if len(entropy) != 32 {
		return "", fmt.Errorf("%w: entropy must be 32 bytes, got %d", ErrMnemonic, len(entropy))
	}
	sum := sha256.Sum256(entropy)
	bits := make([]int, 0, 264)
	for _, b := range append(append([]byte{}, entropy...), sum[0]) {
		for i := 7; i >= 0; i-- {
			bits = append(bits, int(b>>uint(i))&1)
		}
	}
	words := make([]string, 0, WordCount)
	for i := 0; i < len(bits); i += 11 {
		idx := 0
		for _, b := range bits[i : i+11] {
			idx = idx<<1 | b
		}
		words = append(words, wordlist[idx])
	}
	return strings.Join(words, " "), nil
}

// EntropyFromMnemonic recovers 32 bytes of entropy, verifying the checksum.
//
// The checksum catches a mis-transcribed word — the realistic failure when
// copying a phrase off a metal plate by hand.
func EntropyFromMnemonic(mnemonic string, wordlist []string) ([]byte, error) {
	if strings.ToLower(mnemonic) != mnemonic {
		return nil, fmt.Errorf("%w: must be lowercase; uppercase is not normalised", ErrMnemonic)
	}
	words := strings.Fields(mnemonic)
	if len(words) != WordCount {
		return nil, fmt.Errorf("%w: must be %d words, got %d", ErrMnemonic, WordCount, len(words))
	}
	bits := make([]int, 0, 264)
	for i, w := range words {
		idx := -1
		for j, cand := range wordlist {
			if cand == w {
				idx = j
				break
			}
		}
		if idx < 0 {
			return nil, fmt.Errorf("%w: unknown word at position %d: %s", ErrMnemonic, i, w)
		}
		for b := 10; b >= 0; b-- {
			bits = append(bits, (idx>>uint(b))&1)
		}
	}
	entropy := make([]byte, 32)
	for i := 0; i < 32; i++ {
		v := 0
		for _, b := range bits[i*8 : i*8+8] {
			v = v<<1 | b
		}
		entropy[i] = byte(v)
	}
	chk := 0
	for _, b := range bits[256:] {
		chk = chk<<1 | b
	}
	sum := sha256.Sum256(entropy)
	if byte(chk) != sum[0] {
		return nil, fmt.Errorf("%w: checksum failed", ErrMnemonic)
	}
	return entropy, nil
}

// SeedFromMnemonic goes phrase to seed, checksum verified on the way.
func SeedFromMnemonic(mnemonic string, wordlist []string) ([]byte, error) {
	entropy, err := EntropyFromMnemonic(mnemonic, wordlist)
	if err != nil {
		return nil, err
	}
	return SeedFromEntropy(entropy)
}
