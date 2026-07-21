// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Multisig inspection surface with an unsafe 1-of-1 policy, used only to prove the
/// production deployment guard rejects contract wallets that are not actually multisig.
contract SingleSignerWalletMock {
  // solhint-disable-next-line immutable-vars-naming
  address private immutable walletOwner;

  constructor(address owner_) {
    walletOwner = owner_;
  }

  function getThreshold() external pure returns (uint256) {
    return 1;
  }

  function getOwners() external view returns (address[] memory owners) {
    owners = new address[](1);
    owners[0] = walletOwner;
  }
}
