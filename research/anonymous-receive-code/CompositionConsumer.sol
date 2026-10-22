// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ICompositionVerifier {
    function verifyProof(bytes calldata proof, uint256[11] calldata input) external view;
}
interface IOwnerCounterVerifier {
    function verifyProof(uint256[2] calldata a, uint256[2][2] calldata b,
        uint256[2] calldata c, uint256[8] calldata input) external view returns (bool);
}

/// @notice ISOLATED RESEARCH. updateCounter verifies real owner authorization;
/// the fixture owner can also drive arbitrary roots through advance().
/// This accepts synthetic ciphertext bytes, not a production letter or transfer.
contract CompositionConsumer {
    struct Checkpoint { uint256 root; uint64 createdAt; uint64 retiredAt; }
    ICompositionVerifier public immutable verifier;
    address public immutable fixtureOwner;
    IOwnerCounterVerifier public counterVerifier;
    uint256 public currentCheckpointId = 1;
    mapping(uint256 => Checkpoint) public checkpoints;
    mapping(uint256 => bool) public usedMessage;

    error UnauthorizedFixtureDriver();
    error UnknownCheckpoint();
    error InvalidStateTime();
    error CheckpointExpired();
    error ExpiredCode();
    error DuplicateMessage();
    error InvalidProof();
    error CounterVerifierAlreadySet();
    error StaleCounterRoot();
    error InvalidCounterIncrement();
    event Recorded(uint256 indexed messageId, bytes32 ciphertextHash, uint256 binding);

    constructor(address verifier_, uint256 initialRoot) {
        require(verifier_.code.length != 0, "verifier code missing");
        verifier = ICompositionVerifier(verifier_);
        fixtureOwner = msg.sender;
        checkpoints[1] = Checkpoint(initialRoot, uint64(block.timestamp), 0);
    }

    function advance(uint256 root) external {
        if (msg.sender != fixtureOwner) revert UnauthorizedFixtureDriver();
        _advance(root);
    }

    function installCounterVerifier(address verifier_) external {
        if (msg.sender != fixtureOwner) revert UnauthorizedFixtureDriver();
        if (address(counterVerifier) != address(0)) revert CounterVerifierAlreadySet();
        require(verifier_.code.length != 0, "counter verifier code missing");
        counterVerifier = IOwnerCounterVerifier(verifier_);
    }

    function updateCounter(
        uint256 authNullifier, uint256 aliasR, uint256 oldRoot, uint256 newRoot,
        uint64 oldCounter, uint64 newCounter, uint256[2] calldata a,
        uint256[2][2] calldata b, uint256[2] calldata c
    ) external {
        if (oldRoot != checkpoints[currentCheckpointId].root) revert StaleCounterRoot();
        if (uint256(newCounter) != uint256(oldCounter)+1) revert InvalidCounterIncrement();
        uint256[8] memory signals = [authNullifier, block.chainid, uint256(uint160(address(this))),
            aliasR, oldRoot, newRoot, uint256(oldCounter), uint256(newCounter)];
        if (!counterVerifier.verifyProof(a,b,c,signals)) revert InvalidProof();
        _advance(newRoot);
    }

    function _advance(uint256 root) private {
        checkpoints[currentCheckpointId].retiredAt = uint64(block.timestamp);
        ++currentCheckpointId;
        checkpoints[currentCheckpointId] = Checkpoint(root, uint64(block.timestamp), 0);
    }

    function accept(
        uint128 messageId, bytes calldata ciphertext, uint256 checkpointId,
        uint64 asOf, uint64 expiresAt, uint256 binding, bytes calldata proof
    ) external {
        if (block.timestamp >= expiresAt) revert ExpiredCode();
        if (usedMessage[messageId]) revert DuplicateMessage();
        if (checkpointId == 0 || checkpointId > currentCheckpointId) revert UnknownCheckpoint();
        Checkpoint memory checkpoint = checkpoints[checkpointId];
        if (asOf < checkpoint.createdAt || asOf > block.timestamp) revert InvalidStateTime();
        if (checkpointId != currentCheckpointId) {
            if (asOf > checkpoint.retiredAt) revert InvalidStateTime();
            if (block.timestamp >= uint256(checkpoint.retiredAt) + 900) revert CheckpointExpired();
        }
        bytes32 digest = keccak256(ciphertext);
        uint256[11] memory signals = [
            block.chainid, uint256(uint160(address(this))), uint256(1), uint256(messageId),
            uint256(digest) & type(uint128).max, uint256(digest) >> 128,
            checkpointId, checkpoint.root, uint256(asOf), uint256(expiresAt), binding
        ];
        try verifier.verifyProof(proof, signals) {} catch { revert InvalidProof(); }
        usedMessage[messageId] = true;
        emit Recorded(messageId, digest, binding);
    }
}
