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
    uint256 constant deltax1 = 20573349986085398328547228333245078517855013840007170669694747333456023070649;
    uint256 constant deltax2 = 454493149528158619999240315341675419548698318794532976688609349215546606633;
    uint256 constant deltay1 = 20568144190291432873527484748332529134909911726557685893599037357088896590453;
    uint256 constant deltay2 = 14726918800343275466853367119079493054161691731305313189760049948995681646031;

    
    uint256 constant IC0x = 20862045687946199209189195743217567218796848618193621052673872852553681838323;
    uint256 constant IC0y = 21829106293127769113784514402543746174155928823977106450882505637698567776172;
    
    uint256 constant IC1x = 11499929809099852879127861356496630472420779634615874188943068800890109522187;
    uint256 constant IC1y = 21565116416345514611888475613842758511591396138855725078079813086074196917172;
    
    uint256 constant IC2x = 19983105896155658483417024574466509741730594979694358223510404836914369678315;
    uint256 constant IC2y = 833306036424910946153582046811219201007426806150242939200661903499199624214;
    
    uint256 constant IC3x = 175381298295498670963415765448351384676707387521665600765513379397435062671;
    uint256 constant IC3y = 20686462296771173583065587962063863066857770650971855027644465407524936792355;
    
    uint256 constant IC4x = 1739223291411126142991848475150474880113909416262840583996032647660841272860;
    uint256 constant IC4y = 16850067851640618379327941830013477290920228602411078343489789223738348146492;
    
    uint256 constant IC5x = 6810396606321880438728314931435562863695801516369267997432346411740239480215;
    uint256 constant IC5y = 1679490486845541608802656010645693068474071219691320300995151086200492307236;
    
    uint256 constant IC6x = 2571303370765764065770338306401646759494202514324094185569039808425188285006;
    uint256 constant IC6y = 13769785618495917498287013396485072673391535108815325593631545245495928037996;
    
    uint256 constant IC7x = 1155225577144910836482409975019073268594311006138058305899395623792687873475;
    uint256 constant IC7y = 3822413345584342381158677741807598205611108455550244392364093477669496184496;
    
    uint256 constant IC8x = 9218076842578829407069517584295523774761314964545359084561783028859844860534;
    uint256 constant IC8y = 21336250024202585211706219851327840962262559380285873336832343490736728459193;
    
    uint256 constant IC9x = 21558737273589826078446007786170091985241326864195428777219711779467656078059;
    uint256 constant IC9y = 48867431563951080164795015564798259466577222129656211815162362291596420000;
    
    uint256 constant IC10x = 20083374991055878916179352716596067725895165647062190848974306719985485748707;
    uint256 constant IC10y = 7064042281146498621521387820621829760403664325578133386685562606130407581310;
    
    uint256 constant IC11x = 15491390734721852949475046988212634903944023990176532960098426633798144606576;
    uint256 constant IC11y = 19572024610020318770544844800591788980240219676330453972379348879057688329596;
    
    uint256 constant IC12x = 20527803405665185895719138680794909853174818571952192140000794915689623017584;
    uint256 constant IC12y = 7912627165417364886269840112522879231592647182650119474567249679523800140440;
    
    uint256 constant IC13x = 18853795010262798842150944235085103272010108941864148621656553917846564722354;
    uint256 constant IC13y = 15102614985491787867230930386218706619254764807599738430353566856135252840752;
    
    uint256 constant IC14x = 21410214694129344084649238909913642963552145482055573830102724707425689276024;
    uint256 constant IC14y = 15480535504429358092495073275884007625697770862641019882466727271558260324742;
    
    uint256 constant IC15x = 16311025125811549650514208733551301394777605146712446596562445774861875884180;
    uint256 constant IC15y = 6741372529904384279873493776469208440767319268845988066338825086564142819410;
    
    uint256 constant IC16x = 20486920619920133062636647604283066024724396575974815269212104783943739972750;
    uint256 constant IC16y = 7055132044535416020735785150158468146530515441574217068382315434633960735318;
    
    uint256 constant IC17x = 20665237082509303093166363706286043331259000166133378750951262940551659979351;
    uint256 constant IC17y = 13637714497042693434581459483799355068513938572754340473831406929831185879232;
    
    uint256 constant IC18x = 3554515955025964359853350373716404981365114992052046360982123078117757388879;
    uint256 constant IC18y = 15589762516951450356023960654616597161326709892532327919374210198762342968089;
    
    uint256 constant IC19x = 9300850898628984863817329079948737477903954871284597171152081804333700080436;
    uint256 constant IC19y = 20609938922443903335171348116540770076528239448731080917212874547654589886940;
    
    uint256 constant IC20x = 267319065624119107076425100791771749769747113255619051489738280422186586733;
    uint256 constant IC20y = 3546693575615646149228816770713160225379207081162175467284093748198983821785;
    
    uint256 constant IC21x = 12125955079980811580865891485240001773083680193859983770702026228763436986661;
    uint256 constant IC21y = 10170352924526395222938852308892767166249259794809294546426551860316058179104;
    
    uint256 constant IC22x = 3241331742732584610111376872705315786549249902979335467540638808584819096767;
    uint256 constant IC22y = 19303353465208954566535164965109844932078329916088285050105630867730572366842;
    
    uint256 constant IC23x = 699177483431479192221181313970328067067494767067061587673418468377659737650;
    uint256 constant IC23y = 15165410780549374700686382427848383624974389687937199771155787916006480141422;
    
    uint256 constant IC24x = 10756157554314114891027930164366916695172188746971631597296068764677301369654;
    uint256 constant IC24y = 5053817398964907200680476582509739171891511413249431906409616879141285598016;
    
    uint256 constant IC25x = 15068676819785161678612707784222609303239221005594573493685518078573605324877;
    uint256 constant IC25y = 17832853722110757351952914533898169261034603467950744219388605770491281413263;
    
    uint256 constant IC26x = 18439556244750672794023775036749230399555756035419495480655240914957498272349;
    uint256 constant IC26y = 3133425177565012700323325954459124387754540197648329476204027883787041010170;
    
    uint256 constant IC27x = 5875142269585819026079645863935397913154095848566815995261022465437143596238;
    uint256 constant IC27y = 18944583028066796725723931669315013284253194571608225435551339460449019476451;
    
 
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
