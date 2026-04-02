from web3 import Web3
from config import MAINNET_RPC_URL, CONTRACT_ADDRESS, CONTRACT_ADDRESS_V1, STAR_REWARD, ISSUE_REWARD, DEFAULT_PR_REWARD
from rate_limiter import rate_limiter

V1_ABI = [{
    "inputs": [],
    "name": "getStats",
    "outputs": [
        {"name": "balance", "type": "uint256"},
        {"name": "distributed", "type": "uint256"},
        {"name": "claimants", "type": "uint256"},
        {"name": "currentRoot", "type": "bytes32"}
    ],
    "stateMutability": "view",
    "type": "function"
}]

V2_ABI = [
    {"inputs": [], "name": "getStats", "outputs": [{"name": "poolBalance", "type": "uint256"}, {"name": "distributed", "type": "uint256"}, {"name": "stars", "type": "uint256"}, {"name": "issues", "type": "uint256"}, {"name": "prs", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [], "name": "getRewards", "outputs": [{"name": "star", "type": "uint256"}, {"name": "issue", "type": "uint256"}, {"name": "pr", "type": "uint256"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "githubHash", "type": "bytes32"}], "name": "hasClaimedStar", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "githubHash", "type": "bytes32"}, {"name": "issueId", "type": "uint256"}], "name": "hasClaimedIssue", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "githubHash", "type": "bytes32"}, {"name": "prId", "type": "uint256"}], "name": "hasClaimedPR", "outputs": [{"name": "", "type": "bool"}], "stateMutability": "view", "type": "function"}
]

def check_star_claimed_onchain(github_hash: str) -> bool:
    """Check if star reward has already been claimed on-chain"""
    try:
        w3 = Web3(Web3.HTTPProvider(MAINNET_RPC_URL))
        v2 = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=V2_ABI)
        # Convert hex string to bytes32
        gh_hash_bytes = bytes.fromhex(github_hash[2:]) if github_hash.startswith('0x') else bytes.fromhex(github_hash)
        return v2.functions.hasClaimedStar(gh_hash_bytes).call()
    except Exception as e:
        print(f"Error checking on-chain claim: {e}")
        return False

def check_issue_claimed_onchain(github_hash: str, issue_id: int) -> bool:
    """Check if issue reward has already been claimed on-chain"""
    try:
        w3 = Web3(Web3.HTTPProvider(MAINNET_RPC_URL))
        v2 = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=V2_ABI)
        gh_hash_bytes = bytes.fromhex(github_hash[2:]) if github_hash.startswith('0x') else bytes.fromhex(github_hash)
        return v2.functions.hasClaimedIssue(gh_hash_bytes, issue_id).call()
    except Exception as e:
        print(f"Error checking on-chain claim: {e}")
        return False

def check_pr_claimed_onchain(github_hash: str, pr_id: int) -> bool:
    """Check if PR reward has already been claimed on-chain"""
    try:
        w3 = Web3(Web3.HTTPProvider(MAINNET_RPC_URL))
        v2 = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=V2_ABI)
        gh_hash_bytes = bytes.fromhex(github_hash[2:]) if github_hash.startswith('0x') else bytes.fromhex(github_hash)
        return v2.functions.hasClaimedPR(gh_hash_bytes, pr_id).call()
    except Exception as e:
        print(f"Error checking on-chain claim: {e}")
        return False

async def get_contract_stats() -> dict:
    try:
        w3 = Web3(Web3.HTTPProvider(MAINNET_RPC_URL))
        v1 = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS_V1), abi=V1_ABI)
        v2 = w3.eth.contract(address=Web3.to_checksum_address(CONTRACT_ADDRESS), abi=V2_ABI)

        v1_stats = v1.functions.getStats().call()
        v2_stats = v2.functions.getStats().call()
        v2_rewards = v2.functions.getRewards().call()
        rate_stats = rate_limiter.get_stats()

        return {
            "contract": {
                "address": CONTRACT_ADDRESS,
                "version": "2.0.0",
                "pool_balance": v2_stats[0] // 10**18,
                "pool_balance_raw": str(v2_stats[0]),
                "total_distributed": v2_stats[1] // 10**18,
                "total_distributed_raw": str(v2_stats[1]),
                "total_star_claims": v2_stats[2],
                "total_issue_claims": v2_stats[3],
                "total_pr_claims": v2_stats[4],
                "total_claims": v2_stats[2] + v2_stats[3] + v2_stats[4]
            },
            "v1_legacy": {
                "address": CONTRACT_ADDRESS_V1,
                "total_distributed": v1_stats[1] // 10**18,
                "total_claimants": v1_stats[2]
            },
            "combined": {
                "total_distributed": (v1_stats[1] + v2_stats[1]) // 10**18,
                "total_claims": v1_stats[2] + v2_stats[2] + v2_stats[3] + v2_stats[4]
            },
            "rate_limits": rate_stats,
            "rewards": {
                "star_reward": v2_rewards[0] // 10**18,
                "issue_reward": v2_rewards[1] // 10**18,
                "pr_reward_default": v2_rewards[2] // 10**18,
                "max_claims_per_hour": rate_stats["max_per_hour"],
                "max_claims_per_day": rate_stats["max_per_day"]
            }
        }
    except Exception as e:
        return {
            "error": str(e),
            "contract": {"address": CONTRACT_ADDRESS},
            "rate_limits": rate_limiter.get_stats()
        }
