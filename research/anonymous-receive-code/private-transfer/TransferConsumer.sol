// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IResearchSelfTransferVerifier {
    function verifyProof(bytes calldata proof, uint256[30] calldata input) external view;
}
interface IResearchSingleTransferVerifier {
    function verifyProof(bytes calldata proof, uint256[42] calldata input) external view;
}
interface IResearchDualTransferVerifier {
    function verifyProof(bytes calldata proof, uint256[52] calldata input) external view;
}

/// @notice ISOLATED RESEARCH. Each entry selects a fixed verifier whose circuit
/// proves the actual output-owner classification. Calling transferSelf is not
/// sufficient to classify an external output as self. Input note roots and
/// counter updates are fixture-driven. No asset custody or output note tree.
contract TransferConsumer {
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    struct Checkpoint { uint256 root; uint64 createdAt; uint64 retiredAt; }

    IResearchSelfTransferVerifier public immutable selfVerifier;
    IResearchSingleTransferVerifier public immutable singleVerifier;
    IResearchDualTransferVerifier public immutable dualVerifier;
    address public immutable fixtureOwner;
    uint256 public currentCheckpointId = 1;
    mapping(uint256 => Checkpoint) public checkpoints;
    mapping(uint256 => mapping(uint256 => bool)) public fixtureNoteRoots;
    mapping(uint256 => bool) public usedNullifiers;
    mapping(uint256 => bool) public outputCommitmentExists;
    mapping(uint128 => bool) public usedMessage;

    error InvalidProof();
    error InvalidScope();
    error InvalidCiphertext();
    error InvalidFixtureRoot();
    error InvalidCheckpoint();
    error CheckpointExpired();
    error ExpiredCode();
    error AlreadyUsed();
    error UnauthorizedFixtureDriver();

    event TransferVerified(uint8 indexed shape, uint128 indexed messageId, uint256 output0, uint256 output1);

    constructor(address selfVerifier_, address singleVerifier_, address dualVerifier_,
        uint256 initialCounterRoot, uint256[] memory shardIds, uint256[] memory noteRoots) {
        require(selfVerifier_.code.length != 0 && singleVerifier_.code.length != 0 && dualVerifier_.code.length != 0);
        require(shardIds.length == noteRoots.length);
        require(initialCounterRoot < FIELD);
        selfVerifier = IResearchSelfTransferVerifier(selfVerifier_);
        singleVerifier = IResearchSingleTransferVerifier(singleVerifier_);
        dualVerifier = IResearchDualTransferVerifier(dualVerifier_);
        fixtureOwner = msg.sender;
        checkpoints[1] = Checkpoint(initialCounterRoot, uint64(block.timestamp), 0);
        for (uint256 i; i < noteRoots.length; ++i) {
            require(shardIds[i] < FIELD && noteRoots[i] != 0 && noteRoots[i] < FIELD);
            fixtureNoteRoots[shardIds[i]][noteRoots[i]] = true;
        }
    }

    function advanceFixtureCounterRoot(uint256 root) external {
        if (msg.sender != fixtureOwner) revert UnauthorizedFixtureDriver();
        if (root >= FIELD) revert InvalidScope();
        checkpoints[currentCheckpointId].retiredAt = uint64(block.timestamp);
        ++currentCheckpointId;
        checkpoints[currentCheckpointId] = Checkpoint(root, uint64(block.timestamp), 0);
    }

    function transferSelf(bytes[2] calldata ciphertexts, uint256[30] calldata transferInputs,
        bytes calldata proof) external {
        _checkTransfer(ciphertexts, transferInputs);
        if (proof.length != 256) revert InvalidProof();
        try selfVerifier.verifyProof(proof, transferInputs) {} catch { revert InvalidProof(); }
        _record(0, 0, transferInputs);
    }

    function transferSingle(uint128 messageId, bytes[2] calldata ciphertexts,
        uint256 checkpointId, uint64 asOf, uint64 expiresAt, uint256 binding,
        uint256[30] calldata transferInputs, uint256 slot, bytes calldata proof) external {
        _checkTransfer(ciphertexts, transferInputs);
        if (slot > 1) revert InvalidScope();
        if (usedMessage[messageId]) revert AlreadyUsed();
        uint256[11] memory context = _context(messageId, ciphertexts, checkpointId, asOf, expiresAt, binding);
        uint256[42] memory inputs;
        for (uint256 i; i < 11; ++i) inputs[i] = context[i];
        for (uint256 i; i < 30; ++i) inputs[11+i] = transferInputs[i];
        inputs[41] = slot;
        try singleVerifier.verifyProof(proof, inputs) {} catch { revert InvalidProof(); }
        usedMessage[messageId] = true;
        _record(1, messageId, transferInputs);
    }

    function transferDual(uint128 messageId, bytes[2] calldata ciphertexts,
        uint256 checkpointId, uint64 asOf, uint64[2] calldata expiresAt, uint256[2] calldata binding,
        uint256[30] calldata transferInputs, bytes calldata proof) external {
        _checkTransfer(ciphertexts, transferInputs);
        if (usedMessage[messageId]) revert AlreadyUsed();
        uint256[11] memory first = _context(messageId, ciphertexts, checkpointId, asOf, expiresAt[0], binding[0]);
        uint256[11] memory second = _context(messageId, ciphertexts, checkpointId, asOf, expiresAt[1], binding[1]);
        uint256[52] memory inputs;
        for (uint256 i; i < 11; ++i) { inputs[i] = first[i]; inputs[11+i] = second[i]; }
        for (uint256 i; i < 30; ++i) inputs[22+i] = transferInputs[i];
        try dualVerifier.verifyProof(proof, inputs) {} catch { revert InvalidProof(); }
        usedMessage[messageId] = true;
        _record(2, messageId, transferInputs);
    }

    function _context(uint128 messageId, bytes[2] calldata ciphertexts, uint256 checkpointId,
        uint64 asOf, uint64 expiresAt, uint256 binding) private view returns (uint256[11] memory result) {
        if (block.timestamp >= expiresAt) revert ExpiredCode();
        if (binding >= FIELD || checkpointId == 0 || checkpointId > currentCheckpointId) revert InvalidCheckpoint();
        Checkpoint memory cp = checkpoints[checkpointId];
        if (asOf < cp.createdAt || asOf > block.timestamp) revert InvalidCheckpoint();
        if (checkpointId != currentCheckpointId) {
            if (asOf > cp.retiredAt) revert InvalidCheckpoint();
            if (block.timestamp >= uint256(cp.retiredAt) + 900) revert CheckpointExpired();
        }
        uint256 digest = uint256(keccak256(bytes.concat(ciphertexts[0], ciphertexts[1])));
        result = [block.chainid, uint256(uint160(address(this))), uint256(3), uint256(messageId),
            digest & type(uint128).max, digest >> 128, checkpointId, cp.root,
            uint256(asOf), uint256(expiresAt), binding];
    }

    function _checkTransfer(bytes[2] calldata ciphertexts, uint256[30] calldata inputs) private view {
        if (inputs[0] != block.chainid || inputs[1] != uint256(uint160(address(this)))) revert InvalidScope();
        for (uint256 i; i < 30; ++i) if (inputs[i] >= FIELD) revert InvalidScope();
        for (uint256 i; i < 8; ++i) {
            if (inputs[10+i] == 0 || !fixtureNoteRoots[inputs[2+i]][inputs[10+i]]) revert InvalidFixtureRoot();
            uint256 nullifier = inputs[18+i];
            if (nullifier == 0) revert InvalidScope();
            if (usedNullifiers[nullifier]) revert AlreadyUsed();
            for (uint256 j; j < i; ++j) if (inputs[18+j] == nullifier) revert AlreadyUsed();
        }
        if (inputs[26] == 0 || inputs[27] == 0) revert InvalidScope();
        if (inputs[26] == inputs[27] || outputCommitmentExists[inputs[26]] || outputCommitmentExists[inputs[27]]) revert AlreadyUsed();
        for (uint256 i; i < 2; ++i) {
            if (ciphertexts[i].length != 512 || uint256(keccak256(ciphertexts[i])) % FIELD != inputs[28+i]) revert InvalidCiphertext();
        }
    }

    function _record(uint8 shape, uint128 messageId, uint256[30] calldata inputs) private {
        for (uint256 i; i < 8; ++i) usedNullifiers[inputs[18+i]] = true;
        outputCommitmentExists[inputs[26]] = true;
        outputCommitmentExists[inputs[27]] = true;
        emit TransferVerified(shape, messageId, inputs[26], inputs[27]);
    }
}
