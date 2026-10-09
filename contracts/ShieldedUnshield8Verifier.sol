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

contract ShieldedUnshield8Verifier {
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
    uint256 constant deltax1 = 11628548330067384544876206298235941206571650109166029100468798206287340033141;
    uint256 constant deltax2 = 12008710224955619410823232618538869919623193936384549346961018447092344741399;
    uint256 constant deltay1 = 1705353086054047194883342201849657814892790547867905045271721583560373743337;
    uint256 constant deltay2 = 13381269420769131902827908161495445796155981316379771373424832715295757566892;

    
    uint256 constant IC0x = 9618315122396786206791282025091517834748973816737241609566898210421942085848;
    uint256 constant IC0y = 21706791679409276251405153925619149234183974701893372916871010239548628491064;
    
    uint256 constant IC1x = 4438565033670630866170651401174511944078616020349544466088604667942146834462;
    uint256 constant IC1y = 3621007460536835810500658462706611958367496833599151902352807387767078855066;
    
    uint256 constant IC2x = 8111957991240847889070220701434075338769555972256245901420527616466758738769;
    uint256 constant IC2y = 18470350689909030038980539927771454722712731417437918142194622609466061418786;
    
    uint256 constant IC3x = 20312951387560639222349100040291076795513610978316102897713879675234051943337;
    uint256 constant IC3y = 16767500912519303053104570284581312229406754866539004368745180360559432000308;
    
    uint256 constant IC4x = 12156771797342049460521791848232766447208186610681933949692232579623669320936;
    uint256 constant IC4y = 13706538386260669316334162783936351449129637704838577488760668825230630339146;
    
    uint256 constant IC5x = 2054586383501974715590140654431446781922676553728801164034275148796055731977;
    uint256 constant IC5y = 11831746757926049722194964957632062778653338788487231169617079581821435397354;
    
    uint256 constant IC6x = 21736929867523422683847858265598317430985679396984284025067437662560611057046;
    uint256 constant IC6y = 21597912860001378987830118427890988407296829772445362170301789476598817756569;
    
    uint256 constant IC7x = 7373508020177177514473006397063318092827031640138951491540550871714610163734;
    uint256 constant IC7y = 2233843288487032511598070631548819806499168118751205599906281481992486430818;
    
    uint256 constant IC8x = 6210674744367365610406828121954858400213702943613082024907824710249206491239;
    uint256 constant IC8y = 16508802246893890047801342523498154514220474399273505657825201366481871292079;
    
    uint256 constant IC9x = 5970801133493259203751993166657517976035696817973781303926640463095767447414;
    uint256 constant IC9y = 6089631277667694990267600133069755357160474885627879808485260012623584947770;
    
    uint256 constant IC10x = 939471540805521891840674829899075102401229548495218360660711277767780182172;
    uint256 constant IC10y = 10449172700627758289638330377618461994352357439952589850924008650030716476929;
    
    uint256 constant IC11x = 13133297681551199725769406493816773986586043457826762110390585142753522303970;
    uint256 constant IC11y = 9914190911300399716473823213731421330408961225510379390835079082300227642973;
    
    uint256 constant IC12x = 12083420441840806652429732394126759927229977642918820191288113905739633453808;
    uint256 constant IC12y = 19267607384641519457963755822649959437133596203360509752238766321109067436452;
    
    uint256 constant IC13x = 18279714956543540448858284188182894223805118375498985555686651052768452732189;
    uint256 constant IC13y = 13457663304033189412436897166149860391657493793773862697165817491628334849138;
    
    uint256 constant IC14x = 19214249231096785143940097316940312990386136347007429564923239410401108436425;
    uint256 constant IC14y = 14123179309038238142885063683674157144384544729439198809921549638550044805762;
    
    uint256 constant IC15x = 17407223793567421405522198743638260797574311168555202068108008815148627288758;
    uint256 constant IC15y = 11720829245474138003567959792942640727973572849424659488652710282606087238950;
    
    uint256 constant IC16x = 1517110710655473677745316138424749959334381292821303656185169861292184381235;
    uint256 constant IC16y = 18436325578946481616377417139710875330377044891642445311514344434403350613077;
    
    uint256 constant IC17x = 10542214548789701168402549625679011252456809179545320291086346634459634082294;
    uint256 constant IC17y = 18407374496267851144322306593384146021590284146438730309517393236329072617221;
    
    uint256 constant IC18x = 14722893829116623570706387415248352822329045915958914299851414106359071750096;
    uint256 constant IC18y = 6966482375596129024160831812488427284323723205942911201145963005213554973099;
    
    uint256 constant IC19x = 11271970264158532857449182386586054545054169985938857693224443770226206188959;
    uint256 constant IC19y = 6835364900030385575444350078779066955052748566069029131047091378387978030788;
    
    uint256 constant IC20x = 5789620664453240850353366708226257809736150583883814593824918723534727824516;
    uint256 constant IC20y = 545143053762290823734635381441376984497714213436010349931897267985531148236;
    
    uint256 constant IC21x = 3060901211950445050469182491443184450217171856793265668867893977754556787130;
    uint256 constant IC21y = 2166398558952341095702328389283088940951079653980132439820055577921241589230;
    
    uint256 constant IC22x = 18990226730393487647502006922477450411387811091975926552343040355097163947413;
    uint256 constant IC22y = 3704831608214292094391559375922621365402680980074022360973781479378461240202;
    
    uint256 constant IC23x = 20374280708729798808424692938106902637502627088643334276909149217525784625010;
    uint256 constant IC23y = 9305647623379832566398274577450496124993734714461327637134617690913775592310;
    
    uint256 constant IC24x = 6271213536980930037203523558091056596705293834174920702534752495723953590162;
    uint256 constant IC24y = 21518408722078350128641988815529566151622391382945783381851293865339085086731;
    
    uint256 constant IC25x = 7307345830403809992443127590234472895859098158378475572956697590129489257869;
    uint256 constant IC25y = 4787644873531100300657597107549729269520830376546190824694642021093881650161;
    
    uint256 constant IC26x = 10317170658902767464302137983789528021919730847415742791852956212298082465175;
    uint256 constant IC26y = 2672013703097080071739087962801792762766657877062104253908382866048021112224;
    
    uint256 constant IC27x = 11462103180092538444708835054579739938965819599891317246366733976900302341691;
    uint256 constant IC27y = 7211365989638749258372520664723637534418236822417231306828038721797273113579;
    
    uint256 constant IC28x = 18391163270819512327169783648041023985559184474285981813039740344741361061792;
    uint256 constant IC28y = 17871108247565376655797105565051653360078341167808367775223191558846816489940;
    
    uint256 constant IC29x = 21437218256555644249408564982645020934419227005766113327949335580461548920436;
    uint256 constant IC29y = 8817699973146586767770801659178230558652702900535492791339387930458052683041;
    
    uint256 constant IC30x = 2554055678971699983659838240424302190386583539792509048129629338425895097084;
    uint256 constant IC30y = 21201715873811812139733944665088290605078614793481404190678023458296297813103;
    
    uint256 constant IC31x = 11531277902452998746587724639263769913548263135244351678752568155421252025200;
    uint256 constant IC31y = 13924085503552699466118645344578572497037545782965795399220817033376240467003;
    
    uint256 constant IC32x = 6442282622951002685723925976339196190636972265960120129403016987435757664263;
    uint256 constant IC32y = 9034574736316624296316120843582148780678380690731140217229890282453356942728;
    
 
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
