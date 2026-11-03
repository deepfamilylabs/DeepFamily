// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @dev Receive presentations shared by the shielded pools and the private letter archive.
 *      Revert on any invalid proof. The circuit privately authenticates a receive credential,
 *      queries its canonical R and counter in the shared dictionary, checks it is unexpired at
 *      asOf and binds the recipient and the one-time operation to the actual chain/consumer.
 *      No identity, R, counter, expiry, path, original code or reusable issuance proof is public.
 */
interface IReceivePresentationVerifier {
  // chain, consumer, action, three operation fields (letters: messageId, hashLo, hashHi;
  // pools: output slot, actionHashLo, actionHashHi), checkpoint, counterRoot, asOf,
  // deadline (asOf + 15 minutes), recipient operation binding.
  function verifyProof(bytes calldata proof, uint256[11] calldata inputs) external view;
}
