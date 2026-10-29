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

contract ShieldedPrivateTransfer4Verifier {
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
    uint256 constant deltax1 = 17066115454805120338320683420873698656000858145756753379215725815397210081336;
    uint256 constant deltax2 = 14562476597919193174231405437107592124638942839332947166918889005940395914780;
    uint256 constant deltay1 = 8249707373656808365415017481790010735178878850984909521104556355777466306942;
    uint256 constant deltay2 = 8659623035410875878340638033868711024987761857789553641575737403513628793410;

    
    uint256 constant IC0x = 6363973510898024148347268442571188119898567795007304123896161735430074892256;
    uint256 constant IC0y = 6661057504015093602928378102551174091742153421101535067724974100419735163361;
    
    uint256 constant IC1x = 13013139036948211422102745603159657128248608640335032603045405088922676461084;
    uint256 constant IC1y = 7987297610741093999121623471429036861402762395767250152936359266698913156398;
    
    uint256 constant IC2x = 3930481650728028219585877416740815943258728008241737197563963383780105059444;
    uint256 constant IC2y = 21055594064727612305926980469334145932858819291893393966775731756707693480033;
    
    uint256 constant IC3x = 81954042970525646672583735434544814643845434015261402355541753741389115440;
    uint256 constant IC3y = 14465323598349766741740021658488211344854310364622524257677272331468139924470;
    
    uint256 constant IC4x = 1885796285337693588194511824962419455045522272743715828419121563442140862813;
    uint256 constant IC4y = 15286807927655502173847912263822549952956387023589074500528780684153958760489;
    
    uint256 constant IC5x = 3549606265354934919468253599796947389052646440408192566066621894092965093999;
    uint256 constant IC5y = 12818446197854466472363844319308885652188128391962659970576498411973368361442;
    
    uint256 constant IC6x = 6609035949297011136162700881683956256888693255668754447789065912399137284143;
    uint256 constant IC6y = 1347994652179884304932775552332881187551388780930456944239274234824629048158;
    
    uint256 constant IC7x = 570932484429060144528605581476450699860185638199477409145497224953359928690;
    uint256 constant IC7y = 16383990172393225402680890285873068221964186346587225050965458674954074187275;
    
    uint256 constant IC8x = 8329350313961227075866500361944914371689997408868049007321126561744858856473;
    uint256 constant IC8y = 4892374954327394991679849041135201923196919412129745204452364639713697768134;
    
    uint256 constant IC9x = 14133652617763024752516588057871785744631210032928506161785750173378875771055;
    uint256 constant IC9y = 3854725737889492804121887001070106125038044604106263019889163506848524108180;
    
    uint256 constant IC10x = 16584402105497658706944209349772407078631033937900290011627583086946981493795;
    uint256 constant IC10y = 6827114919646885366861440887426797418411610602253130000995114701583037477184;
    
    uint256 constant IC11x = 15350926383119865077636673132268294424355908125529638677480945072176311468592;
    uint256 constant IC11y = 19220516503595209331902772824751717015996632578401841283166894775399542779728;
    
    uint256 constant IC12x = 2796490536068955094102305092974725667536770385605314628879593808682816524723;
    uint256 constant IC12y = 12220044328583261674673139063813413311122619258902001143389766402831410116482;
    
    uint256 constant IC13x = 2630289961894058345510746338657204406771986377439718971997250078677707364704;
    uint256 constant IC13y = 14159621793100685256228951738304760451967009721824650645747817077800758729610;
    
    uint256 constant IC14x = 20319368466353571508018521197111603979601203400551958536303632054822622679420;
    uint256 constant IC14y = 20297653406652332048493556234280215390216053634992887245009967322297571547789;
    
    uint256 constant IC15x = 6649139498534832693394420497697226217802859232897242206487496014644237701952;
    uint256 constant IC15y = 721441906720264113773365176020751097313318461550821775431506984287524353018;
    
    uint256 constant IC16x = 5956745998993590750672864370002377184726651023385212603314924282037866989519;
    uint256 constant IC16y = 14933841790136266204714728845172696228750904827986054163817525070900376187871;
    
    uint256 constant IC17x = 9165341480098060745347675314214064221431483266890284765232365755586300488137;
    uint256 constant IC17y = 4900708013987345918589271360801251183007762621151775499534246220101253491076;
    
    uint256 constant IC18x = 16737550691087095636361717469653647893710589864044112170341498154889074209893;
    uint256 constant IC18y = 204776573316693554884912049628598707684486728108764971843379687852001626606;
    
    uint256 constant IC19x = 256559399061351239462196878254397362888033935223425721647476641453834940153;
    uint256 constant IC19y = 19883485263270311260151562958884114373252542778047524449185635432949150813968;
    
    uint256 constant IC20x = 15537670063974298660453744427787018868952418303223026718995634971662447460081;
    uint256 constant IC20y = 6500880656331094536924061704361060006875273641935947863283464910299342574658;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[20] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
