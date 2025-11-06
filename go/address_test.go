package omne

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOmneAddressConversion tests conversion between hex and Omne address formats
func TestOmneAddressConversion(t *testing.T) {
	t.Run("ToOmneAddress", func(t *testing.T) {
		// Test with known test bytes
		testBytes := [20]byte{
			0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7,
			0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e,
		}

		omneAddr := ToOmneAddress(testBytes)
		assert.True(t, len(omneAddr) > 5, "Omne address should have content after prefix")
		assert.True(t, omneAddr[:5] == "omne1", "Address should start with omne1")

		// Test round-trip conversion
		decodedBytes, err := FromOmneAddress(omneAddr)
		require.NoError(t, err)
		assert.Equal(t, testBytes, decodedBytes, "Round-trip conversion should preserve bytes")
	})

	t.Run("FromOmneAddress", func(t *testing.T) {
		// Test with invalid format
		_, err := FromOmneAddress("invalid")
		assert.Error(t, err, "Should reject invalid format")

		_, err = FromOmneAddress("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e")
		assert.Error(t, err, "Should reject hex format")

		// Test with valid format but invalid content
		_, err = FromOmneAddress("omne1invalid!")
		assert.Error(t, err, "Should reject invalid characters")
	})

	t.Run("FromOmneAddressUppercasePayload", func(t *testing.T) {
		testBytes := [20]byte{0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7, 0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e}
		lower := ToOmneAddress(testBytes)
		uppercasePayload := strings.ToUpper(lower[5:])
		mixedAddr := "omne1" + uppercasePayload

		_, err := FromOmneAddress(mixedAddr)
		assert.Error(t, err, "Uppercase payload should be rejected")
	})

	t.Run("AddressValidation", func(t *testing.T) {
		// Valid Omne address format
		testBytes := [20]byte{0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7, 0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e}
		omneAddr := ToOmneAddress(testBytes)
		assert.True(t, IsValidAddress(omneAddr), "Generated Omne address should be valid")

		// Valid hex address format (backward compatibility)
		hexAddr := "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"
		assert.True(t, IsValidAddress(hexAddr), "Valid hex address should be accepted")
		assert.False(t, IsValidAddress("0x742D35CC4BF688AEE6F7C3C3A6B1C98AEE5E84E"), "Uppercase hex should be rejected")

		// Invalid formats
		assert.False(t, IsValidAddress(""), "Empty string should be invalid")
		assert.False(t, IsValidAddress("invalid"), "Random string should be invalid")
		assert.False(t, IsValidAddress("omne1"), "Just prefix should be invalid")
		assert.False(t, IsValidAddress("0x123"), "Short hex should be invalid")
	})
}

// TestAddressNormalization tests address normalization and formatting
func TestAddressNormalization(t *testing.T) {
	t.Run("NormalizeAddress", func(t *testing.T) {
		// Test hex address normalization
		_, err := NormalizeAddress("0X742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E")
		require.Error(t, err)

		normalized, err := NormalizeAddress("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e")
		require.NoError(t, err)
		assert.Equal(t, "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e", normalized)

		// Test address without 0x prefix
		addrWithoutPrefix := "742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"
		normalized, err = NormalizeAddress(addrWithoutPrefix)
		require.NoError(t, err)
		assert.Equal(t, "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e", normalized)

		// Test invalid address
		_, err = NormalizeAddress("invalid")
		assert.Error(t, err, "Should reject invalid address")
	})

	t.Run("ToChecksumAddress", func(t *testing.T) {
		// Test checksum generation
		addr := "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"
		checksum, err := ToChecksumAddress(addr)
		require.NoError(t, err)
		assert.True(t, len(checksum) == 42, "Checksum address should be 42 characters")
		assert.True(t, checksum[:2] == "0x", "Should have 0x prefix")

		// Test with invalid address
		_, err = ToChecksumAddress("invalid")
		assert.Error(t, err, "Should reject invalid address")
	})
}
