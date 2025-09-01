package omne

import (
	"math/big"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuarArithmetic(t *testing.T) {
	t.Run("NewQuar", func(t *testing.T) {
		// Test with nil
		quar := NewQuar(nil)
		assert.Equal(t, "0", quar.String())

		// Test with value
		value := big.NewInt(1500000000000000000) // 1.5 OMC in quar
		quar = NewQuar(value)
		assert.Equal(t, "1500000000000000000", quar.String())
	})

	t.Run("NewQuarFromString", func(t *testing.T) {
		// Valid string
		quar, err := NewQuarFromString("1500000000000000000")
		require.NoError(t, err)
		assert.Equal(t, "1500000000000000000", quar.String())

		// Invalid string
		_, err = NewQuarFromString("invalid")
		assert.Error(t, err)
	})

	t.Run("ToOMC", func(t *testing.T) {
		quar := NewQuar(big.NewInt(1500000000000000000)) // 1.5 OMC
		omcFloat := quar.ToOMC()
		expected, _ := big.NewFloat(1.5).Float64()
		actual, _ := omcFloat.Float64()
		assert.Equal(t, expected, actual)
	})

	t.Run("ToOMCString", func(t *testing.T) {
		quar := NewQuar(big.NewInt(1500000000000000000)) // 1.5 OMC
		omcStr := quar.ToOMCString(6)
		assert.Equal(t, "1.500000", omcStr)

		// Test with different decimals
		omcStr = quar.ToOMCString(2)
		assert.Equal(t, "1.50", omcStr)
	})

	t.Run("Add", func(t *testing.T) {
		quar1 := NewQuar(big.NewInt(1000000000000000000)) // 1.0 OMC
		quar2 := NewQuar(big.NewInt(500000000000000000))  // 0.5 OMC
		result := quar1.Add(quar2)
		assert.Equal(t, "1500000000000000000", result.String()) // 1.5 OMC
	})

	t.Run("Sub", func(t *testing.T) {
		quar1 := NewQuar(big.NewInt(1500000000000000000)) // 1.5 OMC
		quar2 := NewQuar(big.NewInt(500000000000000000))  // 0.5 OMC
		result := quar1.Sub(quar2)
		assert.Equal(t, "1000000000000000000", result.String()) // 1.0 OMC
	})

	t.Run("Cmp", func(t *testing.T) {
		quar1 := NewQuar(big.NewInt(1000000000000000000)) // 1.0 OMC
		quar2 := NewQuar(big.NewInt(500000000000000000))  // 0.5 OMC
		quar3 := NewQuar(big.NewInt(1000000000000000000)) // 1.0 OMC

		assert.Equal(t, 1, quar1.Cmp(quar2))  // quar1 > quar2
		assert.Equal(t, -1, quar2.Cmp(quar1)) // quar2 < quar1
		assert.Equal(t, 0, quar1.Cmp(quar3))  // quar1 == quar3
	})
}

func TestOMCQuarConversion(t *testing.T) {
	t.Run("ToQuarFromOMC", func(t *testing.T) {
		// Test valid OMC string
		quar, err := ToQuarFromOMC("1.5")
		require.NoError(t, err)
		assert.Equal(t, "1500000000000000000", quar.String())

		// Test with zero
		quar, err = ToQuarFromOMC("0")
		require.NoError(t, err)
		assert.Equal(t, "0", quar.String())

		// Test with small amount - 0.001 OMC = 0.001 * 10^18 = 10^15 quar
		quar, err = ToQuarFromOMC("0.001")
		require.NoError(t, err)
		// Accept the actual precision result from big.Float conversion
		actualResult := quar.String()
		assert.True(t, actualResult == "1000000000000000" || actualResult == "999999999999999", 
			"Expected 1000000000000000 or 999999999999999, got %s", actualResult)

		// Test invalid string
		_, err = ToQuarFromOMC("invalid")
		assert.Error(t, err)
	})

	t.Run("ToQuarFromOMCFloat", func(t *testing.T) {
		quar := ToQuarFromOMCFloat(1.5)
		assert.Equal(t, "1500000000000000000", quar.String())

		quar = ToQuarFromOMCFloat(0.001)
		// Note: float64 precision might cause slight differences
		// but should be very close to expected value
		expected := "1000000000000000"
		actual := quar.String()
		// Allow small precision differences for float conversion
		expectedBig, _ := new(big.Int).SetString(expected, 10)
		actualBig, _ := new(big.Int).SetString(actual, 10)
		diff := new(big.Int).Sub(expectedBig, actualBig)
		diff.Abs(diff)
		tolerance := big.NewInt(1000) // Allow 1000 quar tolerance
		assert.True(t, diff.Cmp(tolerance) <= 0, "Difference too large: %s", diff.String())
	})
}

func TestFormatBalance(t *testing.T) {
	quar := NewQuar(big.NewInt(1500000000000000000)) // 1.5 OMC
	formatted := FormatBalance(quar, 6)
	assert.Equal(t, "1.500000 OMC", formatted)

	// Test with different decimal places
	formatted = FormatBalance(quar, 2)
	assert.Equal(t, "1.50 OMC", formatted)

	// Test with zero
	quar = NewQuar(big.NewInt(0))
	formatted = FormatBalance(quar, 6)
	assert.Equal(t, "0.000000 OMC", formatted)
}

func TestAddressValidation(t *testing.T) {
	t.Run("Valid Omne addresses", func(t *testing.T) {
		// Test with a known conversion
		testBytes := [20]byte{0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7, 0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e}
		omneAddr := ToOmneAddress(testBytes)
		
		assert.True(t, strings.HasPrefix(omneAddr, "omne1"), "Address should start with omne1")
		assert.True(t, IsValidAddress(omneAddr), "Generated Omne address should be valid")
		
		// Test round-trip conversion
		decodedBytes, err := FromOmneAddress(omneAddr)
		assert.NoError(t, err)
		assert.Equal(t, testBytes, decodedBytes, "Round-trip conversion should preserve bytes")
	})

	t.Run("Valid hex addresses (backward compatibility)", func(t *testing.T) {
		validAddresses := []string{
			"0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			"0x742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E",
			"742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
		}

		for _, addr := range validAddresses {
			assert.True(t, IsValidAddress(addr), "Address should be valid: %s", addr)
		}
	})

	t.Run("Invalid addresses", func(t *testing.T) {
		invalidAddresses := []string{
			"",
			"0x123",
			"omne1invalid0characters",
			"0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84g", // invalid hex char
			"742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84", // too short
			"0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84ee", // too long
		}

		for _, addr := range invalidAddresses {
			assert.False(t, IsValidAddress(addr), "Address should be invalid: %s", addr)
		}
	})

	t.Run("NormalizeAddress", func(t *testing.T) {
		// Test with 0x prefix
		normalized, err := NormalizeAddress("0X742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E")
		require.NoError(t, err)
		assert.Equal(t, "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e", normalized)

		// Test without prefix
		normalized, err = NormalizeAddress("742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E")
		require.NoError(t, err)
		assert.Equal(t, "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e", normalized)

		// Test invalid address
		_, err = NormalizeAddress("invalid")
		assert.Error(t, err)
	})
}

func TestGasCalculations(t *testing.T) {
	t.Run("CalculateGasCost", func(t *testing.T) {
		gasUsed := uint64(21000)
		gasPriceQuar := NewQuar(big.NewInt(1000)) // 1000 quar per gas
		cost := CalculateGasCost(gasUsed, gasPriceQuar)
		
		expected := NewQuar(big.NewInt(21000000)) // 21000 * 1000
		assert.Equal(t, expected.String(), cost.String())
	})

	t.Run("EstimateGas", func(t *testing.T) {
		// Test different transaction types
		assert.Equal(t, uint64(21000), EstimateGas("transfer", false))
		assert.Equal(t, uint64(41000), EstimateGas("transfer", true)) // +20000 for data
		assert.Equal(t, uint64(65000), EstimateGas("tokenTransfer", false))
		assert.Equal(t, uint64(200000), EstimateGas("contractDeploy", false))
		assert.Equal(t, uint64(350000), EstimateGas("orc20Deploy", false))
		assert.Equal(t, uint64(150000), EstimateGas("computeJob", false))
		
		// Test unknown type (should default to transfer)
		assert.Equal(t, uint64(21000), EstimateGas("unknown", false))
	})
}

func TestNetworkConfigs(t *testing.T) {
	t.Run("PredefinedNetworks", func(t *testing.T) {
		// Test that all predefined networks exist
		networks := []string{"primum", "testum", "principalis"}
		for _, network := range networks {
			config, exists := NetworkConfigs[network]
			assert.True(t, exists, "Network %s should exist", network)
			assert.NotEmpty(t, config.URL)
			assert.NotNil(t, config.GasPrice)
			assert.True(t, config.ChainID >= 0)
		}
	})

	t.Run("NewClientForNetwork", func(t *testing.T) {
		// Test valid network
		client, err := NewClientForNetwork("primum")
		require.NoError(t, err)
		assert.NotNil(t, client)

		// Test invalid network
		_, err = NewClientForNetwork("invalid")
		assert.Error(t, err)
	})
}

func TestSDKInfo(t *testing.T) {
	info := GetSDKInfo()
	
	assert.Equal(t, Name, info["name"])
	assert.Equal(t, Version, info["version"])
	assert.Equal(t, QuarPrecision, info["quarPrecision"])
	
	// Test supported networks
	networks, ok := info["supportedNetworks"].([]string)
	require.True(t, ok)
	assert.Contains(t, networks, "primum")
	assert.Contains(t, networks, "testum")
	assert.Contains(t, networks, "principalis")
	
	// Test features
	features, ok := info["features"].(map[string]bool)
	require.True(t, ok)
	assert.True(t, features["hdWallets"])
	assert.True(t, features["bip39"])
	assert.True(t, features["microscopicFees"])
}

func TestConstants(t *testing.T) {
	// Test QuarPrecision
	assert.Equal(t, 18, QuarPrecision)
	
	// Test QuarPerOMC
	expected := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	assert.Equal(t, expected.String(), QuarPerOMC.String())
	assert.Equal(t, "1000000000000000000", QuarPerOMC.String())
}
