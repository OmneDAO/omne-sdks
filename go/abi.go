package omne

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
)

// ArgType discriminants matching the Rust ABI codec.
type ArgType byte

const (
	ArgTypeU32     ArgType = 0x01
	ArgTypeU64     ArgType = 0x02
	ArgTypeI32     ArgType = 0x03
	ArgTypeI64     ArgType = 0x04
	ArgTypeString  ArgType = 0x05
	ArgTypeBytes   ArgType = 0x06
	ArgTypeBool    ArgType = 0x07
	ArgTypeAddress ArgType = 0x08
	ArgTypeU128    ArgType = 0x09
)

// AbiArgument is a single typed argument in the Omne ABI encoding.
type AbiArgument struct {
	Type ArgType
	Data []byte
}

// Arg* builders produce typed ABI arguments. Integers are BIG-endian (the
// codec), distinct from the little-endian transaction-hash preimage.

func ArgU32(v uint32) AbiArgument {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return AbiArgument{ArgTypeU32, b}
}

func ArgU64(v uint64) AbiArgument {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, v)
	return AbiArgument{ArgTypeU64, b}
}

func ArgI32(v int32) AbiArgument {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, uint32(v))
	return AbiArgument{ArgTypeI32, b}
}

func ArgI64(v int64) AbiArgument {
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(v))
	return AbiArgument{ArgTypeI64, b}
}

// ArgU128 encodes a non-negative big.Int as a 16-byte big-endian value.
func ArgU128(v *big.Int) AbiArgument {
	b := make([]byte, 16)
	v.FillBytes(b) // big-endian, left-padded; panics if v < 0 or > 16 bytes
	return AbiArgument{ArgTypeU128, b}
}

// ArgU128FromUint is a convenience for u128 values that fit in a uint64.
func ArgU128FromUint(v uint64) AbiArgument {
	return ArgU128(new(big.Int).SetUint64(v))
}

func ArgString(s string) AbiArgument { return AbiArgument{ArgTypeString, []byte(s)} }

func ArgBytes(b []byte) AbiArgument { return AbiArgument{ArgTypeBytes, b} }

func ArgBool(v bool) AbiArgument {
	if v {
		return AbiArgument{ArgTypeBool, []byte{0x01}}
	}
	return AbiArgument{ArgTypeBool, []byte{0x00}}
}

// ArgAddress encodes an om1z address as a 32-byte Address argument.
func ArgAddress(omneAddress string) (AbiArgument, error) {
	payload, err := ParseAddress(omneAddress)
	if err != nil {
		return AbiArgument{}, err
	}
	if len(payload) != 32 {
		return AbiArgument{}, fmt.Errorf("address must be 32 bytes, got %d", len(payload))
	}
	return AbiArgument{ArgTypeAddress, payload}, nil
}

// EncodeContractCall encodes a method call into the Omne ABI wire format
// (bare hex): MAGIC "OMNE" | VERSION 0x01 | method_len u16 BE | method |
// arg_count u16 BE | [type u8 | data_len u32 BE | data]*.
func EncodeContractCall(method string, args []AbiArgument) (string, error) {
	mb := []byte(method)
	if len(mb) > 256 {
		return "", fmt.Errorf("method name exceeds 256 byte limit")
	}
	if len(args) > 64 {
		return "", fmt.Errorf("argument count %d exceeds maximum of 64", len(args))
	}
	buf := []byte{0x4f, 0x4d, 0x4e, 0x45, 0x01} // "OMNE" + version
	var u16 [2]byte
	binary.BigEndian.PutUint16(u16[:], uint16(len(mb)))
	buf = append(buf, u16[:]...)
	buf = append(buf, mb...)
	binary.BigEndian.PutUint16(u16[:], uint16(len(args)))
	buf = append(buf, u16[:]...)
	for _, a := range args {
		buf = append(buf, byte(a.Type))
		var u32 [4]byte
		binary.BigEndian.PutUint32(u32[:], uint32(len(a.Data)))
		buf = append(buf, u32[:]...)
		buf = append(buf, a.Data...)
	}
	return hex.EncodeToString(buf), nil
}
