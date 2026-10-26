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

// DEVELOPMENT ONLY: generated from an isolated local setup; not production keys.
pragma solidity ^0.8.24;

contract BudgetDepositVerifier {
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
    uint256 constant deltax1 = 11811755333613051204178244981724070875670147069750452046151747741171454909693;
    uint256 constant deltax2 = 17568300894262247084471936945479906914959794446897186842164785093155275220830;
    uint256 constant deltay1 = 19382857873037145957732746833912491065658343428095075282873233453294587359213;
    uint256 constant deltay2 = 16969500561410942803735871007078257772945936487804950186467625525641764806241;

    
    uint256 constant IC0x = 2432164539026175110794799158451095086265294616254556934322338327478984065887;
    uint256 constant IC0y = 18150449772367718106347747970258654873010217407248043487501198980795750519140;
    
    uint256 constant IC1x = 6125456979893950496104766140343634319712681502024278078903110032142949480529;
    uint256 constant IC1y = 5681322654864633790283067856476090015187879045298592068279115001476102136993;
    
    uint256 constant IC2x = 11418935582502929164434151979253545774462506075451811180306489609422545430618;
    uint256 constant IC2y = 8762682812903693328582587423295605882032087099241749985475233630568729819456;
    
    uint256 constant IC3x = 3204118869619562012642326536489969414776718345759291921105429114242531941426;
    uint256 constant IC3y = 16920998650645034024774898796062569029083389774307838325760979161161820820861;
    
    uint256 constant IC4x = 4720053935523101902579714857265031878222411645020212922511713985179389141930;
    uint256 constant IC4y = 5968398685682516387794421149307116641727403091563348291552733385745096738920;
    
    uint256 constant IC5x = 4958941308677515099096196920107682541989491249502853972994782902326209351900;
    uint256 constant IC5y = 5344684151439381180208737930748914948772212785373178260728988564601281009067;
    
    uint256 constant IC6x = 15427912442752994271695118892484734510471753680467720641364743949749105228978;
    uint256 constant IC6y = 12086310389250589880749995600568594151434410856937498160182833359545064556802;
    
    uint256 constant IC7x = 16038251554666538560425008066192002479535835893768910797132674203417411665274;
    uint256 constant IC7y = 17945304732052958586680084967164421606348891853692408082534434492883442245698;
    
    uint256 constant IC8x = 16217639786759702739950416497575798646866893622107715544524258001117589362124;
    uint256 constant IC8y = 17120542571014149045179898297118949948788241176363910706535318343213800709786;
    
    uint256 constant IC9x = 3518366218042182408790738218059489251686204511493647095156971042122806983550;
    uint256 constant IC9y = 14461149703193954807670916409640442578465274576591166440149406608445226449911;
    
    uint256 constant IC10x = 21650841457094037407717914375889776709898869978760661646530143266749087979767;
    uint256 constant IC10y = 11479690191829630875911719842350521976456961137510391988012117841242268032349;
    
    uint256 constant IC11x = 7948437862616272015447911727801250507685443579018968051372343764584460313952;
    uint256 constant IC11y = 19995490257634833981288156787361723766047255716501261358428309478038772750466;
    
    uint256 constant IC12x = 16799809428861885001791701622512420830413823634344799961005719981557672121779;
    uint256 constant IC12y = 10173045389369121974322424067560973630838595736523478257848559612111290246711;
    
    uint256 constant IC13x = 4537046969776382083817292488179755865387490819390654252917393825209157529073;
    uint256 constant IC13y = 10116652847947580919601659125250113149916114651572479724707673071695598355533;
    
    uint256 constant IC14x = 17763590976439416700907882808992811801239130487638957076745009378094589776409;
    uint256 constant IC14y = 11923687163134623886208064636291366253658576597465843390733077417567833035052;
    
    uint256 constant IC15x = 9109844241588210566731278389470719568404389605964247826176765758944434295147;
    uint256 constant IC15y = 6102871949501526600615300530067710009598794513749881746870305115397531758158;
    
    uint256 constant IC16x = 11323015643552579890997904489446332373833966694912746676716893561477387486635;
    uint256 constant IC16y = 13140803793669031680909328478247449666571591231383238098162630333690586561040;
    
    uint256 constant IC17x = 21751417536769679704997049920467961300203220048593531541147203875834278839429;
    uint256 constant IC17y = 8910842578406127573450995451504802929205008113862696612856425472621181071315;
    
    uint256 constant IC18x = 111261087187942278479344440061190787719853850831183575632914867789316184107;
    uint256 constant IC18y = 4999996413508894365386145046521879777706671885280668066179366917546535951321;
    
    uint256 constant IC19x = 4654935459926839113488200647157441321266325876558769376708195035680680674162;
    uint256 constant IC19y = 18782563856269854129972570116797800897638144893903024393395399399216960252922;
    
    uint256 constant IC20x = 20262348020909260530104158125364923912414097991734357498144131892177434346223;
    uint256 constant IC20y = 20296307932194586241369836542717008063637170794561576667450766285381332718985;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[20] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC17x, IC17y, calldataload(add(pubSignals, 512)))
                
                g1_mulAccC(_pVk, IC18x, IC18y, calldataload(add(pubSignals, 544)))
                
                g1_mulAccC(_pVk, IC19x, IC19y, calldataload(add(pubSignals, 576)))
                
                g1_mulAccC(_pVk, IC20x, IC20y, calldataload(add(pubSignals, 608)))
                

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
            
            checkField(calldataload(add(_pubSignals, 512)))
            
            checkField(calldataload(add(_pubSignals, 544)))
            
            checkField(calldataload(add(_pubSignals, 576)))
            
            checkField(calldataload(add(_pubSignals, 608)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
