// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IDeepFamilyArchiveV1} from "../interfaces/IDeepFamilyArchiveV1.sol";

/** @dev Exercises initialization visibility and rollback at the safe-mint callback. */
contract MintBiographyReceiver is IERC721Receiver {
  IDeepFamilyArchiveV1 private immutable _archive;
  bool public rejectReceipt;
  uint64 public recordsAtReceipt;
  address public authorAtReceipt;

  constructor(address archive) {
    _archive = IDeepFamilyArchiveV1(archive);
  }

  function setRejectReceipt(bool reject) external {
    rejectReceipt = reject;
  }

  function execute(address target, bytes calldata data) external returns (bytes memory) {
    (bool ok, bytes memory result) = target.call(data);
    if (!ok)
      assembly ("memory-safe") {
        revert(add(result, 32), mload(result))
      }
    return result;
  }

  function onERC721Received(
    address,
    address,
    uint256 tokenId,
    bytes calldata
  ) external returns (bytes4) {
    require(!rejectReceipt, "receiver rejected mint");
    IDeepFamilyArchiveV1.StoryState memory state = _archive.storyState(tokenId);
    recordsAtReceipt = state.totalRecords;
    authorAtReceipt = _archive.storyRecordRef(tokenId, 0).author;
    // A receiver can immediately use the owner interface; the initial head must already exist.
    _archive.sealStory(tokenId, state.totalRecords, state.recordsHead);
    return IERC721Receiver.onERC721Received.selector;
  }
}
