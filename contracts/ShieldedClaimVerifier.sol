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
    uint256 constant deltax1 = 10747311437863945684914781389258903806076964447278748483138362683545238943346;
    uint256 constant deltax2 = 18411684318931432022969916450370095564661112926763934749235772416067696258763;
    uint256 constant deltay1 = 10355073855504907985359401439738369211743594531166376195836350770764725907834;
    uint256 constant deltay2 = 1897003845017890675475460950638229078622686487266839645160464032323623794587;

    
    uint256 constant IC0x = 3397641953750405476757349143923584570241610965548318406713760708875584081156;
    uint256 constant IC0y = 49217689570249413319047646627823233293479851242889287590287585863978683892;
    
    uint256 constant IC1x = 1271254072321534158868225753548139218021419081007210702311088106467670072094;
    uint256 constant IC1y = 12881629379481374334281541003081138541903198865478266643414360744230164492381;
    
    uint256 constant IC2x = 11203451816147758231542262179372431439777940331698458336713478366538054796152;
    uint256 constant IC2y = 3012032783138029213368167551535038105679679064531426830203680104450609605620;
    
    uint256 constant IC3x = 5408925576806159431611261330789287761811451124204598693984077881088031356380;
    uint256 constant IC3y = 1773940311386094721597499338404775888759443982741217646921485516932660873434;
    
    uint256 constant IC4x = 7503961562206775113679002746690567110130976414622179785103235025813990600490;
    uint256 constant IC4y = 7370755428182630624518995831099051466755938472640372733951109593023314745526;
    
    uint256 constant IC5x = 1777048938490491590267593653052913102697619243066502852809791115537004586553;
    uint256 constant IC5y = 9198018922382260255154608449598280101812871052237212122597678101470862290235;
    
    uint256 constant IC6x = 11163887414054441433445703687733631750205116041244713742289075636556898410747;
    uint256 constant IC6y = 13404938442297558011152905570750660564084018277330130458435997907739812744099;
    
    uint256 constant IC7x = 13563790840435165471173901372820035208240004467089166106145517244708371471430;
    uint256 constant IC7y = 3245187133669570850298369858462835471214964772966572285257070051540407731536;
    
    uint256 constant IC8x = 9495561440711811874600785953679712403754530299581085002855143928204110323732;
    uint256 constant IC8y = 18679015411195197491737437406579606530718012447556806988864962438570286240659;
    
    uint256 constant IC9x = 3934539776005148970423061327788352138300995085201185850838567203683117421319;
    uint256 constant IC9y = 190231592645639830385833596634868411326833111305661235679749405470803141127;
    
    uint256 constant IC10x = 18525350158613433640065525880593240615693194227428632414930692736891937251545;
    uint256 constant IC10y = 7142337320151474646782504130816047404586369823987815350494086135314239236000;
    
    uint256 constant IC11x = 21282191108455470352903191000286445466083635936583879412000023454968808756110;
    uint256 constant IC11y = 2429935485701593535439967970609585852321916093364888952872746032402520229544;
    
    uint256 constant IC12x = 16491806649544430078650150670861373574350186052228026711349005179845529945260;
    uint256 constant IC12y = 6109189916870983435156333222630353015944294384590556327615334147146353716112;
    
    uint256 constant IC13x = 21546288466803937626229012581583986026867666157441255148248807641162006662132;
    uint256 constant IC13y = 4117477016612089359608657948998201056090705458258414798619034648807760353488;
    
    uint256 constant IC14x = 2493502203283539072752225015551194351588709266201975291786835068207107692247;
    uint256 constant IC14y = 469797235233375496049472274661933193272519105164219850309916640535172421746;
    
    uint256 constant IC15x = 3566104102332959964036826792493283569865296991357472640476175334326261490723;
    uint256 constant IC15y = 5019817371526953145343657397805187513464613896076848835426553059340151994803;
    
    uint256 constant IC16x = 4904735194804129612773797453678239083910414804541676834655052894582638222627;
    uint256 constant IC16y = 3087100764403787950317449607136674265435515190718255438536718174334531072592;
    
    uint256 constant IC17x = 579893717866808774933439435567210153910386745373118831895851939620970570270;
    uint256 constant IC17y = 9322791086995402140747740321346282346082642949595788683768726271421308787720;
    
    uint256 constant IC18x = 9031885033071149148111885356692717451309151397799374257305723946570117549684;
    uint256 constant IC18y = 21338994950173920069422128358055204840412897634410572760299750274524848379721;
    
    uint256 constant IC19x = 3865464026254733188714601658924180233161285941133696604930417659742032393396;
    uint256 constant IC19y = 610122551846170382359583409826676263683208501261792198049589556411800577387;
    
    uint256 constant IC20x = 5119661503616872223843661695266380918466813350405206540109063134669731050949;
    uint256 constant IC20y = 20960315997680742544642019357580172640658992059976643253362160859089882865252;
    
    uint256 constant IC21x = 11586448785681636741521582281492977448656977150398977221104969381369771385727;
    uint256 constant IC21y = 12134891657595276391696660721631525981056535283670919509742728076493812599219;
    
    uint256 constant IC22x = 1446895919028746355247703378911644193190139642498486699089817974445016280774;
    uint256 constant IC22y = 17836033183193408974388866943902140105132331141937808225514189561728761994422;
    
    uint256 constant IC23x = 13573299535048448086421001136438397403945784914729746249095273263964452755872;
    uint256 constant IC23y = 10224993591456797523325430049615768953367603419404777933485446813968120660406;
    
    uint256 constant IC24x = 9143646797864853979189039808851498138148219217111908268965027193958364851007;
    uint256 constant IC24y = 6464376551883808896063596613241100505395395197690019817150657465694184247847;
    
    uint256 constant IC25x = 8671546745853116671151483198058902218195383900530884546981350176755388498847;
    uint256 constant IC25y = 7613968601802652243623978684755676420915556915570367047280522675686774726772;
    
    uint256 constant IC26x = 14701802509893516936934271343454278559939335426988069229772732251671665019536;
    uint256 constant IC26y = 10237843006676232423647065805550537973075337671723776957740209743328172647338;
    
    uint256 constant IC27x = 14666227224702125978925363584563151315886703016154563738317253108030145500117;
    uint256 constant IC27y = 15116336352223134350781785883811088375607644698070130967097081327030842824459;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[27] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC27x, IC27y, calldataload(add(pubSignals, 832)))
                

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
            
            checkField(calldataload(add(_pubSignals, 832)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
