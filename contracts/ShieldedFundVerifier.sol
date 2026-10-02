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

contract ShieldedFundVerifier {
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
    uint256 constant deltax1 = 8313632123349457775904479326704900781833391827673130021766935377476676705741;
    uint256 constant deltax2 = 13222935763099382464345927361535688098934839065791208868813985143609482905764;
    uint256 constant deltay1 = 7474958424021842969711318121795535387033507224582991999928575561412150906254;
    uint256 constant deltay2 = 8662431390473671363804668134684428814023355505543298025078645608272176031427;

    
    uint256 constant IC0x = 12327248980182130499828097366040829696831829156321414302153717126361825885211;
    uint256 constant IC0y = 18654275499200039081936387187763127279968229443834994662978232698086569862827;
    
    uint256 constant IC1x = 5926458186549660950452946077064924606957590039853229078229752181901614264043;
    uint256 constant IC1y = 20579185057828507683578889799016881673684979886020731802300317500734695581802;
    
    uint256 constant IC2x = 21062708521759038030542714239224867722713499486291311809189028971862548413098;
    uint256 constant IC2y = 12114153475955125539912312155838517312596696221788934825619099997389304024948;
    
    uint256 constant IC3x = 13158661605811643417012155590311262043728530560390962406061950054717871544729;
    uint256 constant IC3y = 2790858642762417574881767573507547307535832339269935141129780866130674417188;
    
    uint256 constant IC4x = 20634538649035105913731962500316902694019517766748816121835347368356754375061;
    uint256 constant IC4y = 16623852413915341045877697283548633829331105107433820080646924306947514278679;
    
    uint256 constant IC5x = 20891281738464439111699399872275412083929367969073345955767432945285180452936;
    uint256 constant IC5y = 11242117795897303039701081785912188668972647366163182246803015805600962970877;
    
    uint256 constant IC6x = 6598064692651680074695845427542895404653645701749763861587562103727013242656;
    uint256 constant IC6y = 15789503980917241711277063157539060450186940398352813588985851496077563297895;
    
    uint256 constant IC7x = 5660134587154710184872585423611373246610357662296669914932531723425055546466;
    uint256 constant IC7y = 21393101145655810594227867990210354615368245417976364298916392285643953955474;
    
    uint256 constant IC8x = 4938798410947939515979751734077200172295871285462552911029497200541435556194;
    uint256 constant IC8y = 1026044081021049910086506554561860799392073034108952973027744521374021066726;
    
    uint256 constant IC9x = 10867100050561798328704620767507836658335647567448453774662460537362898442893;
    uint256 constant IC9y = 779871041878535005807115281755832248448607792663316446957234427174833018323;
    
    uint256 constant IC10x = 6593205720758154205930520932546569817717309744452856432976630387904951324699;
    uint256 constant IC10y = 9863881727815383537266804364624088222279477931344549252434322912720552147453;
    
    uint256 constant IC11x = 11686453202157508211535080092802426186270226032935458656698962800186901628098;
    uint256 constant IC11y = 10399249806954659982002285650292344562464016622354983037738746582302533518810;
    
    uint256 constant IC12x = 5050556440785490996477214886454294526107466200396009077802677050797495208969;
    uint256 constant IC12y = 9122662821618462179942977265322133389277794686809527409701858036039884948951;
    
    uint256 constant IC13x = 5947120563010564543685990468400938421780710559450939908085210643889298515363;
    uint256 constant IC13y = 21880620099777021776862435629010457854141866940792702838665886917119499210878;
    
    uint256 constant IC14x = 14814377084649249789543122846270896825616898620134419956102016319035392379827;
    uint256 constant IC14y = 20600477923471724630831019112482218007372430389299079558925445552120861931373;
    
    uint256 constant IC15x = 16535305414949766681083176414832418902303593056841430795798787910513880190007;
    uint256 constant IC15y = 15762425452073699687584266682285302424951637369524295187417292171810542111592;
    
    uint256 constant IC16x = 18260934486556161673822506819361632523374666796096649538021593878307400311222;
    uint256 constant IC16y = 18422066002739945550238007778334838441340697559731800623270449710378007900044;
    
 
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
