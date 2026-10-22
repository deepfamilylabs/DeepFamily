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
    uint256 constant deltax1 = 7973625684055001371340836422849337566312728608017914872685334313827833329825;
    uint256 constant deltax2 = 20569371308190358201858431908826716863713462010963556051819864643813487979001;
    uint256 constant deltay1 = 10118101214097916636661514978190517434372542034424764145653190576296052685865;
    uint256 constant deltay2 = 21253900066991431803205024457127954390607159486399327780716927413622504512551;

    
    uint256 constant IC0x = 2190802492236312761607892129556149553190840865065109236376660932651185849883;
    uint256 constant IC0y = 16669970960302929132093746663967234591299348521821415361107913174854276147601;
    
    uint256 constant IC1x = 7262777667037199040899120969298771582159673178704569298788584628967223746634;
    uint256 constant IC1y = 17855267763831462389793696058540689702039634897875958411304749241306679163158;
    
    uint256 constant IC2x = 19589307103418146565476285212601529500693771469251104396853662866063272284713;
    uint256 constant IC2y = 15930878098712975006399402145775281599367643503064795160256641724753601728871;
    
    uint256 constant IC3x = 12311485560998304400054778308029133140608373715217701170012433881635519745597;
    uint256 constant IC3y = 10416502745339314277863558063064596949728052479683722390948391250312670797670;
    
    uint256 constant IC4x = 16367003087523388133873829200678597191034235835419508539789114581807669802676;
    uint256 constant IC4y = 7833032023574547000416638193219886614186752468693934645731231050406990864714;
    
    uint256 constant IC5x = 10022929169511376820839326910433493056503068840578787744729114192763970965673;
    uint256 constant IC5y = 7015586036404403970560856025057571983681984433069169372531880964245713560981;
    
    uint256 constant IC6x = 3562644998823307355236393509079221947929130849976482863041280002055112403178;
    uint256 constant IC6y = 4633177888645953941813978177001043960269741789398007233529303709677400221513;
    
    uint256 constant IC7x = 4344829023823860068539071506864538751982863832836294988021822418645902453010;
    uint256 constant IC7y = 486415813101448930064683847663525383982001137876140551614359739749084049916;
    
    uint256 constant IC8x = 3907097277340740216770715592334057965399825415693747974003131488178059547837;
    uint256 constant IC8y = 4128331074703397095599440577034173261577551966026776544180141708448753143677;
    
    uint256 constant IC9x = 8293620996411509005169855080780211938035041367716089742438981130720021112685;
    uint256 constant IC9y = 18435179057558636512479405806351787958416569167874846432974350088873160434878;
    
    uint256 constant IC10x = 15855658432445809470017460852819035506309648163407790592208633784414897333076;
    uint256 constant IC10y = 4882442574514304835049474166247357949321547635589151160831159428262039868891;
    
    uint256 constant IC11x = 12917210112927675701110265138261327052779787840306342784560154043549313566581;
    uint256 constant IC11y = 5587417687392575290619317484988869083659022123075879168615135663438550808508;
    
    uint256 constant IC12x = 13412689520386546924630908597936692910543703712746358037337986723170296312243;
    uint256 constant IC12y = 14173239635684198371849224218213690812795986505431812041156007843575827738579;
    
    uint256 constant IC13x = 4255222640796333410675379624887749181258448949624833078345985155432674871054;
    uint256 constant IC13y = 17536369619430271964216067588107632449041812752630604572146764743286526715848;
    
    uint256 constant IC14x = 10818692714092014792589750661773323756847825836329253748371824209786166791466;
    uint256 constant IC14y = 20029525337126869582343526552064721142747466764459677496992513070509684011458;
    
    uint256 constant IC15x = 2370670729901152259984502284769630277076645359696954922072261281007951458971;
    uint256 constant IC15y = 6679968089666211459664678700802906071363193670075151407306877270854737413038;
    
    uint256 constant IC16x = 12893668341012801839451951132517563478758593991245090768403435155574131765521;
    uint256 constant IC16y = 20156543669281335921826108012030283156745584056916348277984831460743102304926;
    
    uint256 constant IC17x = 292241374524876864701847492558544784333622717018141335757606030399132670685;
    uint256 constant IC17y = 11325669560075744532930583635258934031116096006320625013547104889357587655689;
    
    uint256 constant IC18x = 12768621754688087458144791822131030631604637239503508771441054220711754710752;
    uint256 constant IC18y = 14922455596972794898775698386242411396959567878565931847742643449634348318183;
    
    uint256 constant IC19x = 21446503991547953793417268809319675579345190564540668057136026544025275006118;
    uint256 constant IC19y = 18854409365428072917293773721502660935740165002126777704000560153695512069021;
    
    uint256 constant IC20x = 12854626234059952283090320652132170061328032610053153368141929489010951654006;
    uint256 constant IC20y = 21271187324995648971147156989353675817321114231149644598841627343506118868677;
    
    uint256 constant IC21x = 5419637003492463435083181561809385913568745739156168287096833274868065557718;
    uint256 constant IC21y = 18062918444313240662568343878826772535869901239123360856931102257120651726053;
    
    uint256 constant IC22x = 16970448401504533643775954908380957991737244499353502752088368931746537197321;
    uint256 constant IC22y = 4086546430194246094576003390155297228771584939278055978360115467550337654608;
    
    uint256 constant IC23x = 3355163077983118323222899566177138630180581396829477017965610069512893046372;
    uint256 constant IC23y = 10059338746978176547429605403965221474323102757487146380228865935212068206436;
    
    uint256 constant IC24x = 10257053976454043066450669421721141009553960010643761252914249225289340318053;
    uint256 constant IC24y = 9009827372405575602510870480190972212386723169099397089564148447743658218962;
    
    uint256 constant IC25x = 4318646563114073109169436521338869480785976953111122983656986919192498109069;
    uint256 constant IC25y = 17056447099020828869159244275585444508707355713321865412299116624191521943201;
    
    uint256 constant IC26x = 13844996757706505346620161897361486513908780566530416511524121816775974981674;
    uint256 constant IC26y = 135330432855789685629393031100214468624180681755564572068862560647765867040;
    
    uint256 constant IC27x = 1585759023492828691143584517315983252090192678925162228085349524944636091615;
    uint256 constant IC27y = 8593678207802442497861604432767972721909664409066924458942346433883015095135;
    
 
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
