"""
Utility functions for Omne SDK
"""

from typing import Union
from decimal import Decimal

# Quar conversion constants
QUAR_PER_OMC = 10**18
QUAR_PER_MICRO_OMC = 10**12
QUAR_PER_MILLI_OMC = 10**15

LOWER_HEX_DIGITS = set("0123456789abcdef")


def to_quar(omc_amount: Union[str, int, float, Decimal]) -> int:
    """
    Convert OMC amount to quar (10^-18 OMC precision)
    
    Args:
        omc_amount: Amount in OMC
        
    Returns:
        Amount in quar (int)
        
    Example:
        >>> to_quar(1.0)
        1000000000000000000
        >>> to_quar("0.001")
        1000000000000000
    """
    if isinstance(omc_amount, str):
        omc_amount = Decimal(omc_amount)
    elif isinstance(omc_amount, (int, float)):
        omc_amount = Decimal(str(omc_amount))
    
    return int(omc_amount * QUAR_PER_OMC)


def from_quar(quar_amount: int) -> Decimal:
    """
    Convert quar amount to OMC
    
    Args:
        quar_amount: Amount in quar
        
    Returns:
        Amount in OMC (Decimal)
        
    Example:
        >>> from_quar(1000000000000000000)
        Decimal('1.0')
        >>> from_quar(1000000000000000)
        Decimal('0.001')
    """
    return Decimal(quar_amount) / Decimal(QUAR_PER_OMC)


def to_omc(quar_amount: int) -> Decimal:
    """Alias for from_quar for convenience"""
    return from_quar(quar_amount)


def from_omc(omc_amount: Union[str, int, float, Decimal]) -> int:
    """Alias for to_quar for convenience"""
    return to_quar(omc_amount)


def format_balance(quar_amount: int, decimals: int = 6) -> str:
    """
    Format quar amount as human-readable OMC string
    
    Args:
        quar_amount: Amount in quar
        decimals: Number of decimal places to show
        
    Returns:
        Formatted string
        
    Example:
        >>> format_balance(1500000000000000000)
        '1.500000 OMC'
        >>> format_balance(1500000000000000000, 2)
        '1.50 OMC'
    """
    omc_amount = from_quar(quar_amount)
    return f"{omc_amount:.{decimals}f} OMC"


def parse_address(address: str) -> str:
    """
    Validate and normalize an Omne address
    
    Args:
        address: Address to validate
        
    Returns:
        Normalized address
        
    Raises:
        ValueError: If address is invalid
    """
    if not isinstance(address, str):
        raise ValueError("Address must be a string")
    
    # Check for Omne address format (omne1...)
    if address.startswith('omne1'):
        return _validate_omne_address(address)
    
    # For backward compatibility, also accept hex addresses
    return _validate_hex_address(address)


def _validate_omne_address(address: str) -> str:
    """Validate omne1 address format"""
    if not address.startswith('omne1'):
        raise ValueError("Invalid Omne address format - must start with 'omne1'")

    encoded = address[5:]
    if len(encoded) != 40:
        raise ValueError("Invalid Omne address length - expected 40 hex characters")

    if encoded.lower() != encoded:
        raise ValueError("Invalid Omne address - uppercase characters are not allowed")

    if not all(char in LOWER_HEX_DIGITS for char in encoded):
        raise ValueError("Invalid characters in Omne address")

    return f"0x{encoded}"


def _validate_hex_address(address: str) -> str:
    """Validate hex address format (for backward compatibility)"""
    # Remove 0x prefix if present
    if address.startswith('0x'):
        address = address[2:]

    if address.lower() != address:
        raise ValueError("Invalid address - uppercase characters are not allowed")
    
    # Check length (40 hex characters = 20 bytes)
    if len(address) != 40:
        raise ValueError(f"Invalid address length: {len(address)}, expected 40")
    
    # Check hex format
    try:
        int(address, 16)
    except ValueError:
        raise ValueError("Address contains invalid hex characters")
    
    # Return with 0x prefix
    return f"0x{address.lower()}"


def to_omne_address(address_bytes: bytes) -> str:
    """
    Convert 20-byte address to Omne format (omne1...)
    
    Args:
        address_bytes: 20-byte address
        
    Returns:
        Omne address string
    """
    if len(address_bytes) != 20:
        raise ValueError("Address must be exactly 20 bytes")
    
    encoded = address_bytes.hex()
    return f"omne1{encoded}"


def from_omne_address(address: str) -> bytes:
    """
    Convert Omne address back to 20-byte array
    
    Args:
        address: Omne address string
        
    Returns:
        20-byte address
        
    Raises:
        ValueError: If address is invalid
    """
    if not address.startswith('omne1'):
        raise ValueError("Invalid Omne address format - must start with 'omne1'")
    
    encoded = address[5:]
    if len(encoded) != 40:
        raise ValueError("Invalid Omne address length - expected 40 hex characters")

    if not all(char in LOWER_HEX_DIGITS for char in encoded):
        raise ValueError("Invalid characters in Omne address")

    try:
        return bytes.fromhex(encoded)
    except ValueError as exc:
        raise ValueError("Invalid hex characters in Omne address") from exc


def is_valid_address(address: str) -> bool:
    """
    Check if an address is valid
    
    Args:
        address: Address to check
        
    Returns:
        True if valid, False otherwise
    """
    try:
        parse_address(address)
        return True
    except ValueError:
        return False


def calculate_gas_cost(gas_used: int, gas_price_quar: int) -> int:
    """
    Calculate total gas cost in quar
    
    Args:
        gas_used: Amount of gas used
        gas_price_quar: Gas price in quar per gas unit
        
    Returns:
        Total cost in quar
    """
    return gas_used * gas_price_quar


def estimate_orc20_deployment_gas() -> int:
    """
    Estimate gas required for ORC-20 token deployment
    
    Returns:
        Estimated gas units
    """
    # Based on Omne's optimized ORC-20 implementation
    return 150_000


def estimate_transfer_gas(has_data: bool = False) -> int:
    """
    Estimate gas required for a transfer
    
    Args:
        has_data: Whether transaction includes data
        
    Returns:
        Estimated gas units
    """
    base_cost = 21_000
    if has_data:
        base_cost += 20_000  # Rough estimate for data
    return base_cost


def chunked_list(items: list, chunk_size: int) -> list:
    """
    Split a list into chunks of specified size
    
    Args:
        items: List to chunk
        chunk_size: Size of each chunk
        
    Returns:
        List of chunks
    """
    return [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]


def safe_int(value: Union[str, int, None], default: int = 0) -> int:
    """
    Safely convert value to int
    
    Args:
        value: Value to convert
        default: Default value if conversion fails
        
    Returns:
        Integer value
    """
    if value is None:
        return default
    
    try:
        if isinstance(value, str):
            # Handle hex strings
            if value.startswith('0x'):
                return int(value, 16)
            return int(value)
        return int(value)
    except (ValueError, TypeError):
        return default


def safe_str(value: Union[str, int, None], default: str = "") -> str:
    """
    Safely convert value to string
    
    Args:
        value: Value to convert
        default: Default value if conversion fails
        
    Returns:
        String value
    """
    if value is None:
        return default
    return str(value)


def generate_block_hash(data=None) -> str:
    """
    Generate Omne block hash with bh_ prefix
    
    Args:
        data: Optional data to include in hash generation
        
    Returns:
        Block hash with bh_ prefix (63 chars total)
        
    Example:
        >>> generate_block_hash()
        'bh_a1b2c3d4e5f6789012345678901234567890123456789012345678901234'
    """
    import secrets
    
    # Generate 30 random bytes (60 hex chars)
    random_bytes = secrets.token_bytes(30)
    hex_string = random_bytes.hex()
    
    return f"bh_{hex_string}"


def generate_transaction_hash(data=None) -> str:
    """
    Generate Omne transaction hash with tx_ prefix
    
    Args:
        data: Optional data to include in hash generation
        
    Returns:
        Transaction hash with tx_ prefix (63 chars total)
        
    Example:
        >>> generate_transaction_hash()
        'tx_a1b2c3d4e5f6789012345678901234567890123456789012345678901234'
    """
    import secrets
    
    # Generate 30 random bytes (60 hex chars)
    random_bytes = secrets.token_bytes(30)
    hex_string = random_bytes.hex()
    
    return f"tx_{hex_string}"


def is_valid_block_hash(hash_value: str) -> bool:
    """
    Validate Omne block hash format
    
    Args:
        hash_value: Hash to validate
        
    Returns:
        True if valid block hash format
        
    Example:
        >>> is_valid_block_hash("bh_a1b2c3d4e5f6789012345678901234567890123456789012345678901234")
        True
        >>> is_valid_block_hash("0x123")
        False
    """
    import re
    
    if not isinstance(hash_value, str) or not hash_value.startswith('bh_'):
        return False
    
    hex_part = hash_value[3:]  # Remove 'bh_' prefix
    return len(hex_part) == 60 and re.match(r'^[0-9a-fA-F]{60}$', hex_part) is not None


def is_valid_transaction_hash(hash_value: str) -> bool:
    """
    Validate Omne transaction hash format
    
    Args:
        hash_value: Hash to validate
        
    Returns:
        True if valid transaction hash format
        
    Example:
        >>> is_valid_transaction_hash("tx_a1b2c3d4e5f6789012345678901234567890123456789012345678901234")
        True
        >>> is_valid_transaction_hash("0x123")
        False
    """
    import re
    
    if not isinstance(hash_value, str) or not hash_value.startswith('tx_'):
        return False
    
    hex_part = hash_value[3:]  # Remove 'tx_' prefix
    return len(hex_part) == 60 and re.match(r'^[0-9a-fA-F]{60}$', hex_part) is not None
