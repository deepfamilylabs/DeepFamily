// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeepFamilyArchive} from "./DeepFamilyArchive.sol";
import {IIdentityAuthorizationState} from "./interfaces/IIdentityAuthorizationState.sol";
import {IPrivateLetterVerifier} from "./interfaces/IPrivateLetterVerifiers.sol";
import {ICanonicalLetterPoolFactory} from "./interfaces/ICanonicalLetterPool.sol";

/**
 * @notice Authenticated private letters, stored as immutable encrypted archive blobs.
 * @dev Letter registration has no personHash/NFT and needs no recipient permission list.
 *      The inherited archive's metadata/story APIs do not register or overwrite letters.
 *      Registration verifies its fixed circuit before creating a blob.
 */
contract PrivateLetterArchive is DeepFamilyArchive {
  error InvalidLetterConfiguration();
  error InvalidLetterField();
  error ExpiredReceiveCode();
  error MessageAlreadyRegistered();
  error InvalidLetterProof();

  struct Delivery {
    uint128 messageId;
    uint256 checkpointId;
    uint64 asOf;
    // asOf plus the proof's fixed 15-minute lifetime. The code's own expiry stays private.
    uint64 deadline;
    uint256 recipientBinding;
  }

  struct LetterRecord {
    BlobRef blob;
    uint256 recipientBinding;
    uint64 registeredAt;
    uint64 deadline;
  }

  uint256 private constant SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  IIdentityAuthorizationState public immutable AUTHORIZATION_STATE;
  IPrivateLetterVerifier public immutable LETTER_VERIFIER;
  ICanonicalLetterPoolFactory public immutable POOL_FACTORY;
  uint256 public creationBlock;
  mapping(uint128 messageId => bool registered) public usedMessage;
  mapping(uint128 messageId => LetterRecord record) private _letters;

  event LetterRegistered(
    uint128 indexed messageId,
    BlobRef blob,
    uint256 recipientBinding,
    uint64 deadline,
    uint64 registeredAt
  );

  constructor(
    address deepFamily,
    address authorizationState,
    address letterVerifier,
    address poolFactory
  ) DeepFamilyArchive(deepFamily) {
    if (
      authorizationState.code.length == 0 ||
      letterVerifier.code.length == 0 ||
      poolFactory.code.length == 0
    ) revert InvalidLetterConfiguration();
    AUTHORIZATION_STATE = IIdentityAuthorizationState(authorizationState);
    LETTER_VERIFIER = IPrivateLetterVerifier(letterVerifier);
    POOL_FACTORY = ICanonicalLetterPoolFactory(poolFactory);
    if (POOL_FACTORY.AUTHORIZATION_STATE() != authorizationState) {
      revert InvalidLetterConfiguration();
    }
    creationBlock = block.number;
  }

  function letterRecord(uint128 messageId) external view returns (LetterRecord memory) {
    return _letters[messageId];
  }

  function registerLetter(
    Delivery calldata delivery,
    bytes calldata ciphertext,
    bytes calldata proof
  ) external {
    uint256[11] memory inputs = _deliveryInputs(delivery, ciphertext);
    try LETTER_VERIFIER.verifyProof(proof, inputs) {} catch {
      revert InvalidLetterProof();
    }
    _register(delivery, ciphertext);
  }

  function _deliveryInputs(
    Delivery calldata delivery,
    bytes calldata ciphertext
  ) private view returns (uint256[11] memory inputs) {
    if (block.timestamp >= delivery.deadline) revert ExpiredReceiveCode();
    if (usedMessage[delivery.messageId]) revert MessageAlreadyRegistered();
    if (
      delivery.recipientBinding == 0 ||
      delivery.recipientBinding >= SCALAR_FIELD ||
      delivery.checkpointId >= SCALAR_FIELD
    ) revert InvalidLetterField();
    if (ciphertext.length == 0) revert InvalidPayloadLength();
    uint256 counterRoot = AUTHORIZATION_STATE.validateCheckpoint(
      delivery.checkpointId,
      delivery.asOf
    );
    bytes32 digest = keccak256(ciphertext);
    inputs = [
      block.chainid,
      uint256(uint160(address(this))),
      1,
      uint256(delivery.messageId),
      uint256(digest) & type(uint128).max,
      uint256(digest) >> 128,
      delivery.checkpointId,
      counterRoot,
      uint256(delivery.asOf),
      uint256(delivery.deadline),
      delivery.recipientBinding
    ];
  }

  function _register(Delivery calldata delivery, bytes calldata ciphertext) private {
    // All external verification calls above use STATICCALL. No unverified archive entry exists.
    BlobRef memory blob = _storeBlob(ciphertext);
    uint64 timestamp = uint64(block.timestamp);
    usedMessage[delivery.messageId] = true;
    _letters[delivery.messageId] = LetterRecord({
      blob: blob,
      recipientBinding: delivery.recipientBinding,
      registeredAt: timestamp,
      deadline: delivery.deadline
    });
    emit LetterRegistered(
      delivery.messageId,
      blob,
      delivery.recipientBinding,
      delivery.deadline,
      timestamp
    );
  }
}
