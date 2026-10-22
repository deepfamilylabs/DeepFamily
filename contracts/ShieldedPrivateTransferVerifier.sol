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

contract ShieldedPrivateTransferVerifier {
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
    uint256 constant deltax1 = 5762099352090822130620748927080311417719516542354768280905605178563527421944;
    uint256 constant deltax2 = 20089218326447050155595686785511782758154447502123772905532242844845531139481;
    uint256 constant deltay1 = 20374396135255076715876717610117988988541553141664042105240725343096639526328;
    uint256 constant deltay2 = 1979010478290639633771096632480015605563487074785383031548858134838276976282;

    
    uint256 constant IC0x = 10467082286487800903879383938107917400957702606499643151682682762224181920704;
    uint256 constant IC0y = 10585127983619486259500947509537911800218327290769781563323547144700192281545;
    
    uint256 constant IC1x = 20740282669388473378869321071182059225844739319987643834654519493494526265189;
    uint256 constant IC1y = 10819196798582137346953391608273190957874043467558242376998764900480577045854;
    
    uint256 constant IC2x = 9481326267563141769355842190222263647143481101921691074676007482463059659411;
    uint256 constant IC2y = 16989299345271614102587000687440489002838602447312603090383729278452474407082;
    
    uint256 constant IC3x = 934803213033814531551622461408632902558493636129788349897157998442782869185;
    uint256 constant IC3y = 2457987561186798107968361613724615235964471477046638333875328512388229611177;
    
    uint256 constant IC4x = 2877756266473531977599159123824994676178451212977320762648293894280931649227;
    uint256 constant IC4y = 1117562466121957359432813214305496004009370996376006533607085702911070532110;
    
    uint256 constant IC5x = 21007538244503297712541122812928293903410090312194202956536717351969962581024;
    uint256 constant IC5y = 17440511501092416638191339477649928590329347990153909061854410099461370358394;
    
    uint256 constant IC6x = 13012363217202531484632600616807333346380750066149884245422660965094914907992;
    uint256 constant IC6y = 11772436223844297110787519466328608256884249774480873163121930568934098170271;
    
    uint256 constant IC7x = 14689465438548440272125202956288472230919630246739231744309785173313467998834;
    uint256 constant IC7y = 18145109812190221722500821631491897505640642716664747598513966492107313868770;
    
    uint256 constant IC8x = 19544324745795592938972001185776195325870972824557532786621757283853485416957;
    uint256 constant IC8y = 8915755342405553233803199621554397685215699858348755936669779863759317804694;
    
    uint256 constant IC9x = 19887785084116611724637754777620512128874524576718951403385229514839899176234;
    uint256 constant IC9y = 13462625060000607879695973439293096829723324775383638157298373379245513150038;
    
    uint256 constant IC10x = 14047984396171315161733588520598729195954334378041514663605350546246120725917;
    uint256 constant IC10y = 21421655103105031845006277004641026112287120729374103017267569477713623649222;
    
    uint256 constant IC11x = 4005166006109568239195806557501177094802033607226582339499225295056109492696;
    uint256 constant IC11y = 16971190581880589843519687220706122969656344856096353867100303522964387705345;
    
    uint256 constant IC12x = 3274788474932497211865014165454314727562457633491084709957763121890580281956;
    uint256 constant IC12y = 16398738111324587987188820738270887278364237482785417136341922163963537558236;
    
    uint256 constant IC13x = 15209603866793830937748218946506275001870743183932629025594412999155765513021;
    uint256 constant IC13y = 5157620758653933975420088193383077409400769368815938510738802880057929780483;
    
    uint256 constant IC14x = 4239426949340523174127399564369246621946494568518723420207233215878025772946;
    uint256 constant IC14y = 8653626434172823246935493008182815435848804256708570395039428129934499404623;
    
    uint256 constant IC15x = 2842710196329263882086059054900921153147161583016991138103043932705248382275;
    uint256 constant IC15y = 8117810836484570811947719299153919664419123436187174352932404819345883340493;
    
    uint256 constant IC16x = 8850267275162950169797512455619717837988051351339280922826275062175331765466;
    uint256 constant IC16y = 162250352127100869026420168375406703930963291589754879699854008138519696640;
    
    uint256 constant IC17x = 8886979469365882723297677812150231056600616514340948284070117440128946058666;
    uint256 constant IC17y = 19892107803426434427422559051680827198402039498041984166881013791001461025955;
    
    uint256 constant IC18x = 1656818617862708484368335659631127774801026283307795727597463320317945178280;
    uint256 constant IC18y = 18760762635819751843761692359831642304302238797544757698607370068818171014037;
    
    uint256 constant IC19x = 2693529343085481572102713212095915416384002648912516522983873964648382138434;
    uint256 constant IC19y = 15017509692034467438904662013859417139421460814833755549304399762173796678600;
    
    uint256 constant IC20x = 13595378211466097226522085693852391161177311091508404318814969956179961753664;
    uint256 constant IC20y = 12768058793405602161104738388311264282681024695672781445801941942150448826259;
    
    uint256 constant IC21x = 15158037567880763111450821297906978388528203294938870788652627554162629379982;
    uint256 constant IC21y = 9959662221483446081419052850304873610514202553231267152546613733508673850674;
    
    uint256 constant IC22x = 6239579268183657936759001414719484615607081407967055698570166035069606959135;
    uint256 constant IC22y = 4003435730507620478390504034850729524214542747954961107692543814430526644022;
    
    uint256 constant IC23x = 3327735583259314704176058929935017436822136306976288739138119223488059258352;
    uint256 constant IC23y = 19903344742218970351275560769896610297264452615493828205240838685190067933757;
    
    uint256 constant IC24x = 15713661630170571599758679823840695325731067355100111647715060003567535077953;
    uint256 constant IC24y = 19235569086839004698682334783491497679072353843833534848672214234255631986208;
    
    uint256 constant IC25x = 13730792886909912839150831113592716636160286327515299941246802012831326764233;
    uint256 constant IC25y = 7515811779263641713298700839466830644420468256289988948525447275913922977073;
    
    uint256 constant IC26x = 17179052218006980893840863484164896798707478934509179488465071361556847889388;
    uint256 constant IC26y = 14981925146006477563416056601090159890561446022820199581001430508718021268087;
    
    uint256 constant IC27x = 14674886027855371710518275653421919674467490381646764788234738028643500960302;
    uint256 constant IC27y = 14319235910648818891728156248916183213642527968946627177589368958835497363883;
    
    uint256 constant IC28x = 17923724492420259211293246147578308614040113840152537469564321098365284229808;
    uint256 constant IC28y = 10245459444972672413448677745381834435683443691058657813390595869313812705540;
    
    uint256 constant IC29x = 3052963955649834074919688190528212783857201304678800956750556087918407135929;
    uint256 constant IC29y = 5820914199996532809102942490103353201252086790709912286509928455721512976984;
    
    uint256 constant IC30x = 21255181505276485755404250943597599541627307677370857522130549929872932928772;
    uint256 constant IC30y = 2980120280017747683629779055715864056973536733586603061178664256313674320150;
    
    uint256 constant IC31x = 8998722354531436253633144013585114742566542873294084281410484772807117816311;
    uint256 constant IC31y = 19075193308471401104517660190029945187311957118669009960095350604133687707897;
    
    uint256 constant IC32x = 6833623099065258749541532133919854294956225111825550113032704402559441914247;
    uint256 constant IC32y = 7908898881056323296885333968494602404590193669772741744430626151285205453141;
    
 
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
