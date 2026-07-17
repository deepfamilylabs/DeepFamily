// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../DeepFamilyToken.sol";

contract DeepFamilyTokenMinterMock {
  // solhint-disable-next-line immutable-vars-naming
  address private immutable tokenContract;

  constructor(address tokenContract_) {
    tokenContract = tokenContract_;
  }

  // solhint-disable-next-line func-name-mixedcase
  function DEEP_FAMILY_TOKEN_CONTRACT() external view returns (address) {
    return tokenContract;
  }

  function mint(address miner) external returns (uint256) {
    return DeepFamilyToken(tokenContract).mint(miner);
  }
}
