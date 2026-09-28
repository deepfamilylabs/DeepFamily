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

contract ShieldedCreatePolicyVerifier {
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
    uint256 constant deltax1 = 19860267320980630108561871271116614818628477719835818714659614272143184804378;
    uint256 constant deltax2 = 250798727985575141655772180837772699195774682772148472658083336422006997439;
    uint256 constant deltay1 = 5412223973353957452559063094703795252301477358980059625947259457801830062208;
    uint256 constant deltay2 = 21870659402595531790618488773938970674841874832876754007866667603626061504495;

    
    uint256 constant IC0x = 15113590982148779136678659995916762265118675824174829340686981176870067209183;
    uint256 constant IC0y = 15635283311370900914373877713212924090851516482198733269325766976688544439446;
    
    uint256 constant IC1x = 10202439106962660729972026324471535499630440749143825844684973039756041541264;
    uint256 constant IC1y = 14552823165442433369026087494348084530158422233034844882699260321277552984159;
    
    uint256 constant IC2x = 5239489781199736677932086892621285470019113203384177089288148933176395997296;
    uint256 constant IC2y = 11498516054404563039483748734878724800344154184123621278337366684357803121885;
    
    uint256 constant IC3x = 570566415675518246310435321763051996967071303252099220266338639863787946514;
    uint256 constant IC3y = 207983668660754580239922318760280890596591419553532021761621440787144953174;
    
    uint256 constant IC4x = 3099200092107959232058513353383144670515127880704761322630040217630963278979;
    uint256 constant IC4y = 17362570893753403525223131280707062182947032099519272024453754789662647628295;
    
    uint256 constant IC5x = 16364813376346395583090184225967796048911336224301321851567565395209458623743;
    uint256 constant IC5y = 9635594866911880686686362889311596082318354845574268731891044633350123145105;
    
    uint256 constant IC6x = 21435463840088442058008539181733983762663680029871380640909816592233093901204;
    uint256 constant IC6y = 10695645900985060471389893888175711129292178258800673416178357336653985636217;
    
    uint256 constant IC7x = 18284332043150057482019254376479737482605941089004747233549862411656194419401;
    uint256 constant IC7y = 15353069510093944329243608816598520442057673629323327301079961879999624679993;
    
    uint256 constant IC8x = 1425095114633751282541913854704356845845087282114809607880812940288850944650;
    uint256 constant IC8y = 17908140620555163668706406139147640347017297464404594041582613949072983341556;
    
    uint256 constant IC9x = 11876749339071833567834068920870262794389222571025046041109531016217829734127;
    uint256 constant IC9y = 968412024234543084595636454313663192665155081804314312999190697643016992878;
    
    uint256 constant IC10x = 9871356207782603632476172260018931233228948320876282965504810319188841511208;
    uint256 constant IC10y = 9090693907997194434770278323143120237356219066536316504983341120589595647647;
    
    uint256 constant IC11x = 18217494825716463880620390333252276301951470798301865484021080719348364947218;
    uint256 constant IC11y = 19871964451150999197365518911432277876427882492239034052912102073052993996374;
    
    uint256 constant IC12x = 5543548051766924114789077479463637506471975576994856536513685171616528960111;
    uint256 constant IC12y = 9386746856788062011421029458778788298370606756195116592825074184733688124681;
    
    uint256 constant IC13x = 11139195205363415894910414978188950424153376226498342812769284619159830831070;
    uint256 constant IC13y = 20594958185088750830718610563779712289694194057962450977308855090108001495230;
    
    uint256 constant IC14x = 16582655841595342266593357327412010065511953478898912567383392011681646427121;
    uint256 constant IC14y = 16761254744782374218799329136092430079438675441966680810667211763205347441768;
    
    uint256 constant IC15x = 893355310800093982056779020727209609106947751556019241154297553170064757654;
    uint256 constant IC15y = 15245955504647490338599903417348822116820310510335195623717467045820340302422;
    
    uint256 constant IC16x = 14272554703200721218351395620621643467765548906830047733969930403042470480941;
    uint256 constant IC16y = 16806311196868334630661093731042939246348486763191303444710258017452089855852;
    
    uint256 constant IC17x = 20224198421132646836117519025582005534916604071484664435798962743783283590667;
    uint256 constant IC17y = 4045009576765289446431825216002078728006247534785520328645393349759368495853;
    
    uint256 constant IC18x = 15764992115872897248914202930543669839046589322107411609484163122190782193164;
    uint256 constant IC18y = 11008745613791179449365167405391422949703880466449648224954404946502021834858;
    
    uint256 constant IC19x = 12931373511990051450286348068504371942308573149490138979192109067958741305813;
    uint256 constant IC19y = 2769561536563691622101504571751406447461413611294086919763367038226948271132;
    
    uint256 constant IC20x = 2324528955370636718688159783643448426023740782244252021916916754310210162495;
    uint256 constant IC20y = 7108406789638548102859283476276504158435969947636962267910073911491730173756;
    
    uint256 constant IC21x = 2617804538372276143294441002423644931424866739944562758145252542305879399897;
    uint256 constant IC21y = 5457024541319476189928644634031553783592317935208028139313399417724520962619;
    
    uint256 constant IC22x = 10534193721312613595958532343552480481600639856157638346164556245607314103252;
    uint256 constant IC22y = 6614786737078736830809003645559797013832434322667354269998952783130870232980;
    
    uint256 constant IC23x = 755131018952274674593899583837645234534159820378020596806485552642205359427;
    uint256 constant IC23y = 20762996367462292538785659268390376350491778699255845852908608160000321985924;
    
    uint256 constant IC24x = 6795390574524822242952917678578567678028748401143367237371062702413022449125;
    uint256 constant IC24y = 6567942250774628243118259918390618678597969402184380563978867895271947947689;
    
    uint256 constant IC25x = 1890206892733099436719830858921951027668817730655787741930010318110769505499;
    uint256 constant IC25y = 4733942241595499864243641757376367428037599170170735210355310164891859548476;
    
    uint256 constant IC26x = 21275077310389452450860357677177275097303710508254722906320254652676944643651;
    uint256 constant IC26y = 14680685540241588853477710866141180125087481081782522244955391527100306223032;
    
    uint256 constant IC27x = 14167726853631692660062493467727955586862794705762100122361163998012514686180;
    uint256 constant IC27y = 3010145018929645972072611171169736062597468998604321475322766476872140929515;
    
    uint256 constant IC28x = 9916921139419111706405339068624331401234191769177041986558367889897606052468;
    uint256 constant IC28y = 4868249819875419624274541282100881667947023039519823878123724444163410242695;
    
    uint256 constant IC29x = 12940380511069314969418734828908755533378636506687935366943938782444806589749;
    uint256 constant IC29y = 16298394478653201523146218199592029923477274405964007093507879559475361787659;
    
    uint256 constant IC30x = 14850263374735247648796733168665234372821522117138109166981086168581617010238;
    uint256 constant IC30y = 11755780893437789483322692656299625471565527352238338589180338377870977877443;
    
    uint256 constant IC31x = 2829892587402130980790676362047009872773687758537442678945579571310347877932;
    uint256 constant IC31y = 19159232953059426300756759942140351059811708552665255917586007530530080981864;
    
    uint256 constant IC32x = 2085492447884138107719414974953397488969943269994208078106114919721097406233;
    uint256 constant IC32y = 2255240480170935558391319411796524623989510951628517490684773610832525262135;
    
 
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
