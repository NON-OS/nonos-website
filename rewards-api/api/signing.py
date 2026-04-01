import time
from fastapi import HTTPException
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3
from config import SIGNER_PRIVATE_KEY, CHAIN_ID, CONTRACT_ADDRESS

SIG_STAR = Web3.keccak(text="STAR_CLAIM_V2")
SIG_ISSUE = Web3.keccak(text="ISSUE_CLAIM_V2")
SIG_PR = Web3.keccak(text="PR_CLAIM_V2")

def github_hash(username: str) -> str:
    h = Web3.keccak(text=username.lower()).hex()
    return h if h.startswith('0x') else '0x' + h

def generate_nonce() -> int:
    return int(time.time() * 1000)

def _sign(message_hash: bytes) -> str:
    if not SIGNER_PRIVATE_KEY:
        raise HTTPException(500, "Signer not configured")
    message = encode_defunct(message_hash)
    signed = Account.sign_message(message, SIGNER_PRIVATE_KEY)
    sig = signed.signature.hex()
    return sig if sig.startswith('0x') else '0x' + sig

def _gh_bytes(gh_hash: str) -> bytes:
    return bytes.fromhex(gh_hash[2:]) if gh_hash.startswith('0x') else bytes.fromhex(gh_hash)

def sign_star_claim(wallet: str, amount: int, nonce: int, gh_hash: str) -> str:
    message_hash = Web3.solidity_keccak(
        ['address', 'uint256', 'uint256', 'bytes32', 'bytes32', 'uint256', 'address'],
        [Web3.to_checksum_address(wallet), amount, nonce, _gh_bytes(gh_hash), SIG_STAR, CHAIN_ID, Web3.to_checksum_address(CONTRACT_ADDRESS)]
    )
    return _sign(message_hash)

def sign_issue_claim(wallet: str, amount: int, nonce: int, gh_hash: str, issue_id: int) -> str:
    message_hash = Web3.solidity_keccak(
        ['address', 'uint256', 'uint256', 'bytes32', 'uint256', 'bytes32', 'uint256', 'address'],
        [Web3.to_checksum_address(wallet), amount, nonce, _gh_bytes(gh_hash), issue_id, SIG_ISSUE, CHAIN_ID, Web3.to_checksum_address(CONTRACT_ADDRESS)]
    )
    return _sign(message_hash)

def sign_pr_claim(wallet: str, amount: int, nonce: int, gh_hash: str, pr_id: int) -> str:
    message_hash = Web3.solidity_keccak(
        ['address', 'uint256', 'uint256', 'bytes32', 'uint256', 'bytes32', 'uint256', 'address'],
        [Web3.to_checksum_address(wallet), amount, nonce, _gh_bytes(gh_hash), pr_id, SIG_PR, CHAIN_ID, Web3.to_checksum_address(CONTRACT_ADDRESS)]
    )
    return _sign(message_hash)

def sign_claim(wallet: str, amount: int, nonce: int, gh_hash: str) -> str:
    return sign_star_claim(wallet, amount, nonce, gh_hash)
