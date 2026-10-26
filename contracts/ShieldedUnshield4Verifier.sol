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

// DEVELOPMENT ONLY: isolated local setup; never production keys.
pragma solidity ^0.8.24;

contract ShieldedUnshield4Verifier {
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
    uint256 constant deltax1 = 10945094354127903200282468508590273156303006793393928294765335297241368352337;
    uint256 constant deltax2 = 14478994972713315449615853652648102117250620250062565122143604601132380243048;
    uint256 constant deltay1 = 16079550133267392040591893296947026879964249095018174116700177195265968344433;
    uint256 constant deltay2 = 13441000822201625481049830751803572435303220087732037489895148779908927629768;

    
    uint256 constant IC0x = 18369358459786510349620220396532350606455304160121714508828539628002515984279;
    uint256 constant IC0y = 8048196748723703536588382665479627712429290099722678243538831019523308177090;
    
    uint256 constant IC1x = 3736537741036142734074733260181785245875959571494159531478056152586165502911;
    uint256 constant IC1y = 13179599594122360258359276034703116000392515396235998067386969890439866204920;
    
    uint256 constant IC2x = 17314829960735871393311192965906928282735607087579597304326056841775316103716;
    uint256 constant IC2y = 19558870634909737325877002292137822293453890272661927404855048207034918776817;
    
    uint256 constant IC3x = 9371965341878861513522952153074327187048821472381972078838004626633783143782;
    uint256 constant IC3y = 16022301683038529318919114373755514689773643408926151440535079896374824058655;
    
    uint256 constant IC4x = 1430172731112177626051896795621492466503341355440021413887622763310921208307;
    uint256 constant IC4y = 9679904158790013806546141192405634284515222134947068250195668054909328285746;
    
    uint256 constant IC5x = 20931997447902289910494287540949871069284834336467382141624908225726700442667;
    uint256 constant IC5y = 699217830050835243780122016586641505364212877117196034109766098354480272612;
    
    uint256 constant IC6x = 9283273059975219473654914621670086015171557235722816680382144057615328221716;
    uint256 constant IC6y = 20378458860992920635333070759512332226786279310303638723022395355383565955543;
    
    uint256 constant IC7x = 1067305073924619838858913921857984283676559616484406984543606292459857076380;
    uint256 constant IC7y = 13764372612815936995583739346956111966194973283185341696506304081605327557499;
    
    uint256 constant IC8x = 2456088007968680668258605634668571288715469517574963211417843383387770323017;
    uint256 constant IC8y = 11278809569887716486894991272041303439280897704904631978949413687545359411071;
    
    uint256 constant IC9x = 5764606272860608508445452270902946162933686096166779329468322576384389913151;
    uint256 constant IC9y = 19421911086860934573656492671340106329566417484489941405055832430952028038344;
    
    uint256 constant IC10x = 2636990361832305820532921525413559645069108482365890527720124796586675833804;
    uint256 constant IC10y = 13837211063711306188677593394659923919482767609408788519509059132244838345102;
    
    uint256 constant IC11x = 19455998276247076416774303619396603893862157173393867139097338063928280074641;
    uint256 constant IC11y = 8809784552142065601716525614902177214703035355272236910848057175846147596356;
    
    uint256 constant IC12x = 12074005819826523875394381205374421771342625349123839024202772739420012980572;
    uint256 constant IC12y = 14068256083341919312707724964297977576035500241154212610186953201242896320607;
    
    uint256 constant IC13x = 6201776059483649829445283203352193627721301623915438660063608422542305828605;
    uint256 constant IC13y = 1341444485991426081430038013829101923749172815287506933315497108643161210367;
    
    uint256 constant IC14x = 8279428635306822537216214257045901242031634938268569540495853293214424317073;
    uint256 constant IC14y = 11724643244006252009768941820593992339320472298300563014724538665427486881072;
    
    uint256 constant IC15x = 17396474371978693978527946783854381356797547184401056618320778285798850521082;
    uint256 constant IC15y = 6217386387135780613741860544900014685579297045141958542611665537543293206240;
    
    uint256 constant IC16x = 18720580135848825756112903751338458056934539168028870382686668501441503052441;
    uint256 constant IC16y = 12058776440024157698356849024338566365814868279262628077653933379094945014863;
    
    uint256 constant IC17x = 19517306866333543501916762825242636020373749063880984149491801169218699594053;
    uint256 constant IC17y = 10421140943962464811574833633203214302736254897018013097895129431494131137121;
    
    uint256 constant IC18x = 9301509549482639295990151281249810622915673423631383195490781044077310131070;
    uint256 constant IC18y = 21145797342809923401019967636219562285389033124552804055996124767505710396339;
    
    uint256 constant IC19x = 20947642309457428594100633834543930066885042070294405947581125822089131056428;
    uint256 constant IC19y = 904639071352666891875899167286380291788278609532107814869740150000002694124;
    
    uint256 constant IC20x = 18620604503277557796336202663273173735183825012123693564796310538179542316323;
    uint256 constant IC20y = 11624253212938971063804150816359660556164503761192354603597463579411100721881;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[20] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
