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
    uint256 constant deltax1 = 5329502375387017591849868638446740542999432188801845790218584080676267134103;
    uint256 constant deltax2 = 11091988835513998629112353958756442911514702142826233579109502525585328616139;
    uint256 constant deltay1 = 5667542114079173788946119961298729745057195334086086857004891380744644005269;
    uint256 constant deltay2 = 17368662656377851993298457996008542736834958160323160656400390035440444304151;

    
    uint256 constant IC0x = 12828305069968885606285851227369991225725630709826748316848170257390540977579;
    uint256 constant IC0y = 17539254247774086690522226233947337356375749996339138150253188727531873145782;
    
    uint256 constant IC1x = 10784390145236691633177714151696729991996167656791737858400041578435381143625;
    uint256 constant IC1y = 11156960031473500923101419814505953925103422849676644819780917771315206332289;
    
    uint256 constant IC2x = 19104743464876126681028694917934508792667316522959225529328391646274782088362;
    uint256 constant IC2y = 21179987269838910297927382888380851637546090500520038207905181180487288939058;
    
    uint256 constant IC3x = 5404877243408226965835405855344131014987923793216989168205910679116667216132;
    uint256 constant IC3y = 8850946158676984531819085470556778757980216454921030098454022545665948225334;
    
    uint256 constant IC4x = 2497666148292295171770875212240671735925476643181820995918955242880488930007;
    uint256 constant IC4y = 9127510767411520858818477424303092643635657416543750418738961402519593877314;
    
    uint256 constant IC5x = 2309134950369967261895816413462137031429004787215980721054923631893986626594;
    uint256 constant IC5y = 6198225895022315002485422235875479144769505594314439175000504546893055311204;
    
    uint256 constant IC6x = 12218340864428419195423556465708391496215346300466728345005135955309770224980;
    uint256 constant IC6y = 18227261911279517068964043941655898949476078948444440119833505815388991635035;
    
    uint256 constant IC7x = 18590037716631919915312603629088285887639689710705889609096264501425794040693;
    uint256 constant IC7y = 11849841678357981135489512550124837619784492890231416294633137940503241688821;
    
    uint256 constant IC8x = 356574379237252817180617725356864231200282325857939411228544083983125253241;
    uint256 constant IC8y = 10633176563482271631213394114489395503760739278568201059216388048979997624337;
    
    uint256 constant IC9x = 6139242499349447376896346977792491961209207175146151215644993668947797981149;
    uint256 constant IC9y = 1442051668295987865829989690446815846341535967095126439712941398448380949503;
    
    uint256 constant IC10x = 20338695926812360632208328588389367180884971848149503719640895168540122295447;
    uint256 constant IC10y = 18949016343238085705676089105987640190970789782578667626136682028087206527088;
    
    uint256 constant IC11x = 2648514109850785494858137541834072334930272645208468430504830386007459356171;
    uint256 constant IC11y = 15750239670793737663168453106536799019422167012561337339471882252601610644212;
    
    uint256 constant IC12x = 4815017939204342855702415591938259910465564808220195588208959676315929839261;
    uint256 constant IC12y = 2696794222187151180051586537379318577265153691069705990683840823184952475524;
    
    uint256 constant IC13x = 15755646708872809811657918242913856215914619200808383079623595390487080671736;
    uint256 constant IC13y = 12565272916445979524850299682453386086384193063500036869539113428849903098690;
    
    uint256 constant IC14x = 19727396584826669468624808095520141552995535314637863288418913849360354318836;
    uint256 constant IC14y = 19114812650857391662736880419710501166275156436802267239765110655681956375960;
    
    uint256 constant IC15x = 16123663641594975866440265079918066923676868303960100975296297531988252289819;
    uint256 constant IC15y = 18035970824690676959092510894597809831082980321828447279136172413127623480451;
    
    uint256 constant IC16x = 17593219072809105192620146386502896855324787233088294862116592857030600525929;
    uint256 constant IC16y = 18730625184510970595115951933436585453045924605182349840539183522272270752791;
    
    uint256 constant IC17x = 1815706335302930199909734174004627952671142596748737115609216540109456104271;
    uint256 constant IC17y = 4402424744110379913533046701177551465365435716837694492293131228299031281105;
    
    uint256 constant IC18x = 14351431089402341947029532375245583215130750859818050265810273989390733428099;
    uint256 constant IC18y = 15414788220695779981367969375446754188633183074673601039015539853893894273994;
    
    uint256 constant IC19x = 2786189935357227429709693766243492286330762903358131642594037424632278162049;
    uint256 constant IC19y = 16316172831126867022018639676278130446954831274142317216291294375189288435643;
    
    uint256 constant IC20x = 9805622435654758442334555688444779506259614600169850618067043508638102334292;
    uint256 constant IC20y = 2105928667866739978798486725948419589345254528042306091780525835840075430921;
    
    uint256 constant IC21x = 724832108495067274657718244746975750376933440360121684095655728979907583876;
    uint256 constant IC21y = 12037585413047168160900579808351851115618097656586115200243361468238141545849;
    
    uint256 constant IC22x = 11444122212093057580494606350735784411063231886254529283934037813606934922347;
    uint256 constant IC22y = 17088865059271201229276560183696748608212624151315756359639757820761190223934;
    
    uint256 constant IC23x = 3960624690265598938011044042718945000536077965713557558463412051764560653657;
    uint256 constant IC23y = 13201887928603171491355992249786084186380033057351096076142656396055312267848;
    
    uint256 constant IC24x = 14133292801605782036973184051640837051170795485236937711691847338411303456420;
    uint256 constant IC24y = 4326936373342629055946860899649517676465575795827060662125192127019101975855;
    
    uint256 constant IC25x = 6473402830460320542962895247726488804326888690757362855010701158165228498763;
    uint256 constant IC25y = 13682849678194791080902968734380252022931018344194587534474633114556184416814;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[25] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
