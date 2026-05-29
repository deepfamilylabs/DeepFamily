// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title UUPSProxy
 * @notice Thin ERC1967 proxy wrapper so the deployment tooling can obtain a named
 *         artifact (`UUPSProxy`) via getContractFactory. Upgrade logic lives in the
 *         UUPS implementation contracts; this contract only forwards calls.
 */
contract UUPSProxy is ERC1967Proxy {
  constructor(address implementation, bytes memory data) ERC1967Proxy(implementation, data) {}
}
