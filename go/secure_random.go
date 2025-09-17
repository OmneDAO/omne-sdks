package omne

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"sync"
)

// SecureIDGenerator generates cryptographically secure request IDs
type SecureIDGenerator struct {
	mu       sync.Mutex
	buffer   []byte
	position int
}

// NewSecureIDGenerator creates a new secure ID generator
func NewSecureIDGenerator() *SecureIDGenerator {
	return &SecureIDGenerator{
		buffer:   make([]byte, 1024), // Buffer for random bytes
		position: 1024,               // Force initial fill
	}
}

// NextID generates the next secure random ID
func (g *SecureIDGenerator) NextID() (int64, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	
	// Refill buffer if needed
	if g.position+8 > len(g.buffer) {
		if _, err := rand.Read(g.buffer); err != nil {
			return 0, fmt.Errorf("failed to generate random bytes: %w", err)
		}
		g.position = 0
	}
	
	// Read 8 bytes for int64
	id := int64(binary.BigEndian.Uint64(g.buffer[g.position:g.position+8]))
	g.position += 8
	
	// Ensure positive ID (clear sign bit)
	if id < 0 {
		id = -id
	}
	
	// Ensure non-zero
	if id == 0 {
		id = 1
	}
	
	return id, nil
}

// SecureRandomBytes generates cryptographically secure random bytes
func SecureRandomBytes(length int) ([]byte, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return nil, fmt.Errorf("failed to generate random bytes: %w", err)
	}
	return bytes, nil
}

// SecureRandomString generates a cryptographically secure random hex string
func SecureRandomString(byteLength int) (string, error) {
	bytes, err := SecureRandomBytes(byteLength)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", bytes), nil
}