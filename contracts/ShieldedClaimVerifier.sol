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
    uint256 constant deltax1 = 6879973838167089441079672388479855915111208439746348096834453001334676873557;
    uint256 constant deltax2 = 2713553252054632685856469404628584595178774408746892272658515806887649711118;
    uint256 constant deltay1 = 18576617943309284103633497033867931970069712884842792180733222323232747433284;
    uint256 constant deltay2 = 10492640731320109269842848034044647486526820103152770833110226817190613899675;

    
    uint256 constant IC0x = 2381490133104379274589222778409465954977616597173194349644528201957365105414;
    uint256 constant IC0y = 7577711676342108076864163773992230605691147987938721408460067112310275516759;
    
    uint256 constant IC1x = 19418885745786630607969602201425936161499603940632277642904737188658041000016;
    uint256 constant IC1y = 9121793087305096253782024204390718514198307600528919380506319415374208915272;
    
    uint256 constant IC2x = 2639913898436822908547193485672619334211906195286438081191182562422481067536;
    uint256 constant IC2y = 16474220868123001185442413022063631057270551862358282050655353773033882954307;
    
    uint256 constant IC3x = 6643838359677733035505282789128898131482550646765741945611352075602260340052;
    uint256 constant IC3y = 8526243783382845922760344065837348602503427410751117448144649094611768699758;
    
    uint256 constant IC4x = 20638631542994513113658079582869648702447395827136003338443072962436265499022;
    uint256 constant IC4y = 1549530642734499445432455863738890227981610341248658597491058629161598047067;
    
    uint256 constant IC5x = 17648150706855497363978098153415575921034477761127907624049587810416830320252;
    uint256 constant IC5y = 7618955738185478517581618452177854161344371866539314685517170073802596683597;
    
    uint256 constant IC6x = 4681427647788790466483399598903865199374708536198400733433854800292192985293;
    uint256 constant IC6y = 11157497920448442483104608899459883382331966285233837373459188101520401524199;
    
    uint256 constant IC7x = 14911476494564070653733569820241735772579439045289712080336766627600829884040;
    uint256 constant IC7y = 19029409506194052006767336485558825473765038339276162813229654223501434797655;
    
    uint256 constant IC8x = 11428763934774019479008510053457560344280754250819742600211525698053445127467;
    uint256 constant IC8y = 3447418119521663315487641373551364013221112611695555040494204647032376155616;
    
    uint256 constant IC9x = 20884800171603089370802228986133788421870000475230535103746040211670988528844;
    uint256 constant IC9y = 6091602115571509790289084997732699141772220463985602242773421461831738821780;
    
    uint256 constant IC10x = 571079780267181782550261896565769285429325344464333385961544238499934127062;
    uint256 constant IC10y = 6978915782033335627226980106652799690364081106506865940155490216100841001179;
    
    uint256 constant IC11x = 7655187131257240134732517548919815066035614775801506521864403999242123498583;
    uint256 constant IC11y = 17556361918719847546444714768977900622637735795407520126264433751387422328697;
    
    uint256 constant IC12x = 1808401178651693468449830982433804539793371191677742937899868057961744397649;
    uint256 constant IC12y = 15555140393645430892986732943767416930709766015641144883593949897871551734613;
    
    uint256 constant IC13x = 18938194862433566811031349697393695355883179004828796410024806605356861135062;
    uint256 constant IC13y = 12824712402791388065504567782547760976237541749528208340821783448847010300395;
    
    uint256 constant IC14x = 11541469136945832751765131089551534563364536794181636757160013239767294381674;
    uint256 constant IC14y = 4549054765474660803750714645345907017877424689857692901268121015709140160502;
    
    uint256 constant IC15x = 18080885579932340235916678596393758550292473976094925044274749468628749723348;
    uint256 constant IC15y = 9984161843894284815797509269550269129129224922913577052224192305600344233629;
    
    uint256 constant IC16x = 4986870999040899718660767205173740872323424683041727778411124532686572666769;
    uint256 constant IC16y = 6428178104249510759366153769805143820762130010877114345101383689079951310543;
    
    uint256 constant IC17x = 20622626143504549413184627831744217084754730549994979702813106399682938357821;
    uint256 constant IC17y = 14959862957372610927797323638787005401310801710263004185368525821832581264985;
    
    uint256 constant IC18x = 4432705008821991478009174837186106129411236791028224825722831247468916164796;
    uint256 constant IC18y = 14931912641412793289851627657108377760210328298421099845641992475178000411854;
    
    uint256 constant IC19x = 9826377409257110288455428359362275021588639556736245976199209603328445777852;
    uint256 constant IC19y = 19050262616495857154115535143776059034949572223175552019619462921998805345000;
    
    uint256 constant IC20x = 1655411963299029113513927420250214439964846192337805710812310435999955139350;
    uint256 constant IC20y = 18249271880026914703294857181801574591884029225301730639570226758367343261438;
    
    uint256 constant IC21x = 710440651649646866612481165863889642349943567628342990724805546616344224472;
    uint256 constant IC21y = 10593279832166954962247754439139064884715922971192173022777467260003705418986;
    
    uint256 constant IC22x = 1438938159639143719935772820062415922444599859719632602457344104726738771593;
    uint256 constant IC22y = 19007949802184506684076650524747029328620836912797460689225932551481351990721;
    
    uint256 constant IC23x = 8208497622802136737012540867383779376823832488002989202272493202145276898186;
    uint256 constant IC23y = 20173953650791274040951057357777081782109291479646358181334082991605014696701;
    
    uint256 constant IC24x = 6935546618600019252749368527595728747934986924486326121546424998414567074227;
    uint256 constant IC24y = 20851713230533342136428993509202513364400082830717432502672411528942126541354;
    
    uint256 constant IC25x = 8204027936330302733761653748318964690860949495608613879472190685038172068406;
    uint256 constant IC25y = 16917312721683923591344773840622761712442384692271016308811184421849510949653;
    
    uint256 constant IC26x = 5060590824518273478070667478060771497774911819356952567621276251755195297543;
    uint256 constant IC26y = 1198016492702530090240365526034592407212151666613127573988703329653204518885;
    
    uint256 constant IC27x = 2836274090878005392847306807489795277319679283515603685881657335997586678801;
    uint256 constant IC27y = 1162475643604778250122412444032164151434285289945438109170087024564436650896;
    
 
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
