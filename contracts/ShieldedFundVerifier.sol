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
    uint256 constant deltax1 = 7163372175535304587327640881344668108505115897797668236072738923713086820266;
    uint256 constant deltax2 = 263575138213421023009073635749100740412554812184742891622503679577086364193;
    uint256 constant deltay1 = 20513065760085336569929497146167261352182209964506371004513045207335478203992;
    uint256 constant deltay2 = 4402670704250370967223909764271463276693232533386112514654809152881385712252;

    
    uint256 constant IC0x = 1941133578593534594956392456470674065032446629774894139061189161478047925282;
    uint256 constant IC0y = 13389313121135073446311259304855643045673348449448394133411369740692059487399;
    
    uint256 constant IC1x = 17738535754588566856008797642302311870213192453839462845842608515166439646994;
    uint256 constant IC1y = 16593415073173146190574445742742078335983139734891516264034547379842044152440;
    
    uint256 constant IC2x = 10395425340546352581688098667010956332554318241987064503038235565192491338364;
    uint256 constant IC2y = 6148910469780692692293955969113376157900284023805495407864551643488998412703;
    
    uint256 constant IC3x = 21322389815116246838369549084720795432043522750011854655107685638576540343284;
    uint256 constant IC3y = 14603221592855611683543584458499484495182834027757016744337172104885135464495;
    
    uint256 constant IC4x = 20663977264639952489915225953103881271973744985434444115957444190391048017667;
    uint256 constant IC4y = 4585157196952981000363025214473005135244667773589629799448262025886475707760;
    
    uint256 constant IC5x = 18428890655229955128675319675797715297545714189669590526806025241369544206302;
    uint256 constant IC5y = 9028746475456661426170859934927572227143647701792565623614512877641512329035;
    
    uint256 constant IC6x = 9856454798150037926361180973457652221298617398261916991086010654484184245895;
    uint256 constant IC6y = 14545938539859679040880348342661598793551682488344689627327505345397431299201;
    
    uint256 constant IC7x = 366827030100715722011438353747649812436541620039117419751727910388556178853;
    uint256 constant IC7y = 4165449010648324760886444315042618475660228148476855571266880172061378618015;
    
    uint256 constant IC8x = 8388217296015749948920997018476872656011012877148591007219425197326803367436;
    uint256 constant IC8y = 18494099169732609002867108293346592513532200566526246988127194739509119819134;
    
    uint256 constant IC9x = 12424484295711375463073697522509211432844878906900284856023442824469218537812;
    uint256 constant IC9y = 12613964230404900711270972350109512123743667571481524713185919746440382000101;
    
    uint256 constant IC10x = 7826535929159829323422322679989980950736350102742461455457707084277823485515;
    uint256 constant IC10y = 20621529893843500445713877722518850316551943813051876002936646601288489848397;
    
    uint256 constant IC11x = 20142671438813950114761716389137482031256105981279953459436111161159331278538;
    uint256 constant IC11y = 6223302745039432987971157774582157092431037805464097599753768453908701192493;
    
    uint256 constant IC12x = 5240601457826157831142541370113794746031400467459499237997121280612601230728;
    uint256 constant IC12y = 5798903267547057039165594471209536156916323965528042068165243010119630744698;
    
    uint256 constant IC13x = 19541496105497863846900229261926250535625329455654182731354826520713585256618;
    uint256 constant IC13y = 5164781330750730555446136678969860706189226183978899287122180328755548910252;
    
    uint256 constant IC14x = 14089981870964338729904929325350895654324048891796065692934447383850787673150;
    uint256 constant IC14y = 17494245890874193879202477669722396812765067554768761249650544897059400648119;
    
    uint256 constant IC15x = 4817862485888239124742109173053389374684065666440653894007718181140379156223;
    uint256 constant IC15y = 15132317184559059850117636663913118061525093441359109274247627405973261569285;
    
    uint256 constant IC16x = 13027390380213325742398155679322905622704436807679135611435293764027905793842;
    uint256 constant IC16y = 4757904899939699575624779134938678310529358404624290741733458746081489609543;
    
    uint256 constant IC17x = 14240017608616333440825954451549570233380886286620785793295797625481092686331;
    uint256 constant IC17y = 4357263342207087900226947078016949951380935310681127094534658466173289272562;
    
    uint256 constant IC18x = 6289543766393145808293348117583040866898069153829963361966353431622428146555;
    uint256 constant IC18y = 17379467884283647302990693171822054957583710098781175503921658897152284684158;
    
    uint256 constant IC19x = 6337760386545506788590325841820464130827505393964653056042837561238636229597;
    uint256 constant IC19y = 4509138910064529274491752200323684133596832813525454344562660001568035767451;
    
    uint256 constant IC20x = 18828962375114781489679140680241636723664707540256740254301765629093155667931;
    uint256 constant IC20y = 20764331701281298950527692471677632575748927499408332869298928223315949098258;
    
    uint256 constant IC21x = 18164666663010789879940440509038941372206271907077995402477143097994626037796;
    uint256 constant IC21y = 20405385060198105665904079404114106634392392872053902635627726797485099505071;
    
    uint256 constant IC22x = 17826028513037068025521053042845691169401556228510983122924426781400433087663;
    uint256 constant IC22y = 18284673013512970323166262099572430739983832412030625726206482639380439026557;
    
    uint256 constant IC23x = 11667077110653419760652106039936577020664320243086497185205617502090942108043;
    uint256 constant IC23y = 10581998753631395914877614540580545126780108169034289151502116359564941356152;
    
    uint256 constant IC24x = 11042619295685621971441039339185798823703739115824360772342588784512761371579;
    uint256 constant IC24y = 15128012512411026577111783757159316215550858982625286777802690681091540972388;
    
    uint256 constant IC25x = 11267844641655784656452795415735548135765022529577416082463609417169785159823;
    uint256 constant IC25y = 18058679738886161415279046641071675602534087874526774907108159358702904338820;
    
    uint256 constant IC26x = 5901689833830033274514776476756093647621667584297144227684111441442152423891;
    uint256 constant IC26y = 983960376420545700144840910888907237253346268327905511365367209555315537439;
    
    uint256 constant IC27x = 9321212496720793590330962409691921990354018137293352453118548651853585317640;
    uint256 constant IC27y = 11276901804512501189694450308627981766966367186705010461343784413305414158916;
    
 
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
