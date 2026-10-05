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

contract ShieldedFundVerifier {
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
    uint256 constant deltax1 = 10032026501110291612664830692678843586003080624205770751058856102086400336015;
    uint256 constant deltax2 = 15247832898927867712675927084830157203232387384445145753092091531687737850056;
    uint256 constant deltay1 = 2316519212372560963436614609660533780910490360548826952802394276020202949290;
    uint256 constant deltay2 = 6277313669008492394619018960891126313741343202998311457241999541012033565152;

    
    uint256 constant IC0x = 5736466455153530735526159064509094667651747330887454025212152493625425328789;
    uint256 constant IC0y = 10584219913682545776941380613559788993258969564897131074913775596909111482347;
    
    uint256 constant IC1x = 10801026279712600111287358090922259534958266876398765905271155288254405495488;
    uint256 constant IC1y = 20869876535202372669299844988833265302818581651603455587885614053045241488876;
    
    uint256 constant IC2x = 2047452686278590070139914488460836120868058822639452702750807350315871400748;
    uint256 constant IC2y = 14364315614087598360264871532551586028022319642991848113927195236037555756433;
    
    uint256 constant IC3x = 1566649617427235108317900055320753288415751113232916287558565841498029186487;
    uint256 constant IC3y = 12739435612511788928988483272631374827002741265596135603955937138539177131134;
    
    uint256 constant IC4x = 21847813502648957086355525550030025052832276887313779575846230762150557153397;
    uint256 constant IC4y = 9026785670392542724705601720607035323986567648531698321450396776613887451342;
    
    uint256 constant IC5x = 5581115694093772210207699720526901154202109346852715814382739489686761293190;
    uint256 constant IC5y = 627255210830770276319566629584883691568692427906316064677150527447468781895;
    
    uint256 constant IC6x = 6033580529337067185690107163981311773628007576532674450514975764046312497247;
    uint256 constant IC6y = 7308976641086503586561218740004119715942607972479871645331093632997215232803;
    
    uint256 constant IC7x = 4182716982764491629185445557380623349357949623996115025627317611132011893795;
    uint256 constant IC7y = 16421333317182927772893607388882185656479401256512609062984006675217752009633;
    
    uint256 constant IC8x = 14272634000080730818646086555750240176833112211744150271875856830824975657764;
    uint256 constant IC8y = 14043582724074198740597712114343347401507194358257631373296134043916933937216;
    
    uint256 constant IC9x = 19620250189771895733749548956262874467715170917001624676502717540790071482166;
    uint256 constant IC9y = 9403363116983688288650393505298644485030186853357716438664063297709737027673;
    
    uint256 constant IC10x = 3399929946476133656786707194572521249114801000264797796669675672707065703404;
    uint256 constant IC10y = 15556969889365330569969136975340716447105310126753113198072312163926183933274;
    
    uint256 constant IC11x = 13193149087896193446898467277225045646122852875840153541974821547280705530250;
    uint256 constant IC11y = 10153828691646094958088355564459554522244733502809066595081485957286950014052;
    
    uint256 constant IC12x = 4862451738873243073500980331552761867871547070213213123603815920638459987695;
    uint256 constant IC12y = 18335134608440359088863104428996433736856477598808894448296689141480303995102;
    
    uint256 constant IC13x = 14944952060798837166738442888873121702639190986815188573766483251940808373850;
    uint256 constant IC13y = 3761723147644516015792985351127664998545427467517860528162484675662093585361;
    
    uint256 constant IC14x = 388678976744771338134014531185265567248967339339931002726688905550662647228;
    uint256 constant IC14y = 21015272337425245596637776273858275984126441204062748125308561491362753719166;
    
    uint256 constant IC15x = 178624726926942590848180020830233977348409163432080990892891887826548607586;
    uint256 constant IC15y = 15039709464861489438669665011401389497863833872889749070817844521392307809333;
    
    uint256 constant IC16x = 11252412059433779971264424095814603324816870136916223350257881586158207306157;
    uint256 constant IC16y = 15806374197557973564519119121296212791844687835562400957169800593800570444751;
    
    uint256 constant IC17x = 14168053638917755189523690085088467634569314100457477903359433127343122420888;
    uint256 constant IC17y = 17123317625408608439213329898652175462978537051137993307103017697063931098408;
    
    uint256 constant IC18x = 12516626981351382929166178932011891530471089821488930329185833303838914980189;
    uint256 constant IC18y = 14892621340120312797745626699400616762373334058108308112552239580836209382625;
    
    uint256 constant IC19x = 14722611481748233067587040342199731177079949896748425976207576447126158311868;
    uint256 constant IC19y = 362759118022328532018586947984491793296404639459719177583023958383996243043;
    
    uint256 constant IC20x = 3994610575529488172339890913229768786601332216053694414990977443930859573880;
    uint256 constant IC20y = 9514485610971543660916491744477064669980310989861660434560768754435345982968;
    
    uint256 constant IC21x = 12352058321201531677935639299099102509657507913655572150122123760590961015867;
    uint256 constant IC21y = 13638971630773491534360983227909500114634496861214166137362550710668467471761;
    
    uint256 constant IC22x = 13240649418451859895424210533081513494499867524768044646986000045951014132665;
    uint256 constant IC22y = 3291732843752978238373843557297479133806710326301901069551418181077161353625;
    
    uint256 constant IC23x = 5320952476090764543692186807121267133433350918099308250486694663810648335534;
    uint256 constant IC23y = 20410622539290434170955305089949757407783757541733930956604550078789272894444;
    
    uint256 constant IC24x = 3834750689836726637109503655359844231383164284416645559905147440683926369927;
    uint256 constant IC24y = 9545252848352423845317296505452255047999123078849284971105582285261085739486;
    
    uint256 constant IC25x = 14531760536532082777652502980682426428370642422713097659480797722375966913372;
    uint256 constant IC25y = 20739590668104769979050663798523241550218166918126484229063672619643186806293;
    
    uint256 constant IC26x = 6691574450140693326555496887190833331182529860823375996517085607055005232226;
    uint256 constant IC26y = 16650589627395733893794717518831261269831150739339937951549217515298332132402;
    
    uint256 constant IC27x = 21876013240177970393244002731129115753998142824416884927026657165181064877566;
    uint256 constant IC27y = 9650630921752158138385320218173421621280120821206919917705128033730247334324;
    
 
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
