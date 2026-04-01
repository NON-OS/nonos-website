var NoxContribute = window.NoxContribute || {};

NoxContribute.CONFIG = {
  API_URL: 'https://nonos.software/api',
  REPO_OWNER: 'NON-OS',
  REPO_NAME: 'nonos-kernel',
  REWARDS_CONTRACT: '0xAcb70B0F83f676ef17abEA09101B9797b6bCF95f',
  REWARDS_V1: '0xBB84284EE52cCef27FCC915ecb28bDa5DBb6809A',
  NOX_TOKEN: '0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA',
  CHAIN_ID: 1,
  CHAIN_NAME: 'Ethereum Mainnet',
  RPC_URL: 'https://eth.llamarpc.com'
};

NoxContribute.V2_ABI = [
  'function claimStar(uint256 nonce, bytes32 githubHash, bytes signature) external',
  'function claimIssue(uint256 issueId, uint256 nonce, bytes32 githubHash, bytes signature) external',
  'function claimPR(uint256 prId, uint256 amount, uint256 nonce, bytes32 githubHash, bytes signature) external',
  'function hasClaimedStar(bytes32 githubHash) view returns (bool)',
  'function hasClaimedIssue(bytes32 githubHash, uint256 issueId) view returns (bool)',
  'function hasClaimedPR(bytes32 githubHash, uint256 prId) view returns (bool)',
  'function getStats() view returns (uint256 poolBalance, uint256 distributed, uint256 stars, uint256 issues, uint256 prs)',
  'function getRewards() view returns (uint256 star, uint256 issue, uint256 pr)'
];

window.NoxContribute = NoxContribute;
