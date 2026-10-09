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
    uint256 constant deltax1 = 7033581466629712736998617578470789728003358404871210581911365996952239514063;
    uint256 constant deltax2 = 6460048276300625272052343554542065260378028724906824915665970720329505123725;
    uint256 constant deltay1 = 3350807074650226193723604329672613344730448028206843773188731776201911599054;
    uint256 constant deltay2 = 12170733756732100225807901293731882983101097075059433186405652453044005290497;

    
    uint256 constant IC0x = 1803867768872894806215894725092122347440851278341237726688079295912118882100;
    uint256 constant IC0y = 6843680278884813657207090215980999367301242726101869404432020700537564044151;
    
    uint256 constant IC1x = 1512469964463183530839683118962101771749499777485500805833338423250380822030;
    uint256 constant IC1y = 5478138050881031952501676026018316422402952964803050793555807458290862802085;
    
    uint256 constant IC2x = 13591468760379490812851398387187564137207025996820766126156670601755103252465;
    uint256 constant IC2y = 15726458902628131449933466402163664625831765242204001439872950621298271626015;
    
    uint256 constant IC3x = 2208034512902298618858556194980800686714174775889953000156833389301019984917;
    uint256 constant IC3y = 16060738768655486756800763731608488301149777218531802581487164601349834939128;
    
    uint256 constant IC4x = 15821998959781317917243499317326233587654784902610340870230466867259954419431;
    uint256 constant IC4y = 9106483386720502138381722626597418802297493198034160229977285548523599331959;
    
    uint256 constant IC5x = 15192025679934483794628522746451777390265550698916078745651510090253800381048;
    uint256 constant IC5y = 13259044057059791845245291451134257904339847576934388537408551742529143095427;
    
    uint256 constant IC6x = 3008410793002770702998307245600664999535847290116512890599912386822239113160;
    uint256 constant IC6y = 4215271661230883810711016181486375741970919797325895744950383523205558017682;
    
    uint256 constant IC7x = 6357764998462512764982151677184114078290350778612051552354868852509356976456;
    uint256 constant IC7y = 21002623113725870724053530091671504111175042801382972049283751753788687694949;
    
    uint256 constant IC8x = 10498265232683041902341814478068150326185774729270499076710051683584715536991;
    uint256 constant IC8y = 4961657529161642921662658900847547006040746416996821055655744948875887898253;
    
    uint256 constant IC9x = 8069476794292527618692648435725853281518548657965789303327117911340283433782;
    uint256 constant IC9y = 14803532323010223756812797544199818244251097656154707996358697773942058435760;
    
    uint256 constant IC10x = 12291832642218353227717262907916748713172189475425395735905210690899425629240;
    uint256 constant IC10y = 11754864542516899568300318810558110250908921437856502961864265712397341978237;
    
    uint256 constant IC11x = 2919996558273672109037914490233207954120423610423177960178011257280322687859;
    uint256 constant IC11y = 11174054186231871162665507227260018555857745397044354572316318810718351337701;
    
    uint256 constant IC12x = 14687476154237141693440485205854885976340090829450982442507686042075263272383;
    uint256 constant IC12y = 18697534659349975495353797774797180774350580503389566739362189628233567996677;
    
    uint256 constant IC13x = 11803821357379089598046303927787855040174200581700552129988161618548237643400;
    uint256 constant IC13y = 4162788868231425200673123518980888428825464866752838769526124957410083716612;
    
    uint256 constant IC14x = 12767312250479506614631725368952781372837668916399101632317653813560098673061;
    uint256 constant IC14y = 11782920355684310806186150054946770458463418013101810310014584457593295300347;
    
    uint256 constant IC15x = 21048916477549659601756150166721377742139692885064361346484091363324525765598;
    uint256 constant IC15y = 20630560445171888457178191649076734465204255199620221350937939303614924207659;
    
    uint256 constant IC16x = 6498237127104334994262685515788571109717806969002508571339199747712771972301;
    uint256 constant IC16y = 10358279316163896248411594914484246543011270192632013362750792620488918315499;
    
    uint256 constant IC17x = 2019839507673591203125889086637393821480110433227700377506050380372560705981;
    uint256 constant IC17y = 18025546594073562375512623661861341542966830465362928729657597977786679557846;
    
    uint256 constant IC18x = 19361123858524612011298146745926555869032213218144030016882477041953755792310;
    uint256 constant IC18y = 8647547406303817086389467532769639950895261226946175143464033386213557140961;
    
    uint256 constant IC19x = 19760189142760184622187765580510315799513419349898933944493368072896919295122;
    uint256 constant IC19y = 19154912081559103651527610863261266638968910929359913632888808193108762467860;
    
    uint256 constant IC20x = 16135026213519777870028110627463851150414787763849007061547406843459493405164;
    uint256 constant IC20y = 2844378112882776668287976274817351136160388316815358524953347785004059418000;
    
    uint256 constant IC21x = 5170663327098229234617160345360106880682143121281603203032052782240144360160;
    uint256 constant IC21y = 8664220881486444932792630126999331208313479445334461954790210088186494723097;
    
    uint256 constant IC22x = 17150125433159009719250494693775925349478155149058997323961961967706838313271;
    uint256 constant IC22y = 1720915153150638450430800322286422423853234908864359208253133252463307822359;
    
    uint256 constant IC23x = 16480294622060810038014978579490066885710202007246518347021449534700439464309;
    uint256 constant IC23y = 3297273928448485607443224349795218884298369086302011607033247269204655343663;
    
    uint256 constant IC24x = 1727896865993117738570663705410351644416919830608940507972541849227050604621;
    uint256 constant IC24y = 10417875068770953497538805803654940018963148572932414082159875939975723137897;
    
    uint256 constant IC25x = 4421396870619877015150863685290284634544169780607026465131977866457580042139;
    uint256 constant IC25y = 19349840920571314534991724850380268884415828024600814426569417763071872123955;
    
    uint256 constant IC26x = 13119407487385318888527541438638948924603845096378928001548399735256729887768;
    uint256 constant IC26y = 6767918132733974826807440247249463826415295696751113125538939049100966655562;
    
    uint256 constant IC27x = 3170366446353167660120743632730110984002986313307819362609376949925395279677;
    uint256 constant IC27y = 5234372347188170294648813601729580441996774921370219696253065684484827518999;
    
 
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
