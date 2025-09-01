"""
Basic usage example for Omne Python SDK

This example demonstrates fundamental operations:
- Connecting to Omne network
- Wallet creation and management
- Balance checking
- Simple transactions
"""

import asyncio
from decimal import Decimal
from omne_sdk import OmneClient, Wallet


async def basic_usage_example():
    """Demonstrate basic Omne SDK usage"""
    
    print("🚀 Omne Python SDK - Basic Usage Example")
    print("=" * 50)
    
    # Connect to Omne network
    client = OmneClient("http://localhost:8545")
    
    try:
        # Get network information
        print("\n📡 Network Information:")
        network_info = await client.get_network_info()
        print(f"  Network: {network_info.network_name}")
        print(f"  Chain ID: {network_info.chain_id}")
        print(f"  API Version: {network_info.api_version}")
        print(f"  ORC-20 Enabled: {network_info.features.get('orc20Enabled', False)}")
        print(f"  OON Enabled: {network_info.features.get('oonEnabled', False)}")
        
        # Generate new wallet
        print("\n🔐 Wallet Generation:")
        wallet = Wallet.generate()
        print(f"  Address: {wallet.address}")
        print(f"  Mnemonic: {wallet.mnemonic}")
        
        # Get multiple accounts from wallet
        print("\n👥 Account Derivation:")
        for i in range(3):
            account = wallet.get_account(i)
            print(f"  Account {i}: {account.address}")
        
        # Check balance (will be 0 for new address)
        print("\n💰 Balance Check:")
        balance = await client.get_balance(wallet.address)
        print(f"  Balance: {balance.omc} OMC ({balance.quar:,} quar)")
        print(f"  Last Updated: Block #{balance.last_updated}")
        
        # Demonstrate utility functions
        print("\n🔧 Utility Functions:")
        test_amounts = [1.0, 0.5, 0.001, 10.5]
        for amount in test_amounts:
            quar = client.to_quar(amount)
            back_to_omc = client.from_quar(quar)
            print(f"  {amount} OMC = {quar:,} quar = {back_to_omc} OMC")
        
        # Address validation
        print("\n✅ Address Validation:")
        test_addresses = [
            wallet.address,
            "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
            "invalid_address",
            "0x123"  # Too short
        ]
        
        for addr in test_addresses:
            is_valid = client.is_valid_address(addr)
            status = "✅ Valid" if is_valid else "❌ Invalid"
            print(f"  {addr}: {status}")
        
        # Get current gas price
        print("\n⛽ Gas Information:")
        gas_price = await client.get_gas_price()
        print(f"  Current gas price: {gas_price:,} quar per gas")
        print(f"  Standard transfer cost: ~{21000 * gas_price:,} quar")
        print(f"  Standard transfer cost: ~{client.from_quar(21000 * gas_price)} OMC")
        
        # Get latest block
        print("\n📦 Latest Block:")
        latest_block = await client.get_block("latest")
        print(f"  Block Number: #{latest_block.number}")
        print(f"  Block Hash: {latest_block.hash}")
        print(f"  Timestamp: {latest_block.timestamp}")
        print(f"  Layer: {latest_block.layer}")
        print(f"  Transactions: {latest_block.transaction_count}")
        
        print("\n✅ Basic usage example completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("Make sure Omne node is running on localhost:8545")
        
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(basic_usage_example())
