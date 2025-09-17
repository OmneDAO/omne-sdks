"""
Secure client configuration for Omne Python SDK
"""

import ssl
import aiohttp
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field


@dataclass
class SecurityConfig:
    """Security configuration for Omne client"""
    
    # SSL/TLS Configuration
    verify_ssl: bool = True
    ssl_context: Optional[ssl.SSLContext] = None
    certificate_pins: List[str] = field(default_factory=list)
    custom_ca_bundle: Optional[str] = None
    
    # Request Configuration
    use_secure_random: bool = True
    request_timeout: int = 30
    total_timeout: int = 60
    max_retries: int = 3
    retry_delay: float = 1.0
    
    # Rate Limiting
    rate_limit_requests: int = 100
    rate_limit_window: int = 60
    
    # Connection Security
    max_connections: int = 10
    max_connections_per_host: int = 2
    keep_alive_timeout: int = 30
    
    def create_ssl_context(self) -> Optional[ssl.SSLContext]:
        """Create secure SSL context"""
        if not self.verify_ssl:
            return False  # Disable SSL verification
            
        if self.ssl_context:
            return self.ssl_context
            
        # Create secure SSL context
        context = ssl.create_default_context()
        
        # Set minimum TLS version to 1.2
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        
        # Set strong cipher suites
        context.set_ciphers('ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS')
        
        # Verify hostname
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        
        # Load custom CA bundle if provided
        if self.custom_ca_bundle:
            context.load_verify_locations(self.custom_ca_bundle)
            
        return context
    
    def create_connector(self) -> aiohttp.TCPConnector:
        """Create secure TCP connector for aiohttp"""
        ssl_context = self.create_ssl_context()
        
        return aiohttp.TCPConnector(
            ssl=ssl_context,
            limit=self.max_connections,
            limit_per_host=self.max_connections_per_host,
            keepalive_timeout=self.keep_alive_timeout,
            enable_cleanup_closed=True,
            force_close=True,  # Force close connections for security
            verify_ssl=self.verify_ssl
        )
    
    def create_timeout(self) -> aiohttp.ClientTimeout:
        """Create timeout configuration"""
        return aiohttp.ClientTimeout(
            total=self.total_timeout,
            connect=10,
            sock_read=self.request_timeout
        )


class SecureRequestIDGenerator:
    """Generates cryptographically secure request IDs"""
    
    def __init__(self):
        self._counter = 0
        
    def next_id(self) -> int:
        """Generate next secure request ID"""
        import secrets
        
        # Combine secure random with counter for uniqueness
        random_part = secrets.randbits(48)  # 48 bits of randomness
        counter_part = self._counter % (2**16)  # 16 bits of counter
        self._counter += 1
        
        # Combine into 64-bit ID
        request_id = (random_part << 16) | counter_part
        
        # Ensure positive
        return request_id & 0x7FFFFFFFFFFFFFFF


def create_secure_session(config: SecurityConfig) -> aiohttp.ClientSession:
    """Create securely configured aiohttp session"""
    
    connector = config.create_connector()
    timeout = config.create_timeout()
    
    # Security headers
    headers = {
        'User-Agent': 'Omne-Python-SDK/0.1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'X-Requested-With': 'XMLHttpRequest'
    }
    
    return aiohttp.ClientSession(
        connector=connector,
        timeout=timeout,
        headers=headers,
        raise_for_status=False,  # Handle status codes manually for better error handling
        auto_decompress=True,
        trust_env=False  # Don't trust environment variables for proxy settings
    )


def default_security_config() -> SecurityConfig:
    """Get default secure configuration"""
    return SecurityConfig(
        verify_ssl=True,
        use_secure_random=True,
        request_timeout=30,
        total_timeout=60,
        max_retries=3,
        retry_delay=1.0,
        rate_limit_requests=100,
        rate_limit_window=60,
        max_connections=10,
        max_connections_per_host=2,
        keep_alive_timeout=30
    )