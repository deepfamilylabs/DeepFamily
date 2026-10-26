// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {DeepFamilyArchive} from "./DeepFamilyArchive.sol";
import {IReceiveRegistry} from "./interfaces/IReceiveRegistry.sol";

/// @notice Generic letters need no family eligibility and no second receive code.
contract LetterArchive is DeepFamilyArchive {
  IReceiveRegistry public immutable RECEIVE_REGISTRY;
  mapping(address => mapping(uint128 => bool)) public usedMessage;
  event LetterRegistered(
    uint128 indexed messageId,
    uint256 indexed commonBinding,
    address indexed sender,
    BlobRef blob
  );
  error InvalidLetter();
  constructor(address deepFamily, address registry) DeepFamilyArchive(deepFamily) {
    if (registry.code.length == 0) revert InvalidLetter();
    RECEIVE_REGISTRY = IReceiveRegistry(registry);
  }
  /// @dev HPKE authenticates chain/archive/messageId. Changing ciphertext never produces a
  ///      valid plaintext for another context; sender authenticity is not an identity claim.
  function registerLetter(
    uint128 messageId,
    IReceiveRegistry.Code calldata code,
    bytes calldata codeProof,
    bytes calldata ciphertext
  ) external {
    if (messageId == 0 || usedMessage[msg.sender][messageId] || ciphertext.length == 0)
      revert InvalidLetter();
    if (!RECEIVE_REGISTRY.verifyReceive(code, codeProof)) revert InvalidLetter();
    // A different sender cannot occupy this sender's message ID by front-running.
    usedMessage[msg.sender][messageId] = true;
    BlobRef memory blob = _storeBlob(ciphertext);
    emit LetterRegistered(messageId, code.commonBinding, msg.sender, blob);
  }
}
