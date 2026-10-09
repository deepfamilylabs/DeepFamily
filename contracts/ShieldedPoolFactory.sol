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
  address public immutable LINEAGE_INDEX;
  address public immutable VERIFIER;
  address public immutable NATIVE_POOL;
  mapping(address asset => address pool) public poolFor;
  uint256 public poolCount;

  event PoolCreated(address indexed asset, address indexed pool);

  constructor(address deepToken, address lineageIndex, address verifier, address nativePool) {
    if (deepToken.code.length == 0 || lineageIndex.code.length == 0 || verifier.code.length == 0) {
      revert InvalidConstructorAddress();
    }
    if (nativePool.code.length == 0) revert InvalidNativePool();
    IShieldedPoolConfiguration nativeConfiguration = IShieldedPoolConfiguration(nativePool);
    if (
      nativeConfiguration.assetKind() != 1 ||
      nativeConfiguration.protocolVersion() != 3 ||
      nativeConfiguration.LINEAGE_INDEX() != lineageIndex ||
      nativeConfiguration.VERIFIER() != verifier
    ) revert InvalidNativePool();
    DEEP_TOKEN = deepToken;
    LINEAGE_INDEX = lineageIndex;
    VERIFIER = verifier;
    NATIVE_POOL = nativePool;
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
    pool = address(new ShieldedErc20Pool(token, LINEAGE_INDEX, VERIFIER));
    poolFor[token] = pool;
    ++poolCount;
    emit PoolCreated(token, pool);
  }
}
