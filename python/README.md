# Omne Python SDK

Official Python SDK for Omne Blockchain - the commerce-first blockchain with dual-layer consensus and external revenue integration.

## Features

- **Comprehensive Blockchain Integration**: Full access to Omne's dual-layer PoVERA consensus
- **Microscopic Fee Support**: Native quar-precision gas calculations with cross-subsidization
- **ORC-20 Token Management**: Deploy and manage application tokens with governance features
- **OON Computational Jobs**: Submit and manage distributed computational workloads
- **Commerce-Optimized**: Sub-400ms transaction execution with instant finality
- **AI/ML Integration**: Built-in support for computational revenue streams
- **Type Safety**: Full typing support with Pydantic models
- **Async/Await**: Modern async/await patterns for optimal performance

## Installation

```bash
pip install omne-sdk
```

### Optional Dependencies

```bash
# For AI/ML computational services
pip install omne-sdk[ai]

# For scientific computing integration
pip install omne-sdk[scientific]

# For development
pip install omne-sdk[dev]
```

## Quick Start

```python
import asyncio
from omne_sdk import OmneClient

async def main():
    # Connect to Omne network
    client = OmneClient("http://localhost:8545")
    
    # Get network info
    network_info = await client.get_network_info()
    print(f"Connected to {network_info.network_name}")
    
    # Check balance
    balance = await client.get_balance("0x1234...")
    print(f"Balance: {balance.omc} OMC ({balance.quar} quar)")
    
    # Deploy ORC-20 token
    token_address = await client.deploy_orc20_token(
        name="My App Token",
        symbol="MAT",
        initial_supply=1_000_000
    )
    print(f"Token deployed at: {token_address}")

asyncio.run(main())
```

## Core Features

### Blockchain Operations

```python
# Send transaction with automatic gas estimation
tx_hash = await client.send_transaction(
    to="0x1234...",
    value=client.to_quar(0.1),  # 0.1 OMC
    data="0x"
)

# Wait for confirmation
receipt = await client.wait_for_transaction(tx_hash)
```

### ORC-20 Token Management

```python
# Deploy token with governance features
token = await client.deploy_orc20_token(
    name="DeFi Token",
    symbol="DFT",
    initial_supply=1_000_000,
    governance_enabled=True,
    fee_config={
        "transfer_fee_rate": 0.001,  # 0.1% fee
        "platform_fee_sharing": True
    }
)

# Transfer tokens
await token.transfer(
    to="0x5678...",
    amount=1000
)
```

### Computational Services (OON)

```python
# Submit AI/ML training job
job = await client.submit_computational_job(
    job_type="ai_training",
    data_source="s3://my-bucket/dataset.json",
    parameters={
        "model_type": "transformer",
        "epochs": 10,
        "learning_rate": 0.001
    },
    max_cost_omc=5.0
)

# Monitor job progress
async for status in client.monitor_job(job.job_id):
    print(f"Progress: {status.progress}%")
    if status.completed:
        results = await client.get_job_results(job.job_id)
        break
```

## Advanced Usage

### Wallet Management

```python
from omne_sdk import Wallet

# Generate new wallet
wallet = Wallet.generate()
print(f"Address: {wallet.address}")
print(f"Mnemonic: {wallet.mnemonic}")

# Restore from mnemonic
wallet = Wallet.from_mnemonic("word1 word2 ... word12")

# Sign transactions
signed_tx = wallet.sign_transaction(transaction)
```

### Smart Contract Interaction

```python
# Load contract
contract = client.get_contract(
    address="0x1234...",
    abi=contract_abi
)

# Call contract method
result = await contract.call("balanceOf", wallet.address)

# Send transaction to contract
tx_hash = await contract.send("transfer", {
    "to": "0x5678...",
    "amount": 1000
})
```

### Event Streaming

```python
# Subscribe to new blocks
async for block in client.subscribe_blocks():
    print(f"New block: {block.number}")

# Subscribe to token transfers
async for event in client.subscribe_events(
    contract_address="0x1234...",
    event_name="Transfer"
):
    print(f"Transfer: {event.from_address} -> {event.to_address}")
```

## Development

```bash
# Clone repository
git clone https://github.com/OmneDAO/omne-blockchain.git
cd omne-blockchain/sdk/python

# Install in development mode
pip install -e .[dev]

# Run tests
pytest

### Integration Test Environment

- The integration suite (`integration_test.py::test_with_running_node`) now spins up a short-lived validator via Docker Compose. The compose definition lives in `tests/docker/docker-compose.integration.yml` and builds the node image from the repository.
- Requirements: Docker Desktop (or compatible Linux daemon) with the Compose plugin available as `docker compose`.
- By default the session exposes the RPC endpoint on `http://127.0.0.1:18545` and the tests consume the value from `OMNE_SDK_RPC_URL`. Override the port/url via `OMNE_SDK_NODE_PORT` / `OMNE_SDK_RPC_URL` if you have local conflicts.
- Set `OMNE_SDK_NODE_IMAGE` to point at a prebuilt validator image (for example one produced in CI). Pair this with `OMNE_SDK_SKIP_BUILD=1` to skip the cargo build step during `docker compose up`.
- Set `OMNE_SDK_ENABLE_DOCKER=0` to skip container orchestration (the integration test will be automatically skipped in that mode).
- When you only need the integration target, run `pytest integration_test.py::test_with_running_node -vv` to keep feedback focused.

# Format code
black omne_sdk tests
isort omne_sdk tests

# Type checking
mypy omne_sdk
```

## Examples

See the `examples/` directory for complete examples:

- **Basic Usage**: Simple transactions and balance queries
- **Token Management**: ORC-20 deployment and management
- **AI/ML Integration**: Computational job submission
- **DeFi Applications**: Liquidity pools and trading
- **Enterprise Integration**: Supply chain and compliance

## API Reference

Full API documentation is available at [docs.omne.org/sdk/python](https://docs.omne.org/sdk/python)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Support

- **Documentation**: https://docs.omne.org
- **Discord**: https://discord.gg/omne
- **Issues**: https://github.com/OmneDAO/omne-blockchain/issues
