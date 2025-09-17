package omne

import (
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/btcsuite/btcd/btcutil/hdkeychain"
	"github.com/btcsuite/btcd/chaincfg"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/tyler-smith/go-bip39"
)

// Wallet represents a BIP39 HD wallet
type Wallet struct {
	mnemonic  string
	seed      []byte
	masterKey *hdkeychain.ExtendedKey
	accounts  map[uint32]*Account
	address   string // Address of the first account (index 0)
}

// Account represents a single account derived from the HD wallet
type Account struct {
	privateKey *ecdsa.PrivateKey
	publicKey  *ecdsa.PublicKey
	address    string
	path       string
	index      uint32
}

// NewWallet creates a new wallet from a mnemonic
func NewWallet(mnemonic string) (*Wallet, error) {
	if !bip39.IsMnemonicValid(mnemonic) {
		return nil, fmt.Errorf("invalid mnemonic")
	}

	seed := bip39.NewSeed(mnemonic, "")

	// Create master key using btcsuite for BIP32
	masterKey, err := hdkeychain.NewMaster(seed, &chaincfg.MainNetParams)
	if err != nil {
		return nil, fmt.Errorf("failed to create master key: %w", err)
	}

	wallet := &Wallet{
		mnemonic:  mnemonic,
		seed:      seed,
		masterKey: masterKey,
		accounts:  make(map[uint32]*Account),
	}

	// Generate the first account (index 0) and set as wallet address
	account, err := wallet.GetAccount(0)
	if err != nil {
		return nil, fmt.Errorf("failed to generate first account: %w", err)
	}
	wallet.address = account.address

	return wallet, nil
}

// GenerateWallet creates a new wallet with a random mnemonic
func GenerateWallet() (*Wallet, error) {
	// Generate 256 bits of entropy (24 words)
	entropy, err := bip39.NewEntropy(256)
	if err != nil {
		return nil, fmt.Errorf("failed to generate entropy: %w", err)
	}

	mnemonic, err := bip39.NewMnemonic(entropy)
	if err != nil {
		return nil, fmt.Errorf("failed to generate mnemonic: %w", err)
	}

	return NewWallet(mnemonic)
}

// GetMnemonic returns the wallet's mnemonic phrase
func (w *Wallet) GetMnemonic() string {
	return w.mnemonic
}

// GetAddress returns the wallet's primary address (account 0)
func (w *Wallet) GetAddress() string {
	return w.address
}

// GetAccount derives and returns an account at the specified index
func (w *Wallet) GetAccount(index uint32) (*Account, error) {
	// Check if account already exists
	if account, exists := w.accounts[index]; exists {
		return account, nil
	}

	// Derive account using BIP44 path: m/44'/60'/0'/0/index
	// 60' is Ethereum's coin type
	account, err := w.deriveAccount(index)
	if err != nil {
		return nil, err
	}

	w.accounts[index] = account
	return account, nil
}

// GetAccounts returns multiple accounts starting from index 0
func (w *Wallet) GetAccounts(count uint32) ([]*Account, error) {
	accounts := make([]*Account, count)
	for i := uint32(0); i < count; i++ {
		account, err := w.GetAccount(i)
		if err != nil {
			return nil, fmt.Errorf("failed to get account %d: %w", i, err)
		}
		accounts[i] = account
	}
	return accounts, nil
}

// deriveAccount derives an account at the specified index using BIP44
func (w *Wallet) deriveAccount(index uint32) (*Account, error) {
	// BIP44 derivation path: m/44'/60'/0'/0/index
	// m - master key
	// 44' - BIP44 purpose
	// 60' - Ethereum coin type
	// 0' - account 0 (hardened)
	// 0 - external chain
	// index - address index

	// Derive: m/44'
	purpose, err := w.masterKey.Derive(hdkeychain.HardenedKeyStart + 44)
	if err != nil {
		return nil, fmt.Errorf("failed to derive purpose: %w", err)
	}

	// Derive: m/44'/60'
	coinType, err := purpose.Derive(hdkeychain.HardenedKeyStart + 60)
	if err != nil {
		return nil, fmt.Errorf("failed to derive coin type: %w", err)
	}

	// Derive: m/44'/60'/0'
	account, err := coinType.Derive(hdkeychain.HardenedKeyStart + 0)
	if err != nil {
		return nil, fmt.Errorf("failed to derive account: %w", err)
	}

	// Derive: m/44'/60'/0'/0
	external, err := account.Derive(0)
	if err != nil {
		return nil, fmt.Errorf("failed to derive external chain: %w", err)
	}

	// Derive: m/44'/60'/0'/0/index
	addressKey, err := external.Derive(index)
	if err != nil {
		return nil, fmt.Errorf("failed to derive address key: %w", err)
	}

	// Get the private key
	privateKeyECDSA, err := addressKey.ECPrivKey()
	if err != nil {
		return nil, fmt.Errorf("failed to get private key: %w", err)
	}

	// Convert to Go's ecdsa.PrivateKey
	privateKey := privateKeyECDSA.ToECDSA()
	publicKey := &privateKey.PublicKey

	// Generate address from public key
	addressBytes := crypto.PubkeyToAddress(*publicKey)

	// Convert to Omne address format
	address := ToOmneAddress(addressBytes)

	path := fmt.Sprintf("m/44'/60'/0'/0/%d", index)

	return &Account{
		privateKey: privateKey,
		publicKey:  publicKey,
		address:    address,
		path:       path,
		index:      index,
	}, nil
}

// GetPrivateKey returns the account's private key as hex string
// WARNING: This exposes the private key in memory. Use GetPrivateKeySecure() for better security.
func (a *Account) GetPrivateKey() string {
	privateKeyBytes := crypto.FromECDSA(a.privateKey)
	hexStr := hex.EncodeToString(privateKeyBytes)

	// Zero out the byte slice immediately
	for i := range privateKeyBytes {
		privateKeyBytes[i] = 0
	}

	return hexStr
}

// GetPrivateKeySecure returns the account's private key as SecureString
// The returned SecureString should be destroyed after use by calling Destroy()
func (a *Account) GetPrivateKeySecure() *SecureString {
	privateKeyBytes := crypto.FromECDSA(a.privateKey)
	hexStr := hex.EncodeToString(privateKeyBytes)

	// Zero out the byte slice immediately
	for i := range privateKeyBytes {
		privateKeyBytes[i] = 0
	}

	// Create secure string and zero out the original
	secureStr := NewSecureString(hexStr)

	// Note: Go strings are immutable, so we cannot zero the original hex string
	// The SecureString provides the secure memory management

	return secureStr
}

// GetPublicKey returns the account's public key as hex string
func (a *Account) GetPublicKey() string {
	publicKeyBytes := crypto.FromECDSAPub(a.publicKey)
	return hex.EncodeToString(publicKeyBytes)
}

// GetAddress returns the account's address
func (a *Account) GetAddress() string {
	return a.address
}

// GetPath returns the BIP44 derivation path
func (a *Account) GetPath() string {
	return a.path
}

// GetIndex returns the account index
func (a *Account) GetIndex() uint32 {
	return a.index
}

// SignHash signs a hash with the account's private key
func (a *Account) SignHash(hash []byte) ([]byte, error) {
	signature, err := crypto.Sign(hash, a.privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign hash: %w", err)
	}
	return signature, nil
}

// SignHashSecure signs a hash with secure memory handling
func (a *Account) SignHashSecure(hash []byte) (*SecureBytes, error) {
	signature, err := crypto.Sign(hash, a.privateKey)
	if err != nil {
		return nil, fmt.Errorf("failed to sign hash: %w", err)
	}

	// Create secure bytes from signature
	secureSignature := NewSecureBytesFromSlice(signature)

	// Zero out the original signature
	for i := range signature {
		signature[i] = 0
	}

	return secureSignature, nil
}

// SignMessage signs a message with Ethereum's personal message format
func (a *Account) SignMessage(message string) ([]byte, error) {
	messageHash := crypto.Keccak256Hash([]byte(fmt.Sprintf("\x19Ethereum Signed Message:\n%d%s", len(message), message)))
	return a.SignHash(messageHash.Bytes())
}

// NewAccountFromPrivateKey creates an account from a private key hex string
func NewAccountFromPrivateKey(privateKeyHex string) (*Account, error) {
	// Remove 0x prefix if present
	privateKeyHex = strings.TrimPrefix(privateKeyHex, "0x")

	privateKeyBytes, err := hex.DecodeString(privateKeyHex)
	if err != nil {
		return nil, fmt.Errorf("invalid private key hex: %w", err)
	}

	privateKey, err := crypto.ToECDSA(privateKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	publicKey := &privateKey.PublicKey
	address := crypto.PubkeyToAddress(*publicKey).Hex()

	return &Account{
		privateKey: privateKey,
		publicKey:  publicKey,
		address:    address,
		path:       "imported",
		index:      0,
	}, nil
}

// RandomHex generates a random hex string of specified byte length
func RandomHex(bytes int) (string, error) {
	randomBytes := make([]byte, bytes)
	_, err := rand.Read(randomBytes)
	if err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}
	return hex.EncodeToString(randomBytes), nil
}

// Keccak256 computes the Keccak256 hash of input data
func Keccak256(data []byte) []byte {
	return crypto.Keccak256(data)
}

// Keccak256Hash computes the Keccak256 hash and returns it as a hex string
func Keccak256Hash(data []byte) string {
	hash := Keccak256(data)
	return hex.EncodeToString(hash)
}
