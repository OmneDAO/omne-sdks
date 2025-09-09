// Package omne provides a comprehensive Go SDK for the Omne blockchain.
//
// Omne is a commerce-first blockchain with dual-layer consensus (PoVERA)
// and microscopic fees measured in quar (18-decimal precision).
//
// Key Features:
//   - Dual-layer consensus for 3-second commerce transactions
//   - Microscopic fees (sub-cent costs for typical operations)
//   - ORC-20 token standard with fee inheritance
//   - Computational job orchestration network (OON)
//   - BIP39/BIP44 HD wallet support with secp256k1 signatures
//
// Example usage:
//
//	package main
//
//	import (
//		"context"
//		"fmt"
//		"log"
//
//		"github.com/OmneDAO/omne-blockchain/sdk/go"
//	)
//
//	func main() {
//		// Create client
//		client, err := omne.NewClient("ws://localhost:8545")
//		if err != nil {
//			log.Fatal(err)
//		}
//		defer client.Close()
//
//		// Generate wallet
//		wallet, err := omne.GenerateWallet()
//		if err != nil {
//			log.Fatal(err)
//		}
//
//		fmt.Printf("Address: %s\n", wallet.GetAddress())
//
//		// Get network info
//		ctx := context.Background()
//		networkInfo, err := client.GetNetworkInfo(ctx)
//		if err != nil {
//			log.Fatal(err)
//		}
//
//		fmt.Printf("Chain ID: %d\n", networkInfo.ChainID)
//
//		// Convert OMC to quar
//		quar, err := omne.ToQuarFromOMC("1.5")
//		if err != nil {
//			log.Fatal(err)
//		}
//
//		fmt.Printf("1.5 OMC = %s quar\n", quar.String())
//		fmt.Printf("Formatted: %s\n", omne.FormatBalance(quar, 6))
//	}
package omne

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strings"
)

// SDK version information
const (
	Version = "0.1.0"
	Name    = "Omne Go SDK"
)

// Network configurations for different Omne networks
var NetworkConfigs = map[string]NetworkConfig{
	"primum": {
		ChainID:  0,
		URL:      "ws://localhost:8545",
		GasPrice: NewQuar(big.NewInt(1000)), // 1000 quar per gas
		Features: NetworkFeatures{
			DualLayerConsensus:         true,
			MicroscopicFees:            true,
			InstantFinality:            true,
			ComputationalOrchestration: true,
		},
	},
	"testum": {
		ChainID:  1,
		URL:      "wss://testnet.omne.org",
		GasPrice: NewQuar(big.NewInt(500)), // 500 quar per gas
		Features: NetworkFeatures{
			DualLayerConsensus:         true,
			MicroscopicFees:            true,
			InstantFinality:            true,
			ComputationalOrchestration: false,
		},
	},
	"principalis": {
		ChainID:  42,
		URL:      "wss://mainnet.omne.org",
		GasPrice: NewQuar(big.NewInt(1000)), // 1000 quar per gas
		Features: NetworkFeatures{
			DualLayerConsensus:         true,
			MicroscopicFees:            true,
			InstantFinality:            true,
			ComputationalOrchestration: true,
		},
	},
}

// NetworkConfig represents configuration for a specific network
type NetworkConfig struct {
	ChainID  int64           `json:"chainId"`
	URL      string          `json:"url"`
	GasPrice *Quar           `json:"gasPrice"`
	Features NetworkFeatures `json:"features"`
}

// NewClientForNetwork creates a client for a predefined network
func NewClientForNetwork(network string) (*Client, error) {
	config, exists := NetworkConfigs[network]
	if !exists {
		return nil, fmt.Errorf("unknown network: %s", network)
	}

	return NewClient(config.URL)
}

// GetSDKInfo returns information about the SDK
func GetSDKInfo() map[string]interface{} {
	return map[string]interface{}{
		"name":              Name,
		"version":           Version,
		"quarPrecision":     QuarPrecision,
		"supportedNetworks": []string{"primum", "testum", "principalis"},
		"features": map[string]bool{
			"hdWallets":          true,
			"bip39":              true,
			"bip44":              true,
			"secp256k1":          true,
			"jsonRPC":            true,
			"websockets":         true,
			"orc20Tokens":        true,
			"computationalJobs":  true,
			"microscopicFees":    true,
			"dualLayerConsensus": true,
		},
	}
}

// GenerateBlockHash generates Omne block hash with bh_ prefix
func GenerateBlockHash() string {
	return "bh_" + generateRandomHex(60)
}

// GenerateTransactionHash generates Omne transaction hash with tx_ prefix
func GenerateTransactionHash() string {
	return "tx_" + generateRandomHex(60)
}

// IsValidBlockHash validates Omne block hash format
func IsValidBlockHash(hash string) bool {
	if len(hash) != 63 || !strings.HasPrefix(hash, "bh_") {
		return false
	}

	hexPart := hash[3:]
	matched, _ := regexp.MatchString("^[0-9a-fA-F]{60}$", hexPart)
	return matched
}

// IsValidTransactionHash validates Omne transaction hash format
func IsValidTransactionHash(hash string) bool {
	if len(hash) != 63 || !strings.HasPrefix(hash, "tx_") {
		return false
	}

	hexPart := hash[3:]
	matched, _ := regexp.MatchString("^[0-9a-fA-F]{60}$", hexPart)
	return matched
}

// generateRandomHex generates random hex string of specified length
func generateRandomHex(length int) string {
	bytes := make([]byte, length/2)
	rand.Read(bytes)
	return fmt.Sprintf("%x", bytes)
}
