package omne

import (
	"sync"
	"time"
)

// RateLimiter implements a token bucket rate limiter
type RateLimiter struct {
	mu             sync.Mutex
	tokens         float64
	capacity       float64
	refillRate     float64 // tokens per second
	lastRefill     time.Time
	requestTimes   []time.Time // Track request times for sliding window
	windowSize     time.Duration
	maxRequests    int
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter(capacity float64, refillRate float64, windowSize time.Duration, maxRequests int) *RateLimiter {
	return &RateLimiter{
		tokens:      capacity,
		capacity:    capacity,
		refillRate:  refillRate,
		lastRefill:  time.Now(),
		windowSize:  windowSize,
		maxRequests: maxRequests,
	}
}

// DefaultRateLimiter returns a rate limiter with sensible defaults
func DefaultRateLimiter() *RateLimiter {
	return NewRateLimiter(
		100,                 // 100 token capacity
		10,                  // 10 tokens per second refill rate
		time.Minute,         // 1 minute sliding window
		100,                 // 100 requests per minute max
	)
}

// Allow checks if a request should be allowed
func (rl *RateLimiter) Allow() bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	now := time.Now()
	
	// Refill tokens based on time elapsed
	elapsed := now.Sub(rl.lastRefill).Seconds()
	rl.tokens = min(rl.capacity, rl.tokens+elapsed*rl.refillRate)
	rl.lastRefill = now
	
	// Check sliding window limit
	cutoff := now.Add(-rl.windowSize)
	validRequests := 0
	for i := len(rl.requestTimes) - 1; i >= 0; i-- {
		if rl.requestTimes[i].After(cutoff) {
			validRequests++
		} else {
			// Remove old requests
			rl.requestTimes = rl.requestTimes[i+1:]
			break
		}
	}
	
	// Check both token bucket and sliding window
	if rl.tokens >= 1 && validRequests < rl.maxRequests {
		rl.tokens--
		rl.requestTimes = append(rl.requestTimes, now)
		return true
	}
	
	return false
}

// WaitTime returns the estimated wait time until the next request would be allowed
func (rl *RateLimiter) WaitTime() time.Duration {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	now := time.Now()
	
	// Calculate wait time for token bucket
	tokensNeeded := 1 - rl.tokens
	tokenWait := time.Duration(0)
	if tokensNeeded > 0 {
		tokenWait = time.Duration(tokensNeeded/rl.refillRate) * time.Second
	}
	
	// Calculate wait time for sliding window
	cutoff := now.Add(-rl.windowSize)
	validRequests := 0
	oldestValidRequest := now
	
	for _, reqTime := range rl.requestTimes {
		if reqTime.After(cutoff) {
			validRequests++
			if reqTime.Before(oldestValidRequest) {
				oldestValidRequest = reqTime
			}
		}
	}
	
	windowWait := time.Duration(0)
	if validRequests >= rl.maxRequests {
		windowWait = rl.windowSize - now.Sub(oldestValidRequest)
		if windowWait < 0 {
			windowWait = 0
		}
	}
	
	// Return the maximum of the two wait times
	if tokenWait > windowWait {
		return tokenWait
	}
	return windowWait
}

// Reset resets the rate limiter state
func (rl *RateLimiter) Reset() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	
	rl.tokens = rl.capacity
	rl.lastRefill = time.Now()
	rl.requestTimes = nil
}

// ExponentialBackoff implements exponential backoff with jitter
type ExponentialBackoff struct {
	initialDelay time.Duration
	maxDelay     time.Duration
	multiplier   float64
	jitter       bool
	attempts     int
}

// NewExponentialBackoff creates a new exponential backoff instance
func NewExponentialBackoff(initialDelay, maxDelay time.Duration, multiplier float64, jitter bool) *ExponentialBackoff {
	return &ExponentialBackoff{
		initialDelay: initialDelay,
		maxDelay:     maxDelay,
		multiplier:   multiplier,
		jitter:       jitter,
	}
}

// DefaultExponentialBackoff returns backoff with sensible defaults
func DefaultExponentialBackoff() *ExponentialBackoff {
	return NewExponentialBackoff(
		100*time.Millisecond, // Start with 100ms
		30*time.Second,       // Max 30 seconds
		2.0,                  // Double each time
		true,                 // Add jitter
	)
}

// NextDelay calculates the next delay duration
func (eb *ExponentialBackoff) NextDelay() time.Duration {
	eb.attempts++
	
	delay := eb.initialDelay
	for i := 1; i < eb.attempts; i++ {
		delay = time.Duration(float64(delay) * eb.multiplier)
		if delay > eb.maxDelay {
			delay = eb.maxDelay
			break
		}
	}
	
	if eb.jitter {
		// Add up to 25% jitter
		jitterMs := int64(float64(delay.Milliseconds()) * 0.25)
		if jitterMs > 0 {
			// Use secure random for jitter
			jitterBytes, _ := SecureRandomBytes(8)
			jitterValue := int64(jitterBytes[0]) % jitterMs
			delay += time.Duration(jitterValue) * time.Millisecond
		}
	}
	
	return delay
}

// Reset resets the backoff attempts counter
func (eb *ExponentialBackoff) Reset() {
	eb.attempts = 0
}

// min helper function
func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}