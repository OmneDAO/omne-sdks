package omne

import (
	"encoding/hex"
	"encoding/json"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// Tessera transaction-id conformance, driven by the shared vectors.
//
// The vector file is the contract, not this file. Rust, TypeScript and Python
// assert against the same JSON.

type txCase struct {
	Name      string `json:"name"`
	ChainID   string `json:"chain_id"`
	Sender    string `json:"sender"`
	Recipient string `json:"recipient"`
	Amount    string `json:"amount"`
	Fee       string `json:"fee"`
	Nonce     string `json:"nonce"`
	Asset     string `json:"asset"`
	TxID      string `json:"tx_id"`
}

type txVectors struct {
	DomainTag string   `json:"domain_tag"`
	Cases     []txCase `json:"cases"`
}

func loadTxVectors(t *testing.T) txVectors {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "vectors", "tx_id_v1.json"))
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var v txVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("parse vectors: %v", err)
	}
	return v
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("hex: %v", err)
	}
	return b
}

func mustByte(t *testing.T, s string) uint8 {
	t.Helper()
	n, err := strconv.ParseUint(s, 10, 8)
	if err != nil {
		t.Fatalf("asset %q: %v", s, err)
	}
	return uint8(n)
}

func TestTxDomainTagIsSixteenBytesAndMatchesTheVectorFile(t *testing.T) {
	v := loadTxVectors(t)
	if len(TagTx) != 16 {
		t.Fatalf("domain tag must be 16 bytes, got %d", len(TagTx))
	}
	if v.DomainTag != string(TagTx) {
		t.Fatalf("domain tag mismatch: vector %q, code %q", v.DomainTag, string(TagTx))
	}
}

func TestTransactionIDMatchesVectors(t *testing.T) {
	v := loadTxVectors(t)
	for _, c := range v.Cases {
		c := c
		t.Run(c.Name, func(t *testing.T) {
			// Decimal STRINGS: u128 does not survive JSON numbers.
			amount, ok := new(big.Int).SetString(c.Amount, 10)
			if !ok {
				t.Fatalf("amount %q", c.Amount)
			}
			fee, ok := new(big.Int).SetString(c.Fee, 10)
			if !ok {
				t.Fatalf("fee %q", c.Fee)
			}
			nonce, ok := new(big.Int).SetString(c.Nonce, 10)
			if !ok {
				t.Fatalf("nonce %q", c.Nonce)
			}
			got, err := TransactionID(TxIntent{
				ChainID:   mustHex(t, c.ChainID),
				Sender:    mustHex(t, c.Sender),
				Recipient: mustHex(t, c.Recipient),
				Amount:    amount,
				Fee:       fee,
				Nonce:     nonce.Uint64(),
				Asset:     Asset(mustByte(t, c.Asset)),
			})
			if err != nil {
				t.Fatalf("TransactionID: %v", err)
			}
			if hex.EncodeToString(got) != c.TxID {
				t.Fatalf("id mismatch:\n got %s\nwant %s", hex.EncodeToString(got), c.TxID)
			}
		})
	}
}

func TestEveryVectorIDIsDistinct(t *testing.T) {
	v := loadTxVectors(t)
	seen := map[string]bool{}
	for _, c := range v.Cases {
		if seen[c.TxID] {
			t.Fatalf("two vectors share an id: %s", c.TxID)
		}
		seen[c.TxID] = true
	}
}

func TestRejectsMalformedIntentRatherThanHashingItAnyway(t *testing.T) {
	ok := TxIntent{
		ChainID:   make([]byte, 32),
		Sender:    make([]byte, 32),
		Recipient: make([]byte, 32),
		Amount:    big.NewInt(0),
		Fee:       big.NewInt(0),
		Nonce:     0,
	}
	short := ok
	short.Sender = make([]byte, 31)
	if _, err := TransactionID(short); err == nil {
		t.Fatal("a 31-byte sender must be refused, not hashed")
	}

	big129 := ok
	big129.Amount = new(big.Int).Lsh(big.NewInt(1), 128)
	if _, err := TransactionID(big129); err == nil {
		t.Fatal("an amount above u128::MAX must be refused, not truncated")
	}
}
