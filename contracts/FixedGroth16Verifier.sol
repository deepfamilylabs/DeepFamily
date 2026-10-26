// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IFixedProofVerifier} from "./interfaces/IFixedProofVerifier.sol";

/// @notice Immutable transport adapter for a single generated Groth16 verifier and public ABI.
/// @dev proof is the canonical 256-byte abi.encode(a,b,c), with snarkjs Solidity G2 ordering.
contract FixedGroth16Verifier is IFixedProofVerifier {
  address public immutable VERIFIER;
  uint256 public immutable PUBLIC_SIGNAL_COUNT;
  bytes4 public immutable VERIFY_SELECTOR;
  uint256 private constant FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;

  error InvalidVerifier();

  constructor(address verifier, uint256 publicSignalCount) {
    if (verifier.code.length == 0 || publicSignalCount == 0 || publicSignalCount > 64) {
      revert InvalidVerifier();
    }
    VERIFIER = verifier;
    PUBLIC_SIGNAL_COUNT = publicSignalCount;
    VERIFY_SELECTOR = bytes4(
      keccak256(
        bytes(
          string.concat(
            "verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[",
            Strings.toString(publicSignalCount),
            "])"
          )
        )
      )
    );
  }

  function verifyProof(
    bytes calldata proof,
    uint256[] calldata signals
  ) external view returns (bool) {
    if (proof.length != 256 || signals.length != PUBLIC_SIGNAL_COUNT) return false;
    bytes memory input = new bytes(4 + 256 + 32 * signals.length);
    bytes4 selector = VERIFY_SELECTOR;
    assembly ("memory-safe") {
      mstore(add(input, 32), selector)
      calldatacopy(add(input, 36), proof.offset, 256)
      calldatacopy(add(input, 292), signals.offset, mul(signals.length, 32))
    }
    for (uint256 i; i < signals.length; ++i) if (signals[i] >= FIELD) return false;
    (bool ok, bytes memory result) = VERIFIER.staticcall(input);
    return ok && result.length == 32 && abi.decode(result, (bool));
  }
}
