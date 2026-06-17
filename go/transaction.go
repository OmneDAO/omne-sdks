package omne

import (
	"crypto/sha256"
	"fmt"
	"math/big"
)

const (
	DefaultGasLimit = uint64(200_000)
	DefaultGasPrice = "5000"
)

// Transaction is an unsigned Omne transaction. Value is a u128 (nil == 0);
// GasPrice is a decimal string; Data is hex-encoded ABI calldata.
type Transaction struct {
	From     string
	To       string
	Value    *big.Int
	GasLimit uint64
	GasPrice string
	Nonce    uint64
	ChainID  int
	Data     string
}

// SignedTransaction is a Transaction plus its ML-DSA-44 signature + public key.
type SignedTransaction struct {
	Transaction
	Signature string // hex (2420-byte sig)
	PublicKey string // hex (1312-byte pubkey)
}

func leUint(v uint64, n int) []byte {
	b := make([]byte, n)
	for i := 0; i < n; i++ {
		b[i] = byte(v & 0xff)
		v >>= 8
	}
	return b
}

func leBig(v *big.Int, n int) []byte {
	be := make([]byte, n)
	if v != nil {
		v.FillBytes(be) // big-endian, left-padded
	}
	le := make([]byte, n)
	for i := 0; i < n; i++ {
		le[i] = be[n-1-i]
	}
	return le
}

// HashTransaction computes the canonical 32-byte signing preimage hash,
// matching the Rust-side hash_transaction() and the TS/Python SDKs:
//
//	SHA-256( from(32) ‖ to(32) ‖ value(LE128) ‖ gasLimit(LE64) ‖ gasPrice(LE64)
//	         ‖ nonce(LE64) ‖ chainId(LE64) ‖ data )
func HashTransaction(tx Transaction) ([]byte, error) {
	fromBytes, err := FromOmneAddress(tx.From)
	if err != nil {
		return nil, fmt.Errorf("from: %w", err)
	}
	var toBytes []byte
	if tx.To != "" {
		if toBytes, err = FromOmneAddress(tx.To); err != nil {
			return nil, fmt.Errorf("to: %w", err)
		}
	}
	var dataBytes []byte
	if tx.Data != "" {
		if dataBytes, err = FromHex(tx.Data); err != nil {
			return nil, fmt.Errorf("data: %w", err)
		}
	}
	gasPrice, ok := new(big.Int).SetString(tx.GasPrice, 10)
	if !ok {
		return nil, fmt.Errorf("invalid gasPrice: %q", tx.GasPrice)
	}

	buf := make([]byte, 0, 32+32+16+8+8+8+8+len(dataBytes))
	buf = append(buf, fromBytes...)
	buf = append(buf, toBytes...)
	buf = append(buf, leBig(tx.Value, 16)...)
	buf = append(buf, leUint(tx.GasLimit, 8)...)
	buf = append(buf, leUint(gasPrice.Uint64(), 8)...)
	buf = append(buf, leUint(tx.Nonce, 8)...)
	buf = append(buf, leUint(uint64(tx.ChainID), 8)...)
	buf = append(buf, dataBytes...)

	h := sha256.Sum256(buf)
	return h[:], nil
}
