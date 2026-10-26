// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {IFixedProofVerifier} from "./interfaces/IFixedProofVerifier.sol";
import {IEligibilitySource} from "./interfaces/IEligibilitySource.sol";
import {IReceiveRegistry} from "./interfaces/IReceiveRegistry.sol";

/**
 * @notice Verifies a reusable receive authorization and optional budget capabilities.
 * @dev The append-only credential tree certifies issuance. Its historical roots remain usable;
 *      current source role status is checked independently on every budget acceptance. Ordinary
 *      receive authorization has no family dependency. No administrator can install a tree root,
 *      credential, verification key or replacement source after construction.
 */
contract ReceiveRegistry is IReceiveRegistry {
  error InvalidDependency();
  error InvalidField();
  error InvalidCode();
  error CodeExpired();
  error CodeRevoked();
  error InvalidProof();
  error StaleSourceRoot();
  error UnknownIssuanceRoot();
  error QualificationRevoked(uint8 role);
  error DuplicateCredential();
  error TreeCapacityExceeded();
  error InvalidLeafIndex();
  error InvalidPage();

  uint256 public constant SNARK_SCALAR_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  uint256 public constant MAX_CREDENTIALS = uint256(1) << 32;
  uint256 public constant MAX_PAGE_SIZE = 256;
  uint256 private constant CODE_REVOCATION_DOMAIN = 74021;

  IEligibilitySource public immutable SOURCE;
  IFixedProofVerifier public immutable ISSUE_VERIFIER;
  IFixedProofVerifier public immutable CODE_VERIFIER;
  IFixedProofVerifier public immutable CAPABILITY_VERIFIER;

  uint256 public credentialCount;
  uint256 public issuanceRoot;
  uint256 public issuanceDepth;
  mapping(uint256 level => mapping(uint256 index => uint256 value)) private _nodes;
  mapping(uint256 root => bool known) private _knownIssuanceRoots;
  mapping(uint256 credential => bool issued) public isCredentialIssued;
  mapping(uint256 revocationTag => bool revoked) private _revokedCodes;

  event CredentialIssued(uint256 indexed leafIndex, uint256 credential, uint256 root);
  event ReceiveCodeRevoked(uint256 indexed revocationTag);

  constructor(
    address source,
    address issueVerifier,
    address codeVerifier,
    address capabilityVerifier
  ) {
    if (
      source.code.length == 0 ||
      issueVerifier.code.length == 0 ||
      codeVerifier.code.length == 0 ||
      capabilityVerifier.code.length == 0
    ) revert InvalidDependency();
    if (block.chainid >= SNARK_SCALAR_FIELD) revert InvalidField();
    SOURCE = IEligibilitySource(source);
    ISSUE_VERIFIER = IFixedProofVerifier(issueVerifier);
    CODE_VERIFIER = IFixedProofVerifier(codeVerifier);
    CAPABILITY_VERIFIER = IFixedProofVerifier(capabilityVerifier);
  }

  /// @notice Register only a credential proven against both currently authenticated source roots.
  /// @dev No identity, role secret, recommender address or credential opening is submitted.
  function registerCredential(
    uint256 credential,
    uint256 sourceRoot,
    uint256 trustedRoot,
    bytes calldata proof
  ) external returns (uint256 leafIndex, uint256 root) {
    _nonzeroField(credential);
    _nonzeroField(sourceRoot);
    _nonzeroField(trustedRoot);
    if (isCredentialIssued[credential]) revert DuplicateCredential();
    if (sourceRoot != SOURCE.sourceRoot() || trustedRoot != SOURCE.trustedRoot()) {
      revert StaleSourceRoot();
    }
    uint256[] memory signals = new uint256[](5);
    signals[0] = credential;
    signals[1] = block.chainid;
    signals[2] = uint256(uint160(address(this)));
    signals[3] = sourceRoot;
    signals[4] = trustedRoot;
    if (!ISSUE_VERIFIER.verifyProof(proof, signals)) revert InvalidProof();
    isCredentialIssued[credential] = true;
    (leafIndex, root) = _append(credential);
    emit CredentialIssued(leafIndex, credential, root);
  }

  function verifyReceive(
    Code calldata code,
    bytes calldata codeProof
  ) external view returns (bool) {
    _verifyReceive(code, codeProof);
    return true;
  }

  function verifyBudgetCapability(
    Code calldata code,
    Capability calldata capability,
    bytes calldata codeProof,
    bytes calldata capabilityProof
  ) external view returns (bool) {
    _verifyReceive(code, codeProof);
    if (!_knownIssuanceRoots[capability.issuanceRoot]) revert UnknownIssuanceRoot();
    _nonzeroField(capability.parentVersion);
    _nonzeroField(capability.capabilityBinding);
    _nonzeroField(capability.familyTag);
    _nonzeroField(capability.childRoleIndex);
    _nonzeroField(capability.endorsementRoleIndex);
    _nonzeroField(capability.trustedRoleIndex);
    uint256[] memory signals = new uint256[](10);
    signals[0] = capability.capabilityBinding;
    signals[1] = capability.familyTag;
    signals[2] = capability.childRoleIndex;
    signals[3] = capability.endorsementRoleIndex;
    signals[4] = capability.trustedRoleIndex;
    signals[5] = block.chainid;
    signals[6] = uint256(uint160(address(this)));
    signals[7] = capability.issuanceRoot;
    signals[8] = code.commonBinding;
    signals[9] = capability.parentVersion;
    if (!CAPABILITY_VERIFIER.verifyProof(capabilityProof, signals)) revert InvalidProof();
    // Each read observes the current canonical source state; callers cannot select a stale root.
    if (SOURCE.isRoleRevoked(0, capability.childRoleIndex)) revert QualificationRevoked(0);
    if (SOURCE.isRoleRevoked(1, capability.endorsementRoleIndex)) revert QualificationRevoked(1);
    if (SOURCE.isRoleRevoked(2, capability.trustedRoleIndex)) revert QualificationRevoked(2);
    return true;
  }

  /// @notice Anyone knowing this code's revocation secret may revoke it permanently.
  /// @dev The secret is per code, not the canonical identity secret or a family role secret.
  function revokeCode(uint256 secret) external returns (uint256 tag) {
    _nonzeroField(secret);
    tag = PoseidonT3.hash([CODE_REVOCATION_DOMAIN, secret]);
    if (_revokedCodes[tag]) revert CodeRevoked();
    _revokedCodes[tag] = true;
    emit ReceiveCodeRevoked(tag);
  }

  function isCodeRevoked(uint256 revocationTag) external view returns (bool) {
    return _revokedCodes[revocationTag];
  }

  /// @notice Latest status for qualification indices authenticated inside the fixed Claim proof.
  /// @dev This does not authenticate a credential by itself. Fund uses verifyBudgetCapability;
  ///      Claim additionally proves current-Q membership and the same subject/family itself.
  function validateBudgetRoleStatus(
    uint256 root,
    uint256 childRoleIndex,
    uint256 endorsementRoleIndex,
    uint256 trustedRoleIndex
  ) external view returns (bool) {
    if (!_knownIssuanceRoots[root]) revert UnknownIssuanceRoot();
    _nonzeroField(childRoleIndex);
    _nonzeroField(endorsementRoleIndex);
    _nonzeroField(trustedRoleIndex);
    if (SOURCE.isRoleRevoked(0, childRoleIndex)) revert QualificationRevoked(0);
    if (SOURCE.isRoleRevoked(1, endorsementRoleIndex)) revert QualificationRevoked(1);
    if (SOURCE.isRoleRevoked(2, trustedRoleIndex)) revert QualificationRevoked(2);
    return true;
  }

  function isKnownIssuanceRoot(uint256 root) external view returns (bool) {
    return _knownIssuanceRoots[root];
  }

  function getCredentialPage(
    uint256 start,
    uint256 limit
  ) external view returns (uint256[] memory leaves) {
    if (start > credentialCount || limit == 0 || limit > MAX_PAGE_SIZE) revert InvalidPage();
    uint256 length = credentialCount - start;
    if (length > limit) length = limit;
    leaves = new uint256[](length);
    for (uint256 offset; offset < length; ++offset) leaves[offset] = _nodes[0][start + offset];
  }

  /// @notice A compact LeanIMT path, using only existing siblings (at most 32).
  function getCredentialProof(
    uint256 leafIndex
  )
    external
    view
    returns (uint256 leaf, uint256 root, uint256 index, uint256 depth, uint256[] memory siblings)
  {
    if (leafIndex >= credentialCount) revert InvalidLeafIndex();
    leaf = _nodes[0][leafIndex];
    root = issuanceRoot;
    uint256 position = leafIndex;
    uint256 width = credentialCount;
    for (uint256 level; level < issuanceDepth; ++level) {
      if ((position & 1) == 1 || position + 1 < width) ++depth;
      position >>= 1;
      width = (width + 1) >> 1;
    }
    siblings = new uint256[](depth);
    position = leafIndex;
    width = credentialCount;
    uint256 step;
    for (uint256 level; level < issuanceDepth; ++level) {
      if ((position & 1) == 1) {
        siblings[step] = _nodes[level][position - 1];
        index |= uint256(1) << step;
        ++step;
      } else if (position + 1 < width) {
        siblings[step] = _nodes[level][position + 1];
        ++step;
      }
      position >>= 1;
      width = (width + 1) >> 1;
    }
  }

  function _verifyReceive(Code calldata code, bytes calldata proof) private view {
    _nonzeroField(code.codeAlias);
    _nonzeroField(code.commonBinding);
    _nonzeroField(code.revocationTag);
    _nonzeroField(code.nonce);
    _nonzeroField(code.ownerCommitment);
    if (code.viewKeyLo > type(uint128).max || code.viewKeyHi > type(uint128).max)
      revert InvalidField();
    if ((code.viewKeyLo | code.viewKeyHi) == 0) revert InvalidCode();
    if (code.expiresAt <= block.timestamp) revert CodeExpired();
    if (_revokedCodes[code.revocationTag]) revert CodeRevoked();
    uint256[] memory signals = new uint256[](10);
    signals[0] = code.codeAlias;
    signals[1] = code.commonBinding;
    signals[2] = code.revocationTag;
    signals[3] = block.chainid;
    signals[4] = uint256(uint160(address(this)));
    signals[5] = code.nonce;
    signals[6] = code.ownerCommitment;
    signals[7] = code.viewKeyLo;
    signals[8] = code.viewKeyHi;
    signals[9] = code.expiresAt;
    if (!CODE_VERIFIER.verifyProof(proof, signals)) revert InvalidProof();
  }

  function _nonzeroField(uint256 value) private pure {
    if (value == 0 || value >= SNARK_SCALAR_FIELD) revert InvalidField();
  }

  function _append(uint256 leaf) private returns (uint256 leafIndex, uint256 root) {
    uint256 size = credentialCount;
    if (size == MAX_CREDENTIALS) revert TreeCapacityExceeded();
    leafIndex = size;
    uint256 position = size;
    uint256 width = size + 1;
    root = leaf;
    _nodes[0][position] = root;
    uint256 level;
    while (width > 1) {
      if ((position & 1) == 1) root = PoseidonT3.hash([_nodes[level][position - 1], root]);
      // A rightmost node without a sibling rises unchanged (LeanIMT).
      position >>= 1;
      width = (width + 1) >> 1;
      ++level;
      _nodes[level][position] = root;
    }
    credentialCount = size + 1;
    issuanceDepth = level;
    issuanceRoot = root;
    _knownIssuanceRoots[root] = true;
  }
}
