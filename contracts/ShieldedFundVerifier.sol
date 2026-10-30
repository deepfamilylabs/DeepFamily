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
    uint256 constant deltax1 = 10776516363048937374159744267594951691592129594825543406674387833734126751623;
    uint256 constant deltax2 = 6206161759161072977955748577551674068939460878767443015406596742855434650819;
    uint256 constant deltay1 = 1166007296226217008766126776744548510654567116374055192830894478844942059420;
    uint256 constant deltay2 = 16370802146928540016491444308087066539389853650881047789492814695431934891488;

    
    uint256 constant IC0x = 1764665197743872022528901249159161107454806551905266810175802813632282157220;
    uint256 constant IC0y = 626336312146315178129574125711559398579305604100346060891887975486298780484;
    
    uint256 constant IC1x = 5443873924917149128647519863238362174499705899129140894674595512984911893383;
    uint256 constant IC1y = 21660436201883299850483120466536839509410830048867002121205809708506813718439;
    
    uint256 constant IC2x = 2933346527560864373324150965324761538666497027544192345011489280432182898252;
    uint256 constant IC2y = 11962012450701742577050957607269292157999067257847645500759903144773700406821;
    
    uint256 constant IC3x = 16600584416648265085853767676817549239195543583781638178107476566546940860351;
    uint256 constant IC3y = 10803930104713617041330166976164637095065992941416790751699995232503516151454;
    
    uint256 constant IC4x = 13301428366056243438591208210633084267704429991769939981252450344959065527317;
    uint256 constant IC4y = 130808903332090142213737992954500418248114430600260407236333314847233854382;
    
    uint256 constant IC5x = 5512407760269854464187342706663005918228620785948512848915699939303891207510;
    uint256 constant IC5y = 1954781842913481625186788348868595494263911343990633736695311438233376322682;
    
    uint256 constant IC6x = 11713791197320614019967351557513344770389999018916054190137213939832324356942;
    uint256 constant IC6y = 15734441657458294731046198104227197973287951399144778600573351807642834558223;
    
    uint256 constant IC7x = 857164236506198008019818086037019475572736458101264812714606130971614396989;
    uint256 constant IC7y = 19333646065049213454328654570174371614796772497509943132003820014176041344632;
    
    uint256 constant IC8x = 16560481607666749948370273764915320050083057849241058458283330428552105445035;
    uint256 constant IC8y = 4562595060663354589636340900763762549697025581218227488077684059939671632421;
    
    uint256 constant IC9x = 21776923803571537975951892706990437670860983498498792578200382877458945458735;
    uint256 constant IC9y = 16981481954166868327548696772347041084016480634743290914717377874601136429180;
    
    uint256 constant IC10x = 9055964997320107089949058581936437436159615419971350590044111201287525934911;
    uint256 constant IC10y = 11185467943817865145438518125693926353847038161935339593320133903953882899609;
    
    uint256 constant IC11x = 17392244036925084062733039779143210978555243527386631717873007736993433834545;
    uint256 constant IC11y = 19539352068764529306406353535809797198755239252291504954702427126863984705229;
    
    uint256 constant IC12x = 12226993164203136609559830455712383949748824679668436415098581915193425872159;
    uint256 constant IC12y = 21059474171517350109850606714231803410001995492043852316769874474888353440413;
    
    uint256 constant IC13x = 21283129053238804427676747389016094010552113116424122320415073689059634549773;
    uint256 constant IC13y = 8548578889415745455798125725396393587026918345943386374660777390786626824198;
    
    uint256 constant IC14x = 19590689939515364164727316435426050434289870162221878701681947576420030966554;
    uint256 constant IC14y = 18231502816680414669424993383912311695349622324804817506959340478844535787412;
    
    uint256 constant IC15x = 12901465062145380504668858420716826382799871139299663573080193425024386174617;
    uint256 constant IC15y = 8529289725176173815600152026695153407684142866335328165649199076374456697986;
    
    uint256 constant IC16x = 4097986962613050236356658373403673953053246303542980515217040659712314982445;
    uint256 constant IC16y = 20821679244793195435392564855078556309145336007852192809782999377371403852056;
    
    uint256 constant IC17x = 9932687553161535862894005938699163993479706936564643223168516776230082832184;
    uint256 constant IC17y = 10714110271086976330739757067239734961801503713477857136716107825704754161219;
    
    uint256 constant IC18x = 10894728895324109720866172520180499284467559882606723793436312432439554037364;
    uint256 constant IC18y = 8712750016892679805372155238999704424853365208175025215206437583016537740014;
    
    uint256 constant IC19x = 13098135693450467205178496488555399636935614755121359970212406604246188887899;
    uint256 constant IC19y = 4046746885259425839737077164659512593558854724776299428069667314066373114514;
    
    uint256 constant IC20x = 2805882460643599319751730150342312164603328872355402031098403918875979542918;
    uint256 constant IC20y = 17582462783515441301788134380839979529664003925771537927518536786219446353745;
    
    uint256 constant IC21x = 20528679066126913932247075178712948018767409932970408200844507312018621407967;
    uint256 constant IC21y = 6091930785360022971222795270892053657272971775849455468224016779943875275999;
    
    uint256 constant IC22x = 6916909562929027065537265802100272620122960497262299742823621470261591219943;
    uint256 constant IC22y = 7583288454851363658161116318805548514714895520207768363311186656284228658324;
    
    uint256 constant IC23x = 16960831063724075084291211162371614288395015358029088615034538390470432353088;
    uint256 constant IC23y = 9179290002870185408346273419560398468666709203723252286153770812934345091027;
    
    uint256 constant IC24x = 14539989704561226190081497778820864394518818225067721124754645981707457871127;
    uint256 constant IC24y = 4799814936334870685964830693159105797415511256176727225291326034341656192441;
    
    uint256 constant IC25x = 13782367510514398222781844443386441436557133579738948643493277180716420652524;
    uint256 constant IC25y = 1050823483164529984156342415642454849285980070106887754220913725927000535982;
    
    uint256 constant IC26x = 7102387448125899551255697688801210832284618596125589645321390024337389728766;
    uint256 constant IC26y = 5141756188445402383719182453635996982777069461520776121151242428610787476774;
    
    uint256 constant IC27x = 5502738830608071620936934474829648859255393559412376116185094294988984975701;
    uint256 constant IC27y = 16912763812231740166245766454391936952858988716517440479112669298045135135617;
    
    uint256 constant IC28x = 11180653206637628952128353639706762131198595914175510464252782069168886383515;
    uint256 constant IC28y = 7116837851941169004851689792897983606855944828506025466306720064289990794153;
    
    uint256 constant IC29x = 17342467766177504930059127688726854564324152228173078781030098577660083197430;
    uint256 constant IC29y = 864751068612542877397724374952253212500434868160284013448875468364969462979;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[29] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC28x, IC28y, calldataload(add(pubSignals, 864)))
                
                g1_mulAccC(_pVk, IC29x, IC29y, calldataload(add(pubSignals, 896)))
                

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
            
            checkField(calldataload(add(_pubSignals, 864)))
            
            checkField(calldataload(add(_pubSignals, 896)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
