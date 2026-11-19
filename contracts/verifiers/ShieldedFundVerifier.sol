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
    uint256 constant deltax1 = 11224641473126133067114113250284995355399451703235326386043128255150715246593;
    uint256 constant deltax2 = 692527230785688450959512506079363685099171744557658328606597177704226737587;
    uint256 constant deltay1 = 4038611680294031291889966800106601158951579470049964695628451600234358137368;
    uint256 constant deltay2 = 836381125108700282738207579684495786898882674506542000932251100992672079734;

    
    uint256 constant IC0x = 13649863613988941606261049753333346075021324518403871247236396820983823433786;
    uint256 constant IC0y = 6706470992507128875849624099999311990656378380394720660354507456529980038192;
    
    uint256 constant IC1x = 15331293874431333266269297303769165278912821995987633100455057349361712370755;
    uint256 constant IC1y = 18862720195525452970941110956953111995162603758991420461757900290369596764738;
    
    uint256 constant IC2x = 11252251954350893412273832814817024082959261062129101172869559871197641616808;
    uint256 constant IC2y = 20529011121923992535959464282258181743835964079842099274558312005355040067440;
    
    uint256 constant IC3x = 16731584269564895247150368293534345466261361220097301173155298097283320731773;
    uint256 constant IC3y = 10540597303413419385155728063993324519234298822208678845091607688482746183931;
    
    uint256 constant IC4x = 9241283792199249388268069244360710210753689057671634416696161727344554619431;
    uint256 constant IC4y = 10874646481711334227498392842566901547445513870000067935733793827256921262132;
    
    uint256 constant IC5x = 7752940593871245545974085321655777648156350968899919498597976347648744370334;
    uint256 constant IC5y = 10015893193241570415330849673341107144776585974783930365531575870974185668232;
    
    uint256 constant IC6x = 16777848637702833310945227678327170850935788303052044899052031765048104942755;
    uint256 constant IC6y = 15847080435965028856739570529244987362247275315534796731817973183184579466022;
    
    uint256 constant IC7x = 1540105689616815189698356244805125389048999322710514652418505273757608742695;
    uint256 constant IC7y = 2447265629126786720986920494073975903066299420305695689649311714009559599193;
    
    uint256 constant IC8x = 2675952711309673569528639995173733797224613676136687371289603922442734054913;
    uint256 constant IC8y = 10975303447849745262529274640226077948882397318252511482727369072901822740612;
    
    uint256 constant IC9x = 6523828862163853308329906485710346979149559122783236556590869464963086399008;
    uint256 constant IC9y = 6899039837415928421978205776111595519536198058003631701779263977218062126656;
    
    uint256 constant IC10x = 5964467354973377330010689822371262413384044750091661354781292228214167208772;
    uint256 constant IC10y = 5013369263656190117446884592695578454948268198307738070047163557729590234182;
    
    uint256 constant IC11x = 20920280312761702567678681317418929638241254943161945754947552111290778101021;
    uint256 constant IC11y = 19441526600023692066452493054434673596664667072998319117544993899056836091150;
    
    uint256 constant IC12x = 9443356093401586744809163140329316061649775210972962175986103541884715626945;
    uint256 constant IC12y = 19408009252174492483416377175831360640880180473994155138422269086881732778075;
    
    uint256 constant IC13x = 8284777657956893779145733201079902010071211100714954484386853155703900030193;
    uint256 constant IC13y = 8052101107794648469374339802733388048133455111020251100975884129452751814133;
    
    uint256 constant IC14x = 17123970933916613372278869681069493593434601780483055137332474851694620066498;
    uint256 constant IC14y = 10888954211129828343157217615394906895771762699673405281601071932140298919158;
    
    uint256 constant IC15x = 14189375270563823672494944289792804513920520853696052368334685377054083159687;
    uint256 constant IC15y = 759728490677442705392623127683896392823255025050017673022336869222040807187;
    
    uint256 constant IC16x = 19188080858333324061845968291224628277853488287679375134150163550099143125919;
    uint256 constant IC16y = 17854485793747008194983414419572745696625486564047796563180856730227906097080;
    
    uint256 constant IC17x = 15079037191322270912531731401503167628045485274377916612749358560362507807898;
    uint256 constant IC17y = 3778119605727676793832615919282780010875647799251198073313706016357708521444;
    
    uint256 constant IC18x = 12583331556161524256457689267869590330226848250779976586552858264584898051926;
    uint256 constant IC18y = 7281695822381164453204057669549243391276644847614360668435124394165109828499;
    
    uint256 constant IC19x = 13408785153478198832833211813573592564426241942888673944978961029993875540624;
    uint256 constant IC19y = 2488260537832243800571803248379481436635609273411866306001257900652970689117;
    
    uint256 constant IC20x = 7233226040394119603315089858424934899738248995994831847197209498766797332207;
    uint256 constant IC20y = 17601405156796185687718940293744696327133270902384135598385535604340709410633;
    
    uint256 constant IC21x = 759574348770392578479905593649471161645320811124197000262471759618100191298;
    uint256 constant IC21y = 7406979113178791271053806252816278706756376548987466069945838888761366950939;
    
    uint256 constant IC22x = 18396975241210275192522661748664585520560146117833804014323441101721077333006;
    uint256 constant IC22y = 5454138058180457435578878542950756913276554251544438334121111680920011897529;
    
    uint256 constant IC23x = 6239906339197132323372253137217021160632192713529105672734176474082673447651;
    uint256 constant IC23y = 5384405203357865859701777789555869802800208479879094891303097817852441838249;
    
    uint256 constant IC24x = 6396280137924625803178746788963323170055610601755368969886751777655497495045;
    uint256 constant IC24y = 1587647547385431714582013529837301571694965481547381121853377264756132533311;
    
    uint256 constant IC25x = 11983476705555051579053234404744509311875232170812193703913554442191886668409;
    uint256 constant IC25y = 673517091460961550201771586546842898256692386792537349795498287250811268488;
    
    uint256 constant IC26x = 12864655406800864254196657315210543877778167557368908128366363488271242336563;
    uint256 constant IC26y = 1752052511054303468865716933507683501388740609506059633626491249089197999650;
    
    uint256 constant IC27x = 21118625603745357515329111455164868023050623649400148730955665779637595235972;
    uint256 constant IC27y = 7465211127537439596380991336594883273414377454150698681805796045160040160907;
    
 
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
