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
    uint256 constant deltax1 = 6057549663170528692428325500580338370920591879773284348148262349812899418183;
    uint256 constant deltax2 = 3537840373445971266677157278277295524282825229178091210585771102755345526574;
    uint256 constant deltay1 = 11475768867468050175019473117781900340433827048504016221558450438032604454865;
    uint256 constant deltay2 = 10081492312075565873762380930960248069757886156621405048939107014376934298945;

    
    uint256 constant IC0x = 17110606366167768778599024321200537791274144384910178356307388801757264761532;
    uint256 constant IC0y = 4257763156095345032839955622804433847245316371884177582728983098622609649286;
    
    uint256 constant IC1x = 20680184384320243727346110686265053794376113935917686038073445512185611962332;
    uint256 constant IC1y = 20493201126167477221165962502064317642967538869635689312317657789175380537459;
    
    uint256 constant IC2x = 8154360498578098425624615395448852259030285760847977088326378877085885867844;
    uint256 constant IC2y = 17165475139839951393602922578152524822158825126190241681709609039839293180278;
    
    uint256 constant IC3x = 17493837467459427055997083635149549574472460033907297228450757650370398871644;
    uint256 constant IC3y = 16203954474979865417168117325040609864825704967102704544502616966091568379371;
    
    uint256 constant IC4x = 13146396476571326007274482684591563182323575232624417124285707755803900399047;
    uint256 constant IC4y = 19081557288556919637059356946617106561021207355034869775751033310829785214651;
    
    uint256 constant IC5x = 19419424761783655979294583915385408795490751782334125162303303357131381220097;
    uint256 constant IC5y = 12427592001066011477724666079614178908801351003672017981879051137436125636162;
    
    uint256 constant IC6x = 6205031670228273536863869745187478421344729874807144881365952405709531209601;
    uint256 constant IC6y = 9741585181457801305447127839074088331077997674408074678425541680810696347999;
    
    uint256 constant IC7x = 10789187911401223674602644474823724783087696705782823556547389139744654319820;
    uint256 constant IC7y = 3828420831495991080510330946800178280236149644047824302646579160786439097269;
    
    uint256 constant IC8x = 5884204697695806310683206768054874188662938997332811231105752904990031331755;
    uint256 constant IC8y = 2591619209074124499653785479712592408643233251578560350413688250329074581127;
    
    uint256 constant IC9x = 6432676677153659735461263447962495694673236167231880844525487642125130021024;
    uint256 constant IC9y = 54950139588313285930832321641314447837953333745256499025887998282036096627;
    
    uint256 constant IC10x = 15821175961292539067559239779080108404253935100538931959124532467417553464652;
    uint256 constant IC10y = 2304882416079353112769683855485068199338943002962922641246863786701745936520;
    
    uint256 constant IC11x = 4554416277712542742809781660260513650276957216288760088590979763771049287461;
    uint256 constant IC11y = 17637683834618011657710276935724630640492344575933306821870779710712136611581;
    
    uint256 constant IC12x = 18068318239096811127764715919733719274981904420662939317406745240747516771976;
    uint256 constant IC12y = 1629743648754086721998873152219574360029188220318182050542357002498928467102;
    
    uint256 constant IC13x = 13826190961679046635365019807676823026634444116924844832271317413231449115342;
    uint256 constant IC13y = 3129752959310579964656873388087285080246362535279733535815210949997884748634;
    
    uint256 constant IC14x = 21507988068409007005879616052915842431789600673568533970090728691383153720180;
    uint256 constant IC14y = 12417382579770145846255709483696286945126335218243957890904661308428929723805;
    
    uint256 constant IC15x = 14619961524342541743842934146987061906986421588844719385567547726982069384257;
    uint256 constant IC15y = 3017543485641266552145591602686112560445313559947729926805307229844938595823;
    
    uint256 constant IC16x = 767594536504207827966164315559419846024512078768194110631706311486940454395;
    uint256 constant IC16y = 12434283066387614526831732440227837967110278592687003987641188328948847634282;
    
    uint256 constant IC17x = 18751435430604905245596619279449825754602546045373280450202559761932150463853;
    uint256 constant IC17y = 3325561343159020346091166398672297097909420103473328802046489826579654549094;
    
    uint256 constant IC18x = 10402166067604918637730535591842121812340457415160166489731490021279881148050;
    uint256 constant IC18y = 11602052587509566802953904016888566002336290575135789649937764969152797731263;
    
    uint256 constant IC19x = 2141568190934373038788960348790929534411687860836429506196823653566979326364;
    uint256 constant IC19y = 5851168932938652638046545193164966224966897780773441313945169095195152202989;
    
    uint256 constant IC20x = 7678929256941881515525219548972457561670229811434320554854494890576849892899;
    uint256 constant IC20y = 14529958039937821179890880869769272513578904437640629438986878437840986700633;
    
    uint256 constant IC21x = 8549245359191033970786452326215815868660155790208901646877332405908999426396;
    uint256 constant IC21y = 19249339169864401406918234340009574075280869562957398562409312449258267677980;
    
    uint256 constant IC22x = 11013229310928131869931707969897026174581017924255415141849469056144698029891;
    uint256 constant IC22y = 2344359747674594495763395699432799142985436264250030985974046585269972130632;
    
    uint256 constant IC23x = 18380369861891642453607866969043330383199963663002479888560966361442534706753;
    uint256 constant IC23y = 20785124065492244393362913464988963866175090356609845227036017412865915800020;
    
    uint256 constant IC24x = 14285880918916734421095135309566925545507103649166598264310481706830133249693;
    uint256 constant IC24y = 1976508743231817791833709045205513049951961749192208322126941846052790339444;
    
    uint256 constant IC25x = 6924327509049826753252061610530573834980234259495742661466207446872792627159;
    uint256 constant IC25y = 5058641090995823747368767136642945196291808773359894459830711382156428440709;
    
    uint256 constant IC26x = 20373860750849098642193860690537603836658030405119939719033509345235509051738;
    uint256 constant IC26y = 14122527129885063343411181099581339910510256122613843723995650754263755087744;
    
    uint256 constant IC27x = 21033852279546121983147839982908572164926546169422729519247398328905441603702;
    uint256 constant IC27y = 16900039293045962934530335421302682945616900659810162141082472375676351137549;
    
    uint256 constant IC28x = 1022105386443708523442701216663386937630132024761124435562291444540901298040;
    uint256 constant IC28y = 2779888595204384736135788990557644393367096302651768278225211360793869168265;
    
    uint256 constant IC29x = 3222644434621881982011766360436832827696479078019424425178142000932456009092;
    uint256 constant IC29y = 20318038359750030135719449043350207740948094349574618412291665914726001416943;
    
 
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
