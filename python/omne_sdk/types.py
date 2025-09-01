"""
Type definitions for Omne SDK
"""

from typing import Optional, Dict, Any, List, Union
from enum import Enum
from pydantic import BaseModel, Field
from decimal import Decimal


class NetworkType(str, Enum):
    """Omne network types"""
    PRIMUM = "primum"      # Development/testing
    TESTUM = "testum"      # External testnet
    PRINCIPALIS = "principalis"  # Production mainnet


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


class NetworkInfo(BaseModel):
    """Network information"""
    chain_id: int = Field(alias="chainId")
    network_name: str = Field(alias="networkName")
    api_version: str = Field(alias="apiVersion")
    gas_price_policy: Dict[str, Any] = Field(alias="gasPricePolicy")
    features: Dict[str, bool]


class Balance(BaseModel):
    """Account balance information"""
    address: str
    omc: Decimal = Field(description="Balance in OMC")
    quar: int = Field(description="Balance in quar (10^-18 OMC)")
    last_updated: int = Field(description="Block number of last update")
    
    @property
    def omc_float(self) -> float:
        """Balance as float OMC (convenience method)"""
        return float(self.omc)


class Transaction(BaseModel):
    """Transaction data"""
    hash: Optional[str] = None
    from_address: str = Field(alias="from")
    to_address: str = Field(alias="to")
    value_quar: int = Field(description="Value in quar")
    gas_limit: int
    gas_price_quar: int = Field(description="Gas price in quar")
    nonce: int
    data: str = Field(default="0x")
    
    @property
    def value_omc(self) -> Decimal:
        """Transaction value in OMC"""
        return Decimal(self.value_quar) / Decimal(10**18)


class TransactionReceipt(BaseModel):
    """Transaction execution receipt"""
    transaction_hash: str
    block_number: int
    gas_used: int
    status: TransactionStatus
    logs: List[Dict[str, Any]] = Field(default_factory=list)
    contract_address: Optional[str] = None
    effective_gas_price_quar: int


class Block(BaseModel):
    """Block information"""
    number: int
    hash: str
    parent_hash: str
    timestamp: int
    gas_limit: int
    gas_used: int
    transaction_count: int
    transactions: List[str] = Field(default_factory=list)
    layer: str = Field(description="'commerce' or 'security'")


class ORC20TokenConfig(BaseModel):
    """ORC-20 token configuration"""
    max_supply: Optional[int] = None
    mintable: bool = True
    burnable: bool = True
    governance_enabled: bool = False
    transfer_fee_rate: float = 0.0
    fee_recipient: Optional[str] = None
    platform_fee_sharing: bool = True


class ORC20Token(BaseModel):
    """ORC-20 token information"""
    address: str
    name: str
    symbol: str
    decimals: int
    total_supply: int
    description: str = ""
    application_type: str = "general"
    features: List[str] = Field(default_factory=list)
    config: ORC20TokenConfig


class ComputationalJobRequest(BaseModel):
    """Computational job submission request"""
    job_type: JobType
    data_source: str = Field(description="Data source URL or reference")
    parameters: Dict[str, Any] = Field(default_factory=dict)
    max_cost_omc: Decimal = Field(description="Maximum cost in OMC")
    timeout_minutes: int = Field(default=60)
    priority: int = Field(default=1, ge=1, le=10)
    requirements: Dict[str, Any] = Field(default_factory=dict)


class ComputationalJob(BaseModel):
    """Computational job information"""
    job_id: str
    submitter: str
    job_type: JobType
    status: JobStatus
    created_at: int = Field(description="Unix timestamp")
    started_at: Optional[int] = None
    completed_at: Optional[int] = None
    cost_omc: Optional[Decimal] = None
    node_id: Optional[str] = None
    progress: float = Field(default=0.0, ge=0.0, le=100.0)
    result_hash: Optional[str] = None
    error_message: Optional[str] = None


class NodeInfo(BaseModel):
    """Computational node information"""
    node_id: str
    address: str
    stake_ogt: int
    reputation_score: float = Field(ge=0.0, le=1.0)
    capabilities: List[JobType]
    hardware_specs: Dict[str, Any]
    location: Optional[str] = None
    availability: float = Field(ge=0.0, le=1.0)
    total_jobs_completed: int = 0
    success_rate: float = Field(ge=0.0, le=1.0)


class EventLog(BaseModel):
    """Event log from contract"""
    address: str
    topics: List[str]
    data: str
    block_number: int
    transaction_hash: str
    log_index: int
    removed: bool = False


class Contract(BaseModel):
    """Smart contract information"""
    address: str
    abi: List[Dict[str, Any]]
    bytecode: Optional[str] = None
    name: Optional[str] = None
    version: Optional[str] = None


# Type aliases
Address = str
TxHash = str
BlockHash = str
QuarAmount = int
OMCAmount = Decimal
