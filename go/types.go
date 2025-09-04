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

	encoded := address[5:] // Remove "omne1" prefix
	return isValidBase32(encoded)
}

// isValidHexAddress validates Ethereum-compatible hex address
func isValidHexAddress(address string) bool {
	// Remove 0x prefix if present (case insensitive)
	cleanAddr := strings.ToLower(address)
	cleanAddr = strings.TrimPrefix(cleanAddr, "0x")

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

// isValidBase32 validates Omne base32 encoding
func isValidBase32(encoded string) bool {
	// Omne alphabet (no 0, O, I, L for readability)
	const alphabet = "123456789abcdefghjkmnpqrstuvwxyz"

	for _, char := range encoded {
		valid := false
		for _, validChar := range alphabet {
			if char == validChar {
				valid = true
				break
			}
		}
		if !valid {
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
	encoded := omneEncode(addressBytes)
	return "omne1" + encoded
}

// FromOmneAddress converts an Omne address back to 20-byte array
func FromOmneAddress(address string) ([20]byte, error) {
	if !strings.HasPrefix(address, "omne1") {
		return [20]byte{}, fmt.Errorf("invalid Omne address format - must start with 'omne1'")
	}

	encoded := address[5:] // Remove "omne1" prefix
	return omneDecode(encoded)
}

// omneEncode encodes bytes to Omne-specific base32 format
func omneEncode(bytes [20]byte) string {
	// Custom base32 alphabet optimized for readability (no 0, O, I, L)
	const alphabet = "123456789abcdefghjkmnpqrstuvwxyz"

	// Convert bytes to big integer
	num := new(big.Int).SetBytes(bytes[:])

	if num.Cmp(big.NewInt(0)) == 0 {
		return string(alphabet[0])
	}

	var result []byte
	base := big.NewInt(32)
	remainder := new(big.Int)

	for num.Cmp(big.NewInt(0)) > 0 {
		num.DivMod(num, base, remainder)
		result = append(result, alphabet[remainder.Int64()])
	}

	// Reverse the result
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}

	return string(result)
}

// omneDecode decodes Omne base32 format back to bytes
func omneDecode(encoded string) ([20]byte, error) {
	const alphabet = "123456789abcdefghjkmnpqrstuvwxyz"

	num := big.NewInt(0)
	base := big.NewInt(32)

	for _, ch := range encoded {
		value := -1
		for i, c := range alphabet {
			if rune(c) == ch {
				value = i
				break
			}
		}

		if value == -1 {
			return [20]byte{}, fmt.Errorf("invalid character in Omne address: %c", ch)
		}

		num.Mul(num, base)
		num.Add(num, big.NewInt(int64(value)))
	}

	// Convert back to 20 bytes
	bytes := num.Bytes()
	var result [20]byte

	// Pad with zeros if necessary
	if len(bytes) > 20 {
		return [20]byte{}, fmt.Errorf("address value too large")
	}

	copy(result[20-len(bytes):], bytes)
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
