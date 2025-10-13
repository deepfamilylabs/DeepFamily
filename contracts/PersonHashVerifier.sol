// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity ^0.8.20;

contract PersonHashVerifier {
  // Scalar field size
  uint256 constant r =
    21888242871839275222246405745257275088548364400416034343698204186575808495617;
  // Base field size
  uint256 constant q =
    21888242871839275222246405745257275088696311157297823662689037894645226208583;

  // Verification Key data
  uint256 constant alphax =
    8345249447996820415712162010513924439487905774345689046418169970634669200586;
  uint256 constant alphay =
    10607151413491266933053311588515520884715045481771395211249947936388539744652;
  uint256 constant betax1 =
    3674408713119549878044530260088588730565630368558675628570003291216408602509;
  uint256 constant betax2 =
    12293302752835561496180475474490030836407215113228229077207162120819320060673;
  uint256 constant betay1 =
    644119420543102297665458497927843511278742545971908644888947735050482490249;
  uint256 constant betay2 =
    6695664068721566451830578723787102609604211509195194699178656876364257434229;
  uint256 constant gammax1 =
    11559732032986387107991004021392285783925812861821192530917403151452391805634;
  uint256 constant gammax2 =
    10857046999023057135944570762232829481370756359578518086990519993285655852781;
  uint256 constant gammay1 =
    4082367875863433681332203403145435568316851327593401208105741076214120093531;
  uint256 constant gammay2 =
    8495653923123431417604973247489272438418190587263600148770280649306958101930;
  uint256 constant deltax1 =
    1889806298193937050053968343332466991530604638380914836776577076821510591289;
  uint256 constant deltax2 =
    21805211394743104576408036880178100013056001238289830247964961940315942349701;
  uint256 constant deltay1 =
    7145173630481961628305215923851602996270618569523577091791921690864122113937;
  uint256 constant deltay2 =
    16378791463215924574024521823675038800919597780097496730946095755614332667887;

  uint256 constant IC0x =
    422641276498903087721513373384200898588127030904195569110466974155591437640;
  uint256 constant IC0y =
    10857364137431338097482395384651894803164670477291470758778539792364892274895;

  uint256 constant IC1x =
    18000551110499045318800802903022678666958915727184243895911855612462303281005;
  uint256 constant IC1y =
    2691612196648565528561480334189202706546930517619283666316493166956480879771;

  uint256 constant IC2x =
    7895307819617230245098691645576938556042507366356487033005658145087337798304;
  uint256 constant IC2y =
    17250642943718503067414043127494096584054592496308752065939240000622222402281;

  uint256 constant IC3x =
    12021433448315937499820663661541244599312652258353360248033123477023690184347;
  uint256 constant IC3y =
    16681282607115944722728707383334273728684925310097607233119974838061556381737;

  uint256 constant IC4x =
    6352183950379340395510606997020688505199282180564995559911106081475065875258;
  uint256 constant IC4y =
    1352727597885409567712878707391725530158842716603675161381263491860985067593;

  uint256 constant IC5x =
    3597942540929686762687913646228867391823680441447781846772834303041251542795;
  uint256 constant IC5y =
    15584015255491231198245655079569224286168113709820150512477521852136587117380;

  uint256 constant IC6x =
    2473977958007062629265393597661295443419508262747945312875015704821948227860;
  uint256 constant IC6y =
    983189060786910775461531470479266759258809066327237080158042835956358032741;

  uint256 constant IC7x =
    5946332733775744115712710839902699714173958095119902788194332238234401012558;
  uint256 constant IC7y =
    9496266004728742281027215025764461579357289082879308301649942352925774631300;

  // Memory data
  uint16 constant pVk = 0;
  uint16 constant pPairing = 128;

  uint16 constant pLastMem = 896;

  function verifyProof(
    uint[2] calldata _pA,
    uint[2][2] calldata _pB,
    uint[2] calldata _pC,
    uint[7] calldata _pubSignals
  ) public view returns (bool) {
    assembly {
      function checkField(v) {
        if iszero(lt(v, r)) {
          mstore(0, 0)
          return(0, 0x20)
        }
      }

      // G1 function to multiply a G1 value(x,y) to value in an address
      function g1_mulAccC(pR, x, y, s) {
        let success
        let mIn := mload(0x40)
        mstore(mIn, x)
        mstore(add(mIn, 32), y)
        mstore(add(mIn, 64), s)

        success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

        if iszero(success) {
          mstore(0, 0)
          return(0, 0x20)
        }

        mstore(add(mIn, 64), mload(pR))
        mstore(add(mIn, 96), mload(add(pR, 32)))

        success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

        if iszero(success) {
          mstore(0, 0)
          return(0, 0x20)
        }
      }

      function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
        let _pPairing := add(pMem, pPairing)
        let _pVk := add(pMem, pVk)

        mstore(_pVk, IC0x)
        mstore(add(_pVk, 32), IC0y)

        // Compute the linear combination vk_x

        g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))

        g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))

        g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))

        g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))

        g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))

        g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))

        g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))

        // -A
        mstore(_pPairing, calldataload(pA))
        mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

        // B
        mstore(add(_pPairing, 64), calldataload(pB))
        mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
        mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
        mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

        // alpha1
        mstore(add(_pPairing, 192), alphax)
        mstore(add(_pPairing, 224), alphay)

        // beta2
        mstore(add(_pPairing, 256), betax1)
        mstore(add(_pPairing, 288), betax2)
        mstore(add(_pPairing, 320), betay1)
        mstore(add(_pPairing, 352), betay2)

        // vk_x
        mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
        mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))

        // gamma2
        mstore(add(_pPairing, 448), gammax1)
        mstore(add(_pPairing, 480), gammax2)
        mstore(add(_pPairing, 512), gammay1)
        mstore(add(_pPairing, 544), gammay2)

        // C
        mstore(add(_pPairing, 576), calldataload(pC))
        mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

        // delta2
        mstore(add(_pPairing, 640), deltax1)
        mstore(add(_pPairing, 672), deltax2)
        mstore(add(_pPairing, 704), deltay1)
        mstore(add(_pPairing, 736), deltay2)

        let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

        isOk := and(success, mload(_pPairing))
      }

      let pMem := mload(0x40)
      mstore(0x40, add(pMem, pLastMem))

      // Validate that all evaluations ∈ F

      checkField(calldataload(add(_pubSignals, 0)))

      checkField(calldataload(add(_pubSignals, 32)))

      checkField(calldataload(add(_pubSignals, 64)))

      checkField(calldataload(add(_pubSignals, 96)))

      checkField(calldataload(add(_pubSignals, 128)))

      checkField(calldataload(add(_pubSignals, 160)))

      checkField(calldataload(add(_pubSignals, 192)))

      // Validate all evaluations
      let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

      mstore(0, isValid)
      return(0, 0x20)
    }
  }
}
