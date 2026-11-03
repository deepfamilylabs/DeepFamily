// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IDeepFamilyTokenBinding {
  // solhint-disable-next-line func-name-mixedcase
  function DEEP_FAMILY_TOKEN_CONTRACT() external view returns (address);
}

/**
 * @title DeepFamily Token (DEEP)
 * @dev Family tree mining token contract - Standard ERC20 token
 *
 * Core Features:
 * - Standard ERC20 compatible, supports wallets and DEX
 * - Only authorized deep family contract can mint tokens
 * - Progressive halving mining reward mechanism
 * - Hard cap of 100 billion, with issuance ending earlier if integer rewards reach zero
 *
 * Halving cycles: 1 → 10 → 100 → 1k → 10k → 100k → 1M → 10M → 100M → Fixed 100M
 * Initial reward: 113,777 DEEP
 * Maximum supply: 100 billion DEEP; actual mining issuance may be slightly lower due to integer halvings
 */
contract DeepFamilyToken is ERC20Burnable, Ownable {
  // ========== Mining Parameter Constants ==========

  uint256 public constant MAX_SUPPLY = 100_000_000_000e18; // 100 billion cap
  uint256 public constant INITIAL_REWARD = 113_777e18; // Initial reward (integer, no over-issuance)

  // Fixed cycle length from the 9th cycle onward
  uint256 public constant FIXED_LENGTH = 100_000_000;

  /// @dev Authorized DeepFamily contract address
  address public deepFamilyContract;

  /// @dev Whether contract has been initialized
  bool private initialized;

  /// @dev Number of successful reward-generating records
  uint256 public totalAdditions;

  /// @dev Most recent reward distributed by mint
  uint256 public recentReward;

  /// @dev Mining reward distribution event
  event MiningReward(address indexed miner, uint256 reward, uint256 totalAdditions);

  /// @dev DeepFamily contract address initialization event
  event DeepFamilyContractInitialized(address indexed deepFamilyContract);

  // ========== Custom Errors ==========

  error OnlyDeepFamilyContract();
  error ZeroAddress();
  error AlreadyInitialized();
  error NotInitialized();
  error InvalidDeepFamilyContract();
  error InvalidTokenBinding();
  error InvalidRecordCount();

  // ========== Modifiers ==========

  /// @dev Only allows calls from authorized DeepFamily contract
  modifier onlyDeepFamilyContract() {
    if (!initialized) revert NotInitialized();
    if (msg.sender != deepFamilyContract) revert OnlyDeepFamilyContract();
    _;
  }

  // ========== Constructor ==========

  constructor() ERC20("DeepFamily", "DEEP") Ownable(msg.sender) {}

  // ========== Initialization Functions ==========

  /**
   * @dev Initialize DeepFamily contract address (can only be called once)
   * @param _deepFamilyContract DeepFamily contract address
   */
  function initialize(address _deepFamilyContract) external {
    if (initialized) revert AlreadyInitialized();
    _checkOwner();
    if (_deepFamilyContract == address(0)) revert ZeroAddress();
    if (_deepFamilyContract.code.length == 0) revert InvalidDeepFamilyContract();

    address configuredToken;
    try IDeepFamilyTokenBinding(_deepFamilyContract).DEEP_FAMILY_TOKEN_CONTRACT() returns (
      address tokenAddress
    ) {
      configuredToken = tokenAddress;
    } catch {
      revert InvalidDeepFamilyContract();
    }
    if (configuredToken != address(this)) revert InvalidTokenBinding();

    deepFamilyContract = _deepFamilyContract;
    initialized = true;

    // The owner only protects the one-time deployment handshake. Once the reciprocal binding is
    // established there is no owner-managed configuration, so retire that authority permanently.
    _transferOwnership(address(0));

    emit DeepFamilyContractInitialized(_deepFamilyContract);
  }

  /**
   * @dev Distribute mining rewards (only callable by DeepFamily contract)
   * @param miner Miner address
   * @return reward Actual amount of rewards distributed
   */
  function mint(address miner) external onlyDeepFamilyContract returns (uint256 reward) {
    if (miner == address(0)) revert ZeroAddress();

    uint256 supply = totalSupply();
    if (supply >= MAX_SUPPLY) {
      recentReward = 0;
      return 0;
    }

    uint256 nextIndex = totalAdditions + 1;
    reward = getReward(nextIndex);

    if (reward == 0) {
      recentReward = 0;
      return 0;
    }

    uint256 remaining = MAX_SUPPLY - supply;
    if (reward > remaining) {
      reward = remaining;
    }

    totalAdditions = nextIndex;
    _mint(miner, reward);
    recentReward = reward;

    emit MiningReward(miner, reward, nextIndex);

    return reward;
  }

  /**
   * @dev Query the reward for a specific addition
   * @param recordCount Total number of addition records
   * @return reward Corresponding reward amount
   */
  function getReward(uint256 recordCount) public pure returns (uint256) {
    if (recordCount == 0) revert InvalidRecordCount();

    uint256 countLeft = recordCount;
    uint256 len = 1;

    // The first eight cycles grow tenfold, from 1 to 10_000_000 records.
    for (uint256 i = 0; i < 8; i++) {
      if (countLeft <= len) return INITIAL_REWARD >> i;
      countLeft -= len;
      len *= 10;
    }

    // All subsequent cycles contain FIXED_LENGTH records; countLeft is still one-based.
    return INITIAL_REWARD >> (8 + (countLeft - 1) / FIXED_LENGTH);
  }
}
