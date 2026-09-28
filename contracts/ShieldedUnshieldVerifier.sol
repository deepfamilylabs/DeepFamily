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

contract ShieldedUnshieldVerifier {
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
    uint256 constant deltax1 = 1335731177960562228951857387881477543353268124472593929707885728763272519138;
    uint256 constant deltax2 = 21841329078684767150560754202718494783440009915888504959104151656289683127368;
    uint256 constant deltay1 = 13626087853889314341438424586112298679225403382103949350021034631874299320469;
    uint256 constant deltay2 = 13561311202672096160115434468115049842812468141191017181350405669264467738091;

    
    uint256 constant IC0x = 13672976004395063320305202254247275371465340491414070462237741346383592258113;
    uint256 constant IC0y = 12500181367065847249255226874682389610182967938998296191448237069352362153600;
    
    uint256 constant IC1x = 3396844442966658952032606806781970122194706413934017770607663313149570372015;
    uint256 constant IC1y = 17046975490188881529787395927633167525159830394447275004479477685952881069969;
    
    uint256 constant IC2x = 20683804715929605959304705844555980716334396989637578303252152177702162107575;
    uint256 constant IC2y = 11691852208104957178638001043062490056664657088997435627741464654828110467732;
    
    uint256 constant IC3x = 20061771722087031576332452369720909173831950212135483732083528647921672373975;
    uint256 constant IC3y = 615524510001693452490906105996013978651555053445204866451584734170276413940;
    
    uint256 constant IC4x = 6173536957671984840178963522673118741771500721439670198246142877059098641327;
    uint256 constant IC4y = 1905951614431027330269816255369598540053101401488949733776838761684195422948;
    
    uint256 constant IC5x = 19800475666173221469047410678956459872207497089246418059384592097082162042455;
    uint256 constant IC5y = 682013068059552595721108631535307534639494187078932966529338307366299985140;
    
    uint256 constant IC6x = 6618997311501879592816431206860929476589144279663634351143336645444793023357;
    uint256 constant IC6y = 18588625980469434391199124109931348448991801219110923034759028742226015361832;
    
    uint256 constant IC7x = 4934226347622403468885178711652280656812177260173810635657419458398314771604;
    uint256 constant IC7y = 14216735488297818083767025405117811167988557258870460141277808798442506495309;
    
    uint256 constant IC8x = 10069759656634448798407955329617511184494043581359697856156690764851834071714;
    uint256 constant IC8y = 11209498378262748904894217876106999865197860428384192853382157307981905685273;
    
    uint256 constant IC9x = 12834931134532376574744373041378453308954765476650329762901687882524489420854;
    uint256 constant IC9y = 12714046006335422239631344415310215688320079691886012402750470122027697083408;
    
    uint256 constant IC10x = 17115342754496350051985029819062051287925401894087798135201873846087089636042;
    uint256 constant IC10y = 4275521701792220937281587676805579526021053409599762851373052694337165171395;
    
    uint256 constant IC11x = 21487963705217834773714097280319664271088451615363811985509411595404799384461;
    uint256 constant IC11y = 1271970436785922663344801545826801575298638493678472293712249759523665695023;
    
    uint256 constant IC12x = 16499911619487812969006913945590117006456096156604213593914712896876418634223;
    uint256 constant IC12y = 3499093152185284687445540106264735450376657763084427563131014289999790058266;
    
    uint256 constant IC13x = 3262015784903049388072543449771636507669361659458530889604039773717144937377;
    uint256 constant IC13y = 13282332730236415751984071871551077951378885911819553264310769789519856406211;
    
    uint256 constant IC14x = 8557565040724448729318322055598844404785878432315518662634196352023439574690;
    uint256 constant IC14y = 21846700121541428744927386556510897655993528761778844840097402222904330358901;
    
    uint256 constant IC15x = 2877645778734084400565756694125294733254981708552510655789924538977505395329;
    uint256 constant IC15y = 6082404299582212400012884060806264024337174397845410521675669524152252511714;
    
    uint256 constant IC16x = 1620502933196518700000168612606718579762488903686296218988299335351967043304;
    uint256 constant IC16y = 9238910815854992913163367094511036425699391620552874363128832566777757609876;
    
    uint256 constant IC17x = 1066086901665287156449853643238410343111510420532185357006147463028752439975;
    uint256 constant IC17y = 18290067164381481252396291221795437160023982783982614064796189618880937371493;
    
    uint256 constant IC18x = 12917946181702754012053235484745073431565163716462987488953611983008149115241;
    uint256 constant IC18y = 1927073278152499706175197400810318085978357131678837121000686963915123758474;
    
    uint256 constant IC19x = 7626465637248135996086193796520206404022369468752631035520685619362068770499;
    uint256 constant IC19y = 12068482056839139043993844666603998595120225542703113642555516437028613321461;
    
    uint256 constant IC20x = 17007947858695807122210563552868443929348306135863238398115546146858239329673;
    uint256 constant IC20y = 11781551317863292865544456409659831875094927909841834293381626187643441698112;
    
    uint256 constant IC21x = 10926463209799046450903111804529135467468397332968483636266416972808241400709;
    uint256 constant IC21y = 14175598977794291643748654453728272815725443792748908484337786023749874590303;
    
    uint256 constant IC22x = 251464662961896613695282140763470929075446426333483134749339640167659268694;
    uint256 constant IC22y = 20836551045336496839472938135355677727503096126947386916651046387288918843119;
    
    uint256 constant IC23x = 13876666382487878243062307677214112565076604136617928471277789773410205606671;
    uint256 constant IC23y = 11582960448703279891232055592302803976966381751409814468788086284171647768607;
    
    uint256 constant IC24x = 4597906772681066608325908645596337792222004998152075353232177582925443291679;
    uint256 constant IC24y = 7321253325325125862282634044382879018921437282280581933820061164748053722726;
    
    uint256 constant IC25x = 8601661797629369466941759051545913218535911655263692059771645448086860877401;
    uint256 constant IC25y = 2810969305061383343100233760383786395127583762243617192991351116952055709786;
    
    uint256 constant IC26x = 17112837114824847012230379914657524536897534601890142496787952406123107551085;
    uint256 constant IC26y = 6001300115556085046519388257308685034983578463386029084738830925522609009055;
    
    uint256 constant IC27x = 14606808371186342908333259563549001404976788412969091319456129409044184298967;
    uint256 constant IC27y = 21125571414295184148765597517291423957552576321411778628929789394587092319767;
    
    uint256 constant IC28x = 1400379596089661000105329985922838498360072164438796553193372888176615442801;
    uint256 constant IC28y = 16013766545220149202702955825535793527791556777965050404865813411553221150633;
    
    uint256 constant IC29x = 14240590308811194857793578829645859096565640551808201304345444326259583121358;
    uint256 constant IC29y = 6357352626564822921254114122666654884182372851025949878159393369358210371658;
    
    uint256 constant IC30x = 6872636201511827092090937459869941546356092200846142087884924854072374994010;
    uint256 constant IC30y = 4250868658726226660197539918955851456336773962469955566827677600872390228458;
    
    uint256 constant IC31x = 12395437988599818212834791008690173554552651686477774815480451620875181518923;
    uint256 constant IC31y = 18305659271173501520210158680218315922489309129844982863428107995651841114268;
    
    uint256 constant IC32x = 13621698166313799799863048267058678634699234227159197244024888262784980451323;
    uint256 constant IC32y = 16571628085668502973775343775616935409813741284359528967617597317899601954460;
    
 
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
