// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title NOXRewards
 * @notice Contributor rewards distribution contract for NONOS
 * @dev Uses Merkle proofs for batch reward distribution and signatures for instant claims
 *
 * Security features:
 * - ReentrancyGuard on all claim functions
 * - SafeERC20 for token transfers
 * - ECDSA signature verification with chain ID and contract address binding
 * - Nonce-based replay protection
 * - Merkle proof verification for batch claims
 *
 * Two claiming methods:
 * 1. Merkle Claims: Admin publishes Merkle root of approved rewards, users claim with proof
 * 2. Signature Claims: Backend signs approval, user claims instantly (for star rewards)
 */
contract NOXRewards is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;
    using SafeERC20 for IERC20;

    // NOX token contract
    IERC20 public immutable noxToken;

    // Authorized signer for instant claims (backend wallet)
    address public signer;

    // Merkle root for batch claims
    bytes32 public merkleRoot;

    // Track claimed amounts per address (for Merkle claims)
    mapping(address => uint256) public merkleClaimed;

    // Track used nonces per address (for signature claims)
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    // Track total claimed per GitHub user hash (privacy: only hash stored)
    mapping(bytes32 => uint256) public githubClaimed;

    // Stats
    uint256 public totalDistributed;
    uint256 public totalClaimants;

    // Events
    event MerkleRootUpdated(bytes32 indexed newRoot);
    event SignerUpdated(address indexed newSigner);
    event RewardClaimed(address indexed wallet, uint256 amount, string claimType);
    event TokensDeposited(uint256 amount);
    event TokensWithdrawn(uint256 amount);

    // Errors
    error InvalidProof();
    error InvalidSignature();
    error NonceAlreadyUsed();
    error AlreadyClaimed();
    error InsufficientBalance();
    error ZeroAmount();
    error ZeroAddress();

    constructor(
        address _noxToken,
        address _signer,
        address _owner
    ) Ownable(_owner) {
        if (_noxToken == address(0) || _signer == address(0)) revert ZeroAddress();
        noxToken = IERC20(_noxToken);
        signer = _signer;
    }

    // ============================================
    // MERKLE CLAIMS (for reviewed contributions)
    // ============================================

    /**
     * @notice Claim rewards using Merkle proof
     * @param amount Total approved amount for this address
     * @param proof Merkle proof
     */
    function claimMerkle(
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Verify proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();

        // Calculate claimable (total approved minus already claimed)
        uint256 alreadyClaimed = merkleClaimed[msg.sender];
        if (amount <= alreadyClaimed) revert AlreadyClaimed();
        uint256 claimable = amount - alreadyClaimed;

        // Check balance
        if (noxToken.balanceOf(address(this)) < claimable) revert InsufficientBalance();

        // Update state
        merkleClaimed[msg.sender] = amount;
        if (alreadyClaimed == 0) totalClaimants++;
        totalDistributed += claimable;

        // Transfer (SafeERC20)
        noxToken.safeTransfer(msg.sender, claimable);

        emit RewardClaimed(msg.sender, claimable, "merkle");
    }

    // ============================================
    // SIGNATURE CLAIMS (for instant star rewards)
    // ============================================

    /**
     * @notice Claim rewards using backend signature
     * @param amount Amount to claim
     * @param nonce Unique nonce to prevent replay
     * @param githubHash Hash of GitHub username (privacy)
     * @param signature Backend signature
     */
    function claimWithSignature(
        uint256 amount,
        uint256 nonce,
        bytes32 githubHash,
        bytes calldata signature
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (usedNonces[msg.sender][nonce]) revert NonceAlreadyUsed();

        // Verify signature
        bytes32 messageHash = keccak256(abi.encodePacked(
            msg.sender,
            amount,
            nonce,
            githubHash,
            block.chainid,
            address(this)
        ));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        if (recoveredSigner != signer) revert InvalidSignature();

        // Check balance
        if (noxToken.balanceOf(address(this)) < amount) revert InsufficientBalance();

        // Update state
        usedNonces[msg.sender][nonce] = true;
        githubClaimed[githubHash] += amount;
        totalDistributed += amount;
        totalClaimants++;

        // Transfer (SafeERC20)
        noxToken.safeTransfer(msg.sender, amount);

        emit RewardClaimed(msg.sender, amount, "signature");
    }

    /**
     * @notice Check if a GitHub user has already claimed (by hash)
     */
    function hasGithubClaimed(bytes32 githubHash) external view returns (uint256) {
        return githubClaimed[githubHash];
    }

    /**
     * @notice Check claimable amount for Merkle claim
     */
    function getClaimableMerkle(
        address wallet,
        uint256 totalApproved,
        bytes32[] calldata proof
    ) external view returns (uint256) {
        bytes32 leaf = keccak256(abi.encodePacked(wallet, totalApproved));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) return 0;

        uint256 claimed = merkleClaimed[wallet];
        if (totalApproved <= claimed) return 0;
        return totalApproved - claimed;
    }

    // ============================================
    // ADMIN FUNCTIONS
    // ============================================

    /**
     * @notice Update Merkle root (for batch reward updates)
     */
    function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
        merkleRoot = _merkleRoot;
        emit MerkleRootUpdated(_merkleRoot);
    }

    /**
     * @notice Update authorized signer
     */
    function setSigner(address _signer) external onlyOwner {
        if (_signer == address(0)) revert ZeroAddress();
        signer = _signer;
        emit SignerUpdated(_signer);
    }

    /**
     * @notice Deposit NOX tokens for distribution
     */
    function depositTokens(uint256 amount) external onlyOwner {
        noxToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TokensDeposited(amount);
    }

    /**
     * @notice Emergency withdraw (only owner)
     */
    function withdrawTokens(uint256 amount) external onlyOwner {
        if (noxToken.balanceOf(address(this)) < amount) revert InsufficientBalance();
        noxToken.safeTransfer(owner(), amount);
        emit TokensWithdrawn(amount);
    }

    /**
     * @notice Get contract stats
     */
    function getStats() external view returns (
        uint256 balance,
        uint256 distributed,
        uint256 claimants,
        bytes32 currentRoot
    ) {
        return (
            noxToken.balanceOf(address(this)),
            totalDistributed,
            totalClaimants,
            merkleRoot
        );
    }
}
