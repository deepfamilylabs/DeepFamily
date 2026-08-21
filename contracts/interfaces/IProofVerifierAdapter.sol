// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProofVerifierAdapter
 * @notice Minimal transport-layer adapter contract between DeepFamily business entrypoints
 *         and backend-specific ZK verifiers. This interface decouples
 *         proof encoding / verifier backend from business semantics.
 *
 * @dev Responsibility boundaries:
 *      The adapter is ONLY responsible for:
 *        1. Validating `proofEncodingId` is supported
 *        2. Decoding `proofData` into the backend-specific proof form
 *        3. Matching `publicSignals.length` against the expected length for `purpose`
 *        4. Forwarding the call to the underlying verifier
 *
 *      The adapter MUST NOT:
 *        1. Inspect business meaning of any public signal field
 *        2. Perform business binding (e.g. msg.sender / identityCommitment) checks
 *        3. Read business storage
 *        4. Interpret version / suite compatibility rules
 *
 *      All business-level binding and field semantics remain the responsibility of the
 *      business contract (e.g. DeepFamily.sol).
 */
interface IProofVerifierAdapter {
  /**
   * @notice Verify a proof envelope against its declared encoding and a backend verifier.
   * @param purpose          Frozen entrypoint purpose (PersonRelation or DisclosureBinding).
   * @param proofEncodingId  Payload encoding identifier (see ProofConstants).
   * @param proofData        Encoded proof payload whose layout is defined by `proofEncodingId`.
   * @param publicSignals    Flattened public signals already ordered per the business contract.
   * @return ok              True iff the proof is valid for the given inputs.
   *
   * @dev The adapter MUST revert with `UnsupportedProofEncoding` for unknown encodings and
   *      with `MalformedProofData` for payloads that fail to decode or violate the expected
   *      public-signal length for `purpose`. A cryptographically invalid proof is surfaced
   *      by returning `false`; the business contract is responsible for translating that
   *      into `InvalidZKProof`.
   */
  function verifyProof(
    uint8 purpose,
    uint8 proofEncodingId,
    bytes calldata proofData,
    uint256[] calldata publicSignals
  ) external view returns (bool ok);
}
