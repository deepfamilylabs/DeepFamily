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
    uint256 constant deltax1 = 15627075035856613876454927842465339605691396741828488730847488438813051576307;
    uint256 constant deltax2 = 11832256009346338967032378623940220596041136226093805257407104158381643673130;
    uint256 constant deltay1 = 19492527361383508002885639746405722750110237382129657017436814031740873213280;
    uint256 constant deltay2 = 20275981634495304566233898966100993812880786294555448178097625726260969960145;

    
    uint256 constant IC0x = 19430519793575940922768993560793702749948347338698489675742419557784332614105;
    uint256 constant IC0y = 3649614788225725110819967765940917110771992095036392392868205730745120789818;
    
    uint256 constant IC1x = 16612772232991190508377225680758628979562122767954616194163112933969266857727;
    uint256 constant IC1y = 8138243510653160856019291048043935775635664011015457533103275073137929948722;
    
    uint256 constant IC2x = 19255552584089411480549436933521555299403959068565458522097406622754485310154;
    uint256 constant IC2y = 12612412901758014811708209466809364826982475214438262764644936309295108465258;
    
    uint256 constant IC3x = 17665831796473883033628445206346755280084148451328521275457321386502010128756;
    uint256 constant IC3y = 19393353169978067716477533056964462560173336333580083013551625968304816993930;
    
    uint256 constant IC4x = 8887254474978519657661758628886509436434657586782626484592902013305258942324;
    uint256 constant IC4y = 5425633492881535443209038104130933301937594560921622252808444534215887180358;
    
    uint256 constant IC5x = 11826592098340163813436686799410914460108935444765522632452792229719688374188;
    uint256 constant IC5y = 11616969395431033781194465863784074826275986832993318074133063640093259197454;
    
    uint256 constant IC6x = 19229136900335140495576863485164975576970068147620461584934296214045403643226;
    uint256 constant IC6y = 11287043847583998168956175720963335478152592636268015294037995132168825737923;
    
    uint256 constant IC7x = 10916424797951883326583786363516234777236642128849648730899798067939525875142;
    uint256 constant IC7y = 8365055535049861940748451120484158581724924221814250179577752025467419813439;
    
    uint256 constant IC8x = 10659293287481216949779282998043677305803142604319379656351253623103888079285;
    uint256 constant IC8y = 12034542555415572062930409580476569917864861414524991312437215056978195083288;
    
    uint256 constant IC9x = 13774210160165377013313320846894328102093888902604942435612683846893325618012;
    uint256 constant IC9y = 2717661040655862356840872290043756630611065040851277077352241953041151985535;
    
    uint256 constant IC10x = 1630124363195442752515421137027928584087572449983145289697609785526042658642;
    uint256 constant IC10y = 11029090731726739035538570727952145411135200795532054174465931171064603752647;
    
    uint256 constant IC11x = 1866606839766756666714624663201576549420309150896580693196993010085144513040;
    uint256 constant IC11y = 1890178094682289573290612571007025674525114786389018795347520372347335801638;
    
    uint256 constant IC12x = 2591218843077423235730409807709105760761083858598630116266377625254154769245;
    uint256 constant IC12y = 19051393146202180891940112461212747949490928803613261824110253371635076081884;
    
    uint256 constant IC13x = 8846097677016114959070876660783802220818871150356540001896880855602108907374;
    uint256 constant IC13y = 13226416621023513397567165184932389060441394463829028431517068879910416445201;
    
    uint256 constant IC14x = 9177912405860854771209076496899187360614898048598727131823978452631770246405;
    uint256 constant IC14y = 5180571061599626061687327778929144804887210209769011998923377704867815193105;
    
    uint256 constant IC15x = 16286586446720304049511207085621624836479868587386611009226352182824090695548;
    uint256 constant IC15y = 7490105103510510966982280666828521223492431713266211271076038851989260628789;
    
    uint256 constant IC16x = 18780148771194699287726183897559745717276408896485112485658885537030448393580;
    uint256 constant IC16y = 19502437979678095673290322022064257937283306237198434987318577735680417525722;
    
    uint256 constant IC17x = 20360462199405212767984066001363468931893069075409072208225979762655312188764;
    uint256 constant IC17y = 17113988199001907415530675576658055139842862962395523827559873623784237114049;
    
    uint256 constant IC18x = 17608497912821408132077956623095988233077542070119486829385022352585882464584;
    uint256 constant IC18y = 21056528646719342647790565868186314982942755092260193491228052890558752604508;
    
    uint256 constant IC19x = 14088605255173637115049977524677660390074094596474107565423939513793601688782;
    uint256 constant IC19y = 12312462715263143206871672701779408144622984845880347077402863139969560671642;
    
    uint256 constant IC20x = 12171651020606569072104413318234406347179600552917698239497825349328253388147;
    uint256 constant IC20y = 18218841135132518348202519528226182040013926759888701032654148578784732367480;
    
    uint256 constant IC21x = 14244972451298626574490007487833216813619571255261379997495757807680451812716;
    uint256 constant IC21y = 8724241198526237166161639393500449367614769884162865262273889734857329903719;
    
    uint256 constant IC22x = 13110242761690465919867131595419689369042362951128251128483394784737235598057;
    uint256 constant IC22y = 10753532777191947618440226475875775321506792309350174116202172717282537695304;
    
    uint256 constant IC23x = 5817178781017327357814014816181333188615871676497773259454865015125719250622;
    uint256 constant IC23y = 16560768099390649510969743779937765780113905079273935148215079212082591003209;
    
    uint256 constant IC24x = 15880099384492238397906913580000711363807019143596797123404967081560930613133;
    uint256 constant IC24y = 6419546218175791736996240756619004787350775096902852889768140603248555354922;
    
    uint256 constant IC25x = 11281916485234806801405648172952276199792586057933084922888362716560424374510;
    uint256 constant IC25y = 6120450282562081129172209963845246347116751346986794832247735650035653271094;
    
    uint256 constant IC26x = 19477379587647345552265046303609792266097813233092020246129520090314929529433;
    uint256 constant IC26y = 4719611289230633684488816584155237675036628151017195401499731520564349292288;
    
    uint256 constant IC27x = 17346538019464912237199577009102093798989090371007567074360671819740995769470;
    uint256 constant IC27y = 18830758676198037225821975805085387741805555496850960694258401809154561437673;
    
 
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
