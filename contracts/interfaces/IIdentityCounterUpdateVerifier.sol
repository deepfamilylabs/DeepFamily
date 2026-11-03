// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev The verifier MUST prove canonical R from identity and its nonzero identity secret,
 *      an exact uint64 increment, and the authorization nullifier bound to the actual
 *      chain and state contract. The state contract independently checks the live alias
 *      counter (zero for an absent identity) and computes the tree transition from its
 *      own nodes. Neither tree paths nor roots are part of the owner proof.
 */
interface IIdentityCounterUpdateVerifier {
  function verifyProof(
    bytes calldata proof,
    uint256[6] calldata inputs
  ) external view returns (bool);
}
