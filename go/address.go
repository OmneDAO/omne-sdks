// Package omne is the post-quantum (ML-DSA-44) Go SDK for the Omne L1 —
// wallet, ABI encoding, and JSON-RPC client. It is parity-matched with the
// TypeScript and Python SDKs: the same mnemonic yields the same om1z address,
// and Go-produced signatures are accepted by the node's verify path
// (see parity_test.go and SDK_PARITY.md).
package omne

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	addressHRP            = "om"
	addressWitnessVersion = 2 // bech32 alphabet index 2 = 'z' -> "om1z…"
	addressPayloadBytes   = 32
	bech32Charset         = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
	bech32mConst          = 0x2bc830a3
)

var addressDomainTag = []byte("OMNE_PQC_ADDRESS_V1")

// ToHex / FromHex are thin helpers; FromHex tolerates a leading "0x".
func ToHex(b []byte) string { return hex.EncodeToString(b) }

func FromHex(s string) ([]byte, error) {
	return hex.DecodeString(strings.TrimPrefix(s, "0x"))
}

// ── bech32m (BIP-350) ───────────────────────────────────────────────
func bech32Polymod(values []int) int {
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

func bech32HrpExpand(hrp string) []int {
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

func bech32CreateChecksum(hrp string, data []int) []int {
	values := append(bech32HrpExpand(hrp), data...)
	values = append(values, 0, 0, 0, 0, 0, 0)
	polymod := bech32Polymod(values) ^ bech32mConst
	out := make([]int, 6)
	for i := 0; i < 6; i++ {
		out[i] = (polymod >> uint(5*(5-i))) & 31
	}
	return out
}

func bech32VerifyChecksum(hrp string, data []int) bool {
	return bech32Polymod(append(bech32HrpExpand(hrp), data...)) == bech32mConst
}

func convertBits(data []int, fromBits, toBits uint, pad bool) ([]int, error) {
	acc := 0
	bits := uint(0)
	maxv := (1 << toBits) - 1
	out := []int{}
	for _, value := range data {
		if value < 0 || (value>>fromBits) != 0 {
			return nil, fmt.Errorf("invalid value in convertBits")
		}
		acc = (acc << fromBits) | value
		bits += fromBits
		for bits >= toBits {
			bits -= toBits
			out = append(out, (acc>>bits)&maxv)
		}
	}
	if pad {
		if bits > 0 {
			out = append(out, (acc<<(toBits-bits))&maxv)
		}
	} else if bits >= fromBits || ((acc<<(toBits-bits))&maxv) != 0 {
		return nil, fmt.Errorf("invalid padding in convertBits")
	}
	return out, nil
}

// ToOmneAddress encodes a 32-byte payload as a canonical om1z bech32m address.
func ToOmneAddress(payload []byte) (string, error) {
	if len(payload) != addressPayloadBytes {
		return "", fmt.Errorf("address must be %d bytes, got %d", addressPayloadBytes, len(payload))
	}
	ints := make([]int, len(payload))
	for i, b := range payload {
		ints[i] = int(b)
	}
	conv, err := convertBits(ints, 8, 5, true)
	if err != nil {
		return "", err
	}
	data := append([]int{addressWitnessVersion}, conv...)
	combined := make([]int, 0, len(data)+6)
	combined = append(combined, data...)
	combined = append(combined, bech32CreateChecksum(addressHRP, data)...)
	var sb strings.Builder
	sb.WriteString(addressHRP)
	sb.WriteByte('1')
	for _, d := range combined {
		sb.WriteByte(bech32Charset[d])
	}
	return sb.String(), nil
}

// FromOmneAddress decodes an om1z address to its raw 32-byte payload.
func FromOmneAddress(addr string) ([]byte, error) {
	lowered := strings.ToLower(addr)
	pos := strings.LastIndex(lowered, "1")
	if pos < 1 {
		return nil, fmt.Errorf("invalid address (no separator): %s", addr)
	}
	hrp := lowered[:pos]
	if hrp != addressHRP {
		return nil, fmt.Errorf("invalid address HRP: expected %q, got %q", addressHRP, hrp)
	}
	data := make([]int, 0, len(lowered)-pos-1)
	for _, c := range lowered[pos+1:] {
		idx := strings.IndexRune(bech32Charset, c)
		if idx < 0 {
			return nil, fmt.Errorf("invalid bech32 character in address: %s", addr)
		}
		data = append(data, idx)
	}
	if !bech32VerifyChecksum(hrp, data) {
		return nil, fmt.Errorf("invalid bech32m checksum: %s", addr)
	}
	payloadWords := data[:len(data)-6]
	if len(payloadWords) == 0 || payloadWords[0] != addressWitnessVersion {
		return nil, fmt.Errorf("invalid witness version")
	}
	conv, err := convertBits(payloadWords[1:], 5, 8, false)
	if err != nil {
		return nil, err
	}
	if len(conv) != addressPayloadBytes {
		return nil, fmt.Errorf("address payload must be %d bytes, got %d", addressPayloadBytes, len(conv))
	}
	out := make([]byte, len(conv))
	for i, v := range conv {
		out[i] = byte(v)
	}
	return out, nil
}

// ParseAddress is an alias for FromOmneAddress — returns the 32-byte payload.
func ParseAddress(addr string) ([]byte, error) { return FromOmneAddress(addr) }

// DeriveAddressFromPublicKey is the canonical derivation shared with the
// Rust-side PqcAccountAddress: ToOmneAddress(SHA-256("OMNE_PQC_ADDRESS_V1" || pubkey)).
func DeriveAddressFromPublicKey(publicKey []byte) (string, error) {
	buf := make([]byte, 0, len(addressDomainTag)+len(publicKey))
	buf = append(buf, addressDomainTag...)
	buf = append(buf, publicKey...)
	digest := sha256.Sum256(buf)
	return ToOmneAddress(digest[:])
}
