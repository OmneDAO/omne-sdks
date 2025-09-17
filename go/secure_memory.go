package omne

import (
	"crypto/rand"
	"runtime"
	"unsafe"
)

// SecureBytes represents a byte slice that will be securely zeroed when no longer needed
type SecureBytes struct {
	data []byte
	zeroed bool
}

// NewSecureBytes creates a new SecureBytes instance
func NewSecureBytes(size int) *SecureBytes {
	data := make([]byte, size)
	sb := &SecureBytes{
		data: data,
		zeroed: false,
	}
	
	// Set finalizer to ensure memory is zeroed even if Destroy isn't called
	runtime.SetFinalizer(sb, (*SecureBytes).Destroy)
	
	return sb
}

// NewSecureBytesFromSlice creates SecureBytes from existing slice (copies data)
func NewSecureBytesFromSlice(source []byte) *SecureBytes {
	sb := NewSecureBytes(len(source))
	copy(sb.data, source)
	return sb
}

// Bytes returns the underlying byte slice (read-only access)
func (sb *SecureBytes) Bytes() []byte {
	if sb.zeroed {
		return nil
	}
	return sb.data
}

// Copy returns a copy of the data
func (sb *SecureBytes) Copy() []byte {
	if sb.zeroed {
		return nil
	}
	result := make([]byte, len(sb.data))
	copy(result, sb.data)
	return result
}

// Destroy securely zeros the memory and marks as destroyed
func (sb *SecureBytes) Destroy() {
	if !sb.zeroed && sb.data != nil {
		// Fill with random data first
		rand.Read(sb.data)
		
		// Then zero out
		for i := range sb.data {
			sb.data[i] = 0
		}
		
		// Force garbage collection to prevent compiler optimizations
		runtime.KeepAlive(sb.data)
		
		sb.zeroed = true
		sb.data = nil
		
		// Clear finalizer since we've manually destroyed
		runtime.SetFinalizer(sb, nil)
	}
}

// SecureString represents a string that will be securely zeroed
type SecureString struct {
	bytes *SecureBytes
}

// NewSecureString creates a new SecureString
func NewSecureString(s string) *SecureString {
	sb := NewSecureBytesFromSlice([]byte(s))
	return &SecureString{bytes: sb}
}

// String returns the string value
func (ss *SecureString) String() string {
	if ss.bytes == nil || ss.bytes.zeroed {
		return ""
	}
	return string(ss.bytes.Bytes())
}

// Destroy securely destroys the string
func (ss *SecureString) Destroy() {
	if ss.bytes != nil {
		ss.bytes.Destroy()
		ss.bytes = nil
	}
}

// SecureZeroMemory attempts to securely zero memory at the given address
func SecureZeroMemory(ptr unsafe.Pointer, size uintptr) {
	if ptr == nil || size == 0 {
		return
	}
	
	// Convert to byte slice for manipulation
	slice := (*[1 << 30]byte)(ptr)[:size:size]
	
	// Fill with random data first to prevent recovery
	rand.Read(slice)
	
	// Then zero out
	for i := uintptr(0); i < size; i++ {
		slice[i] = 0
	}
	
	// Force memory barrier to prevent compiler optimizations
	runtime.KeepAlive(slice)
}