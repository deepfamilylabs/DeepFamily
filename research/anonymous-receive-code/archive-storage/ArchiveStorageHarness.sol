// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DeepFamilyArchive} from "../../../contracts/DeepFamilyArchive.sol";

// RESEARCH ONLY. Satisfies the existing constructor's code-presence check;
// _storeBlob does not call the metadata/story authorization interfaces.
contract ResearchArchiveBinder {}

// The public store entry point deliberately has no authorization. It only
// measures the unchanged storage primitive. Never deploy this as a letter API.
contract ArchiveStorageHarness is DeepFamilyArchive {
    event ResearchBlobStored(bytes32 payloadHash, address pointer, uint64 payloadLength, uint32 segmentCount);

    constructor(address binder) DeepFamilyArchive(binder) {}

    function store(bytes calldata payload) external returns (BlobRef memory blob) {
        blob = _storeBlob(payload);
        emit ResearchBlobStored(blob.payloadHash, blob.pointer, blob.payloadLength, blob.segmentCount);
    }
}
