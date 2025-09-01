# Omne Go SDK

Official Go SDK for Omne Blockchain - the commerce-first blockchain with dual-layer consensus and microscopic fees.

## Features

- 🔗 **Full Omne Integration**: Complete support for dual-layer PoVERA consensus
- 💰 **Microscopic Fees**: Quar-precision arithmetic (18-decimal precision)
- 🔐 **BIP39 HD Wallets**: Secure wallet generation and management
- 🪙 **ORC-20 Tokens**: Deploy and interact with Omne token standard
- 🤖 **Computational Jobs**: Submit work to Omne Orchestration Network (OON)
- ⚡ **High Performance**: Compiled Go performance with concurrent operations
- 🔒 **Type Safety**: Strong typing with comprehensive error handling
- 🌐 **Cross-Platform**: Works across all Go-supported platforms

## Installation

```bash
go get github.com/OmneDAO/omne-blockchain/sdk/go
```

## Quick Start

### Basic Usage

```go
package main

import (
    "context"
    "fmt"
    "log"

    "github.com/OmneDAO/omne-blockchain/sdk/go"
)

func main() {
    // Connect to Omne network
    client, err := omne.NewClientForNetwork("testum")
    if err != nil {
        log.Fatal(err)
    }
    defer client.Close()

    // Create or generate wallet
    wallet, err := omne.GenerateWallet()
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Address: %s\n", wallet.GetAddress())
    fmt.Printf("Mnemonic: %s\n", wallet.GetMnemonic())

    // Get network information
    ctx := context.Background()
    networkInfo, err := client.GetNetworkInfo(ctx)
    if err != nil {
        log.Fatal(err)
    }

    fmt.Printf("Chain ID: %d\n", networkInfo.ChainID)
    fmt.Printf("Latest block: %d\n", networkInfo.LatestBlock)
}
```

### Send Transaction

```go
// Send OMC with microscopic fees
ctx := context.Background()
receipt, err := client.Transfer(ctx, 
    wallet.GetAddress(),
    "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
    "0.001", // 0.001 OMC
    "commerce", // Use 3-second commerce layer
)
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Transaction confirmed: %s\n", receipt.TransactionHash)
fmt.Printf("Gas used: %d\n", receipt.GasUsed)
fmt.Printf("Confirmation time: %d ms\n", receipt.ConfirmationTime)
```

### Deploy ORC-20 Token

```go
// Deploy token with microscopic fee inheritance
config := map[string]interface{}{
    "inheritsMicroscopicFees": true, // 50% fee discount
    "mintable":               true,
    "burnable":               false,
}

token, err := client.DeployORC20Token(ctx,
    "My App Token",  // name
    "MAT",          // symbol
    "1000000",      // totalSupply
    config,
)
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Token deployed at: %s\n", token.Address)

// Calculate deployment cost
gasCost := omne.CalculateGasCost(350000, omne.NewQuar(big.NewInt(1000)))
fmt.Printf("Deployment cost: %s\n", omne.FormatBalance(gasCost, 6))
```

### Quar Precision Arithmetic

```go
// Convert between OMC and quar (18-decimal precision)
omcAmount := "1.5"
quarAmount, err := omne.ToQuarFromOMC(omcAmount)
if err != nil {
    log.Fatal(err)
}
fmt.Printf("%s OMC = %s quar\n", omcAmount, quarAmount.String())

backToOMC := quarAmount.ToOMC()
fmt.Printf("Back to OMC: %s\n", backToOMC.String())

// Format for display
formatted := omne.FormatBalance(quarAmount, 6)
fmt.Printf("Formatted: %s\n", formatted) // "1.500000 OMC"

// Address consistency across SDKs
address := "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"
checksumAddr, err := omne.ToChecksumAddress(address)
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Checksum address: %s\n", checksumAddr) // "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"

// Commerce calculations with high precision
coffeePrice, _ := omne.ToQuarFromOMC("0.003")
gasPrice := omne.NewQuar(big.NewInt(1000)) // 1000 quar per gas
gasCost := omne.CalculateGasCost(21000, gasPrice)
totalCost := coffeePrice.Add(gasCost)

fmt.Printf("Coffee + gas: %s\n", omne.FormatBalance(totalCost, 8))
```

### HD Wallet Management

```go
// Generate new wallet
wallet, err := omne.GenerateWallet()
if err != nil {
    log.Fatal(err)
}

// Import from mnemonic
imported, err := omne.NewWallet(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
)
if err != nil {
    log.Fatal(err)
}

// Derive multiple accounts
accounts, err := wallet.GetAccounts(5) // Get first 5 accounts
if err != nil {
    log.Fatal(err)
}

for i, account := range accounts {
    fmt.Printf("Account %d: %s\n", i, account.GetAddress())
    fmt.Printf("  Path: %s\n", account.GetPath())
}

// Sign transactions
account, _ := wallet.GetAccount(0)
message := "Hello, Omne!"
signature, err := account.SignMessage(message)
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Signature length: %d bytes\n", len(signature))
```

### Submit Computational Job

```go
// Submit AI/ML job to Omne Orchestration Network
parameters := map[string]interface{}{
    "model":        "neural_network",
    "epochs":       100,
    "learningRate": 0.001,
    "dataSource":   "https://example.com/dataset.csv",
}

job, err := client.SubmitComputationalJob(ctx,
    "ml_training", // jobType
    parameters,
    "10.0",       // maxCostOMC
)
if err != nil {
    log.Fatal(err)
}

fmt.Printf("Job submitted: %s\n", job.JobID)
fmt.Printf("Status: %s\n", job.Status)

// Monitor job progress
status, err := client.GetJobStatus(ctx, job.JobID)
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Progress: %.1f%%\n", status.Progress)
```

## Network Configuration

### Supported Networks

| Network | Chain ID | Description | URL |
|---------|----------|-------------|-----|
| Primum | 0 | Local development | `ws://localhost:8545` |
| Testum | 1 | Public testnet | `wss://testnet.omne.org` |
| Principalis | 42 | Mainnet | `wss://mainnet.omne.org` |

### Custom Network

```go
client, err := omne.NewClient("wss://custom.omne.network")
if err != nil {
    log.Fatal(err)
}
defer client.Close()
```

### Network Configurations

```go
// Access predefined network configurations
config := omne.NetworkConfigs["testum"]
fmt.Printf("Chain ID: %d\n", config.ChainID)
fmt.Printf("Gas Price: %s quar\n", config.GasPrice.String())
fmt.Printf("Dual-layer consensus: %t\n", config.Features.DualLayerConsensus)

// Create client with network defaults
client, err := omne.NewClientForNetwork("principalis")
```

## Error Handling

```go
import (
    "context"
    "errors"
    "fmt"
    
    "github.com/OmneDAO/omne-blockchain/sdk/go"
)

func handleTransfer() error {
    client, err := omne.NewClientForNetwork("testum")
    if err != nil {
        return fmt.Errorf("failed to create client: %w", err)
    }
    defer client.Close()

    ctx := context.Background()
    _, err = client.Transfer(ctx, "invalid-address", "0x...", "1.0", "commerce")
    if err != nil {
        // Check for specific error types
        var rpcErr *omne.RPCError
        if errors.As(err, &rpcErr) {
            fmt.Printf("RPC Error %d: %s\n", rpcErr.Code, rpcErr.Message)
        } else {
            fmt.Printf("Transfer error: %s\n", err.Error())
        }
        return err
    }
    
    return nil
}
```

## Concurrent Operations

Go's excellent concurrency makes it ideal for blockchain applications:

```go
import (
    "context"
    "sync"
    
    "github.com/OmneDAO/omne-blockchain/sdk/go"
)

func processMultipleTransfers(client *omne.Client, transfers []TransferRequest) {
    var wg sync.WaitGroup
    ctx := context.Background()
    
    for _, transfer := range transfers {
        wg.Add(1)
        go func(tr TransferRequest) {
            defer wg.Done()
            
            receipt, err := client.Transfer(ctx, tr.From, tr.To, tr.Amount, "commerce")
            if err != nil {
                fmt.Printf("Transfer failed: %s\n", err)
                return
            }
            
            fmt.Printf("Transfer successful: %s\n", receipt.TransactionHash)
        }(transfer)
    }
    
    wg.Wait()
}
```

## Type Safety

The Go SDK provides comprehensive type safety:

```go
// All network info is strongly typed
networkInfo, err := client.GetNetworkInfo(ctx)
if err != nil {
    log.Fatal(err)
}

// Type-safe access to network features
if networkInfo.Features.DualLayerConsensus {
    fmt.Println("Network supports dual-layer consensus")
}

// Compile-time verification of gas price calculations
gasPrice := omne.NewQuar(big.NewInt(1000))
gasCost := omne.CalculateGasCost(21000, gasPrice)
// gasCost is guaranteed to be *omne.Quar type
```

## Performance

Go SDK performance characteristics:

- **Wallet Generation**: ~50ms average (optimized cryptographic operations)
- **Transaction Signing**: ~20ms average (native secp256k1 implementation)
- **Address Validation**: <1ms per operation
- **Memory Usage**: ~8MB typical footprint (efficient Go runtime)
- **Concurrent Operations**: Excellent scaling with goroutines

## Examples

Check the `examples/` directory for complete usage examples:

- `basic-usage/` - Wallet creation, transactions, quar calculations
- `orc20-tokens/` - Token deployment and management
- `computational-jobs/` - Submit work to OON
- `concurrent-processing/` - High-performance concurrent operations

## API Reference

### Core Types

- **`Client`** - Main blockchain client with JSON-RPC and WebSocket support
- **`Wallet`** - BIP39 HD wallet implementation
- **`Account`** - Individual account with signing capabilities
- **`Quar`** - High-precision arithmetic for microscopic fees

### Key Functions

- **`NewClient(url)`** - Create client with custom URL
- **`NewClientForNetwork(network)`** - Create client with network defaults
- **`GenerateWallet()`** - Generate new BIP39 wallet
- **`ToQuarFromOMC(omc)`** - Convert OMC to quar precision
- **`FormatBalance(quar, decimals)`** - Format for display
- **`IsValidAddress(address)`** - Validate address format
- **`NormalizeAddress(address)`** - Convert to lowercase with 0x prefix
- **`ToChecksumAddress(address)`** - Convert to EIP-55 checksum format

### Constants

- **`QuarPrecision`** - Number of decimal places (18)
- **`QuarPerOMC`** - Conversion factor (10^18)
- **`NetworkConfigs`** - Predefined network configurations

## Development

### Building

```bash
go build ./...
```

### Testing

```bash
go test ./...
```

### Running Tests with Coverage

```bash
go test -cover ./...
```

### Benchmarking

```bash
go test -bench=. ./...
```

## SDK Information

```go
info := omne.GetSDKInfo()
fmt.Printf("SDK: %s v%s\n", info["name"], info["version"])
fmt.Printf("Quar precision: %d decimals\n", info["quarPrecision"])

// Check feature support
features := info["features"].(map[string]bool)
if features["hdWallets"] {
    fmt.Println("HD wallets supported")
}
```

## License

MIT - see LICENSE file for details

## Support

- Documentation: https://docs.omne.org/sdk/go
- Discord: https://discord.gg/omne
- GitHub Issues: https://github.com/OmneDAO/omne-blockchain/issues
