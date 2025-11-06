package omne

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
)

// QuarPrecision defines the number of decimal places for quar (18)
const QuarPrecision = 18

// QuarPerOMC represents the conversion factor from OMC to quar (10^18)
var QuarPerOMC = new(big.Int).Exp(big.NewInt(10), big.NewInt(QuarPrecision), nil)

// Quar represents a quar amount with high precision arithmetic
type Quar struct {
	*big.Int
}

// NewQuar creates a new Quar from a big.Int
func NewQuar(value *big.Int) *Quar {
	if value == nil {
		value = big.NewInt(0)
	}
	return &Quar{Int: new(big.Int).Set(value)}
}

// NewQuarFromString creates a Quar from a string representation
func NewQuarFromString(s string) (*Quar, error) {
	value := new(big.Int)
	_, ok := value.SetString(s, 10)
	if !ok {
		return nil, fmt.Errorf("invalid quar string: %s", s)
	}
	return NewQuar(value), nil
}

// ToOMC converts quar to OMC as a big.Float with proper precision
func (q *Quar) ToOMC() *big.Float {
	if q.Int == nil {
		return big.NewFloat(0)
	}

	omcFloat := new(big.Float).SetInt(q.Int)
	divisor := new(big.Float).SetInt(QuarPerOMC)
	return omcFloat.Quo(omcFloat, divisor)
}

// String returns the quar amount as a string
func (q *Quar) String() string {
	if q.Int == nil {
		return "0"
	}
	return q.Int.String()
}

// ToOMCString converts quar to OMC string with specified decimal places
func (q *Quar) ToOMCString(decimals int) string {
	if decimals < 0 {
		decimals = 6 // Default to 6 decimal places
	}

	omcFloat := q.ToOMC()
	format := fmt.Sprintf("%%.%df", decimals)
	return fmt.Sprintf(format, omcFloat)
}

// Add adds another Quar to this one
func (q *Quar) Add(other *Quar) *Quar {
	result := new(big.Int).Add(q.Int, other.Int)
	return NewQuar(result)
}

// Sub subtracts another Quar from this one
func (q *Quar) Sub(other *Quar) *Quar {
	result := new(big.Int).Sub(q.Int, other.Int)
	return NewQuar(result)
}

// Mul multiplies this Quar by another
func (q *Quar) Mul(other *Quar) *Quar {
	result := new(big.Int).Mul(q.Int, other.Int)
	return NewQuar(result)
}

// Cmp compares two Quar values
func (q *Quar) Cmp(other *Quar) int {
	return q.Int.Cmp(other.Int)
}

// ToQuarFromOMC converts OMC string to Quar
func ToQuarFromOMC(omcStr string) (*Quar, error) {
	// Parse the OMC string as a float
	omcFloat, ok := new(big.Float).SetString(omcStr)
	if !ok {
		return nil, fmt.Errorf("invalid OMC string: %s", omcStr)
	}

	// Multiply by QuarPerOMC to convert to quar
	quarFloat := new(big.Float).Mul(omcFloat, new(big.Float).SetInt(QuarPerOMC))

	// Convert to big.Int (truncating any fractional quar)
	quarInt, _ := quarFloat.Int(nil)
	return NewQuar(quarInt), nil
}

// ToQuarFromOMCFloat converts OMC float64 to Quar
func ToQuarFromOMCFloat(omc float64) *Quar {
	omcFloat := big.NewFloat(omc)
	quarFloat := new(big.Float).Mul(omcFloat, new(big.Float).SetInt(QuarPerOMC))
	quarInt, _ := quarFloat.Int(nil)
	return NewQuar(quarInt)
}

// FormatBalance formats a quar amount for human-readable display
func FormatBalance(quar *Quar, decimals int) string {
	if decimals < 0 {
		decimals = 6
	}

	omcStr := quar.ToOMCString(decimals)

	// Add OMC suffix
	return fmt.Sprintf("%s OMC", omcStr)
}

// IsValidAddress validates an Omne address format
func IsValidAddress(address string) bool {
	if len(address) == 0 {
		return false
	}

	// Check for Omne address format (omne1...)
	if strings.HasPrefix(address, "omne1") {
		return isValidOmneAddress(address)
	}

	// For backward compatibility, also accept hex addresses
	return isValidHexAddress(address)
}

// isValidOmneAddress validates omne1 address format
func isValidOmneAddress(address string) bool {
	if !strings.HasPrefix(address, "omne1") {
		return false
	}

	encoded := address[5:]
	if len(encoded) != 40 {
		return false
	}

	for _, char := range encoded {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}

	return true
}

// isValidHexAddress validates Ethereum-compatible hex address using lowercase characters only
func isValidHexAddress(address string) bool {
	if strings.ToLower(address) != address {
		return false
	}

	// Remove 0x prefix if present
	cleanAddr := strings.TrimPrefix(address, "0x")

	// Check length (40 hex characters = 20 bytes)
	if len(cleanAddr) != 40 {
		return false
	}

	// Check if all characters are valid hex
	for _, char := range cleanAddr {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}

	return true
}

// NormalizeAddress converts address to standard lowercase format with 0x prefix
func NormalizeAddress(address string) (string, error) {
	if !IsValidAddress(address) {
		return "", fmt.Errorf("invalid address format: %s", address)
	}

	cleanAddr := strings.ToLower(address)
	if strings.HasPrefix(cleanAddr, "0x") {
		return cleanAddr, nil
	}

	return "0x" + cleanAddr, nil
}

// ToChecksumAddress converts address to EIP-55 checksum format
func ToChecksumAddress(address string) (string, error) {
	normalized, err := NormalizeAddress(address)
	if err != nil {
		return "", err
	}

	// Remove 0x prefix for hashing
	addrWithoutPrefix := normalized[2:]

	// Hash with Keccak-256
	hash := crypto.Keccak256([]byte(addrWithoutPrefix))
	hashHex := hex.EncodeToString(hash)

	result := "0x"
	for i, char := range addrWithoutPrefix {
		if i < len(hashHex) {
			// If hash digit >= 8, capitalize the address character
			hashChar := hashHex[i]
			if hashChar >= '8' && hashChar <= 'f' {
				result += strings.ToUpper(string(char))
			} else {
				result += string(char)
			}
		} else {
			result += string(char)
		}
	}

	return result, nil
}

// ToOmneAddress converts a 20-byte address to Omne format (omne1...)
func ToOmneAddress(addressBytes [20]byte) string {
	return "omne1" + hex.EncodeToString(addressBytes[:])
}

// FromOmneAddress converts an Omne address back to 20-byte array
func FromOmneAddress(address string) ([20]byte, error) {
	if !strings.HasPrefix(address, "omne1") {
		return [20]byte{}, fmt.Errorf("invalid Omne address format - must start with 'omne1'")
	}

	hexPayload := address[5:]
	if len(hexPayload) != 40 {
		return [20]byte{}, fmt.Errorf("invalid Omne address length - expected 40 hex characters")
	}

	if strings.ToLower(hexPayload) != hexPayload {
		return [20]byte{}, fmt.Errorf("invalid Omne address - uppercase characters are not allowed")
	}

	decoded, err := hex.DecodeString(hexPayload)
	if err != nil {
		return [20]byte{}, fmt.Errorf("invalid hex characters in Omne address: %w", err)
	}

	var result [20]byte
	copy(result[:], decoded)
	return result, nil
}

// CalculateGasCost calculates the total gas cost in quar
func CalculateGasCost(gasUsed uint64, gasPriceQuar *Quar) *Quar {
	gasUsedBig := new(big.Int).SetUint64(gasUsed)
	cost := new(big.Int).Mul(gasUsedBig, gasPriceQuar.Int)
	return NewQuar(cost)
}

// EstimateGas provides gas estimates for different transaction types
func EstimateGas(transactionType string, hasData bool) uint64 {
	baseGas := map[string]uint64{
		"transfer":       21000,
		"tokenTransfer":  65000,
		"contractDeploy": 200000,
		"orc20Deploy":    350000,
		"computeJob":     150000,
	}

	gas, exists := baseGas[transactionType]
	if !exists {
		gas = 21000 // Default to simple transfer
	}

	if hasData {
		gas += 20000 // Additional gas for data
	}

	return gas
}

// === Dynamic Stake and Fee Estimation - BREAKTHROUGH OPTIMIZATION ===

// DynamicStakeInfo represents dynamic stake requirements based on network conditions
type DynamicStakeInfo struct {
	CurrentRequirement     string  `json:"currentRequirement"`     // Current dynamic stake requirement in OGT
	MinimumStake           string  `json:"minimumStake"`           // Absolute minimum stake in OGT
	MaximumStake           string  `json:"maximumStake"`           // Absolute maximum stake in OGT
	NetworkUtilization     float64 `json:"networkUtilization"`     // Current network utilization (0-1)
	ActiveValidators       uint32  `json:"activeValidators"`       // Number of active validators
	UtilizationFactor      float64 `json:"utilizationFactor"`      // Applied utilization multiplier
	ValidatorDensityFactor float64 `json:"validatorDensityFactor"` // Applied validator density multiplier
	LastUpdated            uint64  `json:"lastUpdated"`            // Block height of last calculation
}

// FeeBreakdown represents detailed fee components
type FeeBreakdown struct {
	Execution            string `json:"execution"`            // Execution cost in quar
	Storage              string `json:"storage"`              // Storage cost in quar
	NetworkFee           string `json:"networkFee"`           // Network maintenance fee in quar
	ComputationalRevenue string `json:"computationalRevenue"` // Revenue generation component in quar
}

// FeeEstimation represents comprehensive fee estimation for transactions
type FeeEstimation struct {
	BaseFee                   string       `json:"baseFee"`                   // Base transaction fee in quar
	CrossSubsidyAmount        string       `json:"crossSubsidyAmount"`        // Cross-subsidization discount in quar
	FinalFee                  string       `json:"finalFee"`                  // Final fee after subsidization in quar
	SubsidyRate               float64      `json:"subsidyRate"`               // Applied subsidy rate (0.25-0.30)
	NetworkUtilization        float64      `json:"networkUtilization"`        // Current network utilization
	EstimatedConfirmationTime uint64       `json:"estimatedConfirmationTime"` // Estimated confirmation time in ms
	FeeBreakdown              FeeBreakdown `json:"feeBreakdown"`              // Detailed fee breakdown
}

// ValidatorPerformance represents validator performance metrics for bonus calculations
type ValidatorPerformance struct {
	Address           string  `json:"address"`           // Validator address
	Uptime            float64 `json:"uptime"`            // Uptime percentage (0-100)
	BlockAccuracy     float64 `json:"blockAccuracy"`     // Block production accuracy (0-100)
	JobCompletionRate float64 `json:"jobCompletionRate"` // Computational job completion rate (0-100)
	AvgResponseTime   uint64  `json:"avgResponseTime"`   // Average response time in milliseconds
	RevenueGenerated  string  `json:"revenueGenerated"`  // Total revenue generated in quar
	PerformanceBonus  string  `json:"performanceBonus"`  // Current performance bonus in quar
	LongevityBonus    string  `json:"longevityBonus"`    // Current longevity bonus in quar
	TotalReward       string  `json:"totalReward"`       // Total reward including bonuses in quar
	RegistrationBlock uint64  `json:"registrationBlock"` // Block height when validator registered
}

// ValidatorRewards represents validator rewards calculation result
type ValidatorRewards struct {
	BaseReward       string  `json:"baseReward"`       // Base validator reward
	PerformanceBonus string  `json:"performanceBonus"` // Performance bonus amount
	LongevityBonus   string  `json:"longevityBonus"`   // Longevity bonus amount
	TotalReward      string  `json:"totalReward"`      // Total reward with bonuses
	BonusPercentage  float64 `json:"bonusPercentage"`  // Total bonus as percentage
}

// NetworkMetrics represents network utilization metrics for dynamic calculations
type NetworkMetrics struct {
	Utilization          float64 `json:"utilization"`          // Network utilization (0-1)
	ActiveValidators     uint32  `json:"activeValidators"`     // Number of active validators
	AverageStake         string  `json:"averageStake"`         // Average validator stake
	TotalStaked          string  `json:"totalStaked"`          // Total amount staked
	NetworkHealth        float64 `json:"networkHealth"`        // Network health score (0-100)
	CrossSubsidyRate     float64 `json:"crossSubsidyRate"`     // Current cross-subsidy rate
	ComputationalRevenue string  `json:"computationalRevenue"` // Total computational revenue
}

// OptimalStakeEstimate represents optimal stake estimation result
type OptimalStakeEstimate struct {
	RecommendedStake string            `json:"recommendedStake"` // Recommended stake amount
	MinimumRequired  string            `json:"minimumRequired"`  // Minimum required stake
	ExpectedReturns  map[string]string `json:"expectedReturns"`  // Expected returns (monthly, annual)
	RiskFactors      []string          `json:"riskFactors"`      // Risk factors to consider
}
