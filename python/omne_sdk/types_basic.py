"""
Basic types for Omne SDK core testing (no external dependencies)
"""

from typing import Optional, Dict, Any, List, Union
from enum import Enum
from decimal import Decimal


class NetworkType(str, Enum):
    """Omne network types"""
    PRIMUM = "primum"
    TESTUM = "testum" 
    PRINCIPALIS = "principalis"


class TransactionStatus(str, Enum):
    """Transaction status types"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FAILED = "failed"


class JobType(str, Enum):
    """Computational job types"""
    AI_TRAINING = "ai_training"
    AI_INFERENCE = "ai_inference"
    RENDERING_3D = "rendering_3d"
    SCIENTIFIC_SIMULATION = "scientific_simulation"
    DATA_PROCESSING = "data_processing"
    CUSTOM = "custom"


class JobStatus(str, Enum):
    """Computational job status"""
    SUBMITTED = "submitted"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Simple data classes (basic implementation without pydantic)
class NetworkInfo:
    """Network information"""
    def __init__(self, chain_id: int, network_name: str, api_version: str, 
                 gas_price_policy: Dict[str, Any], features: Dict[str, bool]):
        self.chain_id = chain_id
        self.network_name = network_name
        self.api_version = api_version
        self.gas_price_policy = gas_price_policy
        self.features = features


class Balance:
    """Account balance information"""
    def __init__(self, address: str, omc: Decimal, quar: int, last_updated: int):
        self.address = address
        self.omc = omc
        self.quar = quar
        self.last_updated = last_updated
    
    @property
    def omc_float(self) -> float:
        """Balance as float OMC (convenience method)"""
        return float(self.omc)


class Transaction:
    """Transaction data"""
    def __init__(self, from_address: str, to_address: str, value_quar: int,
                 gas_limit: int, gas_price_quar: int, nonce: int, data: str = "0x"):
        self.from_address = from_address
        self.to_address = to_address
        self.value_quar = value_quar
        self.gas_limit = gas_limit
        self.gas_price_quar = gas_price_quar
        self.nonce = nonce
        self.data = data
        self.hash: Optional[str] = None
    
    @property
    def value_omc(self) -> Decimal:
        """Transaction value in OMC"""
        return Decimal(self.value_quar) / Decimal(10**18)


class TransactionReceipt:
    """Transaction execution receipt"""
    def __init__(self, transaction_hash: str, block_number: int, gas_used: int,
                 status: TransactionStatus, logs: List[Dict[str, Any]] = None,
                 contract_address: Optional[str] = None, effective_gas_price_quar: int = 0):
        self.transaction_hash = transaction_hash
        self.block_number = block_number
        self.gas_used = gas_used
        self.status = status
        self.logs = logs or []
        self.contract_address = contract_address
        self.effective_gas_price_quar = effective_gas_price_quar


class Block:
    """Block information"""
    def __init__(self, number: int, hash: str, parent_hash: str, timestamp: int,
                 gas_limit: int, gas_used: int, transaction_count: int,
                 transactions: List[str] = None, layer: str = "commerce"):
        self.number = number
        self.hash = hash
        self.parent_hash = parent_hash
        self.timestamp = timestamp
        self.gas_limit = gas_limit
        self.gas_used = gas_used
        self.transaction_count = transaction_count
        self.transactions = transactions or []
        self.layer = layer


class ORC20TokenConfig:
    """ORC-20 token configuration"""
    def __init__(self, max_supply: Optional[int] = None, mintable: bool = True,
                 burnable: bool = True, governance_enabled: bool = False,
                 transfer_fee_rate: float = 0.0, fee_recipient: Optional[str] = None,
                 platform_fee_sharing: bool = True):
        self.max_supply = max_supply
        self.mintable = mintable
        self.burnable = burnable
        self.governance_enabled = governance_enabled
        self.transfer_fee_rate = transfer_fee_rate
        self.fee_recipient = fee_recipient
        self.platform_fee_sharing = platform_fee_sharing


class ORC20Token:
    """ORC-20 token information"""
    def __init__(self, address: str, name: str, symbol: str, decimals: int,
                 total_supply: int, description: str = "", application_type: str = "general",
                 features: List[str] = None, config: ORC20TokenConfig = None):
        self.address = address
        self.name = name
        self.symbol = symbol
        self.decimals = decimals
        self.total_supply = total_supply
        self.description = description
        self.application_type = application_type
        self.features = features or []
        self.config = config or ORC20TokenConfig()


class ComputationalJobRequest:
    """Computational job submission request"""
    def __init__(self, job_type: JobType, data_source: str, 
                 parameters: Dict[str, Any] = None, max_cost_omc: Decimal = Decimal("1.0"),
                 timeout_minutes: int = 60, priority: int = 1,
                 requirements: Dict[str, Any] = None):
        self.job_type = job_type
        self.data_source = data_source
        self.parameters = parameters or {}
        self.max_cost_omc = max_cost_omc
        self.timeout_minutes = timeout_minutes
        self.priority = priority
        self.requirements = requirements or {}


class ComputationalJob:
    """Computational job information"""
    def __init__(self, job_id: str, submitter: str, job_type: JobType, status: JobStatus,
                 created_at: int, started_at: Optional[int] = None, 
                 completed_at: Optional[int] = None, cost_omc: Optional[Decimal] = None,
                 node_id: Optional[str] = None, progress: float = 0.0,
                 result_hash: Optional[str] = None, error_message: Optional[str] = None):
        self.job_id = job_id
        self.submitter = submitter
        self.job_type = job_type
        self.status = status
        self.created_at = created_at
        self.started_at = started_at
        self.completed_at = completed_at
        self.cost_omc = cost_omc
        self.node_id = node_id
        self.progress = progress
        self.result_hash = result_hash
        self.error_message = error_message


# Type aliases
Address = str
TxHash = str
BlockHash = str
QuarAmount = int
OMCAmount = Decimal
