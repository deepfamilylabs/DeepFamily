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
    uint256 constant deltax1 = 4629850204552889529099758499414994330249198522562690321393450385223179126550;
    uint256 constant deltax2 = 6689627048198594397351508669433628924780393861462025430666400451109400880752;
    uint256 constant deltay1 = 10587677043960812701634124533741864854293648438723806367378862337073253190328;
    uint256 constant deltay2 = 6749811529741813836125627360314378150650658540780403153361153537730139913468;

    
    uint256 constant IC0x = 10069791707433294195474748548234978121819844856241531479672587921521171018928;
    uint256 constant IC0y = 5765860335564658756767650575535872261456195134427380990216447219990797875876;
    
    uint256 constant IC1x = 19875543585340807910490161391058470004058357402869071543810993441156003777445;
    uint256 constant IC1y = 20053920348473102496698834785281247670976267047353969168802319276574572718524;
    
    uint256 constant IC2x = 2999468549796949134000215207092161674362090437146117432516661230630796445021;
    uint256 constant IC2y = 5647715542476596113908793581043314392048458226938860941166187072123991745786;
    
    uint256 constant IC3x = 18132927762585306051334035662531237210044423203981225212907770931161635263336;
    uint256 constant IC3y = 13577547879925493013295183509890104572280731202413116065320601697802906379783;
    
    uint256 constant IC4x = 21298253806948878502809888810680465032186173555166805228001847583353905583922;
    uint256 constant IC4y = 12734026140585611594690341352715461289507490362580811511090472890709089864145;
    
    uint256 constant IC5x = 18943176449854250543582100312758893474444017982544324067197136729984210839448;
    uint256 constant IC5y = 17236150776850268064692089020926826853822357790144423738903758564122940520669;
    
    uint256 constant IC6x = 1967797526558674202057568429966663058001212916076041758772417962400787426312;
    uint256 constant IC6y = 18504992628189242827705867005540495369753355773572677613448129022088740486390;
    
    uint256 constant IC7x = 14080051965112360422050601970414202929349917394400811008753307754265261014350;
    uint256 constant IC7y = 15122243902984662370942825861276297241115603676776238733497976606323093297298;
    
    uint256 constant IC8x = 6276223390630776303654393890293425614271606608136913923718908445102365636798;
    uint256 constant IC8y = 7481848026976037973033735943787551122207026598864325911050450895137913254481;
    
    uint256 constant IC9x = 19449613692901272285958206940074132287791164360292679450338640351744144744065;
    uint256 constant IC9y = 15667523612874141632139752627004851513746782445145974836503594216665248945015;
    
    uint256 constant IC10x = 11088529566888305415213893643815720480520231763824080993780420670015899274504;
    uint256 constant IC10y = 20329583089867667488038106823890885218915607111172169031565074331084386536189;
    
    uint256 constant IC11x = 11786195945736293689911670233504476373558679020254079210708468206175807798369;
    uint256 constant IC11y = 8899517771297110372428384791306234007908036769463631641460726378409912926718;
    
    uint256 constant IC12x = 17987978745435248236985915732626451260507728656308601634298222056070872897270;
    uint256 constant IC12y = 11531275109653458599645494658408089841214210503865321594082651317037378796280;
    
    uint256 constant IC13x = 14600608163854888091639308497720891332214132342375918522961911497581820181131;
    uint256 constant IC13y = 15145687433077467885232673120386989684837539371960166285943324119263815907382;
    
    uint256 constant IC14x = 20052502695809765024527160470691307766655039680899442288590915102761669993051;
    uint256 constant IC14y = 8739731835373239603783129239879418936338249671721879313589568830016089470725;
    
    uint256 constant IC15x = 15461649175323417467742437413033301033653362743733764609708685597996218883802;
    uint256 constant IC15y = 17490188920394695808727721691739997215648481392282340718641307736272944728591;
    
    uint256 constant IC16x = 21581866567897478501129754093686957958504869285904473954135928733986959113315;
    uint256 constant IC16y = 8631525232151164509164142384622643257768648591028344055921115589823193103474;
    
    uint256 constant IC17x = 18155269549882388279239953787464722806578211404067538061346300115497342511679;
    uint256 constant IC17y = 7017930881543148640623058459324254175740928157418173300811679477203966809347;
    
    uint256 constant IC18x = 2768050893089477954462619886764863608117897983726821294287188542690095257937;
    uint256 constant IC18y = 7591476210289709597320143691332688489654460101481582991647813307986194240599;
    
    uint256 constant IC19x = 402183418666387293748712080163275946814208521616045014873527971892761575655;
    uint256 constant IC19y = 2406759478138638660027544941810928901450057378896114085889076075932415090403;
    
    uint256 constant IC20x = 20554896250521236653364988314554235187238428244440223362889815633411702937951;
    uint256 constant IC20y = 20159849396986500451861183650553481175872455467284209215190583676156866567642;
    
    uint256 constant IC21x = 13075705176007872347857021745489372054053974605282446993063395453096238452746;
    uint256 constant IC21y = 242830094219535596882221978517242895830729828620758504772646226265249117298;
    
    uint256 constant IC22x = 5692757097543202192327440643926062847229062838395784899565751801961945780129;
    uint256 constant IC22y = 14757106366734229327161512306976707095643203302783898721283809998569037902534;
    
    uint256 constant IC23x = 17175188975657150787985040694277728194701087753084833919162960773008721630993;
    uint256 constant IC23y = 13709032721514207770562067297373854575769302858844246955085541357578257067709;
    
    uint256 constant IC24x = 18121149476272612659776206782567344121830598245134497394883875716971645141647;
    uint256 constant IC24y = 7784475226426996228821033534206807064865655808959296372196239177006844830000;
    
    uint256 constant IC25x = 11783123873560759923996503969203993894309476562002873771951312632220090607557;
    uint256 constant IC25y = 13877789653907156784749156230413062045133059828968081936446367784779521339635;
    
    uint256 constant IC26x = 14095785322018080873688134266784424752115414139164954563983933157429307139162;
    uint256 constant IC26y = 3530438330329457977168354408386083597238250714479430851876979901267347881877;
    
    uint256 constant IC27x = 5225153494882057884268961759403116579456107073356875623436568629550044722541;
    uint256 constant IC27y = 4927274817289526923706564176453611625159464057509718314633159981517563071935;
    
 
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
