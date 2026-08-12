// Tessera transaction identity — Transaction::id in node/src/blocks/tx.rs.
//
// The id is SHA-256 over the domain-tagged, length-framed INTENT: chain id,
// sender, recipient, amount, fee, nonce. The signature and public key are NOT in
// the preimage, so a client derives the id locally, before signing and before
// submitting, and it is the id the chain will record.
//
// Conformance is driven by vectors/tx_id_v1.json, shared with the Rust
// implementation. A divergence shows a user one transaction id while the chain
// records another, and neither side finds out.

package omne

import (
	"errors"
	"fmt"
	"math/big"
)

// TagTx is the 16-byte domain tag. The trailing dot pads it to 16.
var TagTx = []byte("omne.tx.body.v1.")

// ErrTxIntent reports a malformed transaction intent.
var ErrTxIntent = errors.New("txid: intent")

// TxIntent is the part of a transaction the id commits to.
//
// Amounts are big.Int because they are u128 on the wire: uint64 cannot hold
// them, and silently truncating one changes the id.
// Asset names which asset a transfer moves. The discriminant is inside the
// signed preimage, so it is not cosmetic: a signature for AssetOMC cannot
// authorise the same transfer in AssetOGT.
type Asset uint8

const (
	// AssetOMC is Omne Coin — the commerce and utility asset, and the asset
	// fees are paid in. The default for a transfer.
	AssetOMC Asset = 0
	// AssetOGT is the Omne Governance Token — protocol voting rights, staked
	// by validators, and transferable so the rights have a market.
	AssetOGT Asset = 1
)

type TxIntent struct {
	ChainID   []byte
	Sender    []byte
	Recipient []byte
	Amount    *big.Int
	Fee       *big.Int
	Nonce     uint64
	// Asset denominates Amount. The zero value is AssetOMC, which is the
	// commerce asset and the right default — but a caller moving OGT must set
	// it, because the node will derive a different id and reject the signature.
	Asset Asset
}

// le encodes an unsigned integer little-endian into n bytes, refusing to
// truncate.
func le(v *big.Int, n int) ([]byte, error) {
	if v == nil {
		return nil, fmt.Errorf("%w: nil value", ErrTxIntent)
	}
	if v.Sign() < 0 {
		return nil, fmt.Errorf("%w: negative value", ErrTxIntent)
	}
	b := v.Bytes() // big-endian
	if len(b) > n {
		return nil, fmt.Errorf("%w: value does not fit in %d bytes", ErrTxIntent, n)
	}
	out := make([]byte, n)
	for i, c := range b {
		out[len(b)-1-i] = c
	}
	return out, nil
}

func expect32(b []byte, what string) error {
	if len(b) != 32 {
		return fmt.Errorf("%w: %s must be 32 bytes, got %d", ErrTxIntent, what, len(b))
	}
	return nil
}

// TransactionID returns the id a Tessera node will derive for this intent.
//
// Field order is normative and matches the Rust preimage exactly. Addresses are
// raw 32-byte forms — decode om1… before calling.
func TransactionID(tx TxIntent) ([]byte, error) {
	for _, f := range []struct {
		b    []byte
		what string
	}{{tx.ChainID, "chain_id"}, {tx.Sender, "sender"}, {tx.Recipient, "recipient"}} {
		if err := expect32(f.b, f.what); err != nil {
			return nil, err
		}
	}
	amount, err := le(tx.Amount, 16)
	if err != nil {
		return nil, err
	}
	fee, err := le(tx.Fee, 16)
	if err != nil {
		return nil, err
	}
	nonce, err := le(new(big.Int).SetUint64(tx.Nonce), 8)
	if err != nil {
		return nil, err
	}
	if tx.Asset != AssetOMC && tx.Asset != AssetOGT {
		return nil, fmt.Errorf("%w: unknown asset %d", ErrTxIntent, tx.Asset)
	}
	// Reuse OMA-1's digest: §R0.2 requires exactly one framing implementation.
	return digest(TagTx, tx.ChainID, tx.Sender, tx.Recipient, amount, fee, nonce,
		[]byte{byte(tx.Asset)}), nil
}
