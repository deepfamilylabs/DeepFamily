// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import "./FundCompositionConsumer.sol";

interface IResearchPoseidon2 { function hash(uint256[2] memory input) external pure returns (uint256); }
interface IAttachmentVerifier { function verifyProof(bytes calldata proof, uint256[14] calldata input) external view; }

/// @notice Research source: two successful Funds append four output leaves to
/// one shared root. Bounded to two actions, not the production sharded note tree.
contract FundAttachmentSource is FundCompositionConsumer {
    IResearchPoseidon2 public immutable hasher;
    mapping(uint256 => bool) public knownFundRoots;
    uint256 public firstPairRoot;
    uint8 public successfulFunds;
    event VerifiedFundRoot(uint256 root);
    constructor(address verifier_, uint256 counterRoot, uint256[] memory noteRoots,
        uint256 endorsementRoot, uint256 trustedRoot, uint256 lineageAsOf, address hasher_)
        FundCompositionConsumer(verifier_,counterRoot,noteRoots,endorsementRoot,trustedRoot,lineageAsOf) {
        require(hasher_.code.length != 0);
        hasher = IResearchPoseidon2(hasher_);
    }
    function _afterVerifiedFund(uint256 budget, uint256 change) internal override {
        require(successfulFunds < 2, "research tree full");
        uint256 pairRoot = hasher.hash([budget,change]);
        uint256 root = pairRoot;
        if (successfulFunds == 0) firstPairRoot = pairRoot;
        else root = hasher.hash([firstPairRoot,pairRoot]);
        ++successfulFunds;
        knownFundRoots[root] = true;
        emit VerifiedFundRoot(root);
    }
}

/// @notice Research attached-letter consumer. Counter state is read from the
/// same fixture Fund source; all acceptance paths use the real proof verifier.
contract AttachmentConsumer {
    IAttachmentVerifier public immutable verifier;
    FundAttachmentSource public immutable source;
    mapping(uint128 => bool) public usedMessage;
    error InvalidProof();
    error ExpiredCode();
    error AlreadyUsed();
    error InvalidSource();
    error InvalidCheckpoint();
    error CheckpointExpired();
    event LetterRecorded(uint128 indexed messageId, bytes32 ciphertextHash, uint256 relation);
    constructor(address verifier_, address source_) {
        require(verifier_.code.length != 0 && source_.code.length != 0);
        verifier = IAttachmentVerifier(verifier_);
        source = FundAttachmentSource(source_);
    }
    function attach(uint128 messageId, bytes calldata ciphertext, uint256 checkpointId,
        uint64 asOf, uint64 expiresAt, uint256 binding, address budgetPool,
        uint256 budgetRoot, uint256 relation, bytes calldata proof) external {
        if (block.timestamp >= expiresAt) revert ExpiredCode();
        if (usedMessage[messageId]) revert AlreadyUsed();
        if (budgetPool != address(source) || !source.knownFundRoots(budgetRoot)) revert InvalidSource();
        uint256 current = source.currentCheckpointId();
        if (checkpointId == 0 || checkpointId > current) revert InvalidCheckpoint();
        (uint256 counterRoot,uint64 createdAt,uint64 retiredAt) = source.checkpoints(checkpointId);
        if (asOf < createdAt || asOf > block.timestamp) revert InvalidCheckpoint();
        if (checkpointId != current) {
            if (asOf > retiredAt) revert InvalidCheckpoint();
            if (block.timestamp >= uint256(retiredAt)+900) revert CheckpointExpired();
        }
        bytes32 digest = keccak256(ciphertext);
        uint256[14] memory inputs = [block.chainid,uint256(uint160(address(this))),uint256(2),uint256(messageId),
            uint256(digest)&type(uint128).max,uint256(digest)>>128,checkpointId,counterRoot,uint256(asOf),
            uint256(expiresAt),binding,uint256(uint160(budgetPool)),budgetRoot,relation];
        try verifier.verifyProof(proof,inputs) {} catch { revert InvalidProof(); }
        usedMessage[messageId] = true;
        emit LetterRecorded(messageId,digest,relation);
    }
}
