var CONFIG = {
    STAKING_ADDRESS: '0xa94d6009790ba13597a1e1b7cf4e1531ea513613',
    NOX_TOKEN_ADDRESS: '0x0a26c80Be4E060e688d7C23aDdB92cBb5D2C9eCA',
    ZEROSTATE_PASS_ADDRESS: '0x7b575DD8e8b111c52Ab1e872924d4Efd4DF403df',
    RPC_URL: 'https://ethereum-rpc.publicnode.com',
    WC_PROJECT_ID: 'f6660eeed931e1739a01b78e47a5dacd'
};

var STAKING_ABI = [
    'function stake(uint256 amount) external',
    'function stakeLocked(uint256 amount, uint256 lockPeriod) external',
    'function unstake(uint256 amount) external',
    'function unstakePosition(uint256 positionId) external',
    'function earlyUnlock(uint256 positionId) external',
    'function extendLock(uint256 positionId, uint256 newLockPeriod) external',
    'function claimRewards() external',
    'function refreshBoost(address user) external',
    'function getStakeInfo(address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256)',
    'function pendingRewards(address user) view returns (uint256)',
    'function totalStaked() view returns (uint256)',
    'function getEmissionRate() view returns (uint256)',
    'function getUserPositions(address user) view returns (uint256[],uint256[],uint256[],uint256[],bool[],bool[])',
    'function getPosition(address user, uint256 positionId) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool)',
    'function earlyUnlockPenaltyBps() view returns (uint256)',
    'function version() view returns (string)'
];

var ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)'
];

var ERC721_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function ownerOf(uint256 tokenId) view returns (address)'
];

var LOCK_BOOSTS = {
    '0': '',
    '2592000': '+20%',
    '5184000': '+40%',
    '7776000': '+60%',
    '15552000': '+80%',
    '31536000': '+150%'
};
