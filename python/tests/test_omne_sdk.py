"""
Comprehensive test suite for Omne Python SDK
"""

import pytest
import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from omne_sdk import (
    OmneClient, Wallet, Account,
    NetworkInfo, Balance, Transaction, ORC20Token, ORC20TokenConfig,
    to_quar, from_quar, is_valid_address
)
from omne_sdk.exceptions import NetworkError, ValidationError, OmneSDKError


class TestUtils:
    """Test utility functions"""
    
    def test_quar_conversion(self):
        """Test OMC <-> quar conversion"""
        # Test to_quar
        assert to_quar(1) == 1_000_000_000_000_000_000
        assert to_quar(0.001) == 1_000_000_000_000_000
        assert to_quar("0.5") == 500_000_000_000_000_000
        
        # Test from_quar
        assert from_quar(1_000_000_000_000_000_000) == Decimal('1.0')
        assert from_quar(500_000_000_000_000_000) == Decimal('0.5')
        assert from_quar(1_000_000_000_000_000) == Decimal('0.001')
    
    def test_address_validation(self):
        """Test address validation"""
        # Valid addresses
        assert is_valid_address("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e")
        assert is_valid_address("742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e")
        
        # Invalid addresses
        assert not is_valid_address("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84")  # Too short
        assert not is_valid_address("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84ex")  # Invalid hex
        assert not is_valid_address("0x742D35CC4BF688AEE6F7C3C3A6B1C98AAEE5E84E")  # Uppercase hex rejected
        assert not is_valid_address("omne1" + "AB" * 20)  # Uppercase Omne rejected
        assert not is_valid_address("not_an_address")


class TestWallet:
    """Test wallet functionality"""
    
    def test_wallet_generation(self):
        """Test wallet generation with mnemonic"""
        wallet = Wallet.generate()
        
        # Check mnemonic
        words = wallet.get_mnemonic_words()
        assert len(words) == 12  # 128-bit entropy = 12 words
        assert all(isinstance(word, str) for word in words)
        
        # Check address format - should be Omne format now
        assert wallet.address.startswith('omne1')
        assert len(wallet.address) > 5
        assert is_valid_address(wallet.address)
    
    def test_wallet_from_mnemonic(self):
        """Test wallet restoration from mnemonic"""
        # Generate wallet
        wallet1 = Wallet.generate()
        mnemonic = wallet1.mnemonic
        
        # Restore wallet
        wallet2 = Wallet(mnemonic)
        
        # Should have same address
        assert wallet1.address == wallet2.address
    
    def test_account_derivation(self):
        """Test account derivation from wallet"""
        wallet = Wallet.generate()
        
        # Get multiple accounts
        account0 = wallet.get_account(0)
        account1 = wallet.get_account(1)
        account2 = wallet.get_account(2)
        
        # Should be different addresses
        assert account0.address != account1.address
        assert account1.address != account2.address
        
        # All should be Omne format
        assert account0.address.startswith('omne1')
        assert account1.address.startswith('omne1')
        assert account2.address.startswith('omne1')

    def test_omne_address_conversion(self):
        """Test Omne address encoding/decoding"""
        from omne_sdk.utils import to_omne_address, from_omne_address
        
        # Test with known bytes
        test_bytes = bytes([0x74, 0x2d, 0x35, 0xcc, 0x4b, 0xf6, 0x88, 0xae, 0xe6, 0xf7, 
                           0xc3, 0xc3, 0xa6, 0xb1, 0xc9, 0x8a, 0xae, 0xe5, 0xe8, 0x4e])
        
        # Convert to Omne address
        omne_addr = to_omne_address(test_bytes)
        assert omne_addr.startswith('omne1')
        assert is_valid_address(omne_addr)
        
        # Round-trip conversion
        decoded_bytes = from_omne_address(omne_addr)
        assert decoded_bytes == test_bytes
        
        # Test invalid addresses
        with pytest.raises(ValueError):
            from_omne_address("invalid")
        
        with pytest.raises(ValueError):
            from_omne_address("0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e")

        with pytest.raises(ValueError):
            from_omne_address("omne1" + ("AB" * 20))
    
    def test_private_key_import(self):
        """Test direct private key import"""
        # Generate account from wallet
        wallet = Wallet.generate()
        wallet_account = wallet.get_account(0)
        
        # Import same private key
        imported_account = Wallet.from_private_key(wallet_account.private_key_hex)
        
        # Should have same address
        assert wallet_account.address == imported_account.address
    
    def test_transaction_signing(self):
        """Test transaction signing"""
        wallet = Wallet.generate()
        account = wallet.get_account(0)
        
        transaction = Transaction(
            **{
                "from": account.address,
                "to": "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
                "value_quar": to_quar(1.0),
                "gas_limit": 21000,
                "gas_price_quar": 1000,
                "nonce": 0,
                "data": "0x"
            }
        )
        
        # Sign transaction
        signature = account.sign_transaction(transaction)
        
        # Should be hex string
        assert signature.startswith('0x')
        assert len(signature) > 100  # Typical signature length
    
    def test_keystore_export_import(self):
        """Test keystore export and import"""
        account = Wallet.generate().get_account(0)
        original_address = account.address
        
        # Create wallet for export
        wallet = Wallet.generate()
        
        # Test unencrypted export
        keystore = wallet.export_account(0, password="")
        assert not keystore["encrypted"]
        
        imported_account = Wallet.import_keystore(keystore, "")
        assert imported_account.address == wallet.address
        
        # Test encrypted export
        password = "test_password_123"
        encrypted_keystore = wallet.export_account(0, password=password)
        assert encrypted_keystore["encrypted"]
        
        imported_account = Wallet.import_keystore(encrypted_keystore, password)
        assert imported_account.address == wallet.address


class TestOmneClient:
    """Test Omne client functionality"""
    
    @pytest.fixture
    def mock_client(self):
        """Create mock client for testing"""
        client = OmneClient("http://localhost:8545")
        client._session = AsyncMock()
        return client
    
    @pytest.mark.asyncio
    async def test_network_info(self, mock_client):
        """Test network info retrieval"""
        # Mock response
        mock_response = {
            "chainId": 0,
            "networkName": "Primum",
            "apiVersion": "1.0.0",
            "gasPricePolicy": {
                "baseFeeQuar": 1000,
                "priorityFeeEnabled": True,
                "subsidizationActive": True,
                "maxFeeSpikeMultiplier": 2.0
            },
            "features": {
                "orc20Enabled": True,
                "oonEnabled": True,
                "crossChainEnabled": False
            }
        }
        
        with patch.object(mock_client, '_make_request', return_value=mock_response):
            network_info = await mock_client.get_network_info()
            
            assert isinstance(network_info, NetworkInfo)
            assert network_info.chain_id == 0
            assert network_info.network_name == "Primum"
            assert network_info.features["orc20Enabled"] is True
    
    @pytest.mark.asyncio
    async def test_balance_retrieval(self, mock_client):
        """Test balance retrieval"""
        address = "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e"
        mock_response = {
            "balance": str(to_quar(5.5)),  # 5.5 OMC
            "lastUpdated": 12345
        }
        
        with patch.object(mock_client, '_make_request', return_value=mock_response):
            balance = await mock_client.get_balance(address)
            
            assert isinstance(balance, Balance)
            assert balance.address == address
            assert balance.omc == Decimal('5.5')
            assert balance.quar == to_quar(5.5)
            assert balance.last_updated == 12345
    
    @pytest.mark.asyncio
    async def test_transaction_sending(self, mock_client):
        """Test transaction sending"""
        from_addr = "omne10123456789abcdef0123456789abcdef01234567"
        to_addr = "omne189abcdef0123456789abcdef0123456789abcdef"
        
        # Mock responses
        with patch.object(mock_client, 'get_nonce', return_value=5):
            with patch.object(mock_client, 'estimate_gas', return_value=21000):
                with patch.object(mock_client, 'get_gas_price', return_value=1000):
                    with patch.object(mock_client, '_make_request', return_value={"transactionHash": "0xabc123"}):
                        
                        tx_hash = await mock_client.send_transaction(
                            from_address=from_addr,
                            to_address=to_addr,
                            value_omc=1.0
                        )
                        
                        assert tx_hash == "0xabc123"
    
    @pytest.mark.asyncio
    async def test_orc20_deployment(self, mock_client):
        """Test ORC-20 token deployment"""
        mock_response = {
            "contractAddress": "0x456d35cc4bf688aee6f7c3c3a6b1c98aaee5e456"
        }
        
        with patch.object(mock_client, '_make_request', return_value=mock_response):
            contract_address = await mock_client.deploy_orc20_token(
                name="Test Token",
                symbol="TEST",
                initial_supply=1000000,
                config=ORC20TokenConfig(
                    governance_enabled=True,
                    transfer_fee_rate=0.001
                )
            )
            
            assert contract_address == mock_response["contractAddress"]
    
    @pytest.mark.asyncio
    async def test_computational_job_submission(self, mock_client):
        """Test computational job submission"""
        from omne_sdk.types import ComputationalJobRequest, JobType
        
        job_request = ComputationalJobRequest(
            job_type=JobType.AI_TRAINING,
            data_source="s3://test-bucket/dataset.json",
            parameters={"epochs": 10, "learning_rate": 0.001},
            max_cost_omc=Decimal("5.0")
        )
        
        mock_response = {
            "jobId": "job_123456",
            "submitter": "0x742d35cc4bf688aee6f7c3c3a6b1c98aaee5e84e",
            "jobType": "ai_training",
            "status": "submitted",
            "createdAt": 1693526400
        }
        
        with patch.object(mock_client, '_make_request', return_value=mock_response):
            job = await mock_client.submit_computational_job(job_request)
            
            assert job.job_id == "job_123456"
            assert job.job_type == JobType.AI_TRAINING
            assert job.status.value == "submitted"
    
    @pytest.mark.asyncio
    async def test_error_handling(self, mock_client):
        """Test error handling"""
        # Test network error
        with patch.object(mock_client, '_make_request', side_effect=NetworkError("Connection failed")):
            with pytest.raises(NetworkError):
                await mock_client.get_chain_id()
        
        # Test validation error
        with pytest.raises(ValueError):
            await mock_client.get_balance("invalid_address")


class TestIntegration:
    """Integration tests requiring running Omne node"""
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_end_to_end_workflow(self):
        """Test complete workflow with real node"""
        # This test requires a running Omne node
        client = OmneClient("http://localhost:8545")
        
        try:
            # Test network connection
            network_info = await client.get_network_info()
            assert network_info.chain_id is not None
            
            # Generate wallet
            wallet = Wallet.generate()
            address = wallet.address
            
            # Check balance (should be 0 for new address)
            balance = await client.get_balance(address)
            assert balance.omc >= 0
            
            print(f"✅ Integration test passed - Connected to {network_info.network_name}")
            
        except NetworkError:
            pytest.skip("Omne node not available for integration test")
        finally:
            await client.close()


class TestPerformance:
    """Performance and stress tests"""
    
    @pytest.mark.performance
    def test_wallet_generation_performance(self):
        """Test wallet generation performance"""
        import time
        
        start_time = time.time()
        wallets = [Wallet.generate() for _ in range(10)]
        end_time = time.time()
        
        assert len(wallets) == 10
        assert all(wallet.address.startswith('omne1') for wallet in wallets)
        
        generation_time = end_time - start_time
        print(f"Generated 10 wallets in {generation_time:.3f} seconds")
        assert generation_time < 5.0  # Should be fast
    
    @pytest.mark.performance
    @pytest.mark.asyncio
    async def test_concurrent_requests(self):
        """Test concurrent request handling"""
        client = OmneClient("http://localhost:8545")
        
        # Mock multiple concurrent requests
        with patch.object(client, '_make_request', return_value=42) as mock_request:
            
            # Make 50 concurrent requests
            tasks = [client.get_chain_id() for _ in range(50)]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # All should succeed
            assert all(result == 42 for result in results)
            assert mock_request.call_count == 50
        
        await client.close()


# Test configuration
def pytest_configure(config):
    """Configure pytest markers"""
    config.addinivalue_line("markers", "integration: integration tests requiring running node")
    config.addinivalue_line("markers", "performance: performance and stress tests")


if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])
