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
    uint256 constant deltax1 = 12978185830010305117237611841422631323099024685142574572938266435830222387332;
    uint256 constant deltax2 = 10979695825490830569975577150446239985565062550577842669926153412563743606091;
    uint256 constant deltay1 = 17326975757123494940746135901067475780665062968332456710274008680647215332975;
    uint256 constant deltay2 = 15196311256043488726751419813779779013458388177924862740840366816904935224427;

    
    uint256 constant IC0x = 11204567862457612051975212721294901039286580977611846777431595806226798093617;
    uint256 constant IC0y = 2536734747855194673866300797497682127011222212595401125653560984373977068596;
    
    uint256 constant IC1x = 9280174175755895961532018342683556731005869630550901290926583136517593575391;
    uint256 constant IC1y = 3023810603159479755417407722332525211938348013733953591249042048815462704481;
    
    uint256 constant IC2x = 7505610477520345820146169070226403575547013477228416000980198255771635530155;
    uint256 constant IC2y = 6400296822619785324892577645832929804449573764564940631844766278811407337693;
    
    uint256 constant IC3x = 5374038247696521627841997455952853931085185255290751735603795759105883620934;
    uint256 constant IC3y = 17508246304106725660651972640306340778675002481837837148967726469801276765622;
    
    uint256 constant IC4x = 20763239822421766913547127214077869620557343766001095570956526744838020341187;
    uint256 constant IC4y = 1251263677076482727480003461248395242294070426359164369098763242484650977480;
    
    uint256 constant IC5x = 19751758968900079022269150805474184386819050662658000373103845928461391622038;
    uint256 constant IC5y = 13949358916047619577093150200305829979248362146041437868249025733822570246278;
    
    uint256 constant IC6x = 15043610871730004495065438250257432849409331446940315269767922404966509621408;
    uint256 constant IC6y = 19024327087875988590396423972813735772223765540361769671815987977740179099601;
    
    uint256 constant IC7x = 1845138036579568514744868808763205266340686145670778810709497386114363939494;
    uint256 constant IC7y = 11250646760678430405916243717790443892784886465918023399444988942906919856894;
    
    uint256 constant IC8x = 15288511912069013866254299655760600659030641610350795184049223652349531778051;
    uint256 constant IC8y = 19644735931931231792960872331756809299084095340551807314023540878296048513666;
    
    uint256 constant IC9x = 16273962684284401588304059358592690546205221569805531465031022269172280483259;
    uint256 constant IC9y = 19741529570088086992979276366005251019076245289310662814349662731381095744146;
    
    uint256 constant IC10x = 16443940500056150998774562082914698103590028521085390378035252631348350848448;
    uint256 constant IC10y = 6247807996509695219455586573453297061927591209695902480016291527324406193016;
    
    uint256 constant IC11x = 12132843203400899733193833892311372730488959249654756245730841265457031386898;
    uint256 constant IC11y = 19034697506533413330823696774428383700724576708022959770913598459924296089052;
    
    uint256 constant IC12x = 18167530089697082398733592629593433999570346069800393255045146476379072342744;
    uint256 constant IC12y = 17212583872496438250900399815712974538526450404449657510522197569052174073189;
    
    uint256 constant IC13x = 1273684893417332373604204685268983386485385727378373904742173519992964245115;
    uint256 constant IC13y = 2203249911324734720889937755531846283875400668389910337462077569645580200593;
    
    uint256 constant IC14x = 9238118592473999173907553982710974764986082137778448584462065617007635476553;
    uint256 constant IC14y = 4629620488611549229918433075861129801571175693077337708193572996062587023066;
    
    uint256 constant IC15x = 15930117122548063983973337641171604570077280935829010586129350949499780388954;
    uint256 constant IC15y = 3229860287195863329774967547788499463078365826673198129679887166568147598077;
    
    uint256 constant IC16x = 5391311008104597584717004833639688565992045074031894070584871124881997250457;
    uint256 constant IC16y = 15124001158635913500862326145580912299322549886268221544789878738312007507325;
    
    uint256 constant IC17x = 10911504993992914597957666146823688950048046554590766571003201625240259323191;
    uint256 constant IC17y = 2749451215983028692851921811645278815965428365659133686137906771153114681710;
    
    uint256 constant IC18x = 18207109444409133296341101268944624016877247330266836732125004450522198237038;
    uint256 constant IC18y = 6702628904610327979640923587356056394437366321562016278942268333560859731699;
    
    uint256 constant IC19x = 3622556285113414951979759082936344004614261959687364203322092528504857530650;
    uint256 constant IC19y = 4101451545625497031527003436812331960173554239195538183307250609035033223963;
    
    uint256 constant IC20x = 21542364789933109920817345554653980288936439696093428608020804382729617929681;
    uint256 constant IC20y = 20227538779331099823559803013315339447433801243115341120542198993244722191836;
    
    uint256 constant IC21x = 7313672822623577635707366765059149507391680002861917944827384791722967370781;
    uint256 constant IC21y = 19473535662186633991172803094119300425328083436797176419272399114314377833200;
    
    uint256 constant IC22x = 8592782216704765174081146748744688184781811840506822376755675144007753775727;
    uint256 constant IC22y = 20331537418093044449633009877572278983374074851080925882057536993967322244850;
    
    uint256 constant IC23x = 8512156458534176301352581314609607634427006609030932497668218736855834538352;
    uint256 constant IC23y = 1051552230668116076802435298973516568724558361750995516360194131731151860244;
    
    uint256 constant IC24x = 21162466012533767077196475438102872818537583413801983683443744251789504621915;
    uint256 constant IC24y = 2463265546952507072943492694218148760389849271494202423302762363929770061712;
    
    uint256 constant IC25x = 16514302684906641906828302397645884731263789064688326882391522103911819909724;
    uint256 constant IC25y = 9884876727559153904014417637020213196917939399457327425364434001417122082817;
    
    uint256 constant IC26x = 9724657190601121399639598886405300598490726876173299851435359904487033886007;
    uint256 constant IC26y = 2233451612748283489546545966755861418206050193977024780974982237278357018577;
    
    uint256 constant IC27x = 5489432148397788889531755749145702779085078439157402863479305781732044628012;
    uint256 constant IC27y = 20771933142231227298428190408055444451410428545655525051080867456926959163212;
    
 
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
