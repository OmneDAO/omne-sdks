"""
Rate limiting and backoff utilities for Omne Python SDK
"""

import asyncio
import time
from typing import List, Optional
from dataclasses import dataclass
import secrets


@dataclass
class RateLimitConfig:
    """Rate limiting configuration"""
    requests_per_second: float = 10.0
    burst_capacity: int = 100
    window_size_seconds: int = 60
    max_requests_per_window: int = 100


class AsyncRateLimiter:
    """
    Async-compatible rate limiter with token bucket and sliding window
    """
    
    def __init__(self, config: RateLimitConfig):
        self.config = config
        self.tokens = float(config.burst_capacity)
        self.last_refill = time.time()
        self.request_times: List[float] = []
        self._lock = asyncio.Lock()
    
    async def is_allowed(self) -> bool:
        """Check if request is allowed under rate limits"""
        async with self._lock:
            return self._check_limits()
    
    def _check_limits(self) -> bool:
        """Internal method to check rate limits (must hold lock)"""
        now = time.time()
        
        # Refill tokens based on elapsed time
        elapsed = now - self.last_refill
        tokens_to_add = elapsed * self.config.requests_per_second
        self.tokens = min(self.config.burst_capacity, self.tokens + tokens_to_add)
        self.last_refill = now
        
        # Clean old requests from sliding window
        cutoff_time = now - self.config.window_size_seconds
        self.request_times = [t for t in self.request_times if t > cutoff_time]
        
        # Check both token bucket and sliding window
        if (self.tokens >= 1.0 and 
            len(self.request_times) < self.config.max_requests_per_window):
            self.tokens -= 1.0
            self.request_times.append(now)
            return True
        
        return False
    
    async def wait_time(self) -> float:
        """Get estimated wait time until next request is allowed"""
        async with self._lock:
            return self._calculate_wait_time()
    
    def _calculate_wait_time(self) -> float:
        """Calculate wait time (must hold lock)"""
        now = time.time()
        
        # Time to get one token
        token_wait = 0.0
        if self.tokens < 1.0:
            tokens_needed = 1.0 - self.tokens
            token_wait = tokens_needed / self.config.requests_per_second
        
        # Time for sliding window to allow requests
        window_wait = 0.0
        cutoff_time = now - self.config.window_size_seconds
        valid_requests = [t for t in self.request_times if t > cutoff_time]
        
        if len(valid_requests) >= self.config.max_requests_per_window:
            oldest_request = min(valid_requests)
            window_wait = max(0, self.config.window_size_seconds - (now - oldest_request))
        
        return max(token_wait, window_wait)
    
    async def reset(self):
        """Reset rate limiter state"""
        async with self._lock:
            self.tokens = float(self.config.burst_capacity)
            self.last_refill = time.time()
            self.request_times.clear()


@dataclass
class BackoffConfig:
    """Exponential backoff configuration"""
    initial_delay: float = 0.1  # 100ms
    max_delay: float = 30.0     # 30 seconds
    multiplier: float = 2.0
    jitter: bool = True
    max_attempts: int = 5


class ExponentialBackoff:
    """
    Exponential backoff with jitter for retry logic
    """
    
    def __init__(self, config: BackoffConfig):
        self.config = config
        self.attempts = 0
    
    def next_delay(self) -> float:
        """Calculate next delay duration"""
        self.attempts += 1
        
        if self.attempts > self.config.max_attempts:
            raise Exception(f"Maximum retry attempts ({self.config.max_attempts}) exceeded")
        
        # Calculate base delay
        delay = self.config.initial_delay * (self.config.multiplier ** (self.attempts - 1))
        delay = min(delay, self.config.max_delay)
        
        # Add jitter if enabled
        if self.config.jitter:
            jitter_range = delay * 0.25  # 25% jitter
            jitter = secrets.randbelow(int(jitter_range * 1000)) / 1000.0
            delay += jitter
        
        return delay
    
    def reset(self):
        """Reset attempt counter"""
        self.attempts = 0
    
    @property
    def should_retry(self) -> bool:
        """Check if more retries are allowed"""
        return self.attempts < self.config.max_attempts


async def with_rate_limiting(
    rate_limiter: AsyncRateLimiter,
    backoff: Optional[ExponentialBackoff] = None,
    operation_name: str = "request"
) -> None:
    """
    Context manager for rate-limited operations
    
    Args:
        rate_limiter: Rate limiter instance
        backoff: Optional backoff for retries
        operation_name: Name for error messages
    """
    max_wait_time = 60.0  # Maximum time to wait for rate limit
    
    while True:
        if await rate_limiter.is_allowed():
            return
        
        wait_time = await rate_limiter.wait_time()
        if wait_time > max_wait_time:
            raise Exception(f"Rate limit wait time ({wait_time:.2f}s) exceeds maximum ({max_wait_time}s) for {operation_name}")
        
        if backoff:
            try:
                backoff_delay = backoff.next_delay()
                actual_delay = min(wait_time, backoff_delay)
            except Exception:
                raise Exception(f"Rate limiting failed for {operation_name} after maximum retries")
        else:
            actual_delay = wait_time
        
        await asyncio.sleep(actual_delay)


def default_rate_limiter() -> AsyncRateLimiter:
    """Create rate limiter with default configuration"""
    return AsyncRateLimiter(RateLimitConfig(
        requests_per_second=10.0,
        burst_capacity=50,
        window_size_seconds=60,
        max_requests_per_window=100
    ))


def default_backoff() -> ExponentialBackoff:
    """Create exponential backoff with default configuration"""
    return ExponentialBackoff(BackoffConfig(
        initial_delay=0.1,
        max_delay=30.0,
        multiplier=2.0,
        jitter=True,
        max_attempts=5
    ))