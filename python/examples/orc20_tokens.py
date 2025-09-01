"""
ORC-20 Token Management Example

This example demonstrates:
- ORC-20 token deployment
- Token configuration options
- Token transfers and balance checking
- Governance features
"""

import asyncio
from decimal import Decimal
from omne_sdk import OmneClient, Wallet
from omne_sdk.types import ORC20TokenConfig


async def orc20_token_example():
    """Demonstrate ORC-20 token operations"""
    
    print("🪙 Omne Python SDK - ORC-20 Token Example")
    print("=" * 50)
    
    client = OmneClient("http://localhost:8545")
    
    try:
        # Create wallets for testing
        deployer_wallet = Wallet.generate()
        user_wallet = Wallet.generate()
        
        print(f"\n👤 Deployer: {deployer_wallet.address}")
        print(f"👤 User: {user_wallet.address}")
        
        # Configure token with advanced features
        token_config = ORC20TokenConfig(
            max_supply=10_000_000,  # 10M token cap
            mintable=True,
            burnable=True,
            governance_enabled=True,
            transfer_fee_rate=0.001,  # 0.1% transfer fee
            platform_fee_sharing=True
        )
        
        print("\n🔧 Token Configuration:")
        print(f"  Max Supply: {token_config.max_supply:,}")
        print(f"  Mintable: {token_config.mintable}")
        print(f"  Governance: {token_config.governance_enabled}")
        print(f"  Transfer Fee: {token_config.transfer_fee_rate * 100}%")
        
        # Deploy ORC-20 token
        print("\n🚀 Deploying ORC-20 Token...")
        token_address = await client.deploy_orc20_token(
            name="Omne App Token",
            symbol="OAT",
            initial_supply=1_000_000,  # 1M initial supply
            decimals=18,
            description="Example application token for Omne ecosystem",
            application_type="defi",
            config=token_config,
            from_address=deployer_wallet.address,
            wallet=deployer_wallet
        )
        
        print(f"✅ Token deployed at: {token_address}")
        
        # Get token information
        print("\n📋 Token Information:")
        token_info = await client.get_token_info(token_address)
        print(f"  Name: {token_info.name}")
        print(f"  Symbol: {token_info.symbol}")
        print(f"  Decimals: {token_info.decimals}")
        print(f"  Total Supply: {token_info.total_supply:,}")
        print(f"  Description: {token_info.description}")
        print(f"  Application Type: {token_info.application_type}")
        print(f"  Features: {', '.join(token_info.features)}")
        
        # Check deployer's token balance
        print("\n💰 Token Balances:")
        deployer_balance = await client.get_token_balance(token_address, deployer_wallet.address)
        user_balance = await client.get_token_balance(token_address, user_wallet.address)
        
        print(f"  Deployer: {deployer_balance:,} {token_info.symbol}")
        print(f"  User: {user_balance:,} {token_info.symbol}")
        
        # Demonstrate token transfer
        print("\n💸 Token Transfer:")
        transfer_amount = 10_000  # 10k tokens
        
        # Note: In a real scenario, you'd need to fund accounts with OMC for gas
        print(f"  Transferring {transfer_amount:,} {token_info.symbol} to user...")
        
        # Calculate expected fee
        transfer_fee = int(transfer_amount * token_config.transfer_fee_rate)
        net_amount = transfer_amount - transfer_fee
        
        print(f"  Transfer Amount: {transfer_amount:,}")
        print(f"  Transfer Fee (0.1%): {transfer_fee:,}")
        print(f"  Net Amount: {net_amount:,}")
        
        # This would require funded accounts in a real scenario
        # tx_hash = await client.send_token_transfer(
        #     token_address=token_address,
        #     from_address=deployer_wallet.address,
        #     to_address=user_wallet.address,
        #     amount=transfer_amount,
        #     wallet=deployer_wallet
        # )
        
        print("  💡 Note: Token transfer requires funded accounts (skipped in demo)")
        
        # Demonstrate governance features
        if token_config.governance_enabled:
            print("\n🗳️  Governance Features:")
            print("  Token holders can participate in governance:")
            print("  - Proposal creation and voting")
            print("  - Parameter changes")
            print("  - Protocol upgrades")
            print("  - Fee structure modifications")
        
        # Show advanced token features
        print("\n🔥 Advanced Features:")
        print("  📈 Mintable: New tokens can be created (by authorized addresses)")
        print("  🔥 Burnable: Tokens can be permanently destroyed")
        print("  💰 Fee Sharing: Transfer fees shared with platform")
        print("  🏛️  Governance: Decentralized decision making")
        print("  🔒 Transfer Restrictions: Configurable limits and controls")
        
        # Gas optimization benefits
        print("\n⚡ Gas Optimization Benefits:")
        print("  🎯 Microscopic Fees: Inherits Omne's quar-level precision")
        print("  💰 Cross-Subsidization: 30% fee reduction from computational revenue")
        print("  🚀 Commerce Priority: Sub-400ms execution in FastVM")
        print("  📊 15% gas efficiency improvement over standard ERC-20")
        
        print("\n✅ ORC-20 token example completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("Make sure Omne node is running with ORC-20 features enabled")
        
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(orc20_token_example())
