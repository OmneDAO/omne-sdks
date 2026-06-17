package omne

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa44"
)

// Cross-SDK parity vectors, captured from the TypeScript SDK
// (@omne/sdk + @noble/post-quantum). See ../SDK_PARITY.md.
const (
	testMnemonic        = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	expectHDSeed        = "d6f8deee4da4c94e81c8e0e53a61f584bf15a540b48516273fc1bfe27006612d"
	expectPubkeySHA256  = "a875fccc8fd28539d6249741acef4e3c6333822707e39ed019c49d0fc1fcc5fc"
	expectAddress       = "om1z6n2ydj89l7e6wq3eravk35er4jx66r63q48wfgh4ql6x0p566rvsj22jgp"
	expectZeroSeedPKSha = "eb4e7302842153b0fa19e8620739ad258af4929c26dd89079a7ec7d4282208e1"
	expectIotaSeedPKSha = "9f107644c1084526af3bc8098680b05499a2325a644e388fb4f970e058d19d46"
)

func pkSha256(seed [32]byte) string {
	pub, _ := mldsa44.NewKeyFromSeed(&seed)
	b, _ := pub.MarshalBinary()
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func TestKeygenZeroSeedMatchesNoble(t *testing.T) {
	var seed [32]byte
	if got := pkSha256(seed); got != expectZeroSeedPKSha {
		t.Fatalf("zero-seed pubkey sha256 = %s, want %s", got, expectZeroSeedPKSha)
	}
}

func TestKeygenIotaSeedMatchesNoble(t *testing.T) {
	var seed [32]byte
	for i := range seed {
		seed[i] = byte(i)
	}
	if got := pkSha256(seed); got != expectIotaSeedPKSha {
		t.Fatalf("iota-seed pubkey sha256 = %s, want %s", got, expectIotaSeedPKSha)
	}
}

func TestFullChainMnemonicToAddress(t *testing.T) {
	w, err := WalletFromMnemonic(testMnemonic, "")
	if err != nil {
		t.Fatal(err)
	}
	a, err := w.Account(0)
	if err != nil {
		t.Fatal(err)
	}
	if a.PrivateKey != expectHDSeed {
		t.Fatalf("HD seed = %s, want %s", a.PrivateKey, expectHDSeed)
	}
	pkBytes, _ := hex.DecodeString(a.PublicKey)
	if got := hex.EncodeToString(sha256Sum(pkBytes)); got != expectPubkeySHA256 {
		t.Fatalf("pubkey sha256 = %s, want %s", got, expectPubkeySHA256)
	}
	if a.Address != expectAddress {
		t.Fatalf("address = %s, want %s", a.Address, expectAddress)
	}
}

func TestAddressRoundtrip(t *testing.T) {
	payload, err := FromOmneAddress(expectAddress)
	if err != nil {
		t.Fatal(err)
	}
	if len(payload) != 32 {
		t.Fatalf("payload len = %d, want 32", len(payload))
	}
	back, err := ToOmneAddress(payload)
	if err != nil {
		t.Fatal(err)
	}
	if back != expectAddress {
		t.Fatalf("round-trip = %s, want %s", back, expectAddress)
	}
}

func TestSignThenVerify(t *testing.T) {
	w, _ := WalletFromMnemonic(testMnemonic, "")
	a, _ := w.Account(0)
	digest := sha256Sum([]byte("omne-parity-test"))
	sig, err := a.SignHash(digest)
	if err != nil {
		t.Fatal(err)
	}
	if len(sig) != 2420 {
		t.Fatalf("signature len = %d, want 2420", len(sig))
	}
	pkBytes, _ := hex.DecodeString(a.PublicKey)
	var pub mldsa44.PublicKey
	if err := pub.UnmarshalBinary(pkBytes); err != nil {
		t.Fatal(err)
	}
	if !mldsa44.Verify(&pub, digest, nil, sig) {
		t.Fatal("signature did not verify")
	}
}

func TestAbiEncodeContractCallShape(t *testing.T) {
	arg, err := ArgAddress(expectAddress)
	if err != nil {
		t.Fatal(err)
	}
	data, err := EncodeContractCall("get_principal", []AbiArgument{arg})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(data, "4f4d4e45") { // "OMNE"
		t.Fatalf("calldata missing OMNE magic: %s", data[:8])
	}
	raw, _ := hex.DecodeString(data)
	if raw[4] != 0x01 {
		t.Fatalf("ABI version = %d, want 1", raw[4])
	}
}

// Transaction-hash preimage parity (the signed message). Ground truth from the
// Python SDK's hash_transaction for the same fixed transaction.
const (
	txHashFrom   = "om1zaczuzfu9lkcnz323r5k59qwd9p0l5m3m2tq3ultus5nuvhfsasks9zqy62"
	txHashTo     = "om1zsc5m9ny660phyhaev0j7rgeqsfs94pm8q90lxl206cqyr0nqv6yqrwqlk7"
	expectTxHash = "bbd8fce534bd849ddb8d0276d6c921bb59021094effbe2cfb0e565f06de7daa2"
)

func TestTxHashParity(t *testing.T) {
	h, err := HashTransaction(Transaction{
		From: txHashFrom, To: txHashTo, Value: nil,
		GasLimit: 200000, GasPrice: "5000", Nonce: 0, ChainID: 3, Data: "deadbeef",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := hex.EncodeToString(h); got != expectTxHash {
		t.Fatalf("tx hash = %s, want %s", got, expectTxHash)
	}
}

func sha256Sum(b []byte) []byte {
	h := sha256.Sum256(b)
	return h[:]
}
