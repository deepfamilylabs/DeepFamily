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

contract ShieldedTopUpVerifier {
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
    uint256 constant deltax1 = 6107245582585394670913000887482918332637777392217727765274395078637650565063;
    uint256 constant deltax2 = 16151530344890243653967032749696262965649629365963526149534868521237234951391;
    uint256 constant deltay1 = 4886320767620094230527100942546259983389410908078765510551373546073493754295;
    uint256 constant deltay2 = 2568817395576932812636930482190337834022352137058600117935163711934810685386;

    
    uint256 constant IC0x = 15133229772210643225746468180179203134417972460867345252841729992023327231382;
    uint256 constant IC0y = 15011442561886143473542263196080606992213600394212967408459637471048123533490;
    
    uint256 constant IC1x = 8471857410673921449046789617298168013641538834799206200488525762327180355413;
    uint256 constant IC1y = 7855315619777749279301774065287912462200907064804764668371692460040977493748;
    
    uint256 constant IC2x = 18856843924497034491661751365203918727038752399319734068694044289042570101293;
    uint256 constant IC2y = 16066525550215938521820286532328526513341317862179797626649062891384403620698;
    
    uint256 constant IC3x = 5749593690845617344062038059421662877969985910718507474596766710739928903385;
    uint256 constant IC3y = 6972941212493535284952600079558216767577633458476596055317479702408098734433;
    
    uint256 constant IC4x = 4191351288615962294630604286280248518045798307196352386736373601780950951800;
    uint256 constant IC4y = 19202886957716216800008686041414501234983303818093884620665425173639310170179;
    
    uint256 constant IC5x = 11537680597624145781175694101341662324324349475858268959765292956633517329719;
    uint256 constant IC5y = 14832919772342383112198267620895715602017942339487599472380316743925612281850;
    
    uint256 constant IC6x = 15420931281919859408536126982888648918754930403552915991314134573045283279958;
    uint256 constant IC6y = 19659924121617527804926025964889020922479349029312108752151316939261177304093;
    
    uint256 constant IC7x = 7074871260092050040188812655395604587380357445770991210513133398542342546551;
    uint256 constant IC7y = 12380296248304550211038731676910996048213765444188268417975958860431648181869;
    
    uint256 constant IC8x = 10077150163631355341296845052480650279990173557978083978053907729124020785830;
    uint256 constant IC8y = 206071323061706775821021612231826442447229218587111655807406394582827746867;
    
    uint256 constant IC9x = 12685009172053997515432229753526232593281711499042052423936564875541721105776;
    uint256 constant IC9y = 14582027825986497214914157170493494790646033701826577028489597526285779409897;
    
    uint256 constant IC10x = 2911083537577037817640197254411445517376935798842030274082020194835605753400;
    uint256 constant IC10y = 3301924482862242099719752520649722742004358282965619275146798682569046287537;
    
    uint256 constant IC11x = 1872482191385481607727720479168819612613932757709949324960298964454824904767;
    uint256 constant IC11y = 1393313681680808263135850422932320065830286360957029517626335011501779026192;
    
    uint256 constant IC12x = 21815606469470227870787968579268016488015931040854769062941018894463213333363;
    uint256 constant IC12y = 9718731006068841745060461138103925585439215690907690374958804067452162316481;
    
    uint256 constant IC13x = 16874594214946535212988802474862215129296336865878522411972801080141757555232;
    uint256 constant IC13y = 7777238041323049875791648996082081329563188487274198029362081993000116665175;
    
    uint256 constant IC14x = 953991610250120649494041954296326806472601949863976212289014327410080812241;
    uint256 constant IC14y = 10632089217471351312850299664773001720172754714783550352483863497340419020017;
    
    uint256 constant IC15x = 20676652326909777752763971012741642888264063947817806083905721317870857888720;
    uint256 constant IC15y = 10218432026047995982418249701124419317772220544144266381724489056973064137336;
    
    uint256 constant IC16x = 5008916137083115961663866747416930852455555215957361153224722889401581733248;
    uint256 constant IC16y = 11856388526289667754458706830324706716536158234128386339958825386892544493807;
    
    uint256 constant IC17x = 19295725339540364842505054939817715117539658864152947032199046781249779065544;
    uint256 constant IC17y = 18045228290217184857055444154683242470398175372350481873061214219434124099850;
    
    uint256 constant IC18x = 2941366851392471014501052302204384704476125862493558391206548618649501329365;
    uint256 constant IC18y = 15103818612475361158541940410674620121343485977888231433289672062615683056579;
    
    uint256 constant IC19x = 4053785775242329153927159015759298786937463333516630599639901061143999397261;
    uint256 constant IC19y = 15888842016871875957999901632391118237731494704503548332442229075684487580160;
    
    uint256 constant IC20x = 8187988844497941954773681304270143941096759507800284168025259849111863249600;
    uint256 constant IC20y = 18331442406210018775626521825620598454079546842066225136175289992451623567681;
    
    uint256 constant IC21x = 2781500667759722253329711218170827211089792659490052743617664170325823496324;
    uint256 constant IC21y = 8107170959339433430293089073472021056865381473162204690050593091178191628834;
    
    uint256 constant IC22x = 7059399145465621167038125190075444182221005650812417086356292240918893205784;
    uint256 constant IC22y = 20961218514792458818241021788885319147707684953971516392472516647946040894909;
    
    uint256 constant IC23x = 19367231993846197003329693341428074508983418847213977372763309305593001020622;
    uint256 constant IC23y = 13652431769128207288743396518056862217427498270128826384707474997322748195024;
    
    uint256 constant IC24x = 15906135379785794120611009846154850147111400768305891379829416792338201547384;
    uint256 constant IC24y = 17345798406577257720448967286246385721826845173260000976539379269151225669249;
    
    uint256 constant IC25x = 16639291696897131109702704463130340357240845473497989846544681060570315431968;
    uint256 constant IC25y = 8287713316773072074894963100634478455026205003082038958346845872664225847403;
    
    uint256 constant IC26x = 17522994086982843598978239083347132441912297053308928892839313373852373786657;
    uint256 constant IC26y = 17624863232506419426864080251057224257497628394454916410462789756733276050033;
    
    uint256 constant IC27x = 16198284347956089672348768621908930812787614053462145097073598687359431791611;
    uint256 constant IC27y = 20108600784395814394283775158058792880621650719004332487288473346199428647596;
    
    uint256 constant IC28x = 15874850141284255096291981391881258396238617840444971843617277548377853784163;
    uint256 constant IC28y = 2778700407927737779121406579751984131463665179826143445666910338810524047638;
    
    uint256 constant IC29x = 10014589087832571251224665386847414476187714125709817523606044703986810908079;
    uint256 constant IC29y = 5775764709685785973424208575880276010742644953770687740818392095269796501140;
    
    uint256 constant IC30x = 16892036015969404367110530713874205893203063598691175057690924905992350155135;
    uint256 constant IC30y = 7595861274004639260842370886783094233968939435413765563643887078452669390218;
    
    uint256 constant IC31x = 16876077731551973631943791245370054548524738559198146105844810339268659045640;
    uint256 constant IC31y = 16474553603577903814289569378036759487797653697264953974800405271678847559670;
    
    uint256 constant IC32x = 8865044007672097039097840594108624825585107501683894740623161978948159893379;
    uint256 constant IC32y = 3214846305513139140490341456191862392704449343556637748104220798390650285157;
    
 
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
