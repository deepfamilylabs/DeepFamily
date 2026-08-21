// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMetadataArchiveV1} from "./interfaces/IMetadataArchiveV1.sol";

/**
 * @dev Constructor-only data contract. Its deployed runtime is exactly
 *      `0x00 || envelope`, where the leading STOP byte is not part of the envelope.
 */
contract MetadataBlobV1 {
  constructor(bytes memory envelope) {
    bytes memory runtime = bytes.concat(hex"00", envelope);
    assembly ("memory-safe") {
      return(add(runtime, 0x20), mload(runtime))
    }
  }
}

/**
 * @title MetadataArchiveV1
 * @notice Immutable, format-agnostic blob writer and metadata-reference index.
 * @dev The archive deliberately does not parse envelope bytes. Format semantics belong to clients.
 */
contract MetadataArchiveV1 is IMetadataArchiveV1 {
  error InvalidDeepFamilyAddress();
  error UnauthorizedCaller();
  error InvalidPayloadLength();
  error MetadataAlreadyStored();

  uint256 public constant MAX_PAYLOAD_LENGTH = 16_384;

  address public immutable override DEEP_FAMILY;

  mapping(bytes32 personHash => mapping(uint256 versionIndex => MetadataRef metadata))
    private _metadataRefs;

  event MetadataStored(
    bytes32 indexed personHash,
    uint256 indexed versionIndex,
    address pointer,
    bytes32 payloadHash,
    uint32 payloadLength
  );

  constructor(address deepFamily) {
    if (deepFamily == address(0) || deepFamily.code.length == 0) {
      revert InvalidDeepFamilyAddress();
    }
    DEEP_FAMILY = deepFamily;
  }

  function store(
    bytes32 personHash,
    uint256 versionIndex,
    bytes calldata envelope
  ) external override returns (MetadataRef memory metadata) {
    if (msg.sender != DEEP_FAMILY) revert UnauthorizedCaller();

    uint256 payloadLength = envelope.length;
    if (payloadLength == 0 || payloadLength > MAX_PAYLOAD_LENGTH) {
      revert InvalidPayloadLength();
    }
    if (_metadataRefs[personHash][versionIndex].pointer != address(0)) {
      revert MetadataAlreadyStored();
    }

    address pointer = address(new MetadataBlobV1(envelope));
    metadata = MetadataRef({
      pointer: pointer,
      payloadHash: keccak256(envelope),
      payloadLength: uint32(payloadLength)
    });
    _metadataRefs[personHash][versionIndex] = metadata;

    emit MetadataStored(
      personHash,
      versionIndex,
      metadata.pointer,
      metadata.payloadHash,
      metadata.payloadLength
    );
  }

  function metadataRef(
    bytes32 personHash,
    uint256 versionIndex
  ) external view override returns (MetadataRef memory metadata) {
    return _metadataRefs[personHash][versionIndex];
  }
}
