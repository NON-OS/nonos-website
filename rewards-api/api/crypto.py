import os
import base64
import hashlib
import secrets
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
_salt = b"nox_rewards_v2_salt"

def _derive_key(password: str) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=_salt, iterations=100000)
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))

_fernet = Fernet(_derive_key(ENCRYPTION_KEY))

def encrypt(data: str) -> str:
    return _fernet.encrypt(data.encode()).decode()

def decrypt(token: str) -> str:
    return _fernet.decrypt(token.encode()).decode()

def hash_data(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()

def generate_token(length: int = 32) -> str:
    return secrets.token_urlsafe(length)

def verify_hash(data: str, expected_hash: str) -> bool:
    return hashlib.sha256(data.encode()).hexdigest() == expected_hash

def encrypt_wallet(wallet: str) -> str:
    return encrypt(wallet.lower())

def decrypt_wallet(token: str) -> str:
    return decrypt(token)

def hash_github(username: str) -> str:
    return hash_data(username.lower() + _salt.decode())
