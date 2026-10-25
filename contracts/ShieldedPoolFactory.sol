// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ShieldedErc20Pool} from "./ShieldedErc20Pool.sol";
import {IShieldedPoolConfiguration} from "./interfaces/IShieldedPoolConfiguration.sol";

/** @notice Permissionless, immutable registration of one standard pool per asset on this chain. */
contract ShieldedPoolFactory is ReentrancyGuardTransient {
  error InvalidConstructorAddress();
  error InvalidToken();
  error InvalidNativePool();

  address public immutable DEEP_TOKEN;
  address public immutable VERIFIER;
  address public immutable NATIVE_POOL;
  address public immutable RECEIVE_REGISTRY;
  address public immutable FUND_VERIFIER;
  address public immutable CLAIM_VERIFIER;
  address public immutable TRANSFER_VERIFIER;
  mapping(address asset => address pool) public poolFor;
  uint256 public poolCount;

  event PoolCreated(address indexed asset, address indexed pool);

  constructor(
    address deepToken,
    address verifier,
    address nativePool,
    address registry,
    address fundVerifier,
    address claimVerifier,
    address transferVerifier
  ) {
    if (
      deepToken.code.length == 0 ||
      verifier.code.length == 0 ||
      registry.code.length == 0 ||
      fundVerifier.code.length == 0 ||
      claimVerifier.code.length == 0 ||
      transferVerifier.code.length == 0
    ) {
      revert InvalidConstructorAddress();
    }
    if (nativePool.code.length == 0) revert InvalidNativePool();
    IShieldedPoolConfiguration nativeConfiguration = IShieldedPoolConfiguration(nativePool);
    if (
      nativeConfiguration.assetKind() != 1 ||
      nativeConfiguration.protocolVersion() != 1 ||
      nativeConfiguration.VERIFIER() != verifier ||
      nativeConfiguration.RECEIVE_REGISTRY() != registry ||
      nativeConfiguration.FUND_VERIFIER() != fundVerifier ||
      nativeConfiguration.CLAIM_VERIFIER() != claimVerifier ||
      nativeConfiguration.TRANSFER_VERIFIER() != transferVerifier
    ) revert InvalidNativePool();
    DEEP_TOKEN = deepToken;
    VERIFIER = verifier;
    NATIVE_POOL = nativePool;
    RECEIVE_REGISTRY = registry;
    FUND_VERIFIER = fundVerifier;
    CLAIM_VERIFIER = claimVerifier;
    TRANSFER_VERIFIER = transferVerifier;
    poolFor[address(0)] = nativePool;
    poolCount = 1;
    emit PoolCreated(address(0), nativePool);
    _createPool(deepToken);
  }

  function createPool(address token) external nonReentrant returns (address pool, bool created) {
    if (token == address(0) || token.code.length == 0) revert InvalidToken();
    pool = poolFor[token];
    if (pool != address(0)) return (pool, false);
    return (_createPool(token), true);
  }

  function _createPool(address token) private returns (address pool) {
    pool = address(
      new ShieldedErc20Pool(token, VERIFIER, RECEIVE_REGISTRY, FUND_VERIFIER,
        CLAIM_VERIFIER, TRANSFER_VERIFIER)
    );
    poolFor[token] = pool;
    ++poolCount;
    emit PoolCreated(token, pool);
  }
}
