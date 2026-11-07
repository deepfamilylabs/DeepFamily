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

contract ShieldedUnshield4Verifier {
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
    uint256 constant deltax1 = 2630980333035050823332635557549181305280017014337054291298356451324893786435;
    uint256 constant deltax2 = 18765828471043519968017968798088535217900738409475839375315114588182510779323;
    uint256 constant deltay1 = 20819806011444564265865414961275083313865050747951552319401079069815053152009;
    uint256 constant deltay2 = 16693376605844047993508546577824355370600957462784794866561115256661243847935;

    
    uint256 constant IC0x = 12441773064983503333271384424877788287617258808793896848190618087643801424743;
    uint256 constant IC0y = 20193676955431707141215629013354677151810927441197805693810580978489144993375;
    
    uint256 constant IC1x = 19702896947655583355319110269918081176373904285203716375081001566513631196878;
    uint256 constant IC1y = 5279772412907839772174977717521769573290184323827749793730686860073157831819;
    
    uint256 constant IC2x = 20158360315847780323870885474185919570452314495112629212479999871178112378234;
    uint256 constant IC2y = 19258587266683383650767863162003119164921548093514755001353552531777163710009;
    
    uint256 constant IC3x = 9531071851955193530012682389867045218737069656605179883639960678241604266736;
    uint256 constant IC3y = 20361512433889313950337626990639043429335161607063223629660843848450309782410;
    
    uint256 constant IC4x = 13679926972891363679948688393520432449940669951123642248359796041695113784347;
    uint256 constant IC4y = 8865952475951702419992329747771837242809424619000048885288904175335910286949;
    
    uint256 constant IC5x = 13904833101839229360155262594381208746879339422146372183866648866363966818662;
    uint256 constant IC5y = 14185262426111248283486285620722032724060133291758858902596185177165652060395;
    
    uint256 constant IC6x = 12160901952622202858589319743346289829023094193478884309920214006293371100639;
    uint256 constant IC6y = 9070992875854878019411386830332564724765298695998895133370804090175218081661;
    
    uint256 constant IC7x = 1265365299113820288226238051666078624492538211603514626769794975799492712309;
    uint256 constant IC7y = 12412757233501343511729280927586865053703866903894851217271435486647562298654;
    
    uint256 constant IC8x = 16743533961942016550856334696211164888784777158823247540730698075362346835417;
    uint256 constant IC8y = 2587466684554573553031091463107044947201471703718107128376635368110187182780;
    
    uint256 constant IC9x = 8243883216977772983594210795477528227893060441526763836884404904828628253621;
    uint256 constant IC9y = 15805858512977533694359343005019299242856871132752910570946241431077336712057;
    
    uint256 constant IC10x = 13958193064657288710503543048131727629869957551747384475779031597676344181271;
    uint256 constant IC10y = 12889145541605376019178517633559894514763090052960403596055015710892338017976;
    
    uint256 constant IC11x = 16588101542157646716599938010401506102651389858327461794137055722083081227430;
    uint256 constant IC11y = 19963664111506180786376663284270507420954159988277120319803103762148623960286;
    
    uint256 constant IC12x = 18334670785206659221044089460024026486741339098202965186813274736689149559520;
    uint256 constant IC12y = 19267379561114618368034644490401631777055049434423268303592998410346115941111;
    
    uint256 constant IC13x = 8341659370127937032534750071223821638806743594132894499095098714527670835069;
    uint256 constant IC13y = 18582551625290126746211720916857994257830192640902602619685208613811223106704;
    
    uint256 constant IC14x = 20573816282138773875122140489249913214240246919447636677010584054221443743874;
    uint256 constant IC14y = 12299146989372824638763835397196544337996474682496749573418353514989616671344;
    
    uint256 constant IC15x = 14060212957726249330623852610691070717414259729624614251488691209615103760940;
    uint256 constant IC15y = 19904038079224809824604692669611740408238375018744533081712652330863497155654;
    
    uint256 constant IC16x = 19394124429351383943548110227018574041918911475737751441296568252918923250263;
    uint256 constant IC16y = 21817183603414292307475717092468925309891286271946796919882412961756623208627;
    
 
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
