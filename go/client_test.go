package omne

import (
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClientCreation(t *testing.T) {
	t.Run("NewClient", func(t *testing.T) {
		client, err := NewClient("http://localhost:8545")
		require.NoError(t, err)
		assert.NotNil(t, client)
		assert.Equal(t, "http://localhost:8545", client.url)
		assert.Equal(t, "ws://localhost:8545", client.wsURL)
	})

	t.Run("NewClientHTTPS", func(t *testing.T) {
		client, err := NewClient("https://mainnet.omne.org")
		require.NoError(t, err)
		assert.NotNil(t, client)
		assert.Equal(t, "wss://mainnet.omne.org", client.wsURL)
	})

	t.Run("NewClientWebSocket", func(t *testing.T) {
		client, err := NewClient("wss://testnet.omne.org")
		require.NoError(t, err)
		assert.NotNil(t, client)
		assert.Equal(t, "wss://testnet.omne.org", client.wsURL)
	})

	t.Run("InvalidURL", func(t *testing.T) {
		_, err := NewClient("://invalid-url")
		assert.Error(t, err)
	})
}

func TestTransactionValidation(t *testing.T) {
	client, err := NewClient("http://localhost:8545")
	require.NoError(t, err)

	t.Run("ValidTransaction", func(t *testing.T) {
		tx := &Transaction{
			From:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:       "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			Value:    "1000000000000000000", // 1 OMC in quar
			GasLimit: 21000,
			GasPrice: "1000", // 1000 quar per gas
			Nonce:    0,
		}

		err := client.validateTransaction(tx)
		assert.NoError(t, err)
	})

	t.Run("InvalidFromAddress", func(t *testing.T) {
		tx := &Transaction{
			From:     "invalid-address",
			To:       "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			Value:    "1000000000000000000",
			GasLimit: 21000,
			GasPrice: "1000",
			Nonce:    0,
		}

		err := client.validateTransaction(tx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid from address")
	})

	t.Run("InvalidToAddress", func(t *testing.T) {
		tx := &Transaction{
			From:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:       "invalid-to-address",
			Value:    "1000000000000000000",
			GasLimit: 21000,
			GasPrice: "1000",
			Nonce:    0,
		}

		err := client.validateTransaction(tx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid to address")
	})

	t.Run("InvalidValue", func(t *testing.T) {
		tx := &Transaction{
			From:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:       "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			Value:    "invalid-value",
			GasLimit: 21000,
			GasPrice: "1000",
			Nonce:    0,
		}

		err := client.validateTransaction(tx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid value")
	})

	t.Run("InvalidGasPrice", func(t *testing.T) {
		tx := &Transaction{
			From:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:       "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			Value:    "1000000000000000000",
			GasLimit: 21000,
			GasPrice: "invalid-gas-price",
			Nonce:    0,
		}

		err := client.validateTransaction(tx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid gas price")
	})

	t.Run("ZeroGasLimit", func(t *testing.T) {
		tx := &Transaction{
			From:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:       "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			Value:    "1000000000000000000",
			GasLimit: 0,
			GasPrice: "1000",
			Nonce:    0,
		}

		err := client.validateTransaction(tx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "gas limit must be greater than 0")
	})
}

func TestRPCStructures(t *testing.T) {
	t.Run("RPCRequest", func(t *testing.T) {
		req := &RPCRequest{
			JSONRPC: "2.0",
			Method:  "omne_getNetworkInfo",
			Params:  nil,
			ID:      1,
		}

		assert.Equal(t, "2.0", req.JSONRPC)
		assert.Equal(t, "omne_getNetworkInfo", req.Method)
		assert.Equal(t, int64(1), req.ID)
	})

	t.Run("RPCError", func(t *testing.T) {
		rpcErr := &RPCError{
			Code:    -32602,
			Message: "Invalid params",
			Data:    "Additional error data",
		}

		assert.Equal(t, -32602, rpcErr.Code)
		assert.Equal(t, "Invalid params", rpcErr.Message)
		assert.Equal(t, "RPC error -32602: Invalid params", rpcErr.Error())
	})
}

func TestNetworkInfoStructure(t *testing.T) {
	t.Run("NetworkInfo", func(t *testing.T) {
		networkInfo := &NetworkInfo{
			ChainID:     42,
			NetworkType: "principalis",
			LatestBlock: 12345,
			GasPrice: map[string]string{
				"base":     "1000",
				"commerce": "500",
				"compute":  "2000",
			},
			Features: NetworkFeatures{
				DualLayerConsensus:          true,
				MicroscopicFees:            true,
				InstantFinality:            true,
				ComputationalOrchestration: true,
			},
		}

		assert.Equal(t, int64(42), networkInfo.ChainID)
		assert.Equal(t, "principalis", networkInfo.NetworkType)
		assert.Equal(t, int64(12345), networkInfo.LatestBlock)
		assert.True(t, networkInfo.Features.DualLayerConsensus)
		assert.True(t, networkInfo.Features.MicroscopicFees)
	})
}

func TestTransactionStructure(t *testing.T) {
	t.Run("Transaction", func(t *testing.T) {
		tx := &Transaction{
			From:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:       "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			Value:    "1500000000000000000", // 1.5 OMC
			GasLimit: 21000,
			GasPrice: "1000",
			Data:     "",
			Nonce:    5,
			Priority: "commerce",
		}

		assert.Equal(t, "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e", tx.From)
		assert.Equal(t, "0x8ba1f109551bd432803012645cac136c8a96e6e8", tx.To)
		assert.Equal(t, "1500000000000000000", tx.Value)
		assert.Equal(t, uint64(21000), tx.GasLimit)
		assert.Equal(t, "commerce", tx.Priority)
	})

	t.Run("TransactionReceipt", func(t *testing.T) {
		receipt := &TransactionReceipt{
			TransactionHash:   "0xabcd1234...",
			BlockNumber:       12345,
			BlockHash:         "0x5678efgh...",
			TransactionIndex:  1,
			From:              "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			To:                "0x8ba1f109551bd432803012645cac136c8a96e6e8",
			GasUsed:           21000,
			Status:            1,
			ConfirmationTime:  280,
		}

		assert.Equal(t, "0xabcd1234...", receipt.TransactionHash)
		assert.Equal(t, int64(12345), receipt.BlockNumber)
		assert.Equal(t, uint64(21000), receipt.GasUsed)
		assert.Equal(t, 1, receipt.Status)
		assert.Equal(t, int64(280), receipt.ConfirmationTime)
	})
}

func TestORC20TokenStructure(t *testing.T) {
	t.Run("ORC20Token", func(t *testing.T) {
		token := &ORC20Token{
			Address:     "0x1234567890abcdef1234567890abcdef12345678",
			Name:        "Test Token",
			Symbol:      "TEST",
			Decimals:    18,
			TotalSupply: "1000000000000000000000000", // 1M tokens
			Config: map[string]interface{}{
				"inheritsMicroscopicFees": true,
				"mintable":               true,
				"burnable":               false,
			},
		}

		assert.Equal(t, "Test Token", token.Name)
		assert.Equal(t, "TEST", token.Symbol)
		assert.Equal(t, 18, token.Decimals)
		assert.True(t, token.Config["inheritsMicroscopicFees"].(bool))
	})
}

func TestComputationalJobStructure(t *testing.T) {
	t.Run("ComputationalJob", func(t *testing.T) {
		now := time.Now()
		completedAt := now.Add(5 * time.Minute)
		
		job := &ComputationalJob{
			JobID:   "job-12345",
			JobType: "ml_training",
			Parameters: map[string]interface{}{
				"model":        "neural_network",
				"epochs":       100,
				"learningRate": 0.001,
			},
			Status:      "completed",
			Progress:    100.0,
			Result:      "Model trained successfully",
			CostOMC:     "5.25",
			SubmittedAt: now,
			CompletedAt: &completedAt,
		}

		assert.Equal(t, "job-12345", job.JobID)
		assert.Equal(t, "ml_training", job.JobType)
		assert.Equal(t, "completed", job.Status)
		assert.Equal(t, 100.0, job.Progress)
		assert.Equal(t, "5.25", job.CostOMC)
		assert.NotNil(t, job.CompletedAt)
	})
}

func TestBalanceStructure(t *testing.T) {
	t.Run("Balance", func(t *testing.T) {
		balance := &Balance{
			Address:     "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
			BalanceOMC:  "42.5",
			BalanceQuar: "42500000000000000000",
		}

		assert.Equal(t, "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e", balance.Address)
		assert.Equal(t, "42.5", balance.BalanceOMC)
		assert.Equal(t, "42500000000000000000", balance.BalanceQuar)

		// Verify balance consistency
		expectedQuar, err := ToQuarFromOMC(balance.BalanceOMC)
		require.NoError(t, err)
		assert.Equal(t, expectedQuar.String(), balance.BalanceQuar)
	})
}

func TestClientTimeout(t *testing.T) {
	t.Run("ClientHasTimeout", func(t *testing.T) {
		client, err := NewClient("http://localhost:8545")
		require.NoError(t, err)
		
		// Verify HTTP client has timeout
		assert.Equal(t, 30*time.Second, client.httpClient.Timeout)
	})
}

func TestNetworkConfigIntegration(t *testing.T) {
	t.Run("NetworkConfigsComplete", func(t *testing.T) {
		for networkName, config := range NetworkConfigs {
			t.Run(networkName, func(t *testing.T) {
				assert.NotEmpty(t, config.URL)
				assert.True(t, config.ChainID >= 0)
				assert.NotNil(t, config.GasPrice)
				assert.True(t, config.GasPrice.Cmp(NewQuar(big.NewInt(0))) > 0)
				
				// Test client creation
				client, err := NewClientForNetwork(networkName)
				require.NoError(t, err)
				assert.NotNil(t, client)
				assert.Equal(t, config.URL, client.url)
			})
		}
	})
}
