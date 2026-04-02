import os

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
SIGNER_PRIVATE_KEY = os.getenv("SIGNER_PRIVATE_KEY", "")
CONTRACT_ADDRESS_V1 = "0xBB84284EE52cCef27FCC915ecb28bDa5DBb6809A"
CONTRACT_ADDRESS_V2 = "0xAcb70B0F83f676ef17abEA09101B9797b6bCF95f"
CONTRACT_ADDRESS_V3 = os.getenv("CONTRACT_ADDRESS_V3", "")  # Set when V3 deployed
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", CONTRACT_ADDRESS_V3 or CONTRACT_ADDRESS_V2)
USE_V3_CONTRACT = os.getenv("USE_V3_CONTRACT", "false").lower() == "true"
CHAIN_ID = int(os.getenv("CHAIN_ID", "1"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://nonos.software")
API_SECRET = os.getenv("API_SECRET", "")
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")
MAINNET_RPC_URL = os.getenv("MAINNET_RPC_URL", "https://eth.llamarpc.com")

STAR_REWARD = 5000 * 10**18
ISSUE_REWARD = 10000 * 10**18
DEFAULT_PR_REWARD = 25000 * 10**18

REPO_OWNER = "NON-OS"
REPO_NAME = "nonos-kernel"

CORS_ORIGINS = [
    FRONTEND_URL,
    "https://nonos.software",
    "http://localhost:1313",
    "http://localhost:1314"
]
