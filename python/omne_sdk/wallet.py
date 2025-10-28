"""
Wallet and account management for Omne SDK
"""

import os
import secrets
from typing import Optional, Dict, Any
from mnemonic import Mnemonic
from eth_keys import keys
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

from .types import Transaction
from .utils import parse_address
from .exceptions import WalletError, ValidationError


class Account:
    """
    Represents an Omne account with private key management
    """
    
    def __init__(self, private_key: bytes):
        """
        Initialize account from private key
        
        Args:
            private_key: 32-byte private key
        """
        if len(private_key) != 32:
            raise ValidationError("Private key must be 32 bytes")
            
        self._private_key = keys.PrivateKey(private_key)
        self._public_key = self._private_key.public_key
        
    @property
    def private_key_hex(self) -> str:
        """Private key as hex string"""
        return self._private_key.to_hex()
    
    @property
    def public_key_hex(self) -> str:
        """Public key as hex string"""
        return self._public_key.to_hex()
    
    @property
    def address(self) -> str:
        """Account address"""
        # Generate Omne address from public key
        from Crypto.Hash import keccak
        
        # Get uncompressed public key bytes (remove 0x04 prefix)
        public_key_bytes = bytes.fromhex(self._public_key.to_hex()[2:])
        public_key_uncompressed = public_key_bytes[1:]  # Remove first byte (0x04)
        
        # Hash with Keccak-256
        hash_obj = keccak.new(digest_bits=256)
        hash_obj.update(public_key_uncompressed)
        address_bytes = hash_obj.digest()[-20:]  # Take last 20 bytes
        
        # Convert to Omne address format
        from .utils import to_omne_address
        return to_omne_address(address_bytes)
    
    def sign_message(self, message: bytes) -> str:
        """
        Sign a message with this account's private key
        
        Args:
            message: Message to sign
            
        Returns:
            Hex-encoded signature
        """
        signature = self._private_key.sign_msg(message)
        return signature.to_hex()
    
    def sign_transaction(self, transaction: Transaction) -> str:
        """
        Sign a transaction
        
        Args:
            transaction: Transaction to sign
            
        Returns:
            Hex-encoded signature
        """
        # Create transaction hash for signing
        tx_hash = self._create_transaction_hash(transaction)
        return self.sign_message(tx_hash)
    
    def _create_transaction_hash(self, transaction: Transaction) -> bytes:
        """Create hash of transaction for signing"""
        # Simplified transaction hash - in production would use RLP encoding
        tx_data = (
            f"{transaction.from_address}"
            f"{transaction.to_address}"
            f"{transaction.value_quar}"
            f"{transaction.gas_limit}"
            f"{transaction.gas_price_quar}"
            f"{transaction.nonce}"
            f"{transaction.data}"
        ).encode()
        
        digest = hashes.Hash(hashes.SHA256(), backend=default_backend())
        digest.update(tx_data)
        return digest.finalize()


class Wallet:
    """
    HD Wallet implementation for Omne with BIP39 mnemonic support
    """
    
    def __init__(self, mnemonic: str, password: str = ""):
        """
        Initialize wallet from mnemonic
        
        Args:
            mnemonic: BIP39 mnemonic phrase
            password: Optional password for additional security
        """
        self.mnemonic_obj = Mnemonic("english")
        
        if not self.mnemonic_obj.check(mnemonic):
            raise WalletError("Invalid mnemonic phrase")
            
        self.mnemonic = mnemonic
        self.password = password
        self._seed = self.mnemonic_obj.to_seed(mnemonic, password)
        self._accounts: Dict[int, Account] = {}
    
    @classmethod
    def generate(cls, strength: int = 128, password: str = "") -> 'Wallet':
        """
        Generate a new wallet with random mnemonic
        
        Args:
            strength: Entropy strength in bits (128, 160, 192, 224, 256)
            password: Optional password
            
        Returns:
            New Wallet instance
        """
        if strength not in [128, 160, 192, 224, 256]:
            raise ValueError("Strength must be 128, 160, 192, 224, or 256 bits")
            
        mnemonic_obj = Mnemonic("english")
        mnemonic = mnemonic_obj.generate(strength=strength)
        
        return cls(mnemonic, password)
    
    @classmethod
    def from_private_key(cls, private_key: str) -> Account:
        """
        Create account directly from private key
        
        Args:
            private_key: Hex-encoded private key
            
        Returns:
            Account instance
        """
        if private_key.startswith('0x'):
            private_key = private_key[2:]
            
        try:
            private_key_bytes = bytes.fromhex(private_key)
        except ValueError:
            raise WalletError("Invalid private key format")
            
        return Account(private_key_bytes)
    
    def get_account(self, index: int = 0) -> Account:
        """
        Get account at derivation path index
        
        Args:
            index: Account index (default: 0)
            
        Returns:
            Account instance
        """
        if index in self._accounts:
            return self._accounts[index]
        
        # Use secure and deterministic key derivation so the same mnemonic
        # reproduces identical accounts across sessions while keeping salts unique.
        import hashlib

        index_bytes = index.to_bytes(4, byteorder='big')
        salt_material = self._seed + index_bytes + b"omne_account_derivation"
        account_salt = hashlib.sha256(salt_material).digest()
        
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=account_salt,
            iterations=100000,  # Increased from 2048 to 100,000 for security
            backend=default_backend()
        )
        
        private_key_bytes = bytearray(kdf.derive(self._seed))
        account = Account(bytes(private_key_bytes))
        
        # Zero out sensitive data immediately
        for i in range(len(private_key_bytes)):
            private_key_bytes[i] = 0
            
        self._accounts[index] = account
        return account
    
    @property
    def address(self) -> str:
        """Primary account address (index 0)"""
        return self.get_account(0).address
    
    def export_account(self, index: int = 0, password: str = "") -> Dict[str, str]:
        """
        Export account as encrypted keystore
        
        Args:
            index: Account index
            password: Encryption password
            
        Returns:
            Keystore dictionary
        """
        account = self.get_account(index)
        
        if not password:
            # Return unencrypted (WARNING: insecure)
            return {
                "address": account.address,
                "private_key": account.private_key_hex,
                "public_key": account.public_key_hex,
                "encrypted": False
            }
        
        # Encrypt private key with secure parameters
        import secrets
        salt = secrets.token_bytes(32)  # Increased salt size to 32 bytes
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,  # Increased from 4096 to 100,000 iterations
            backend=default_backend()
        )
        encryption_key = bytearray(kdf.derive(password.encode('utf-8')))

        # Use AES-256-GCM for authenticated encryption
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        nonce = secrets.token_bytes(12)  # GCM nonce (96 bits)
        aesgcm = AESGCM(bytes(encryption_key))

        # Get private key bytes
        private_key_bytes = bytearray(bytes.fromhex(account.private_key_hex[2:]))

        # Encrypt with authenticated encryption
        ciphertext = aesgcm.encrypt(nonce, private_key_bytes, None)

        # Zero out sensitive data
        for i in range(len(encryption_key)):
            encryption_key[i] = 0
        for i in range(len(private_key_bytes)):
            private_key_bytes[i] = 0
        
        return {
            "address": account.address,
            "encrypted_key": ciphertext.hex(),
            "salt": salt.hex(),
            "nonce": nonce.hex(),  # GCM uses nonce instead of IV
            "kdf": "pbkdf2",
            "iterations": 100000,
            "cipher": "aes-256-gcm",
            "encrypted": True
        }
    
    @classmethod
    def import_keystore(cls, keystore: Dict[str, str], password: str = "") -> Account:
        """
        Import account from keystore
        
        Args:
            keystore: Keystore dictionary
            password: Decryption password
            
        Returns:
            Account instance
        """
        if not keystore.get("encrypted", True):
            # Unencrypted keystore
            private_key = keystore["private_key"]
            return cls.from_private_key(private_key)
        
        if not password:
            raise WalletError("Password required for encrypted keystore")
        
        # Check keystore format and decrypt accordingly
        cipher_type = keystore.get("cipher", "aes-256-cbc")  # Default to old format
        
        if cipher_type == "aes-256-gcm":
            # New secure format with authenticated encryption
            salt = bytes.fromhex(keystore["salt"])
            nonce = bytes.fromhex(keystore["nonce"])
            encrypted_key = bytes.fromhex(keystore["encrypted_key"])
            iterations = keystore.get("iterations", 100000)

            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=iterations,
                backend=default_backend()
            )
            decryption_key = bytearray(kdf.derive(password.encode('utf-8')))

            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            aesgcm = AESGCM(bytes(decryption_key))

            try:
                private_key_bytes = bytearray(aesgcm.decrypt(nonce, encrypted_key, None))
            except Exception:
                raise WalletError("Invalid password or corrupted keystore")
            finally:
                # Zero out decryption key
                for i in range(len(decryption_key)):
                    decryption_key[i] = 0

        else:
            # Legacy format (CBC mode) - maintain backward compatibility
            salt = bytes.fromhex(keystore["salt"])
            iv = bytes.fromhex(keystore.get("iv", keystore.get("nonce", "")))
            encrypted_key = bytes.fromhex(keystore["encrypted_key"])
            iterations = keystore.get("iterations", 4096)

            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=iterations,
                backend=default_backend()
            )
            key = bytearray(kdf.derive(password.encode()))

            cipher = Cipher(
                algorithms.AES(bytes(key)),
                modes.CBC(iv),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()

            decrypted = decryptor.update(encrypted_key) + decryptor.finalize()
            private_key_bytes = bytearray(decrypted.rstrip(b'\x00'))

            # Zero out key
            for i in range(len(key)):
                key[i] = 0
        
        # Create account and zero out private key bytes
        account = Account(bytes(private_key_bytes))

        # Zero out private key bytes
        for i in range(len(private_key_bytes)):
            private_key_bytes[i] = 0

        return account
    
    def sign_transaction(self, transaction: Transaction, account_index: int = 0) -> str:
        """
        Sign transaction with specified account
        
        Args:
            transaction: Transaction to sign
            account_index: Account index to use for signing
            
        Returns:
            Hex-encoded signature
        """
        account = self.get_account(account_index)
        return account.sign_transaction(transaction)
    
    def get_mnemonic_words(self) -> list:
        """Get mnemonic as list of words"""
        return self.mnemonic.split()
    
    def verify_mnemonic(self, mnemonic: str) -> bool:
        """Verify if mnemonic matches this wallet"""
        return mnemonic == self.mnemonic
