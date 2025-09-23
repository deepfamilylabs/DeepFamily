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
    10820533967848804261283629202224498489349061042198076616070702020878894385625;
  uint256 constant alphay =
    8784995046300836111775097832512648724790754000851303253457317773931256431008;
  uint256 constant betax1 =
    7140606049166424652911630465510318049042851554019441465070822300996410114050;
  uint256 constant betax2 =
    3137007315078548456715141919032463632738712044834409706795370155987152322105;
  uint256 constant betay1 =
    11265532471706448741419068632948264385736047143027511477031998347057992938511;
  uint256 constant betay2 =
    495044789018562445236569388500763953203722240739481494053672139103125022818;
  uint256 constant gammax1 =
    11559732032986387107991004021392285783925812861821192530917403151452391805634;
  uint256 constant gammax2 =
    10857046999023057135944570762232829481370756359578518086990519993285655852781;
  uint256 constant gammay1 =
    4082367875863433681332203403145435568316851327593401208105741076214120093531;
  uint256 constant gammay2 =
    8495653923123431417604973247489272438418190587263600148770280649306958101930;
  uint256 constant deltax1 =
    13863542103243067245468519744891604700234363427988733255729410141243924787528;
  uint256 constant deltax2 =
    1175612915701642012091509404801477149755776850451667871638250397965409133912;
  uint256 constant deltay1 =
    4003524591391469349049821818213101017992016061635071226759414779012575671267;
  uint256 constant deltay2 =
    16669665303638167921542038132589035470238456591910027289035505129316905008063;

  uint256 constant IC0x =
    3497193308577502136037181960515319783514692680283994009008547428869641284845;
  uint256 constant IC0y =
    12086780215654202408421263301861674282994820679314103546186397849064111146008;

  uint256 constant IC1x =
    6277981365880534195534972484465432801176486592596781634688495756506430863421;
  uint256 constant IC1y =
    7888347305715867213596823659090442164453507273328478352575280405076513851863;

  uint256 constant IC2x =
    14414957938525087964194267722228261621136039701616297900941890507849209586243;
  uint256 constant IC2y =
    9490660595288311697996879060267579898612993795154367101666956958368947559433;

  uint256 constant IC3x =
    10001761670639717289181448180299860700755831839033280065537246059350502150326;
  uint256 constant IC3y =
    9775062397167820442904436855230484674071766861344708964984490881852906151999;

  uint256 constant IC4x =
    19528019518678343203762958337796855282613338754198689146781452472658527746105;
  uint256 constant IC4y =
    20269941146536778089134433791560098571994476261736392211856240493125574221522;

  uint256 constant IC5x =
    108187579192345415512422222645728473544443890827323477902633906706970195355;
  uint256 constant IC5y =
    19265728457208565913912207821230697530813331346605080770326172037129109414240;

  uint256 constant IC6x =
    16392044266597531558136895542972530237736327862515771682510524737133746393989;
  uint256 constant IC6y =
    4530205673890151011636358755836833034953289159941087698203696494293566290461;

  uint256 constant IC7x =
    2300753200701899777268520610319727778359843630548818566421315888955676460049;
  uint256 constant IC7y =
    7508468467951928021417604390670680863221369013478451603025331667178735901694;

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
