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

contract ShieldedClaimVerifier {
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
    uint256 constant deltax1 = 6856019362279104952169079078626188418643445713927288655682575566754823229226;
    uint256 constant deltax2 = 679280417021529577796992370030332469359308499835327016495365962403707607992;
    uint256 constant deltay1 = 16813304976419342796878228229683530335825195845115734356267186482685965508706;
    uint256 constant deltay2 = 18643676587063823274902665791437654537097579352736856474303859631858270713041;

    
    uint256 constant IC0x = 7974662358981293807856622197570714109928037809225854030539773580344298064122;
    uint256 constant IC0y = 6781602592704800843822845424312737928814857286265048351731868700998725148561;
    
    uint256 constant IC1x = 16413445617655171330555526500644417828875734863751020125904104340703908782821;
    uint256 constant IC1y = 11366723473702795402848557024617824456375093201676907996508390857785627301044;
    
    uint256 constant IC2x = 17915742433989049830499756717538579621488152934641779015023006743119442048607;
    uint256 constant IC2y = 21644916517859186945261065303542967070812162527367823726468991888281627870088;
    
    uint256 constant IC3x = 4720862213784455149960911414236230981401169350937734490292095106583904579597;
    uint256 constant IC3y = 12700954121549357966131126731514811896800279945967211361561062270410186139682;
    
    uint256 constant IC4x = 7481449522624848585906270574701300684375633994585901217707796669153114894097;
    uint256 constant IC4y = 6979892657059825992747071181511128507838145212696086503351629092992839195200;
    
    uint256 constant IC5x = 11180844029517236053157402872606177303001423010118739308720958882060274069194;
    uint256 constant IC5y = 19221205112744140066187567847414371065795851270998685093578879728469323524605;
    
    uint256 constant IC6x = 10652030530075562582616901695052137316107749375973141586795939790368453619553;
    uint256 constant IC6y = 15658065880962861221914946958218017921314159889134688359880071691075065628340;
    
    uint256 constant IC7x = 17365597271244378685372588401487931357427418073658325735139703287820023841657;
    uint256 constant IC7y = 9874178061382005797213638889173312970151237214152050202363887721213873144514;
    
    uint256 constant IC8x = 175174984500403688091828045474395715988354009900415987255763348308077460575;
    uint256 constant IC8y = 1943106645808224809538998558811519042097994424531799901094293153179265978786;
    
    uint256 constant IC9x = 925328819382938309735931286832809232731641241991168323693005026058666989594;
    uint256 constant IC9y = 6397351934601217850995793606400639159823764740893015296910757445135215441824;
    
    uint256 constant IC10x = 20551412528412397265003863081864897577286544027007425337082455866547704193734;
    uint256 constant IC10y = 21428031156716585628806749458431799103053972235941003952909920774148632586037;
    
    uint256 constant IC11x = 19881476455320289420595503622620731405595856589096349094456730776930105557554;
    uint256 constant IC11y = 85580004605329412329570183756203545140031524596487566124137868154884511503;
    
    uint256 constant IC12x = 11307116186697935599448044108716049116875054282688813641523408538818339203340;
    uint256 constant IC12y = 16296634911995075033475746945498725212443461412711734309757691207344362932863;
    
    uint256 constant IC13x = 16458374474354460048408446975766659573628856947036265274306432758456363788686;
    uint256 constant IC13y = 8929679463193447767566074323098210109425340864470681692247943424212355430684;
    
    uint256 constant IC14x = 19500868613734242306913641517075553646591829286274490242221811445370722484369;
    uint256 constant IC14y = 15789677231947774576313909299159950943408503383411896106554037177336332275602;
    
    uint256 constant IC15x = 9525045283510561223432280617618835557637300354254309032336583866054209824650;
    uint256 constant IC15y = 8617098824466454002638963980286147079364113476716768913226128741608213645433;
    
    uint256 constant IC16x = 1362208302898169964250856699371470377776554422382611367062755037241439528391;
    uint256 constant IC16y = 18122140085645636803410520219302555077990481617185059711765069153443901982359;
    
    uint256 constant IC17x = 12703690553657052888951501936871316163067858667151156816562178880026507428688;
    uint256 constant IC17y = 2243568670468108501728952403218883885617725288675513743277700549227823077250;
    
    uint256 constant IC18x = 802880532550826637240599818936848588284752086245890309065865487753447402447;
    uint256 constant IC18y = 577685682652783555884491070220538404476184591746290865649833775519401691370;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[18] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
