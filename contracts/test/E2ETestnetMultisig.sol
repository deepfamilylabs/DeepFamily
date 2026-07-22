// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Testnet-only 2-of-3 wallet for unattended eSpace acceptance tests. Never use this
///      contract or centrally managed acceptance-test keys for production governance.
contract E2ETestnetMultisig is EIP712 {
  error InvalidOwner(address owner);
  error DuplicateOwner(address owner);
  error InvalidTarget();
  error InvalidSignatureCount(uint256 count);
  error UnauthorizedSigner(address signer);
  error DuplicateSigner(address signer);
  error CallFailed(bytes returnData);

  event Received(address indexed sender, uint256 value);
  event Executed(
    uint256 indexed nonce,
    address indexed relayer,
    address indexed target,
    uint256 value,
    bytes32 dataHash
  );

  bytes32 public constant EXECUTE_TYPEHASH =
    keccak256("Execute(address target,uint256 value,bytes32 dataHash,uint256 nonce)");

  mapping(address => bool) public isOwner;
  uint256 public nonce;

  address[3] private owners;

  constructor(
    address ownerA,
    address ownerB,
    address ownerC
  ) EIP712("DeepFamily E2E Testnet Multisig", "1") {
    if (ownerA == address(0)) revert InvalidOwner(ownerA);
    if (ownerB == address(0)) revert InvalidOwner(ownerB);
    if (ownerC == address(0)) revert InvalidOwner(ownerC);
    if (ownerA == ownerB) revert DuplicateOwner(ownerA);
    if (ownerA == ownerC) revert DuplicateOwner(ownerA);
    if (ownerB == ownerC) revert DuplicateOwner(ownerB);

    owners = [ownerA, ownerB, ownerC];
    isOwner[ownerA] = true;
    isOwner[ownerB] = true;
    isOwner[ownerC] = true;
  }

  /// @dev Executes exactly one EVM CALL after at least two owners sign the current nonce.
  ///      Signatures may be submitted in any owner order by any relayer.
  function execute(
    address target,
    uint256 value,
    bytes calldata data,
    bytes[] calldata signatures
  ) external returns (bytes memory returnData) {
    if (target == address(0)) revert InvalidTarget();
    uint256 signatureCount = signatures.length;
    if (signatureCount < 2 || signatureCount > 3) revert InvalidSignatureCount(signatureCount);

    uint256 currentNonce = nonce;
    bytes32 dataHash = keccak256(data);
    bytes32 structHash = keccak256(
      abi.encode(EXECUTE_TYPEHASH, target, value, dataHash, currentNonce)
    );
    bytes32 digest = _hashTypedDataV4(structHash);

    address[3] memory signers;
    for (uint256 i = 0; i < signatureCount; ++i) {
      address signer = ECDSA.recoverCalldata(digest, signatures[i]);
      if (!isOwner[signer]) revert UnauthorizedSigner(signer);
      for (uint256 j = 0; j < i; ++j) {
        if (signer == signers[j]) revert DuplicateSigner(signer);
      }
      signers[i] = signer;
    }

    // Increment before the external call so the same signatures cannot be used reentrantly.
    // A failed call reverts this increment together with all other state changes.
    nonce = currentNonce + 1;
    (bool success, bytes memory result) = target.call{value: value}(data);
    if (!success) revert CallFailed(result);

    emit Executed(currentNonce, msg.sender, target, value, dataHash);
    return result;
  }

  function getOwners() external view returns (address[] memory result) {
    result = new address[](3);
    result[0] = owners[0];
    result[1] = owners[1];
    result[2] = owners[2];
  }

  function getThreshold() external pure returns (uint256) {
    return 2;
  }

  receive() external payable {
    emit Received(msg.sender, msg.value);
  }
}
