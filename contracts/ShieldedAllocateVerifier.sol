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

contract ShieldedAllocateVerifier {
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
    uint256 constant deltax1 = 15204617339185837418055175164731862546729441995833722390910973562771383753621;
    uint256 constant deltax2 = 603555674697655603024570121777772628057259604851458726754624821205026457335;
    uint256 constant deltay1 = 16712350599665096179579193678685464116383068842596496725719810627645983830634;
    uint256 constant deltay2 = 17080796901257257070781369156933235299737541796704140484173642007641888875377;

    
    uint256 constant IC0x = 21570305351835006251736410375719598256318118929654862146259773977189229764068;
    uint256 constant IC0y = 7118075655038306222252492425955584957554228649469243067819227021465614965633;
    
    uint256 constant IC1x = 17884359057216717152299742900279318940208660808314602914570835418455094967321;
    uint256 constant IC1y = 10387050925446965757056066468370552208648710403423445454720768168904339110319;
    
    uint256 constant IC2x = 15454395818317870337945229438818072216362933471987818122080658641051663062507;
    uint256 constant IC2y = 15463915169425029505190269245708543078971862960855655841444254411354826511092;
    
    uint256 constant IC3x = 21633992574773952576444445177859810399102799340485814200871266848729357162412;
    uint256 constant IC3y = 19165144254928103882004088645835796499291234648234491172490232573900717274646;
    
    uint256 constant IC4x = 2565375370866185535478131821036527070648399502943185561966642718386765632105;
    uint256 constant IC4y = 12100566169278481379069049284020620318070704498371441061275190096311228431300;
    
    uint256 constant IC5x = 4147376995494101124741672432273091017764873889363483162483528101851002436473;
    uint256 constant IC5y = 1527362063774818585166422321932718924774288205498490078348994918183119071273;
    
    uint256 constant IC6x = 15170053885893478969239614509016717376154925782417282274835455093216409038338;
    uint256 constant IC6y = 16710311443628236385006562791325545014083161967986583246004512318470900293026;
    
    uint256 constant IC7x = 7037136867958489959755592110826915428366920938737864245406815418372883504675;
    uint256 constant IC7y = 20283763323606180185345382492807845831963999676492063876730513072534414817882;
    
    uint256 constant IC8x = 21008183490945745588663144573461042910385810801912557759365508175260798754224;
    uint256 constant IC8y = 15842562973580243368444500396576993193494578324290013244452999604340137566060;
    
    uint256 constant IC9x = 5581086049650134599087529296166468041025185824719330755267548667145216221779;
    uint256 constant IC9y = 4982737267924088231506228779290043784314663405823518524580198433883293721817;
    
    uint256 constant IC10x = 21113971856242310070429180189266569007704067314604133377978476092760290935545;
    uint256 constant IC10y = 9360960965956730366878934322380144859738606777399632854129805025426666166233;
    
    uint256 constant IC11x = 487444397338328392410434989363912851959137649650828192919840123747910060819;
    uint256 constant IC11y = 169939410336797709227178781384559235372807318742213524199295396276521218979;
    
    uint256 constant IC12x = 11316656417170690917257739455292687665198825544782445302745491024160747617124;
    uint256 constant IC12y = 20061901716009298761550017048133797708911692599756297583275845507174338597121;
    
    uint256 constant IC13x = 7440345869237037542589021944408733869040434827032703644609569512962345930169;
    uint256 constant IC13y = 20507977991544983426045894320287303340068665133397066805060103134976564882693;
    
    uint256 constant IC14x = 5903997926873332990145612388679859904731433842033227399191521588788936094144;
    uint256 constant IC14y = 5919565142695074903496972363261830978253116247178927912930766021675503924583;
    
    uint256 constant IC15x = 3618142997331912494796059217984777003529992587087506567626168664302734079594;
    uint256 constant IC15y = 8119158406887687829143663387711096527358170271197606282833124466673725289193;
    
    uint256 constant IC16x = 6050269127477401367137608780879800450957357458059942813220788443528413742286;
    uint256 constant IC16y = 10460536928558314717522049134496916676380407603815161777464887952744543435152;
    
    uint256 constant IC17x = 8879435379499983878114819249601476360246340304740786238166397834583762241785;
    uint256 constant IC17y = 21716079576523452601556468276825164965260012960831032964037487063183716186128;
    
    uint256 constant IC18x = 16381035220487878347395161441672265771381747633015762043853756374286332703101;
    uint256 constant IC18y = 8058197774671310797604456752191199681560318159853796584684146482237674980618;
    
    uint256 constant IC19x = 17790989444981450139215841313246784279455615959970144135829149619705974177742;
    uint256 constant IC19y = 16063897441621864328522538892176048993087276782031512442782876361837221183812;
    
    uint256 constant IC20x = 11199650138972404269979159950902565096684902551232953223909509562298230578101;
    uint256 constant IC20y = 20137478363537641360864965491486625618079271705636265775014291885378079221302;
    
    uint256 constant IC21x = 11468764253986168024732774983100570807035050567030505491268202623937605608843;
    uint256 constant IC21y = 18395921530921361402954731037031901780989192477135719247302294483312928941635;
    
    uint256 constant IC22x = 1012148699746049032806724743600451392930082568141418065857311026574071583314;
    uint256 constant IC22y = 11982806831764900195253924331902374231970754870740231540706679622979033205441;
    
    uint256 constant IC23x = 18433763308212267462312808945874217450145212075951440687961725713777049236293;
    uint256 constant IC23y = 870198867492498107068995220971399108675095351364640632227808011884928844131;
    
    uint256 constant IC24x = 6482457864354217884997498315610277023221212635961882650373824586777920861527;
    uint256 constant IC24y = 8353269040435090535038572622750897487530433958883728192473077206452162467187;
    
    uint256 constant IC25x = 11945622883789322972654723238664951414226643588725101181270197240054307970139;
    uint256 constant IC25y = 13817784006417827304512112763686115058598972996205496258240231528082701941078;
    
    uint256 constant IC26x = 4485979067755841802462869090262277165424650545794525967572410123362991901479;
    uint256 constant IC26y = 16546181441059072741151011026015222534273106251017105161551086133966478661379;
    
    uint256 constant IC27x = 6587722439414223982547596550278952717281041813280346258238342394134021999637;
    uint256 constant IC27y = 2292273676879367091493844204129843104834338201846371597690538872105018888328;
    
    uint256 constant IC28x = 8851511933600374681365374485294949227313409208972938762256437527005376507183;
    uint256 constant IC28y = 21716749854889654182384209958551621055217992992012850184429940060432974980701;
    
    uint256 constant IC29x = 18976267680645139031474490928263983788490469711851011613187203910464178298151;
    uint256 constant IC29y = 10678529799448243714058143588434020997654243296606760406299834682491075744332;
    
    uint256 constant IC30x = 2524042133577074457066406168138946935599655110602294152779920327881753833314;
    uint256 constant IC30y = 7644489675184451467046317779513855421336716413734451092396078018264785827218;
    
    uint256 constant IC31x = 8191884696873618284908633145211206667561935956141899719955941185606234405287;
    uint256 constant IC31y = 16297445003127036704723275307667126033388379286072399085945732039692994758591;
    
    uint256 constant IC32x = 1894490480365389660923891174796165993514802273568149098590449218587239412881;
    uint256 constant IC32y = 16623162268703485053261490201544330003100886475744002613570030812776485912205;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[32] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC30x, IC30y, calldataload(add(pubSignals, 928)))
                
                g1_mulAccC(_pVk, IC31x, IC31y, calldataload(add(pubSignals, 960)))
                
                g1_mulAccC(_pVk, IC32x, IC32y, calldataload(add(pubSignals, 992)))
                

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
            
            checkField(calldataload(add(_pubSignals, 928)))
            
            checkField(calldataload(add(_pubSignals, 960)))
            
            checkField(calldataload(add(_pubSignals, 992)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
