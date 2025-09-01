package omne

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWalletGeneration(t *testing.T) {
	t.Run("GenerateWallet", func(t *testing.T) {
		wallet, err := GenerateWallet()
		require.NoError(t, err)
		assert.NotNil(t, wallet)
		
		// Check mnemonic
		mnemonic := wallet.GetMnemonic()
		assert.NotEmpty(t, mnemonic)
		assert.True(t, len(mnemonic) > 50) // Should be substantial length
		
		// Check address
		address := wallet.GetAddress()
		assert.NotEmpty(t, address)
		assert.True(t, IsValidAddress(address))
		assert.True(t, strings.HasPrefix(address, "omne1")) // Should be Omne format
	})

	t.Run("NewWalletFromMnemonic", func(t *testing.T) {
		// Test with known mnemonic for reproducibility
		mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
		
		wallet, err := NewWallet(mnemonic)
		require.NoError(t, err)
		assert.NotNil(t, wallet)
		
		// Verify mnemonic matches
		assert.Equal(t, mnemonic, wallet.GetMnemonic())
		
		// Address should be deterministic
		address := wallet.GetAddress()
		assert.True(t, IsValidAddress(address))
		
		// Create another wallet with same mnemonic
		wallet2, err := NewWallet(mnemonic)
		require.NoError(t, err)
		
		// Should generate the same address
		assert.Equal(t, wallet.GetAddress(), wallet2.GetAddress())
	})

	t.Run("InvalidMnemonic", func(t *testing.T) {
		_, err := NewWallet("invalid mnemonic phrase")
		assert.Error(t, err)
	})
}

func TestAccountDerivation(t *testing.T) {
	// Use known mnemonic for deterministic testing
	mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
	wallet, err := NewWallet(mnemonic)
	require.NoError(t, err)

	t.Run("GetAccount", func(t *testing.T) {
		// Get first account
		account0, err := wallet.GetAccount(0)
		require.NoError(t, err)
		assert.NotNil(t, account0)
		
		// Verify account properties
		assert.Equal(t, uint32(0), account0.GetIndex())
		assert.Equal(t, "m/44'/60'/0'/0/0", account0.GetPath())
		assert.True(t, IsValidAddress(account0.GetAddress()))
		
		// Private and public keys should be valid hex
		privateKey := account0.GetPrivateKey()
		assert.Equal(t, 64, len(privateKey)) // 32 bytes = 64 hex chars
		
		publicKey := account0.GetPublicKey()
		assert.True(t, len(publicKey) > 0)
		
		// Get same account again (should be cached)
		account0Again, err := wallet.GetAccount(0)
		require.NoError(t, err)
		assert.Equal(t, account0.GetAddress(), account0Again.GetAddress())
		assert.Equal(t, account0.GetPrivateKey(), account0Again.GetPrivateKey())
	})

	t.Run("GetMultipleAccounts", func(t *testing.T) {
		accounts, err := wallet.GetAccounts(3)
		require.NoError(t, err)
		assert.Len(t, accounts, 3)
		
		// Each account should have different addresses
		addresses := make(map[string]bool)
		for i, account := range accounts {
			assert.Equal(t, uint32(i), account.GetIndex())
			assert.True(t, IsValidAddress(account.GetAddress()))
			
			// Ensure no duplicate addresses
			address := account.GetAddress()
			assert.False(t, addresses[address], "Duplicate address found: %s", address)
			addresses[address] = true
		}
	})

	t.Run("AccountSigning", func(t *testing.T) {
		account, err := wallet.GetAccount(0)
		require.NoError(t, err)
		
		// Test hash signing - use 32-byte hash
		testHash := make([]byte, 32)
		copy(testHash, []byte("test hash for signing"))
		signature, err := account.SignHash(testHash)
		require.NoError(t, err)
		assert.Len(t, signature, 65) // 64 bytes signature + 1 byte recovery
		
		// Test message signing
		message := "Hello, Omne!"
		messageSignature, err := account.SignMessage(message)
		require.NoError(t, err)
		assert.Len(t, messageSignature, 65)
		
		// Signatures should be different for different inputs
		assert.NotEqual(t, signature, messageSignature)
	})
}

func TestAccountFromPrivateKey(t *testing.T) {
	t.Run("ValidPrivateKey", func(t *testing.T) {
		// Test private key (32 bytes hex)
		privateKeyHex := "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
		
		account, err := NewAccountFromPrivateKey(privateKeyHex)
		require.NoError(t, err)
		assert.NotNil(t, account)
		
		// Verify the private key is stored correctly
		assert.Equal(t, privateKeyHex, account.GetPrivateKey())
		
		// Address should be valid
		assert.True(t, IsValidAddress(account.GetAddress()))
		
		// Path should indicate imported
		assert.Equal(t, "imported", account.GetPath())
		assert.Equal(t, uint32(0), account.GetIndex())
	})

	t.Run("PrivateKeyWith0xPrefix", func(t *testing.T) {
		privateKeyHex := "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
		
		account, err := NewAccountFromPrivateKey(privateKeyHex)
		require.NoError(t, err)
		
		// Should strip 0x prefix
		expected := "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
		assert.Equal(t, expected, account.GetPrivateKey())
	})

	t.Run("InvalidPrivateKey", func(t *testing.T) {
		// Test invalid hex
		_, err := NewAccountFromPrivateKey("invalid hex")
		assert.Error(t, err)
		
		// Test wrong length
		_, err = NewAccountFromPrivateKey("ac0974bec39a17e36ba4a6b4d238ff94") // Too short
		assert.Error(t, err)
	})
}

func TestCryptographicUtilities(t *testing.T) {
	t.Run("RandomHex", func(t *testing.T) {
		// Test 32 bytes (64 hex chars)
		hex32, err := RandomHex(32)
		require.NoError(t, err)
		assert.Len(t, hex32, 64)
		
		// Test 16 bytes (32 hex chars)
		hex16, err := RandomHex(16)
		require.NoError(t, err)
		assert.Len(t, hex16, 32)
		
		// Multiple calls should produce different results
		hex1, _ := RandomHex(32)
		hex2, _ := RandomHex(32)
		assert.NotEqual(t, hex1, hex2)
	})

	t.Run("Keccak256", func(t *testing.T) {
		data := []byte("Hello, Omne!")
		hash := Keccak256(data)
		assert.Len(t, hash, 32) // Keccak256 produces 32-byte hash
		
		// Same input should produce same hash
		hash2 := Keccak256(data)
		assert.Equal(t, hash, hash2)
		
		// Different input should produce different hash
		hash3 := Keccak256([]byte("Different data"))
		assert.NotEqual(t, hash, hash3)
	})

	t.Run("Keccak256Hash", func(t *testing.T) {
		data := []byte("Hello, Omne!")
		hashHex := Keccak256Hash(data)
		assert.Len(t, hashHex, 64) // 32 bytes = 64 hex chars
		
		// Should be valid hex
		for _, char := range hashHex {
			assert.True(t, (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f'))
		}
	})
}

func TestWalletConsistency(t *testing.T) {
	t.Run("DeterministicGeneration", func(t *testing.T) {
		mnemonic := "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
		
		// Create two wallets from the same mnemonic
		wallet1, err := NewWallet(mnemonic)
		require.NoError(t, err)
		
		wallet2, err := NewWallet(mnemonic)
		require.NoError(t, err)
		
		// Should generate identical addresses
		assert.Equal(t, wallet1.GetAddress(), wallet2.GetAddress())
		
		// Should generate identical accounts
		for i := uint32(0); i < 5; i++ {
			account1, err := wallet1.GetAccount(i)
			require.NoError(t, err)
			
			account2, err := wallet2.GetAccount(i)
			require.NoError(t, err)
			
			assert.Equal(t, account1.GetAddress(), account2.GetAddress())
			assert.Equal(t, account1.GetPrivateKey(), account2.GetPrivateKey())
			assert.Equal(t, account1.GetPublicKey(), account2.GetPublicKey())
		}
	})

	t.Run("AccountIndependence", func(t *testing.T) {
		wallet, err := GenerateWallet()
		require.NoError(t, err)
		
		// Generate multiple accounts
		accounts := make([]*Account, 5)
		for i := 0; i < 5; i++ {
			accounts[i], err = wallet.GetAccount(uint32(i))
			require.NoError(t, err)
		}
		
		// Each account should have unique addresses and keys
		for i := 0; i < 5; i++ {
			for j := i + 1; j < 5; j++ {
				assert.NotEqual(t, accounts[i].GetAddress(), accounts[j].GetAddress())
				assert.NotEqual(t, accounts[i].GetPrivateKey(), accounts[j].GetPrivateKey())
				assert.NotEqual(t, accounts[i].GetPublicKey(), accounts[j].GetPublicKey())
			}
		}
	})
}
