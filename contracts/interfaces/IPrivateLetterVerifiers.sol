// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Revert on any invalid proof. Both circuits privately authenticate an anonymous receipt,
 *      query its canonical R and counter in the shared dictionary, check it is unexpired at
 *      asOf and bind ciphertext, recipient keys and the one-time operation to actual
 *      chain/consumer. No identity, R, counter, expiry, path, original code or reusable
 *      issuance proof is public.
 */
interface IPrivateLetterVerifier {
  // chain, archive, action=1, messageId, hashLo, hashHi, checkpoint, counterRoot,
  // asOf, deadline (asOf + 15 minutes), recipient operation binding.
  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external view;
}

interface IPrivateAttachedLetterVerifier {
  // The above eleven fields (action=2), then pool, shared note root, relation commitment.
  // The circuit MUST check an actual private Fund budget note (kind=0), its full owner,
  // viewing key and mode and its private membership path, and bind the encrypted envelope's
  // structured budget reference through relationCommitment and the ciphertext hash.
  function verifyProof(bytes calldata proof, uint256[14] calldata inputs) external view;
}
