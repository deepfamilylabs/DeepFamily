// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEligibilitySource} from "../interfaces/IEligibilitySource.sol";

/// @dev TEST ONLY: models authenticated DeepFamily entrypoints and dynamic NFT-manager lookup.
contract SourceFamilyMock {
  address public eligibilitySource;
  mapping(bytes32 => mapping(uint256 => mapping(address => bool))) private _managers;

  function setSource(address source) external { eligibilitySource = source; }

  function setManager(bytes32 personHash, uint256 version, address actor, bool allowed) external {
    _managers[personHash][version][actor] = allowed;
  }

  function isTrustedEndorserManager(bytes32 personHash, uint256 version, address actor) external view returns (bool) {
    return _managers[personHash][version][actor];
  }

  function revoke(address source, address actor, uint8[] calldata roles, uint256[] calldata secrets) external {
    IEligibilitySource(source).revokeRoles(actor, roles, secrets);
  }

  function revokeAndEndorse(
    address source, address lineage, uint256 child, address endorser,
    uint8[] calldata roles, uint256[] calldata secrets, bool failAfter
  ) external {
    IEligibilitySource(source).revokeRoles(msg.sender, roles, secrets);
    IEligibilitySource(source).beforeEndorsementChange(child, endorser);
    SourceLineageMock(lineage).changeEndorsement(child, endorser, failAfter);
  }

  function revokeAndUntrust(
    address source, address lineage, uint256 parent, uint256 version, address endorser,
    uint8[] calldata roles, uint256[] calldata secrets
  ) external {
    IEligibilitySource(source).revokeRoles(msg.sender, roles, secrets);
    IEligibilitySource(source).beforeTrustedChange(parent, version, endorser);
    SourceLineageMock(lineage).changeTrusted(parent, version, endorser);
  }

  function mutateEndorsement(address lineage, uint256 child, address endorser) external {
    IEligibilitySource(eligibilitySource).beforeEndorsementChange(child, endorser);
    SourceLineageMock(lineage).changeEndorsement(child, endorser, false);
  }
}

/// @dev TEST ONLY: source roots are arbitrary, so this must never authenticate a real credential.
contract SourceLineageMock {
  address public immutable DEEP_FAMILY;
  uint256[2] private _roots = [uint256(1001), uint256(1002)];

  constructor(address deepFamily) { DEEP_FAMILY = deepFamily; }
  function setRoots(uint256 endorsement, uint256 trusted) external { _roots = [endorsement, trusted]; }
  function root(uint8 treeId) external view returns (uint256) { return _roots[treeId]; }

  function changeEndorsement(uint256 child, address endorser, bool failAfter) external {
    require(msg.sender == DEEP_FAMILY);
    ++_roots[0];
    require(!failAfter, "mock mutation failure");
  }

  function changeTrusted(uint256 parent, uint256 version, address endorser) external {
    require(msg.sender == DEEP_FAMILY);
    ++_roots[1];
  }
}
