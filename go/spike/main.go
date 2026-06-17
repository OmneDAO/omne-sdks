// ML-DSA-44 keygen/sign parity spike for a future Go SDK.
//
// Confirms CIRCL's mldsa44 (NewKeyFromSeed) is byte-identical to the TS SDK's
// @noble/post-quantum ml_dsa44.keygen(seed) — the gate for a Go SDK whose
// addresses must match the TS/Python SDKs. Vectors: see ../../SDK_PARITY.md.
//
//	cd sdk/go/spike && go run .
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/cloudflare/circl/sign/mldsa/mldsa44"
)

const (
	expectZero = "eb4e7302842153b0fa19e8620739ad258af4929c26dd89079a7ec7d4282208e1"
	expectIota = "9f107644c1084526af3bc8098680b05499a2325a644e388fb4f970e058d19d46"
)

func pkSha(seed [32]byte) (string, int) {
	pub, _ := mldsa44.NewKeyFromSeed(&seed)
	b, _ := pub.MarshalBinary()
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), len(b)
}

func main() {
	var zero [32]byte
	var iota [32]byte
	for i := range iota {
		iota[i] = byte(i)
	}

	zs, zlen := pkSha(zero)
	is, _ := pkSha(iota)
	fmt.Printf("ZERO_SEED pubkeyLen=%d match=%v\n", zlen, zs == expectZero)
	fmt.Printf("IOTA_SEED match=%v\n", is == expectIota)

	// Sign with an empty context (matches @noble / the node) and self-verify.
	pub, priv := mldsa44.NewKeyFromSeed(&iota)
	msg := sha256.Sum256([]byte("omne-tx-hash-test"))
	sig := make([]byte, mldsa44.SignatureSize)
	if err := mldsa44.SignTo(priv, msg[:], nil, false, sig); err != nil {
		fmt.Println("sign err:", err)
		return
	}
	fmt.Printf("SIGN sigLen=%d self-verify=%v\n", len(sig), mldsa44.Verify(pub, msg[:], nil, sig))

	if zs == expectZero && is == expectIota {
		fmt.Println("GATE: GREEN — CIRCL keygen is byte-identical to @noble")
	} else {
		fmt.Println("GATE: RED — divergence; a bespoke/vendored keygen is required")
	}
}
