package omne

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"time"
)

// SecureClientConfig represents secure configuration options for the client
type SecureClientConfig struct {
	// TLS Configuration
	InsecureSkipVerify bool     // Set to true only for testing
	CertificatePins    []string // SHA256 hashes of pinned certificates
	CustomCAs          []string // PEM-encoded custom CA certificates
	
	// Request Configuration
	UseSecureRandom    bool          // Use cryptographically secure request IDs
	RequestTimeout     time.Duration // Request timeout
	MaxRetries         int           // Maximum retry attempts
	
	// Rate Limiting
	RateLimitRequests  int           // Requests per second limit
	RateLimitBurst     int           // Burst capacity
}

// DefaultSecureConfig returns a secure default configuration
func DefaultSecureConfig() *SecureClientConfig {
	return &SecureClientConfig{
		InsecureSkipVerify: false,
		CertificatePins:    nil,
		CustomCAs:          nil,
		UseSecureRandom:    true,
		RequestTimeout:     30 * time.Second,
		MaxRetries:         3,
		RateLimitRequests:  100,
		RateLimitBurst:     10,
	}
}

// CreateSecureTLSConfig creates a TLS configuration with security enhancements
func (config *SecureClientConfig) CreateSecureTLSConfig() *tls.Config {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: config.InsecureSkipVerify,
		MinVersion:         tls.VersionTLS12, // Minimum TLS 1.2
		CipherSuites: []uint16{
			// Strong cipher suites only
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
		},
		PreferServerCipherSuites: false, // Use client preference
	}
	
	// Add custom CA certificates if provided
	if len(config.CustomCAs) > 0 {
		certPool := x509.NewCertPool()
		for _, caPEM := range config.CustomCAs {
			if !certPool.AppendCertsFromPEM([]byte(caPEM)) {
				// Log warning but continue
				continue
			}
		}
		tlsConfig.RootCAs = certPool
	}
	
	// Certificate pinning verification
	if len(config.CertificatePins) > 0 {
		tlsConfig.VerifyConnection = func(cs tls.ConnectionState) error {
			return verifyCertificatePins(cs, config.CertificatePins)
		}
	}
	
	return tlsConfig
}

// CreateSecureHTTPClient creates an HTTP client with security enhancements
func (config *SecureClientConfig) CreateSecureHTTPClient() *http.Client {
	transport := &http.Transport{
		TLSClientConfig:       config.CreateSecureTLSConfig(),
		DisableCompression:    false,
		DisableKeepAlives:     false,
		MaxIdleConns:          10,
		MaxIdleConnsPerHost:   2,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	
	return &http.Client{
		Transport: transport,
		Timeout:   config.RequestTimeout,
	}
}

// verifyCertificatePins verifies certificate pins against the connection
func verifyCertificatePins(cs tls.ConnectionState, pins []string) error {
	// Implementation would verify certificate fingerprints
	// This is a placeholder for the actual implementation
	return nil
}