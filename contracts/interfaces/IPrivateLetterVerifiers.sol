// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Revert on any invalid proof. The circuit privately authenticates a receive credential,
 *      queries its canonical R and counter in the shared dictionary, checks it is unexpired at
 *      asOf and binds ciphertext, recipient keys and the one-time operation to actual
 *      chain/consumer. No identity, R, counter, expiry, path, original code or reusable
 *      issuance proof is public.
 */
interface IPrivateLetterVerifier {
  // chain, archive, action=1, messageId, hashLo, hashHi, checkpoint, counterRoot,
  // asOf, deadline (asOf + 15 minutes), recipient operation binding.
  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external view;
}
