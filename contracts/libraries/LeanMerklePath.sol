// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

/** @dev LeanIMT promotes an unpaired node. A present sibling with value zero is still hashed. */
library LeanMerklePath {
  function proof(
    mapping(uint256 => mapping(uint256 => uint256)) storage nodes,
    uint256 size,
    uint256 treeDepth,
    uint256 leafIndex
  ) internal view returns (uint256 proofIndex, uint256 proofDepth, uint256[] memory siblings) {
    uint256 levelSize = size;
    uint256 index = leafIndex;
    // Count only existing siblings so the returned path has zk-kit LeanIMT's compact shape.
    for (uint256 level = 0; level < treeDepth; ++level) {
      if ((index & 1) == 1 || index + 1 < levelSize) ++proofDepth;
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }

    siblings = new uint256[](proofDepth);
    index = leafIndex;
    levelSize = size;
    uint256 siblingIndex = 0;
    for (uint256 level = 0; level < treeDepth; ++level) {
      if ((index & 1) == 1) {
        siblings[siblingIndex] = nodes[level][index - 1];
        proofIndex |= uint256(1) << siblingIndex;
        ++siblingIndex;
      } else if (index + 1 < levelSize) {
        siblings[siblingIndex] = nodes[level][index + 1];
        ++siblingIndex;
      }
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }
  }

  function writePath(
    mapping(uint256 => mapping(uint256 => uint256)) storage nodes,
    uint256 index,
    uint256 node,
    uint256 levelSize,
    uint256 treeDepth
  ) internal returns (uint256) {
    for (uint256 level = 0; level < treeDepth; ++level) {
      nodes[level][index] = node;
      if (index & 1 == 1) {
        node = PoseidonT3.hash([nodes[level][index - 1], node]);
      } else if (index + 1 < levelSize) {
        node = PoseidonT3.hash([node, nodes[level][index + 1]]);
      }
      index >>= 1;
      levelSize = (levelSize + 1) >> 1;
    }
    nodes[treeDepth][0] = node;
    return node;
  }
}
