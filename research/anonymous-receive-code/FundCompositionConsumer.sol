// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IFundCompositionVerifier {
    function verifyProof(bytes calldata proof, uint256[38] calldata input) external view;
}

/// @notice RESEARCH ONLY. Real Fund/authentication proof; fixture note and lineage
/// roots. No token custody, production note tree, HPKE or receipt registration.
contract FundCompositionConsumer {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    struct Checkpoint { uint256 root; uint64 createdAt; uint64 retiredAt; }
    IFundCompositionVerifier public immutable verifier;
    address public immutable fixtureOwner;
    uint256 public currentCheckpointId = 1;
    mapping(uint256 => Checkpoint) public checkpoints;
    mapping(uint256 => bool) public fixtureNoteRoots;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(uint128 => bool) public usedMessage;
    uint256 public immutable fixtureEndorsementRoot;
    uint256 public immutable fixtureTrustedRoot;
    uint256 public immutable fixtureLineageAsOf;

    error InvalidProof();
    error ExpiredCode();
    error InvalidCheckpoint();
    error CheckpointExpired();
    error InvalidFixtureRoot();
    error InvalidCiphertext();
    error InvalidScope();
    error AlreadyUsed();
    error UnauthorizedFixtureDriver();
    event FundVerified(uint128 indexed messageId, uint256 budgetCommitment, uint256 changeCommitment);

    constructor(address verifier_, uint256 counterRoot, uint256[] memory noteRoots,
        uint256 endorsementRoot, uint256 trustedRoot, uint256 lineageAsOf) {
        require(verifier_.code.length != 0);
        verifier = IFundCompositionVerifier(verifier_);
        fixtureOwner = msg.sender;
        checkpoints[1] = Checkpoint(counterRoot, uint64(block.timestamp), 0);
        for (uint256 i; i < noteRoots.length; ++i) fixtureNoteRoots[noteRoots[i]] = true;
        fixtureEndorsementRoot = endorsementRoot;
        fixtureTrustedRoot = trustedRoot;
        fixtureLineageAsOf = lineageAsOf;
    }

    function advanceFixtureCounterRoot(uint256 root) external {
        if (msg.sender != fixtureOwner) revert UnauthorizedFixtureDriver();
        checkpoints[currentCheckpointId].retiredAt = uint64(block.timestamp);
        ++currentCheckpointId;
        checkpoints[currentCheckpointId] = Checkpoint(root, uint64(block.timestamp), 0);
    }

    function fund(uint128 messageId, bytes[2] calldata ciphertexts, uint256 checkpointId,
        uint64 asOf, uint64 expiresAt, uint256 binding, uint256[27] calldata fundInputs,
        bytes calldata proof) external {
        if (block.timestamp >= expiresAt) revert ExpiredCode();
        if (usedMessage[messageId]) revert AlreadyUsed();
        if (checkpointId == 0 || checkpointId > currentCheckpointId) revert InvalidCheckpoint();
        Checkpoint memory cp = checkpoints[checkpointId];
        if (asOf < cp.createdAt || asOf > block.timestamp) revert InvalidCheckpoint();
        if (checkpointId != currentCheckpointId) {
            if (asOf > cp.retiredAt) revert InvalidCheckpoint();
            if (block.timestamp >= uint256(cp.retiredAt) + 900) revert CheckpointExpired();
        }
        if (fundInputs[0] != block.chainid || fundInputs[1] != uint256(uint160(address(this)))
            || fundInputs[3] != 0) revert InvalidScope();
        for (uint256 i; i < 27; ++i) if (fundInputs[i] >= FIELD) revert InvalidScope();
        if (!fixtureNoteRoots[fundInputs[16]] || !fixtureNoteRoots[fundInputs[17]]) revert InvalidFixtureRoot();
        if (fundInputs[2] == 0 && (fundInputs[24] != fixtureEndorsementRoot
            || fundInputs[25] != fixtureTrustedRoot || fundInputs[26] != fixtureLineageAsOf)) revert InvalidFixtureRoot();
        for (uint256 i; i < 2; ++i) {
            if (ciphertexts[i].length != 512 || uint256(keccak256(ciphertexts[i])) % FIELD != fundInputs[22+i]) revert InvalidCiphertext();
            if (usedNullifiers[fundInputs[18+i]]) revert AlreadyUsed();
        }
        bytes32 digest = keccak256(bytes.concat(ciphertexts[0], ciphertexts[1]));
        uint256[38] memory inputs;
        inputs[0] = block.chainid;
        inputs[1] = uint256(uint160(address(this)));
        inputs[2] = 1;
        inputs[3] = messageId;
        inputs[4] = uint256(digest) & type(uint128).max;
        inputs[5] = uint256(digest) >> 128;
        inputs[6] = checkpointId;
        inputs[7] = cp.root;
        inputs[8] = asOf;
        inputs[9] = expiresAt;
        inputs[10] = binding;
        for (uint256 i; i < 27; ++i) inputs[11+i] = fundInputs[i];
        try verifier.verifyProof(proof, inputs) {} catch { revert InvalidProof(); }
        usedMessage[messageId] = true;
        usedNullifiers[fundInputs[18]] = true;
        usedNullifiers[fundInputs[19]] = true;
        emit FundVerified(messageId, fundInputs[20], fundInputs[21]);
        _afterVerifiedFund(fundInputs[20], fundInputs[21]);
    }

    function _afterVerifiedFund(uint256, uint256) internal virtual {}
}
