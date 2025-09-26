"""
Main client for interacting with Omne blockchain
"""

import asyncio
import json
from typing import Optional, Dict, Any, List, Union, AsyncIterator
from decimal import Decimal
import aiohttp
import websockets

from .types import (
    NetworkInfo, Balance, Transaction, TransactionReceipt, Block,
    ORC20Token, ORC20TokenConfig, ComputationalJob, ComputationalJobRequest,
    JobStatus, NodeInfo, NetworkType, TransactionStatus,
    DynamicStakeInfo, FeeEstimation, ValidatorPerformance, ValidatorRewards,
    NetworkMetrics, OptimalStakeEstimate
)
from .wallet import Wallet, Account
from .utils import to_quar, from_quar, parse_address, is_valid_address
from .exceptions import (
    NetworkError, TransactionError, ValidationError, 
    InsufficientFundsError, JobExecutionError
)
from .security import SecurityConfig, SecureRequestIDGenerator, create_secure_session, default_security_config


class OmneClient:
    """
    Main client for interacting with Omne blockchain
    
    Provides comprehensive access to Omne's dual-layer consensus,
    microscopic fee system, ORC-20 tokens, and computational services.
    """
    
    def __init__(
        self,
        rpc_url: str = "http://localhost:8545",
        ws_url: Optional[str] = None,
        timeout: int = 30,
        max_retries: int = 3,
        security_config: Optional[SecurityConfig] = None
    ):
        """
        Initialize Omne client
        
        Args:
            rpc_url: HTTP RPC endpoint URL
            ws_url: WebSocket endpoint URL (optional)
            timeout: Request timeout in seconds (deprecated, use security_config)
            max_retries: Maximum retry attempts (deprecated, use security_config)
            security_config: Security configuration object
        """
        self.rpc_url = rpc_url
        self.ws_url = ws_url or rpc_url.replace('http', 'ws')
        
        # Use provided security config or create default
        if security_config is None:
            self.security_config = default_security_config()
            # Apply legacy parameters if provided
            if timeout != 30:
                self.security_config.request_timeout = timeout
            if max_retries != 3:
                self.security_config.max_retries = max_retries
        else:
            self.security_config = security_config
            
        self._session: Optional[aiohttp.ClientSession] = None
        self._ws_connection: Optional[websockets.WebSocketServerProtocol] = None
        self._id_generator = SecureRequestIDGenerator()
        
    async def __aenter__(self):
        """Async context manager entry"""
        await self._ensure_session()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit"""
        await self.close()
    
    async def _ensure_session(self):
        """Ensure HTTP session is created with secure configuration"""
        if self._session is None or self._session.closed:
            self._session = create_secure_session(self.security_config)
    
    async def close(self):
        """Close all connections"""
        if self._session and not self._session.closed:
            await self._session.close()
        if self._ws_connection:
            await self._ws_connection.close()
    
    def _get_request_id(self) -> int:
        """Get next secure request ID"""
        return self._id_generator.next_id()
    
    async def _make_request(self, method: str, params: List[Any] = None) -> Any:
        """
        Make JSON-RPC request to Omne node
        
        Args:
            method: RPC method name
            params: Method parameters
            
        Returns:
            Response result
            
        Raises:
            NetworkError: If request fails
        """
        await self._ensure_session()
        
        request_data = {
            "jsonrpc": "2.0",
            "id": self._get_request_id(),
            "method": method,
            "params": params or []
        }
        
        for attempt in range(self.security_config.max_retries + 1):
            try:
                async with self._session.post(
                    self.rpc_url,
                    json=request_data
                ) as response:
                    
                    if response.status != 200:
                        raise NetworkError(
                            f"HTTP {response.status}: {await response.text()}"
                        )
                    
                    result = await response.json()
                    
                    if "error" in result:
                        error = result["error"]
                        raise NetworkError(
                            error.get("message", "Unknown RPC error"),
                            code=error.get("code"),
                            data=error.get("data")
                        )
                    
                    return result.get("result")
                    
            except aiohttp.ClientError as e:
                if attempt == self.security_config.max_retries:
                    raise NetworkError(f"Network request failed: {str(e)}")
                await asyncio.sleep(self.security_config.retry_delay * (2 ** attempt))  # Exponential backoff
    
    # ===== Network Information =====
    
    async def get_network_info(self) -> NetworkInfo:
        """Get network information"""
        result = await self._make_request("omne_networkInfo")
        return NetworkInfo(**result)
    
    async def get_chain_id(self) -> int:
        """Get chain ID"""
        return await self._make_request("omne_chainId")
    
    async def get_block_number(self) -> int:
        """Get latest block number"""
        return await self._make_request("omne_blockNumber")
    
    # ===== Account Management =====
    
    async def get_balance(self, address: str) -> Balance:
        """
        Get account balance
        
        Args:
            address: Account address
            
        Returns:
            Balance information
        """
        address = parse_address(address)
        result = await self._make_request("omne_getBalance", [address])
        
        quar_balance = int(result["balance"])
        return Balance(
            address=address,
            omc=from_quar(quar_balance),
            quar=quar_balance,
            last_updated=result.get("lastUpdated", 0)
        )
    
    async def get_account_info(self, address: str) -> Dict[str, Any]:
        """Get detailed account information"""
        address = parse_address(address)
        return await self._make_request("omne_getAccount", [address])
    
    async def get_nonce(self, address: str) -> int:
        """Get account nonce for transactions"""
        address = parse_address(address)
        return await self._make_request("omne_getNonce", [address])
    
    # ===== Transaction Management =====
    
    async def send_transaction(
        self,
        from_address: str,
        to_address: str,
        value_omc: Union[str, int, float, Decimal] = 0,
        data: str = "0x",
        gas_limit: Optional[int] = None,
        gas_price_quar: Optional[int] = None,
        wallet: Optional[Wallet] = None,
        account_index: int = 0
    ) -> str:
        """
        Send transaction
        
        Args:
            from_address: Sender address
            to_address: Recipient address
            value_omc: Amount to send in OMC
            data: Transaction data
            gas_limit: Gas limit (auto-estimated if None)
            gas_price_quar: Gas price in quar (auto-calculated if None)
            wallet: Wallet for signing (if provided)
            account_index: Account index in wallet
            
        Returns:
            Transaction hash
        """
        from_address = parse_address(from_address)
        to_address = parse_address(to_address)
        value_quar = to_quar(value_omc)
        
        # Get nonce
        nonce = await self.get_nonce(from_address)
        
        # Estimate gas if not provided
        if gas_limit is None:
            gas_limit = await self.estimate_gas({
                "from": from_address,
                "to": to_address,
                "value": hex(value_quar),
                "data": data
            })
        
        # Get gas price if not provided
        if gas_price_quar is None:
            gas_price_quar = await self.get_gas_price()
        
        # Create transaction
        transaction = Transaction(
            **{
                "from": from_address,
                "to": to_address,
                "value_quar": value_quar,
                "gas_limit": gas_limit,
                "gas_price_quar": gas_price_quar,
                "nonce": nonce,
                "data": data
            }
        )
        
        # Sign transaction if wallet provided
        if wallet:
            signature = wallet.sign_transaction(transaction, account_index)
            # In production, would create signed raw transaction
            # For now, submit as structured transaction
        
        # Submit transaction
        tx_params = {
            "from": from_address,
            "to": to_address,
            "value": hex(value_quar),
            "gas": hex(gas_limit),
            "gasPrice": hex(gas_price_quar),
            "nonce": hex(nonce),
            "data": data
        }
        
        result = await self._make_request("omne_sendTransaction", [tx_params])
        return result["transactionHash"]
    
    async def wait_for_transaction(
        self,
        tx_hash: str,
        timeout: int = 60,
        poll_interval: float = 1.0
    ) -> TransactionReceipt:
        """
        Wait for transaction confirmation
        
        Args:
            tx_hash: Transaction hash
            timeout: Maximum wait time in seconds
            poll_interval: Polling interval in seconds
            
        Returns:
            Transaction receipt
            
        Raises:
            TransactionError: If transaction fails or times out
        """
        start_time = asyncio.get_event_loop().time()
        
        while True:
            try:
                receipt = await self.get_transaction_receipt(tx_hash)
                if receipt.status != TransactionStatus.PENDING:
                    return receipt
            except NetworkError:
                pass  # Receipt not available yet
            
            if asyncio.get_event_loop().time() - start_time > timeout:
                raise TransactionError(
                    f"Transaction {tx_hash} timed out after {timeout} seconds",
                    tx_hash=tx_hash
                )
            
            await asyncio.sleep(poll_interval)
    
    async def get_transaction_receipt(self, tx_hash: str) -> TransactionReceipt:
        """Get transaction receipt"""
        result = await self._make_request("omne_getTransactionReceipt", [tx_hash])
        
        status_map = {
            "0x1": TransactionStatus.CONFIRMED,
            "0x0": TransactionStatus.FAILED,
            "pending": TransactionStatus.PENDING
        }
        
        return TransactionReceipt(
            transaction_hash=result["transactionHash"],
            block_number=int(result["blockNumber"], 16),
            gas_used=int(result["gasUsed"], 16),
            status=status_map.get(result["status"], TransactionStatus.PENDING),
            logs=result.get("logs", []),
            contract_address=result.get("contractAddress"),
            effective_gas_price_quar=int(result.get("effectiveGasPrice", "0"), 16)
        )
    
    async def estimate_gas(self, transaction: Dict[str, Any]) -> int:
        """Estimate gas required for transaction"""
        result = await self._make_request("omne_estimateGas", [transaction])
        return int(result, 16)
    
    async def get_gas_price(self) -> int:
        """Get current gas price in quar"""
        result = await self._make_request("omne_gasPrice")
        return int(result, 16)
    
    # ===== Block Information =====
    
    async def get_block(self, block_number: Union[int, str] = "latest") -> Block:
        """Get block by number"""
        if isinstance(block_number, int):
            block_number = hex(block_number)
        
        result = await self._make_request("omne_getBlockByNumber", [block_number, False])
        
        return Block(
            number=int(result["number"], 16),
            hash=result["hash"],
            parent_hash=result["parentHash"],
            timestamp=int(result["timestamp"], 16),
            gas_limit=int(result["gasLimit"], 16),
            gas_used=int(result["gasUsed"], 16),
            transaction_count=len(result.get("transactions", [])),
            transactions=result.get("transactions", []),
            layer=result.get("layer", "commerce")
        )
    
    # ===== ORC-20 Token Management =====
    
    async def deploy_orc20_token(
        self,
        name: str,
        symbol: str,
        initial_supply: int,
        decimals: int = 18,
        description: str = "",
        application_type: str = "general",
        config: Optional[ORC20TokenConfig] = None,
        from_address: Optional[str] = None,
        wallet: Optional[Wallet] = None
    ) -> str:
        """
        Deploy ORC-20 token
        
        Args:
            name: Token name
            symbol: Token symbol
            initial_supply: Initial token supply
            decimals: Token decimals
            description: Token description
            application_type: Application type
            config: Token configuration
            from_address: Deployer address
            wallet: Wallet for signing
            
        Returns:
            Contract address
        """
        if config is None:
            config = ORC20TokenConfig()
        
        deploy_params = {
            "name": name,
            "symbol": symbol,
            "initialSupply": initial_supply,
            "decimals": decimals,
            "description": description,
            "applicationType": application_type,
            "config": config.dict()
        }
        
        if from_address:
            deploy_params["from"] = parse_address(from_address)
        
        result = await self._make_request("omne_deployORC20", [deploy_params])
        return result["contractAddress"]
    
    async def get_token_info(self, token_address: str) -> ORC20Token:
        """Get ORC-20 token information"""
        token_address = parse_address(token_address)
        result = await self._make_request("omne_getTokenInfo", [token_address])
        
        return ORC20Token(
            address=token_address,
            name=result["name"],
            symbol=result["symbol"],
            decimals=result["decimals"],
            total_supply=result["totalSupply"],
            description=result.get("description", ""),
            application_type=result.get("applicationType", "general"),
            features=result.get("features", []),
            config=ORC20TokenConfig(**result.get("config", {}))
        )
    
    async def get_token_balance(self, token_address: str, account_address: str) -> int:
        """Get ORC-20 token balance"""
        token_address = parse_address(token_address)
        account_address = parse_address(account_address)
        
        result = await self._make_request(
            "omne_getTokenBalance",
            [token_address, account_address]
        )
        return int(result["balance"])
    
    # ===== Computational Services (OON) =====
    
    async def submit_computational_job(
        self,
        job_request: ComputationalJobRequest,
        from_address: Optional[str] = None
    ) -> ComputationalJob:
        """
        Submit computational job to OON
        
        Args:
            job_request: Job request details
            from_address: Submitter address
            
        Returns:
            Job information
        """
        params = job_request.dict()
        if from_address:
            params["from"] = parse_address(from_address)
        
        result = await self._make_request("omne_submitJob", [params])
        
        return ComputationalJob(
            job_id=result["jobId"],
            submitter=result["submitter"],
            job_type=result["jobType"],
            status=JobStatus(result["status"]),
            created_at=result["createdAt"],
            cost_omc=Decimal(str(result.get("costOmc", 0)))
        )
    
    async def get_job_status(self, job_id: str) -> ComputationalJob:
        """Get computational job status"""
        result = await self._make_request("omne_getJobStatus", [job_id])
        
        return ComputationalJob(
            job_id=result["jobId"],
            submitter=result["submitter"],
            job_type=result["jobType"],
            status=JobStatus(result["status"]),
            created_at=result["createdAt"],
            started_at=result.get("startedAt"),
            completed_at=result.get("completedAt"),
            cost_omc=Decimal(str(result.get("costOmc", 0))),
            node_id=result.get("nodeId"),
            progress=result.get("progress", 0.0),
            result_hash=result.get("resultHash"),
            error_message=result.get("errorMessage")
        )
    
    async def monitor_job(self, job_id: str, poll_interval: float = 5.0) -> AsyncIterator[ComputationalJob]:
        """
        Monitor computational job progress
        
        Args:
            job_id: Job ID to monitor
            poll_interval: Polling interval in seconds
            
        Yields:
            Job status updates
        """
        while True:
            job = await self.get_job_status(job_id)
            yield job
            
            if job.status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
                break
                
            await asyncio.sleep(poll_interval)
    
    # ===== Event Streaming =====
    
    async def subscribe_blocks(self) -> AsyncIterator[Block]:
        """Subscribe to new blocks"""
        # WebSocket subscription implementation
        # Simplified for this example
        while True:
            latest_block = await self.get_block("latest")
            yield latest_block
            await asyncio.sleep(3)  # Commerce layer block time
    
    # ===== Utility Methods =====
    
    def to_quar(self, omc_amount: Union[str, int, float, Decimal]) -> int:
        """Convert OMC to quar"""
        return to_quar(omc_amount)
    
    def from_quar(self, quar_amount: int) -> Decimal:
        """Convert quar to OMC"""
        return from_quar(quar_amount)
    
    def is_valid_address(self, address: str) -> bool:
        """Check if address is valid"""
        return is_valid_address(address)

    # ===== Dynamic Stake and Fee Estimation - BREAKTHROUGH OPTIMIZATION =====
    
    async def get_dynamic_stake_info(self) -> "DynamicStakeInfo":
        """Get current dynamic stake requirements based on network conditions"""
        from .types import DynamicStakeInfo
        result = await self._make_request("omne_getDynamicStakeInfo")
        return DynamicStakeInfo(**result)
    
    async def estimate_fees(self, transaction: Dict[str, Any]) -> "FeeEstimation":
        """Estimate transaction fees with intelligent cross-subsidization"""
        from .types import FeeEstimation
        result = await self._make_request("omne_estimateFees", [transaction])
        return FeeEstimation(**result)
    
    async def get_validator_performance(self, validator_address: str) -> "ValidatorPerformance":
        """Get validator performance metrics for bonus calculations"""
        from .types import ValidatorPerformance
        if not is_valid_address(validator_address):
            raise ValidationError(f"Invalid validator address: {validator_address}")
        result = await self._make_request("omne_getValidatorPerformance", [validator_address])
        return ValidatorPerformance(**result)
    
    async def calculate_validator_rewards(self, validator_address: str, base_reward: Optional[str] = None) -> "ValidatorRewards":
        """Calculate potential validator rewards including performance and longevity bonuses"""
        from .types import ValidatorRewards
        params = [validator_address, base_reward] if base_reward else [validator_address]
        result = await self._make_request("omne_calculateValidatorRewards", params)
        return ValidatorRewards(**result)
    
    async def get_network_metrics(self) -> "NetworkMetrics":
        """Get network utilization metrics for dynamic calculations"""
        from .types import NetworkMetrics
        result = await self._make_request("omne_getNetworkMetrics")
        return NetworkMetrics(**result)
    
    async def estimate_optimal_stake(self, target_performance: Optional[float] = None) -> "OptimalStakeEstimate":
        """Estimate optimal stake amount for validator registration"""
        from .types import OptimalStakeEstimate
        params = [target_performance] if target_performance is not None else []
        result = await self._make_request("omne_estimateOptimalStake", params)
        return OptimalStakeEstimate(**result)
