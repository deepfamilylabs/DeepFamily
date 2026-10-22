// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev LinkG16 from zk-creds, IEEE S&P 2023, Appendix C/D. Two ordinary
/// Groth16 proofs are rerandomized and verified against blinded inputs. The
/// EqWire proof authenticates identical hidden inputs under both fixed keys.
/// No pairing arithmetic is executed inside either proving circuit.
abstract contract LinkedGroth16Verifier {
    error InvalidProof();
    error PublicInputNotInField();

    uint256 private constant P =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 private constant R =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    bytes32 private constant DOMAIN = keccak256("DeepFamily:LinkedGroth16:v1");

    struct VerificationKey {
        bytes32 digest;
        uint256[2] deltaG1;
        uint256[2] alpha;
        // G2 coordinates use the EIP-197 order [x1,x0,y1,y0].
        uint256[4] beta;
        uint256[4] delta;
        uint256[2][] ic;
    }

    function _issuerKey() internal pure virtual returns (VerificationKey memory);
    function _presentationKey() internal pure virtual returns (VerificationKey memory);
    function _commonInputCount() internal pure virtual returns (uint256);
    function _publicInputCount() internal pure virtual returns (uint256);

    /// @dev Exact payload: two (A,B,C) proofs (16 words), two U points (4),
    /// two EqWire commitments (4), t shared responses, two blinding responses.
    function _verifyLinked(bytes calldata proof, uint256[] memory inputs) internal view {
        uint256 commonCount = _commonInputCount();
        if (proof.length != (26 + commonCount) * 32 || inputs.length != _publicInputCount()) {
            revert InvalidProof();
        }
        for (uint256 i; i < inputs.length; ++i) {
            if (inputs[i] >= R) revert PublicInputNotInField();
        }
        uint256[] memory words = new uint256[](26 + commonCount);
        uint256[] memory pointWords = new uint256[](24);
        for (uint256 i; i < words.length; ++i) {
            uint256 value;
            assembly ("memory-safe") {
                value := calldataload(add(proof.offset, mul(i, 32)))
            }
            words[i] = value;
            if (i < 24) {
                if (value >= P) revert InvalidProof();
                pointWords[i] = value;
            } else if (value >= R) {
                revert InvalidProof();
            }
        }
        VerificationKey memory issuer = _issuerKey();
        VerificationKey memory presentation = _presentationKey();
        if (issuer.ic.length != commonCount + 1 || presentation.ic.length != commonCount + inputs.length + 1) {
            revert InvalidProof();
        }
        uint256 challenge = uint256(keccak256(abi.encode(
            DOMAIN,
            commonCount,
            inputs.length,
            issuer.digest,
            presentation.digest,
            pointWords,
            inputs
        ))) % R;
        if (challenge == 0) revert InvalidProof();
        _verifyPart(issuer, words, inputs, commonCount, challenge, 0);
        _verifyPart(presentation, words, inputs, commonCount, challenge, 1);
    }

    function _verifyPart(
        VerificationKey memory vk,
        uint256[] memory words,
        uint256[] memory inputs,
        uint256 commonCount,
        uint256 challenge,
        uint256 index
    ) private view {
        uint256[2] memory u = [words[16 + index * 2], words[17 + index * 2]];
        uint256[2] memory response = _multiply(vk.deltaG1, words[24 + commonCount + index]);
        for (uint256 j; j < commonCount; ++j) {
            response = _add(response, _multiply(vk.ic[j + 1], words[24 + j]));
        }
        response = _add(response, _multiply(u, challenge));
        if (response[0] != words[20 + index * 2] || response[1] != words[21 + index * 2]) {
            revert InvalidProof();
        }
        uint256[2] memory preparedInput = _add(vk.ic[0], u);
        if (index == 1) {
            for (uint256 j; j < inputs.length; ++j) {
                preparedInput = _add(preparedInput, _multiply(vk.ic[commonCount + 1 + j], inputs[j]));
            }
        }
        _pairing(vk, words, preparedInput, index * 8);
    }

    function _add(uint256[2] memory a, uint256[2] memory b) private view returns (uint256[2] memory result) {
        uint256[4] memory input = [a[0], a[1], b[0], b[1]];
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 6, input, 128, result, 64)
        }
        if (!success) revert InvalidProof();
    }

    function _multiply(uint256[2] memory point, uint256 scalar) private view returns (uint256[2] memory result) {
        uint256[3] memory input = [point[0], point[1], scalar];
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 7, input, 96, result, 64)
        }
        if (!success) revert InvalidProof();
    }

    function _pairing(
        VerificationKey memory vk,
        uint256[] memory words,
        uint256[2] memory preparedInput,
        uint256 offset
    ) private view {
        // EIP-197 validates all proof points, including the G2 subgroup. Keep
        // each relation's pairing check separate: multiplying two unchecked
        // equations together would permit malicious cancellation.
        if (
            (words[offset] == 0 && words[offset + 1] == 0) ||
            (words[offset + 6] == 0 && words[offset + 7] == 0) ||
            (words[offset + 2] == 0 && words[offset + 3] == 0 && words[offset + 4] == 0 && words[offset + 5] == 0)
        ) revert InvalidProof();
        uint256[24] memory input;
        input[0] = words[offset];
        input[1] = words[offset + 1] == 0 ? 0 : P - words[offset + 1];
        for (uint256 j; j < 4; ++j) input[2 + j] = words[offset + 2 + j];
        input[6] = vk.alpha[0];
        input[7] = vk.alpha[1];
        for (uint256 j; j < 4; ++j) input[8 + j] = vk.beta[j];
        input[12] = preparedInput[0];
        input[13] = preparedInput[1];
        // gamma = 1 is a checked precondition of the fixed-key generator.
        input[14] = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
        input[15] = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
        input[16] = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
        input[17] = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
        input[18] = words[offset + 6];
        input[19] = words[offset + 7];
        for (uint256 j; j < 4; ++j) input[20 + j] = vk.delta[j];
        uint256[1] memory output;
        bool success;
        assembly ("memory-safe") {
            success := staticcall(gas(), 8, input, 768, output, 32)
        }
        if (!success || output[0] != 1) revert InvalidProof();
    }
}
