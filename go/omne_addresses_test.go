package omne

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestOmneAddressEncoding ensures Omne hex encoding/decoding works as expected
func TestOmneAddressEncoding(t *testing.T) {
	t.Run("OmneEncodeDecode", func(t *testing.T) {
		// Test with known test vectors
		testCases := []struct {
			name  string
			bytes [20]byte
		}{
			{
				name:  "zero address",
				bytes: [20]byte{},
			},
			{
				name: "test vector 1",
				bytes: [20]byte{
					0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7,
					0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e,
				},
			},
			{
				name: "test vector 2",
				bytes: [20]byte{
					0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
					0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
				},
			},
			{
				name: "test vector 3",
				bytes: [20]byte{
					0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22,
					0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
				},
			},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				// Encode to Omne format
				omneAddr := ToOmneAddress(tc.bytes)
				assert.Equal(t, "omne1", omneAddr[:5], "Should start with omne1 prefix")
				assert.Equal(t, 45, len(omneAddr), "Omne address should be prefix + 40 hex chars")

				// Decode back to bytes
				decodedBytes, err := FromOmneAddress(omneAddr)
				require.NoError(t, err)
				assert.Equal(t, tc.bytes, decodedBytes, "Round-trip should preserve original bytes")

				// Validate the generated address
				assert.True(t, IsValidAddress(omneAddr), "Generated address should be valid")
			})
		}
	})

	t.Run("OmneAddressFormatValidation", func(t *testing.T) {
		validLower := "omne1" + strings.Repeat("ab", 20)

		assert.True(t, isValidOmneAddress(validLower), "Should accept lowercase hex payload")

		assert.False(t, isValidOmneAddress("omne1"+strings.Repeat("g", 40)), "Should reject non-hex characters")
		assert.False(t, isValidOmneAddress("omne1"+strings.Repeat("a", 39)), "Should reject payloads that are too short")
		assert.False(t, isValidOmneAddress("omne1"+strings.Repeat("a", 41)), "Should reject payloads that are too long")
		assert.False(t, isValidOmneAddress(strings.Repeat("a", 40)), "Should reject missing prefix")
		assert.False(t, isValidOmneAddress("omne1"+strings.ToUpper(strings.Repeat("ab", 20))), "Should reject uppercase payloads")
	})
}

// TestOmneAddressCompatibility tests compatibility with different address formats
func TestOmneAddressCompatibility(t *testing.T) {
	t.Run("HexToOmneConversion", func(t *testing.T) {
		// Test conversion from hex to Omne format
		hexAddr := "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"

		// Parse the hex address to get bytes
		normalized, err := NormalizeAddress(hexAddr)
		require.NoError(t, err)

		// This should work once we have hex->bytes conversion
		assert.True(t, IsValidAddress(normalized), "Normalized hex address should be valid")
		assert.True(t, IsValidAddress(hexAddr), "Original hex address should be valid")
	})

	t.Run("AddressFormatDetection", func(t *testing.T) {
		// Test Omne format detection
		testBytes := [20]byte{0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7, 0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e}
		omneAddr := ToOmneAddress(testBytes)

		assert.True(t, isValidOmneAddress(omneAddr), "Should detect valid Omne address")
		assert.False(t, isValidOmneAddress("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"), "Should reject hex as Omne")
		assert.False(t, isValidOmneAddress("invalid"), "Should reject invalid format")

		// Test hex format detection
		assert.True(t, isValidHexAddress("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"), "Should detect valid hex address")
		assert.True(t, isValidHexAddress("742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"), "Should detect hex without prefix")
		assert.False(t, isValidHexAddress(omneAddr), "Should reject Omne as hex")
		assert.False(t, isValidHexAddress("invalid"), "Should reject invalid format")
	})

	t.Run("CrossFormatValidation", func(t *testing.T) {
		// Generate test address in both formats
		testBytes := [20]byte{0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7, 0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e}
		omneAddr := ToOmneAddress(testBytes)
		hexAddr := "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"

		// Both should be valid through IsValidAddress
		assert.True(t, IsValidAddress(omneAddr), "Omne address should be valid")
		assert.True(t, IsValidAddress(hexAddr), "Hex address should be valid")

		// But format-specific validators should be exclusive
		assert.True(t, isValidOmneAddress(omneAddr), "Should validate as Omne")
		assert.False(t, isValidOmneAddress(hexAddr), "Should not validate hex as Omne")
		assert.True(t, isValidHexAddress(hexAddr), "Should validate as hex")
		assert.False(t, isValidHexAddress(omneAddr), "Should not validate Omne as hex")
	})
}
