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

contract ShieldedShieldVerifier {
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
    uint256 constant deltax1 = 2991886025944111091011493150127335511071441279158391789915358423408370803570;
    uint256 constant deltax2 = 10198296538001640070227375782513960435501644771142052613840030362990867777540;
    uint256 constant deltay1 = 14127612707113155693527436230738234953313388833349230225250482632255346303584;
    uint256 constant deltay2 = 19113231384601833234579687121060048169939973280487302783444751123489684410826;

    
    uint256 constant IC0x = 5662543690239267991960121461581719905684776658341701077013477598677562466590;
    uint256 constant IC0y = 3455211350032323680047449861017141941944140955678353600530823894041349522897;
    
    uint256 constant IC1x = 9200686005012674125647043300966681614223882837784147520713009001095347283009;
    uint256 constant IC1y = 1991206202107055723852941270595422571209828355216499481263977131784785934758;
    
    uint256 constant IC2x = 2689712435163719449885961160056401166810938080171147921435719259735166832420;
    uint256 constant IC2y = 1896530182201622990609295371302739686566334518605901489309298221530618307701;
    
    uint256 constant IC3x = 10338620608054523633300028769236923972604646150909918046148145911639044205352;
    uint256 constant IC3y = 14578405880659223868176989271218804395468632436261049182307685904908888406606;
    
    uint256 constant IC4x = 15176043670798042869351568698165574396040766204525527219323231211716872553411;
    uint256 constant IC4y = 17562690560599659471144656129118277333440387519672435429496455642550986163749;
    
    uint256 constant IC5x = 18240030293181722103695486883489038432184918238171831027646740695246064279711;
    uint256 constant IC5y = 9651890006938067025355366613718820208014579516279861487224026576018742040816;
    
    uint256 constant IC6x = 17755266023905060619163854796968969624363143016724573516407272887607442260435;
    uint256 constant IC6y = 9457008567013759852734300369765617512485609945803279634775551392151174954828;
    
    uint256 constant IC7x = 6065301407938884652500796217978825144908701571215035527336808279551217440880;
    uint256 constant IC7y = 3153218160940000256794957960259598353876862990903638774650048158882460266946;
    
    uint256 constant IC8x = 8434224485882653237885527074843431215333008514294075420991748953954445409456;
    uint256 constant IC8y = 18763788685855651928101795532910324754640532634919836819775588588226183456516;
    
    uint256 constant IC9x = 10104038050646265903233465664194475282399656310239462292947924625644719577642;
    uint256 constant IC9y = 7492276474410451223999548543313433233201316225722927463802078331060447860440;
    
    uint256 constant IC10x = 6348967344926424453246489799310975679364191641538587832738005823618078177561;
    uint256 constant IC10y = 19582503665918014012773130413363876768947636952442165782568258329671325769700;
    
    uint256 constant IC11x = 112509483847766909704722631824083841054674935678251883783240710879172294670;
    uint256 constant IC11y = 18645777556537840613646848174677026146912500029546992180091568767636915943386;
    
    uint256 constant IC12x = 10781786173709133765673750142749179716349806026120935828780872174481339275951;
    uint256 constant IC12y = 17028199640517021682909321429929003575675247180864471669458583118848823964167;
    
    uint256 constant IC13x = 5526465842267054372022217226501462759790138922171150468167024594191880256638;
    uint256 constant IC13y = 5113496036499600004130419762219126283205663445412629365928184063294738095308;
    
    uint256 constant IC14x = 7929888080059099930333622430682377745063332857334408507579956129267400411562;
    uint256 constant IC14y = 1484158965787740824505882562344231491773120738290540949478295980152039144825;
    
    uint256 constant IC15x = 6095259346448341071004352213259673859159932429898222644583301302870876679545;
    uint256 constant IC15y = 17850376991492594693059900924864224486633455185355371498682107269260737894563;
    
    uint256 constant IC16x = 4225994187235992772058543845025630703646552182698213065218567099230449593257;
    uint256 constant IC16y = 4713843019341506117402662238389864085603389402495608605310503535880669056560;
    
    uint256 constant IC17x = 5701388932017345909368289039527636547596051680084086401402998546008425237347;
    uint256 constant IC17y = 11941032128598136685486257923316119426064310113158761460085963979543931235888;
    
    uint256 constant IC18x = 16232884715539279706789067171129463541920121093706908260959761058868403979324;
    uint256 constant IC18y = 710794627610397527346357682515913731278418713104906942813790002196387407215;
    
    uint256 constant IC19x = 8979873419428837258883818545427439428287207821205292507357267916993487964958;
    uint256 constant IC19y = 18435265813172006741938514964278024445539779208276887434149034334780869111540;
    
    uint256 constant IC20x = 7448086736463056243889515318128894130979469540541184936895183737652723852395;
    uint256 constant IC20y = 4575835265175836951865421871588224322044042019358480105676122573504341708198;
    
    uint256 constant IC21x = 6086766376746778895043000142360475200198705090351674827593850659343241328928;
    uint256 constant IC21y = 18518615050717864016996784981098479769303929782500095159318216798693508425970;
    
    uint256 constant IC22x = 3801041343668429328581961872503076948227629429665792202775679286975540074448;
    uint256 constant IC22y = 19567147829206881153687412522908349744278582809258208523146041381064876665513;
    
    uint256 constant IC23x = 21670869656153441584030457310108732874872309069671272345627925269116260764504;
    uint256 constant IC23y = 13583733339222401445837709980329811173405842311092514617509139424810674365460;
    
    uint256 constant IC24x = 18636331976681631023403734835631569801221050639581939030290756721050752755670;
    uint256 constant IC24y = 17028470728031197037211820187967190638352866344661969363362129313089781049702;
    
    uint256 constant IC25x = 9928222080635831275297004784792466759038184719265115934847216418120400975495;
    uint256 constant IC25y = 14509133429942712286877171780523130768180998137145570427096599149115935660906;
    
    uint256 constant IC26x = 15214536184408302033280347177046056498501386247358268831314689335864919317362;
    uint256 constant IC26y = 2337738232092251954746093101916883268651351547379010290762192351008264451045;
    
    uint256 constant IC27x = 14851303541422168071797764928329560759021024189022787127689400208762010834139;
    uint256 constant IC27y = 1779415320705009501388366245942027399687420844956108289064848143116331482324;
    
    uint256 constant IC28x = 4006509728510618393700988486776939178195368740059340848663507125055178377853;
    uint256 constant IC28y = 17298700281545571907706924178035233343131748318383616180452946465748262010263;
    
    uint256 constant IC29x = 4946044421351597851078552311125282672085412271581271437589883119242972564703;
    uint256 constant IC29y = 13104394300488677548860870890627067440710859306489027312193677723672082228177;
    
    uint256 constant IC30x = 15591815191482452169074970648630302406672662734336581190002054195506725332439;
    uint256 constant IC30y = 7663738252455955150056915500951533359352742408415275368895368900537770050642;
    
    uint256 constant IC31x = 3310586591313850539304410481120799208794754530830084534734274342726506039784;
    uint256 constant IC31y = 10933873910999024812436416525635275570002000176621339124277513132714270889327;
    
    uint256 constant IC32x = 8197481936630537824906548010573661282217216269667844305492320956094787016665;
    uint256 constant IC32y = 6502039973109026113080793661796615322202467391803800401007872627146452252942;
    
 
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
