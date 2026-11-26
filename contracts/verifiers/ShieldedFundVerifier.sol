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
    uint256 constant deltax1 = 17954606101523439571053118887891320178469305047249514788512736711609140728327;
    uint256 constant deltax2 = 17724672574106170430388025260304437855920873703742910672867793509667805738418;
    uint256 constant deltay1 = 18771070448319249717746380846529400632843197794447517385046789624115863799935;
    uint256 constant deltay2 = 5145954967375650837593878516592405156859478561009813340182701495291410221717;

    
    uint256 constant IC0x = 16629973523690017228472442363995891769263814342264390605744050209801744528685;
    uint256 constant IC0y = 17358630461461243310623523438668151529432870189811864444408199285050467935501;
    
    uint256 constant IC1x = 6649992605348732364577288978963654105390907090018198424458959518540704302269;
    uint256 constant IC1y = 8023699273858317539352761808939562934317557049529092161270579060871940605072;
    
    uint256 constant IC2x = 9006093333862163759758595924469028196769971070406311663533362258290636165465;
    uint256 constant IC2y = 16526393924259932368147983902606796304873782648020458270030990598312520781335;
    
    uint256 constant IC3x = 12014387440473058469866831124339463429862624999372789518111760719841827280160;
    uint256 constant IC3y = 15277700821782915026303178001036792126828695609420405024314362708534440642130;
    
    uint256 constant IC4x = 10247998349495519226010371843661910269374244337638199071291426610893515103821;
    uint256 constant IC4y = 19900500777902263741995545424270403891436475774794279678203689734355199272114;
    
    uint256 constant IC5x = 19782299800422520789950008774105085417145120822157513652286798604345302472933;
    uint256 constant IC5y = 8586200439169776349601296823239391303839261897504014847541423573850324342669;
    
    uint256 constant IC6x = 6123210842205831538453044247977585492261032255554286247438185535057830884156;
    uint256 constant IC6y = 19868573008642267007449610222230688518864164609617644416423891148417909967947;
    
    uint256 constant IC7x = 7063894969344284479498101922142008639494934934366295461800119822745318164072;
    uint256 constant IC7y = 10698798295988096713311807640338189546388375338092275802875465028998412938582;
    
    uint256 constant IC8x = 530269381117737692273184204514820296396552857994150516075308284754574747723;
    uint256 constant IC8y = 5405939200330960483544012914790861796319910892282677985828679872068496198966;
    
    uint256 constant IC9x = 9771178340444598492784447033964464607364322781722731260693397473050648560965;
    uint256 constant IC9y = 8977466161900061138954848081826894977752183595711505078059187775781998718655;
    
    uint256 constant IC10x = 5238520858761098401991380310270552109102235494013702204261223426467106657805;
    uint256 constant IC10y = 1365383632961702634982498251238964853404518738583975551342897080078748250704;
    
    uint256 constant IC11x = 21310407312790131079038327903989221958859433141224638789661419171336592698239;
    uint256 constant IC11y = 21864368664600162890839847920469854288750780713738821034136632336894067041071;
    
    uint256 constant IC12x = 9895580541679670581270123185977982565345824738811252982664725048682256577724;
    uint256 constant IC12y = 6031390518376587161293769986469007248125415214945971116053130320673264474316;
    
    uint256 constant IC13x = 11591074303711766409372797540190852226532460852904888388273317376481858824417;
    uint256 constant IC13y = 5348846404983045318481632012880793893636802653808478209540063948944669135709;
    
    uint256 constant IC14x = 19401528322802313698246513533206581295952287435220660214657375131911809465568;
    uint256 constant IC14y = 3041065894007886437111356272234465482109542983246350595935179444348893720319;
    
    uint256 constant IC15x = 20592888808898595991834461601038819942124841105941800806429745162827111278502;
    uint256 constant IC15y = 4816962039983804295140783601168409242685982138253325719555860208450118274049;
    
    uint256 constant IC16x = 4910132651192068703477739620033749822745017005105823536416894828362459173565;
    uint256 constant IC16y = 1786991414523615512198297107625917766384770457464519830411013151059343358915;
    
    uint256 constant IC17x = 15416302828645435643890777566836359164153711233347263233603137287904819442467;
    uint256 constant IC17y = 6590174619785398640143555772465473224765605220000113957808098556625717350416;
    
    uint256 constant IC18x = 16273237011039520467286899773619593621112460390170317552216063223624165586913;
    uint256 constant IC18y = 6071301135869730615253221177757542664926635945472782131186377986433741298681;
    
    uint256 constant IC19x = 656600406432800367470234656590214098114631790250793475240072839106479085547;
    uint256 constant IC19y = 10128690239591629190227097284706325219230611977528342537074624499005054800990;
    
    uint256 constant IC20x = 10323382230213615856594517278453480453472992297108731418295197737691926293417;
    uint256 constant IC20y = 15826587456194405469393016860655863350040588588532589267453102855996107537294;
    
    uint256 constant IC21x = 14142410574773447736795574098309725573486184550605170811519261721638960161627;
    uint256 constant IC21y = 4279666147614839546269084716631210970382302588468736184557301069394924551532;
    
    uint256 constant IC22x = 852190925184002754103350762159788706411046118060744008130112973406622983022;
    uint256 constant IC22y = 18681081652188297717063619716075861207150435576339323506689051033619057843490;
    
    uint256 constant IC23x = 11902539647808197359863949103880497446976444217528173932385831839002051994122;
    uint256 constant IC23y = 8334545886264633508904698081361651744794210809064839888092512810613202466687;
    
    uint256 constant IC24x = 17383956374612647170555778415787462075381660264402519915371726317580965519593;
    uint256 constant IC24y = 2923859865395138303088355067260414127863603749488792197143438042877624787835;
    
    uint256 constant IC25x = 17953185924365792291520691514732788025944739173120109044900905849393029174947;
    uint256 constant IC25y = 10541388126286254681118718351749027628855146248098032403505141363516447080586;
    
    uint256 constant IC26x = 2629468908009030145128607782281858535361348881129779252892205629164685870757;
    uint256 constant IC26y = 1228142493518981425121986896448151713053871241929368196067824036575554653803;
    
    uint256 constant IC27x = 8767212312408245840467150431166147479986281286508354330417956087811466896425;
    uint256 constant IC27y = 12728441803098413105559088325440981155420522024153723039381850903100457835028;
    
 
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
