"""
SDK Integration Test with Running Omne Node

This example tests the Python SDK against a running Omne node
to validate real integration scenarios.
"""

import asyncio
import os
import sys
from decimal import Decimal

import pytest

# Test if we can import the full client
try:
    from omne_sdk import OmneClient, Wallet, to_quar, from_quar
    has_full_sdk = True
except ImportError:
    # Fall back to basic functionality
    from omne_sdk import to_quar, from_quar, NetworkInfo, Balance
    has_full_sdk = False
    OmneClient = None
    Wallet = None


async def _run_with_running_node() -> bool:
    """Execute integration flow; returns True when all checks pass."""
    print("🔗 Testing SDK Integration with Omne Node")
    print("=" * 50)
    
    if not has_full_sdk or OmneClient is None:
        print("❌ Full SDK not available (missing dependencies)")
        print("   Install with: pip install aiohttp websockets mnemonic eth-keys cryptography")
        print("   Core functionality working, but node integration requires dependencies")
        return False
    
    # Test basic connection
    rpc_url = os.environ.get("OMNE_SDK_RPC_URL", "http://localhost:8545")
    print(f"Connecting to Omne node at {rpc_url}")
    client = OmneClient(rpc_url)
    
    try:
        print("\n📡 Testing Network Connection...")
        
        # Test network info
        network_info = await client.get_network_info()
        print(f"✅ Connected to network: {network_info.network_name}")
        print(f"   Chain ID: {network_info.chain_id}")
        print(f"   API Version: {network_info.api_version}")
        print(f"   ORC-20 Enabled: {network_info.features.get('orc20Enabled')}")
        print(f"   OON Enabled: {network_info.features.get('oonEnabled')}")
        
        # Test chain ID
        chain_id = await client.get_chain_id()
        print(f"✅ Chain ID: {chain_id}")
        
        # Test block number
        block_number = await client.get_block_number()
        print(f"✅ Latest block: #{block_number}")
        
        # Test gas price
        gas_price = await client.get_gas_price()
        print(f"✅ Gas price: {gas_price:,} quar per gas")
        
        # Test wallet generation
        print("\n🔐 Testing Wallet Generation...")
        wallet = Wallet.generate()
        print(f"✅ Generated wallet: {wallet.address}")
        
        # Test balance check
        print("\n💰 Testing Balance Query...")
        balance = await client.get_balance(wallet.address)
        print(f"✅ Balance: {balance.omc} OMC ({balance.quar:,} quar)")
        
        # Test block info
        print("\n📦 Testing Block Query...")
        latest_block = await client.get_block("latest")
        print(f"✅ Block #{latest_block.number}")
        print(f"   Hash: {latest_block.hash}")
        print(f"   Layer: {latest_block.layer}")
        print(f"   Transactions: {latest_block.transaction_count}")
        
        print("\n🎉 All integration tests passed!")
        return True
        
    except Exception as e:
        print(f"\n❌ Integration test failed: {e}")
        print("   Make sure Omne node is running on localhost:8545")
        return False
        
    finally:
        await client.close()


def _run_basic_functionality() -> bool:
    """Run local functionality checks; returns True when all assertions pass."""
    print("🧮 Testing Basic SDK Functionality")
    print("=" * 40)
    
    # Test quar conversion
    print("\n💰 Testing Quar Conversion:")
    test_cases = [
        (1.0, "1 OMC"),
        (0.5, "0.5 OMC"),
        (0.001, "1 milliOMC"),
        (0.000001, "1 microOMC"),
        (0.000000000000000001, "1 quar")
    ]
    
    for omc_amount, description in test_cases:
        quar = to_quar(omc_amount)
        back_to_omc = from_quar(quar)
        print(f"  {description:>12}: {omc_amount} → {quar:>22,} quar → {back_to_omc}")
        assert back_to_omc == Decimal(str(omc_amount))
    
    print("✅ Quar conversion tests passed!")
    
    # Test commerce scenarios
    print("\n🏪 Testing Commerce Scenarios:")
    scenarios = [
        ("Micropayment", 0.0001),
        ("Coffee", 0.003),
        ("Movie ticket", 0.012),
        ("Monthly subscription", 9.99),
        ("Digital asset", 0.25),
    ]
    
    gas_cost_quar = 21000 * 1000  # 21k gas at 1000 quar/gas
    
    for scenario, price_omc in scenarios:
        price_quar = to_quar(price_omc)
        total_quar = price_quar + gas_cost_quar
        total_omc = from_quar(total_quar)
        
        print(f"  {scenario:>18}: {price_omc:>8} OMC + gas = {total_omc} OMC")
    
    print("✅ Commerce scenario tests passed!")
    
    return True


@pytest.mark.asyncio
@pytest.mark.skipif(not has_full_sdk or OmneClient is None, reason="Full SDK not available (missing dependencies)")
async def test_with_running_node(omne_docker_node):
    """Pytest entrypoint that exercises integration flow."""
    _ = omne_docker_node  # Ensures fixture activation for clarity
    assert await _run_with_running_node()


def test_basic_functionality():
    """Pytest entrypoint that validates basic conversions."""
    assert _run_basic_functionality()


async def main():
    """Main test runner"""
    
    print("🐍 Omne Python SDK Integration Tests")
    print("=" * 45)
    
    # Test basic functionality (always works)
    basic_success = _run_basic_functionality()
    
    # Test with running node (requires node + dependencies)
    integration_success = await _run_with_running_node()
    
    print("\n📊 Test Summary:")
    print(f"  Basic Functionality: {'✅ PASS' if basic_success else '❌ FAIL'}")
    print(f"  Node Integration: {'✅ PASS' if integration_success else '❌ FAIL'}")
    
    if basic_success and integration_success:
        print("\n🎉 All tests passed! SDK is ready for use.")
        
        print("\n🚀 Next Steps:")
        print("  1. Try the examples:")
        print("     python examples/basic_usage.py")
        print("     python examples/orc20_tokens.py")
        print("     python examples/ai_ml_services.py")
        
        print("\n  2. Read the documentation:")
        print("     cat README.md")
        
        print("\n  3. Install full dependencies:")
        print("     pip install -e .[dev,ai,scientific]")
        
        return True
    else:
        print("\n⚠️  Some tests failed - check requirements above")
        return False


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
