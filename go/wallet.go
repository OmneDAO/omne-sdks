package omne

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"

	"github.com/cloudflare/circl/sign/mldsa/mldsa44"
)

const hdBasePath = "m/44'/60'/0'/0"

var hdMasterKey = []byte("omne ml-dsa44 seed")

// MnemonicToSeed derives the 64-byte BIP39 seed
// (PBKDF2-HMAC-SHA512(mnemonic, "mnemonic"+passphrase, 2048)).
//
// NOTE: NFKD normalization of non-ASCII passphrases is a follow-up; ASCII
// mnemonics are NFKD-stable, so cross-SDK parity holds on the standard vectors.
func MnemonicToSeed(mnemonic, passphrase string) ([]byte, error) {
	return pbkdf2.Key(sha512.New, mnemonic, []byte("mnemonic"+passphrase), 2048, 64)
}

func hmacSHA512(key, data []byte) []byte {
	m := hmac.New(sha512.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func hdMaster(seed []byte) (childSeed, chainCode []byte) {
	i := hmacSHA512(hdMasterKey, seed)
	return i[:32], i[32:]
}

func hdChild(parentSeed, parentChain []byte, index uint32) (childSeed, chainCode []byte) {
	hardened := index | 0x80000000
	data := make([]byte, 0, 1+32+4)
	data = append(data, 0x00)
	data = append(data, parentSeed...)
	var idx [4]byte
	binary.BigEndian.PutUint32(idx[:], hardened)
	data = append(data, idx[:]...)
	i := hmacSHA512(parentChain, data)
	return i[:32], i[32:]
}

func hdDerivePath(seed []byte, path string) ([]byte, error) {
	cur, chain := hdMaster(seed)
	for _, seg := range strings.Split(strings.TrimPrefix(path, "m/"), "/") {
		if seg == "" {
			continue
		}
		idx, err := strconv.Atoi(strings.TrimSuffix(seg, "'"))
		if err != nil {
			return nil, fmt.Errorf("invalid derivation path segment: %q", seg)
		}
		cur, chain = hdChild(cur, chain, uint32(idx))
	}
	return cur, nil
}

// WalletAccount is a single account: a 32-byte seed expanded to an ML-DSA-44
// keypair via CIRCL's NewKeyFromSeed (byte-identical to the TS @noble keygen).
type WalletAccount struct {
	PrivateKey string // 32-byte ML-DSA-44 seed, hex
	Path       string
	PublicKey  string // 1312-byte ML-DSA-44 public key, hex
	Address    string // canonical om1z
	secretKey  *mldsa44.PrivateKey
}

func newWalletAccount(privateKeyHex, path string) (*WalletAccount, error) {
	if len(privateKeyHex) != 64 {
		return nil, fmt.Errorf("invalid private key: expected 64 hex chars (32-byte seed)")
	}
	seedBytes, err := hex.DecodeString(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key hex: %w", err)
	}
	var seed [mldsa44.SeedSize]byte
	copy(seed[:], seedBytes)
	pub, priv := mldsa44.NewKeyFromSeed(&seed)
	pubBytes, err := pub.MarshalBinary()
	if err != nil {
		return nil, err
	}
	addr, err := DeriveAddressFromPublicKey(pubBytes)
	if err != nil {
		return nil, err
	}
	return &WalletAccount{
		PrivateKey: privateKeyHex,
		Path:       path,
		PublicKey:  hex.EncodeToString(pubBytes),
		Address:    addr,
		secretKey:  priv,
	}, nil
}

// AccountFromPrivateKey builds an account directly from a 32-byte seed (hex).
func AccountFromPrivateKey(privateKeyHex string) (*WalletAccount, error) {
	return newWalletAccount(privateKeyHex, "")
}

// SignHash produces a 2420-byte ML-DSA-44 signature over digest using an empty
// context (matches @noble and the node's verify path).
func (a *WalletAccount) SignHash(digest []byte) ([]byte, error) {
	sig := make([]byte, mldsa44.SignatureSize)
	if err := mldsa44.SignTo(a.secretKey, digest, nil, false, sig); err != nil {
		return nil, err
	}
	return sig, nil
}

// SignTransaction signs tx (ChainID must be set) and returns the signed form
// with hex signature + public key. The preimage matches HashTransaction.
func (a *WalletAccount) SignTransaction(tx Transaction) (SignedTransaction, error) {
	digest, err := HashTransaction(tx)
	if err != nil {
		return SignedTransaction{}, err
	}
	sig, err := a.SignHash(digest)
	if err != nil {
		return SignedTransaction{}, err
	}
	return SignedTransaction{
		Transaction: tx,
		Signature:   hex.EncodeToString(sig),
		PublicKey:   a.PublicKey,
	}, nil
}

// Wallet is an HD wallet with BIP39 mnemonic support (hardened-only
// HMAC-SHA512 KDF), parity-matched with the TS/Python SDKs.
type Wallet struct {
	mnemonic string
	seed     []byte
}

// WalletFromMnemonic builds a wallet from a BIP39 mnemonic (+ optional passphrase).
//
// NOTE: mnemonic checksum validation against the BIP39 wordlist is a follow-up;
// seed derivation (the parity-critical path) is exact.
func WalletFromMnemonic(mnemonic, passphrase string) (*Wallet, error) {
	seed, err := MnemonicToSeed(mnemonic, passphrase)
	if err != nil {
		return nil, err
	}
	return &Wallet{mnemonic: mnemonic, seed: seed}, nil
}

// Account derives the account at the given index (m/44'/60'/0'/0/index).
func (w *Wallet) Account(index int) (*WalletAccount, error) {
	if index < 0 {
		return nil, fmt.Errorf("account index must be non-negative: %d", index)
	}
	path := fmt.Sprintf("%s/%d", hdBasePath, index)
	seed, err := hdDerivePath(w.seed, path)
	if err != nil {
		return nil, err
	}
	return newWalletAccount(hex.EncodeToString(seed), path)
}
