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

// DEVELOPMENT ONLY: generated from an isolated local setup; not production keys.
pragma solidity ^0.8.24;

contract BudgetClaimVerifier {
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
    uint256 constant deltax1 = 9492263627634147900141427735389852333800243752465971326603386181661851293235;
    uint256 constant deltax2 = 3191560142225448735732957265131118593209221259637131717206693789555888515083;
    uint256 constant deltay1 = 13323101267742787468330559226462256713184425549721352101355149446454602193389;
    uint256 constant deltay2 = 15790401352738241011352898467276735420785126632686302610490244267755645817450;

    
    uint256 constant IC0x = 14855808675694900821420442055082362796185044514327905527715231036588177146937;
    uint256 constant IC0y = 10227795307299188127305438646381218000875353678838324909471199714915341218960;
    
    uint256 constant IC1x = 20436611560512571546110015075631366397509180528553347935063236852152305238960;
    uint256 constant IC1y = 11309330779144401851245689861886066166507799014928854393751008805865578402075;
    
    uint256 constant IC2x = 21569796641512981637065192699567977307561111798127130302625505171883427561571;
    uint256 constant IC2y = 9795457221888362769702559039577543867685044117769435119306094358657555630938;
    
    uint256 constant IC3x = 12786285166184291735601908680458087218898923860013517528292810085853410914364;
    uint256 constant IC3y = 2583641632801209736923063886316592669562931769586257274303069775953843242655;
    
    uint256 constant IC4x = 11217859974921287561809023781646242163527775264388245636411957061496527349109;
    uint256 constant IC4y = 18676151923440841625210727866952690848485445910452882983406946643606962531783;
    
    uint256 constant IC5x = 9137925670969883843524452497859457202185268059742929354288261912130897081692;
    uint256 constant IC5y = 3722999468534090072749459606622360557454912445050348450470569278338502043104;
    
    uint256 constant IC6x = 20382701857029398722211203161217335753605392944959895768223221382461648268853;
    uint256 constant IC6y = 19694749153190911541271357374141006479845297051315013125092161831915417874793;
    
    uint256 constant IC7x = 16243632836441024674777127301914872531723105556036477401884624888926837998482;
    uint256 constant IC7y = 14916021433203672225587669147730910499263551612293839547225072609494510823582;
    
    uint256 constant IC8x = 15514380248001998379478259448519215204100001271608320299723575184986746134106;
    uint256 constant IC8y = 2972782931807209475856599392118401792754674419832299125910600429174871892175;
    
    uint256 constant IC9x = 11222858755392263873102067697643391495327503024787226502512376096683481753833;
    uint256 constant IC9y = 19472092397605145822768080512686727458725506178614150691572050002086423566822;
    
    uint256 constant IC10x = 12558998512669889808866671508437262410192278354654639093174926237001319780386;
    uint256 constant IC10y = 15117035537605495721291434664212629449870323642904905959136843909573175145548;
    
    uint256 constant IC11x = 4381678827133161095892234917984090240062669621274742801942559981481931650681;
    uint256 constant IC11y = 21148429726922443480844348340353725047049737784363599268217388787044948814282;
    
    uint256 constant IC12x = 21291565258715806987081173244085004812556904776791994978989626826681088242521;
    uint256 constant IC12y = 17744685264754957304179052947626391703399016549506865002808860334434235372997;
    
    uint256 constant IC13x = 17575324567147134803903744661543047029795545299404096289422386271998496978146;
    uint256 constant IC13y = 481232026743138077834192296344589013236415790672933892271762828284436351994;
    
    uint256 constant IC14x = 2460368373097167227596631609580976851949009671455065486590497717828019545477;
    uint256 constant IC14y = 2972829160252082303071693674089466170817409163506779986439403525720117239040;
    
    uint256 constant IC15x = 5100176814801853843237978541459388986281251832969593700935254706715335751864;
    uint256 constant IC15y = 6237118297148580982091615756122781860988116561049831360591747621401704154493;
    
    uint256 constant IC16x = 1560085840743861617759624651913475141255247724056700080759515348783132791350;
    uint256 constant IC16y = 3566662624726756286778561182215538940798342545613918277822493561951295226272;
    
    uint256 constant IC17x = 7663501816687211369388400807991088610395751340375504043286552446660682256738;
    uint256 constant IC17y = 5933425760396912078437008133637895363578880044674180586077419665078903993008;
    
    uint256 constant IC18x = 16506344245399075840046816699379822526332992360200945897324256614952850819273;
    uint256 constant IC18y = 18207577398206840225022150571248807188785328701038959589614270754422160700278;
    
    uint256 constant IC19x = 4139151740693181490349552185202771407229588467499319972266992652283162879872;
    uint256 constant IC19y = 232823081899610822388065505999422746415490000245281085086877727736673030233;
    
    uint256 constant IC20x = 1097012147032830422445562616806623109602812117479561484878069961433096942098;
    uint256 constant IC20y = 4375663965940702897208748120775983318237840397919022334385317330223953106898;
    
    uint256 constant IC21x = 12812853767531512240235420408173725072546866212303684609154813613021154007604;
    uint256 constant IC21y = 13694554443423401867410201095223467451410695328240675686319489014516774341032;
    
    uint256 constant IC22x = 14125693558222207145903945509905519537312450777246107507248343791336911453928;
    uint256 constant IC22y = 6023025822711144104567612229964383057230383377822486946916836519804874125883;
    
    uint256 constant IC23x = 11962419512245712164133289285216507788282022668812437348033849162043619828152;
    uint256 constant IC23y = 9076752906782862250204448316793974013190891515516859298285048488604942413772;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[23] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
