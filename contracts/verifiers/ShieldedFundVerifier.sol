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
    uint256 constant deltax1 = 16676888361493121413285321733564337771611000782204183250735088426214708451631;
    uint256 constant deltax2 = 3566975867865391607486486062441502286078033638777683366132948024557766373724;
    uint256 constant deltay1 = 4881937423133843211719701748134355361210492789198770955205823760878845418936;
    uint256 constant deltay2 = 15078733358808417420004604935537680066306736054678868556348264759123902402529;

    
    uint256 constant IC0x = 9753802604059275724607413599162821084841518067599423307975777209638940901539;
    uint256 constant IC0y = 4885431759198868681515242651950477369315919956894611143373003733755902234531;
    
    uint256 constant IC1x = 7657258912843385163553493226949903690910093607076764215663109467756939340110;
    uint256 constant IC1y = 19960717503908193698932126135321343560935444973113552019341646169696806162387;
    
    uint256 constant IC2x = 5626631969394741904989212255922026482341879714431797334903628537377357061273;
    uint256 constant IC2y = 3322437077244207457410379029310632458802466096946471668467288664223862894335;
    
    uint256 constant IC3x = 13167629087321054472601055055721729187523437899651652773285332896716844358224;
    uint256 constant IC3y = 10083818765218552911361776225085858589137968400831013046202576007438652186616;
    
    uint256 constant IC4x = 17910190016586952403949606119816354817272687770761610459074373581883257597289;
    uint256 constant IC4y = 2653199936849878341173292148592244920678450998005345141946812819847124897725;
    
    uint256 constant IC5x = 15911619080686387658882580715163676658665424208789880245453733229621502807478;
    uint256 constant IC5y = 13277398299999207695258021460395130369645945445042042435366428987254719337676;
    
    uint256 constant IC6x = 19003320354185818640886652390772013472474284741092159216346342058189375259043;
    uint256 constant IC6y = 2016070785853100897522433884118367482485895134141692142788197278002714214882;
    
    uint256 constant IC7x = 18404444794289822012361218004671010385525597172633385227698310177330122828943;
    uint256 constant IC7y = 4502950925864987438308577329653318995240285323574706729850296470630828654313;
    
    uint256 constant IC8x = 16175878445334212341370586236263187605756414409351239403836088039043858978388;
    uint256 constant IC8y = 12286699562454218249455965051479466426340890451992855244949140701261586727291;
    
    uint256 constant IC9x = 3647084073088899893476387779671228094369904935195544126973734099655060728477;
    uint256 constant IC9y = 16064995694133219776860858105033961592581988004591815937835393231548958961809;
    
    uint256 constant IC10x = 6102073859574838357777783388748768947935884711614998890100446386547127939940;
    uint256 constant IC10y = 5855676117195748363403794659326166572323839573351098947947683531316752621378;
    
    uint256 constant IC11x = 17501727215741481377299530617077523323207946461550530020676570014764016587257;
    uint256 constant IC11y = 16609098742771747611462895359650017333744092598182063238614330398474875272911;
    
    uint256 constant IC12x = 3846958138464019976880559147866241100756826652731190487415492619461170654400;
    uint256 constant IC12y = 14043057771160126385147126382553775995983965885892301332403133820916791914277;
    
    uint256 constant IC13x = 848926521932953755384030606045254249015608833565543462507338420551028501879;
    uint256 constant IC13y = 2711154126261189302340314417033391702726806259732793178402532571880520583831;
    
    uint256 constant IC14x = 16027913626432603239542477855376056546693864590522751351772364343741121969322;
    uint256 constant IC14y = 2670983873254548110798646444232355306673324176393640586313440676541974829197;
    
    uint256 constant IC15x = 17486314208837385506329093977764232515209412619126918244213517631905805135072;
    uint256 constant IC15y = 153103688834565491235672409639790396257281594241191030608040507317067263184;
    
    uint256 constant IC16x = 5092177200061340257648898314152462972234316919622913324302800166955534481197;
    uint256 constant IC16y = 20811546580794009399760856415483312273261928047436919136119518892940790770074;
    
    uint256 constant IC17x = 11864722668534172522080680187755751637643231626561219013540141831294324275743;
    uint256 constant IC17y = 20233451137385187372034887872688400927811438479478012607304640791583021985566;
    
    uint256 constant IC18x = 3341729264558159325394907351447674362832575505325306056989151153688003442770;
    uint256 constant IC18y = 3653877749307068088851075623158173443764171650221035863823066710168857829500;
    
    uint256 constant IC19x = 3746581461854527630995129477451416300926790203860015157533580219731274851105;
    uint256 constant IC19y = 21388060521530038716846350123885970929949881811483689648372717245531924375110;
    
    uint256 constant IC20x = 2275373025252849127874307205934421227693586854913682017603252849386258962651;
    uint256 constant IC20y = 824605487572672077492202777756329044441303079368598273990188743565466010020;
    
    uint256 constant IC21x = 4235480373061391252004212993829142264474694675263318003960242363365380158818;
    uint256 constant IC21y = 9385705835638556158823531919422812680686462015502201162080568052577413479933;
    
    uint256 constant IC22x = 2873929321591731364504298560706482133157209294631802775366559896012699101156;
    uint256 constant IC22y = 2789985720086485557403275280720191324338051743299180921798088229568299747199;
    
    uint256 constant IC23x = 7443477402590347882889022894260050739420614926956238607002733699799734492246;
    uint256 constant IC23y = 18181685512091369539030084687986242652509584952053433416739771707282736091623;
    
    uint256 constant IC24x = 15843014988779071907191698893335539111194089750416231449125578637157634293977;
    uint256 constant IC24y = 8265696723004624080477300091122136699207782408946611803436298160586669803378;
    
    uint256 constant IC25x = 15184560922210809047468635736444023976453428386568178899576106819654180411346;
    uint256 constant IC25y = 8836376270140811668945694020778947765512625421926916459774684559642186619519;
    
    uint256 constant IC26x = 2747625177989200921168791488457533181687323465115451517819964802728113436260;
    uint256 constant IC26y = 134275615142683297855761011707199310490409915275898405737353009003936949603;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[26] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC21x, IC21y, calldataload(add(pubSignals, 640)))
                
                g1_mulAccC(_pVk, IC22x, IC22y, calldataload(add(pubSignals, 672)))
                
                g1_mulAccC(_pVk, IC23x, IC23y, calldataload(add(pubSignals, 704)))
                
                g1_mulAccC(_pVk, IC24x, IC24y, calldataload(add(pubSignals, 736)))
                
                g1_mulAccC(_pVk, IC25x, IC25y, calldataload(add(pubSignals, 768)))
                
                g1_mulAccC(_pVk, IC26x, IC26y, calldataload(add(pubSignals, 800)))
                

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
            
            checkField(calldataload(add(_pubSignals, 640)))
            
            checkField(calldataload(add(_pubSignals, 672)))
            
            checkField(calldataload(add(_pubSignals, 704)))
            
            checkField(calldataload(add(_pubSignals, 736)))
            
            checkField(calldataload(add(_pubSignals, 768)))
            
            checkField(calldataload(add(_pubSignals, 800)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
