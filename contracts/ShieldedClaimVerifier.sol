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
    uint256 constant deltax1 = 271550580458282897684736854618237897351247637852607497676628434598060552442;
    uint256 constant deltax2 = 15367116538727763573722727209465148123189804184288557222437999041565520975958;
    uint256 constant deltay1 = 5341079083316711254287840776077120671674268042794020827983997120714006351483;
    uint256 constant deltay2 = 6251221251404841407308966422080745754000638663189719954731788194689562234814;

    
    uint256 constant IC0x = 18667963518695622817768896142191098406704016355405133562197185208689161351017;
    uint256 constant IC0y = 1399934182162006748123705364973607871366930089805022314167075806216258100942;
    
    uint256 constant IC1x = 5197181273159003299259052929980124941921526375585818159827639496684103714611;
    uint256 constant IC1y = 13348514970059820196723648815873587547591743639926788953349394914227757651610;
    
    uint256 constant IC2x = 18671631284946946810599586178308612922129498076611683170130604335468170842948;
    uint256 constant IC2y = 6108667392232409522029727558361754655437888446196275438419636583904097308820;
    
    uint256 constant IC3x = 13285971032402027020102276316844208377410416654460952212874965113369558959680;
    uint256 constant IC3y = 9942169560543298120675430384402675677208371188982837885208658678022504919323;
    
    uint256 constant IC4x = 3079976128639000312865792099214018187009030631452647477651323700978647929192;
    uint256 constant IC4y = 6605089380784310220966722696187495067450116906062802395801247970550606414595;
    
    uint256 constant IC5x = 10342483684851227589021548595991473182435446763399113863292588614416565766588;
    uint256 constant IC5y = 1860291514316444290607246453353452750076917300305452721669306604858693152644;
    
    uint256 constant IC6x = 10247526739927858698265315902328160911419612507341536768923455501662038497285;
    uint256 constant IC6y = 11428998764422503754646282827403632146490899747433911090031242570134464572467;
    
    uint256 constant IC7x = 16521374132692074838808466209779540403383550786429182018447081181787990686551;
    uint256 constant IC7y = 20735862771942282029753047053830986909659473305508441692782364676724673282699;
    
    uint256 constant IC8x = 9092287567870343724400501164156093866878527495393212281088969120551295336765;
    uint256 constant IC8y = 14309485458640968544237044618008277871021589809038156409522420974085060131030;
    
    uint256 constant IC9x = 20035352994907192523427297245655452614172356750003866209530501404318159221603;
    uint256 constant IC9y = 18249223974705412945973883852034163798396498814674794535476972728323070470885;
    
    uint256 constant IC10x = 7857641329678505506389375874584356797049407246048635170369361226889623425439;
    uint256 constant IC10y = 3949617689115437001461688809207481312655993681328134289013982576414894129090;
    
    uint256 constant IC11x = 9622486589011656472165539983003125958548221789830093921313161498151597724809;
    uint256 constant IC11y = 6947806568964753755175761552114418435958162007211511070388360108056041637962;
    
    uint256 constant IC12x = 9536816291227793478928144874483337150569079817003124105204177339795809206373;
    uint256 constant IC12y = 18524093036154221106512759224330964024265605988907611575483329780520288051864;
    
    uint256 constant IC13x = 7106252056738781046050187694715893391362732097371251113631616389005608769227;
    uint256 constant IC13y = 19419699424584150564261913186406497083010965387143041627335876485080330049546;
    
    uint256 constant IC14x = 6043728455221418893907711777547670542205635962996649721130417945635104671179;
    uint256 constant IC14y = 12812756436329666537674184779681070684602957687199598437612847015295443527768;
    
    uint256 constant IC15x = 18536310159664439962911775389441226685053737682990274351796279785007522462734;
    uint256 constant IC15y = 5613994140235042098153995203194380884733786428123377206143827944543589326509;
    
    uint256 constant IC16x = 5312742225271059387008293100584806435061939174765984709488547955378042162109;
    uint256 constant IC16y = 8827707540798357469205113310567654609469684565039108087898657110653285124201;
    
    uint256 constant IC17x = 10136197238375422631231818791529315979649258122551886334104958935433096162660;
    uint256 constant IC17y = 9571451003832606074922710656498147538773233358307319140344744521186897775786;
    
    uint256 constant IC18x = 6371306496443318924191098080157131023035764052952697933643924681176862500053;
    uint256 constant IC18y = 9598315619845822909662123323998757311111414139501679689155804176245795093535;
    
    uint256 constant IC19x = 1509000285465426019183286849693487343658322284762190488496030418850659528854;
    uint256 constant IC19y = 3000367498208743381721822841450558206551306596013199642274873927495036867570;
    
    uint256 constant IC20x = 13594630904581417984614162173722777324332685620387049229604804605272867705048;
    uint256 constant IC20y = 6577715890339948101708752209442234268856484607150639750004136297477382179589;
    
    uint256 constant IC21x = 7768973567974618629009844524435354851190601684619059536280134230616493660830;
    uint256 constant IC21y = 21495940477726402135211795618705282407625799789487367017344007046763202898999;
    
    uint256 constant IC22x = 20373217541546912970311480979961842405806740544919274013966769532144493560197;
    uint256 constant IC22y = 15280524572886447886456993073217837842411182566449089912998874708154825077073;
    
    uint256 constant IC23x = 21742456452523473868070183070204370104492082433647870933487941764038901203995;
    uint256 constant IC23y = 15668264572842827418546190852487564638535281113293015754961487161835493058046;
    
    uint256 constant IC24x = 2067609754067018001730230392365222871456778630987687793539979688021113893278;
    uint256 constant IC24y = 437912895965641258289195385860025183863288619590730351958201682952920994411;
    
    uint256 constant IC25x = 1834633873678152742439258702217493587499461885183571628779484743496338533496;
    uint256 constant IC25y = 6138007807691821530513107433798669845740617183276503082812045665806933074988;
    
    uint256 constant IC26x = 9293740022620450443601885070837513652159971386928181801130136938035360008518;
    uint256 constant IC26y = 12343279543789657107285994630486192729051720958936118205965210297877612708078;
    
    uint256 constant IC27x = 14156229244532279461120603066415971245604521621198439280929624624322569445740;
    uint256 constant IC27y = 1352976494402653882827991999763663681784277487983932897968610460458351379546;
    
 
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
