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
    uint256 constant deltax1 = 649936448936255870996379607646980271458587528315294391090447218141124135715;
    uint256 constant deltax2 = 2809012377317881936816482262945357979726617342889399894037331936513462357247;
    uint256 constant deltay1 = 15841314925359021869544261649577329567176129378253237152013691958530671981590;
    uint256 constant deltay2 = 10837954014652642579190398886392685259979819924203900435225094361789489498519;

    
    uint256 constant IC0x = 5969013738932608486073052977878988613743279149823784304849111526467613770999;
    uint256 constant IC0y = 12842745114460634159905962126893086483098253983651011729244089483601941018392;
    
    uint256 constant IC1x = 13050283073995686584300944906846155361895822074417018948416976481380270355085;
    uint256 constant IC1y = 15174821294827244229783705540478015501293726446216487293138116287880998752604;
    
    uint256 constant IC2x = 8925173327071495693413439564455874301668781630800774008446255130474805303664;
    uint256 constant IC2y = 16356391019736982302903062398457476587959104833914380957623696724089961763262;
    
    uint256 constant IC3x = 15482675416103455501815066478205781127470715043589157937876719396622013620468;
    uint256 constant IC3y = 16097384984759382893381002617343324656334316699828924444978881751316344719849;
    
    uint256 constant IC4x = 19998177060760590971590290763446201726539076376505788569919406462011529865793;
    uint256 constant IC4y = 10265012656023102579485673880026299866892288068295113431601388686061963645361;
    
    uint256 constant IC5x = 1604308537125917739541400225693428215859858640798569029898646235982583317709;
    uint256 constant IC5y = 15821020591566971439205656635182906411068476742420684365943802024179356801080;
    
    uint256 constant IC6x = 20962509491101696437084967694177785094239968513783478682738231936934214682281;
    uint256 constant IC6y = 13775498972598013422930628743413049157014132939204894311925217605441929480080;
    
    uint256 constant IC7x = 2891160511799501186292418395342640645975052449739774716683441884235781414582;
    uint256 constant IC7y = 972683627353712116368732677174573221660289704940291548268340359784625525178;
    
    uint256 constant IC8x = 12032410924460828158279420011952107819086684935204513188650465441711376171428;
    uint256 constant IC8y = 6636179373256824344611180040513683810110189359616735634243392944148253958100;
    
    uint256 constant IC9x = 21676292561123739000240095685118450211953852466146290260303778289319615515015;
    uint256 constant IC9y = 21426611900112091383460616127170264314986708321283601135917281924214676351773;
    
    uint256 constant IC10x = 2189837684359820687167434174731276881836375499645768739204679597751105981105;
    uint256 constant IC10y = 14748981619064455381648712583895631330010466834413906287195368733137435070525;
    
    uint256 constant IC11x = 1230965488651929108826551236170362373003735126358638575297971735102821248270;
    uint256 constant IC11y = 2457668986174848563344090231565366332508702213529694133702040647877433834036;
    
    uint256 constant IC12x = 11205973370705135504582421143076948295148638338456481725151612552077160569745;
    uint256 constant IC12y = 390391525762847116512996801938378597456025009474903448832416192946392689259;
    
    uint256 constant IC13x = 16424013106277074941343630376144820916765984589880951274191561196972590629985;
    uint256 constant IC13y = 11906776258634982170024210898931751432881224606788673811341810664269372269090;
    
    uint256 constant IC14x = 3117198280212263147739599426809140645985692971549509267229691501995689510968;
    uint256 constant IC14y = 4162288477838278757810902265680115676728363433895104901369382102248601400494;
    
    uint256 constant IC15x = 9421862034793150772006921308272197219600149770357092157343825989675895882152;
    uint256 constant IC15y = 17465615847990069971073559361632023735815715973484243534055846637045939597954;
    
    uint256 constant IC16x = 381363822047271356474940960159166108113945561826348312828381166885773988000;
    uint256 constant IC16y = 8984168730559399991180950538658899626256887608952983738708838329296710353310;
    
 
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
