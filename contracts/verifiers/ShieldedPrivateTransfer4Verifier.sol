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

pragma solidity >=0.7.0 <0.9.0;

contract ShieldedPrivateTransfer4Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 16428432848801857252194528405604668803277877773566238944394625302971855135431;
    uint256 constant alphay  = 16846502678714586896801519656441059708016666274385668027902869494772365009666;
    uint256 constant betax1  = 3182164110458002340215786955198810119980427837186618912744689678939861918171;
    uint256 constant betax2  = 16348171800823588416173124589066524623406261996681292662100840445103873053252;
    uint256 constant betay1  = 4920802715848186258981584729175884379674325733638798907835771393452862684714;
    uint256 constant betay2  = 19687132236965066906216944365591810874384658708175106803089633851114028275753;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 9194267373285236938061929669266819278407056441791041245408807307482743791037;
    uint256 constant deltax2 = 11058999358583413958162472324642020078195862219565121189838949720722086121344;
    uint256 constant deltay1 = 18481889565848663387009829744576934400057051840855751808599568609371400336636;
    uint256 constant deltay2 = 17897805671630336502265981215183450055204766829678830323520554976363276793930;

    
    uint256 constant IC0x = 12971333220479952890114791860079987849257709432732922193484139101686090652927;
    uint256 constant IC0y = 11042528950301945218828266091494679429677695655685823675114267206577166407305;
    
    uint256 constant IC1x = 8821535892126790469013335172283028891566354624622917447928768895851106563382;
    uint256 constant IC1y = 484732272842460617485006054351023640534779630486940245490310616512229159227;
    
    uint256 constant IC2x = 17644321323392905519368218390965449759150473809293647117747915935861666456369;
    uint256 constant IC2y = 20193713572253280826272991534523080885746957013013359584684185789692518050276;
    
    uint256 constant IC3x = 10877898849543947973327540204603539272282588636161263353829710667696008074896;
    uint256 constant IC3y = 15717910012739814289382695021791769600494850911764946651228244503462107261541;
    
    uint256 constant IC4x = 9738909515378645031080994119613205534794619009686480482316476065459974768430;
    uint256 constant IC4y = 9942646476602564730500846430481907372751258697606671080004226278979126578035;
    
    uint256 constant IC5x = 15373498113738678928996210776922001662090323367713067013087478998986706667383;
    uint256 constant IC5y = 12490845764964476828830059077942146301992181449254321168977278836020897588779;
    
    uint256 constant IC6x = 4497167776605837839285485487739541740674753231003138791961110062764527018298;
    uint256 constant IC6y = 13649865238837671185023199113945349557354742772012896776919360014897314237382;
    
    uint256 constant IC7x = 11707512930771336816098620178258712848530873264884276379617811322041153362017;
    uint256 constant IC7y = 12227477513114348811705163723015548778795425190660494152450705896726165273963;
    
    uint256 constant IC8x = 12636524279230887165415465940784360108515260933961908980119902611016221447517;
    uint256 constant IC8y = 19306769267705639231580077684093989476510259048059239319074445094571704079524;
    
    uint256 constant IC9x = 6329731583802277618470608310485492765143311656821429943788872041086004952186;
    uint256 constant IC9y = 19327155573017573473467482149990299534601368110576625665472435026261794942982;
    
    uint256 constant IC10x = 20552687116449894106092418109096321543689472844190704673048978994245639358904;
    uint256 constant IC10y = 14509707035919371822216055396757213157967464859853963044596288863455128966373;
    
    uint256 constant IC11x = 16480362844604248979279251058563595991393743603486364675089960086037127972726;
    uint256 constant IC11y = 2345340064864260192166509117798731862829425206374515685980989369119338380125;
    
    uint256 constant IC12x = 20876855747182552821067062513495992439316040454589100534974730706610149115266;
    uint256 constant IC12y = 17093767974800564049198781822367196366127741852079570077079167907665571723869;
    
    uint256 constant IC13x = 15873320278660812222540645640228374150220172501745756480551538679170133340944;
    uint256 constant IC13y = 11376022468001430639989861147559049426148648893960833128635130915373066508115;
    
    uint256 constant IC14x = 21865911898207138349762288410830689434174731299672904516301502090758884401862;
    uint256 constant IC14y = 10917149696851238031926868007515790076240693228865136175959937115886773854002;
    
    uint256 constant IC15x = 8345101905388509206815371166648010340198746847301394288369355062629381600519;
    uint256 constant IC15y = 16631546791543027947955096806798075654800745468389285221897925921912880738295;
    
    uint256 constant IC16x = 20331183959005396822867080486830754334367059804701730663638791196392534926063;
    uint256 constant IC16y = 19689837600621579455415754023288891764737085575880395119481885014356239853201;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[16] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                
                g1_mulAccC(_pVk, IC15x, IC15y, calldataload(add(pubSignals, 448)))
                
                g1_mulAccC(_pVk, IC16x, IC16y, calldataload(add(pubSignals, 480)))
                

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
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            
            checkField(calldataload(add(_pubSignals, 416)))
            
            checkField(calldataload(add(_pubSignals, 448)))
            
            checkField(calldataload(add(_pubSignals, 480)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
