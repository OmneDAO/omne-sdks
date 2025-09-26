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


# === Dynamic Stake and Fee Estimation - BREAKTHROUGH OPTIMIZATION ===

class DynamicStakeInfo(BaseModel):
    """Dynamic stake requirements based on network conditions"""
    current_requirement: str = Field(alias="currentRequirement")  # Current dynamic stake requirement in OGT
    minimum_stake: str = Field(alias="minimumStake")              # Absolute minimum stake in OGT
    maximum_stake: str = Field(alias="maximumStake")              # Absolute maximum stake in OGT  
    network_utilization: float = Field(alias="networkUtilization") # Current network utilization (0-1)
    active_validators: int = Field(alias="activeValidators")       # Number of active validators
    utilization_factor: float = Field(alias="utilizationFactor")  # Applied utilization multiplier
    validator_density_factor: float = Field(alias="validatorDensityFactor") # Applied validator density multiplier
    last_updated: int = Field(alias="lastUpdated")                # Block height of last calculation


class FeeBreakdown(BaseModel):
    """Fee breakdown components"""
    execution: str          # Execution cost in quar
    storage: str           # Storage cost in quar
    network_fee: str = Field(alias="networkFee")        # Network maintenance fee in quar
    computational_revenue: str = Field(alias="computationalRevenue") # Revenue generation component in quar


class FeeEstimation(BaseModel):
    """Comprehensive fee estimation for transactions"""
    base_fee: str = Field(alias="baseFee")              # Base transaction fee in quar
    cross_subsidy_amount: str = Field(alias="crossSubsidyAmount") # Cross-subsidization discount in quar
    final_fee: str = Field(alias="finalFee")            # Final fee after subsidization in quar
    subsidy_rate: float = Field(alias="subsidyRate")    # Applied subsidy rate (0.25-0.30)
    network_utilization: float = Field(alias="networkUtilization") # Current network utilization
    estimated_confirmation_time: int = Field(alias="estimatedConfirmationTime") # Estimated confirmation time in ms
    fee_breakdown: FeeBreakdown = Field(alias="feeBreakdown")       # Detailed fee breakdown


class ValidatorPerformance(BaseModel):
    """Validator performance metrics for bonus calculations"""
    address: str                                        # Validator address
    uptime: float                                      # Uptime percentage (0-100)
    block_accuracy: float = Field(alias="blockAccuracy")           # Block production accuracy (0-100)
    job_completion_rate: float = Field(alias="jobCompletionRate")  # Computational job completion rate (0-100)
    avg_response_time: int = Field(alias="avgResponseTime")        # Average response time in milliseconds
    revenue_generated: str = Field(alias="revenueGenerated")       # Total revenue generated in quar
    performance_bonus: str = Field(alias="performanceBonus")       # Current performance bonus in quar
    longevity_bonus: str = Field(alias="longevityBonus")           # Current longevity bonus in quar
    total_reward: str = Field(alias="totalReward")                 # Total reward including bonuses in quar
    registration_block: int = Field(alias="registrationBlock")     # Block height when validator registered


class ValidatorRewards(BaseModel):
    """Validator rewards calculation result"""
    base_reward: str = Field(alias="baseReward")                   # Base validator reward
    performance_bonus: str = Field(alias="performanceBonus")       # Performance bonus amount
    longevity_bonus: str = Field(alias="longevityBonus")           # Longevity bonus amount
    total_reward: str = Field(alias="totalReward")                 # Total reward with bonuses
    bonus_percentage: float = Field(alias="bonusPercentage")       # Total bonus as percentage


class NetworkMetrics(BaseModel):
    """Network utilization metrics for dynamic calculations"""
    utilization: float                                  # Network utilization (0-1)
    active_validators: int = Field(alias="activeValidators")       # Number of active validators
    average_stake: str = Field(alias="averageStake")              # Average validator stake
    total_staked: str = Field(alias="totalStaked")                # Total amount staked
    network_health: float = Field(alias="networkHealth")          # Network health score (0-100)
    cross_subsidy_rate: float = Field(alias="crossSubsidyRate")   # Current cross-subsidy rate
    computational_revenue: str = Field(alias="computationalRevenue") # Total computational revenue


class OptimalStakeEstimate(BaseModel):
    """Optimal stake estimation result"""
    recommended_stake: str = Field(alias="recommendedStake")       # Recommended stake amount
    minimum_required: str = Field(alias="minimumRequired")         # Minimum required stake
    expected_returns: Dict[str, str] = Field(alias="expectedReturns") # Expected returns (monthly, annual)
    risk_factors: List[str] = Field(alias="riskFactors")          # Risk factors to consider
