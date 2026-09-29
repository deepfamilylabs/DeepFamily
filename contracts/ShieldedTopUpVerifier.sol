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

contract ShieldedTopUpVerifier {
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
    uint256 constant deltax1 = 20587252206740442312949534629711673991359798668759253125018793721082110831457;
    uint256 constant deltax2 = 4792893814177464172184890666094921634060733019188826618435125314278717288680;
    uint256 constant deltay1 = 15303956912603938537680528029524511866935997308652127815182597482848838023791;
    uint256 constant deltay2 = 4351468774783024325537131991028007754183944517516032486317358764563148622744;

    
    uint256 constant IC0x = 14944684735722918760825656856343096272373758617110349321840723886879128583342;
    uint256 constant IC0y = 8127330502492953149403211406762059287429146829979794360762385780515794832828;
    
    uint256 constant IC1x = 6896506263703666267207247151875487738910900289241061186499037947127968287343;
    uint256 constant IC1y = 12395443681488449855870221491935083268738049592484453680112150927259940376307;
    
    uint256 constant IC2x = 11000901928834513595458821159765790857652850262875895724472839297212187548815;
    uint256 constant IC2y = 13669492237260883970218654681021889455630108948827305287030799056273105457477;
    
    uint256 constant IC3x = 15940871907083867247686247457470261381584053723062966296534123643535724004171;
    uint256 constant IC3y = 19949915297762101709827512538237109266150460002529670532405600661581051229753;
    
    uint256 constant IC4x = 12894075335088430602207585481176995858597126373587969471122277405007213295281;
    uint256 constant IC4y = 7414493234800322279680435832651090297128422508599697079899240630557711532732;
    
    uint256 constant IC5x = 17736126832450936292533369787318692485766040173917938176002267574881842210836;
    uint256 constant IC5y = 10165877121753595299019923873863110027104626765191941431324289724885058800169;
    
    uint256 constant IC6x = 5339756260318374316157762676406847570620527420899224025086549325018098119900;
    uint256 constant IC6y = 2690364877651834338959393226369214438950189660177930937429031328031191691860;
    
    uint256 constant IC7x = 21099141808926342179837176327171335793898214955434455061174373745708413077083;
    uint256 constant IC7y = 1767546502699296328004179623719737722776934340090561628213937978864157578153;
    
    uint256 constant IC8x = 18899234640490915079398367812991702078433102997817893821751064944840042616892;
    uint256 constant IC8y = 9723507760979397458040580689932822442979633491870691402021910198253938172291;
    
    uint256 constant IC9x = 21192026466197239978980824673007327559777028354639678297441304709122579337627;
    uint256 constant IC9y = 9687214868149237001491660554495718920005160959651345844411107478775417592896;
    
    uint256 constant IC10x = 18148702889358329046466260363815892900522840591475303463763369104170515072060;
    uint256 constant IC10y = 17120318066384127249084204958968714127991397356363898707028916244354500920384;
    
    uint256 constant IC11x = 14576496528932298921323750112854449342472674506836628375343358589937209336223;
    uint256 constant IC11y = 15831949008108242095783960813730624932285452566989835687193120052638871912087;
    
    uint256 constant IC12x = 14875371560651990373965279747824308875851850306878919952719381013192897999701;
    uint256 constant IC12y = 8604733684592913243142521793958489032477592032574915180659140293723625343764;
    
    uint256 constant IC13x = 2207564804576505254254354822734607988347034342245565952219521096925606198564;
    uint256 constant IC13y = 17324102812651819020139335159182531525893988520645300546932262937535746339492;
    
    uint256 constant IC14x = 4784594942703226753179260955409909924107487612623859671031479704459560105012;
    uint256 constant IC14y = 17122983092505230473713753449515650653915991014872705033390835524542518488187;
    
    uint256 constant IC15x = 6170799803125342089727903527561572298028509692298352240441069556792952302586;
    uint256 constant IC15y = 12696901201456029127696821118054548900406905030324297766688864114554755953306;
    
    uint256 constant IC16x = 3782300642954476343122597571144469745149556810527599729095447693905677917826;
    uint256 constant IC16y = 11073491496572319744205741472772873111452697623170022509477964333715023158486;
    
    uint256 constant IC17x = 9742882246364651360269778496017232002043867654887772152364010602231857895093;
    uint256 constant IC17y = 2566427008892819442858945080393038114143851855513044582873964415274997004844;
    
    uint256 constant IC18x = 3866537477852115828754281921821123153176117640026499321633961338432615125064;
    uint256 constant IC18y = 16688740941355536786434442221511183661900880766773930686638662603173167885253;
    
    uint256 constant IC19x = 7149654587964357492461436572531953411500493392284212860856418502280225137169;
    uint256 constant IC19y = 1109758458240200550221325551568111697889923756044864100569851543808019784027;
    
    uint256 constant IC20x = 1618921946520152873304213435213866983102121622360558125569177693122152559159;
    uint256 constant IC20y = 18397524290164283090441266009289501050523353202296714972750436823414859295412;
    
    uint256 constant IC21x = 17133184592640897601696892520625652538923680039121248811406909885425043446843;
    uint256 constant IC21y = 10121812361321443419617432079484104974639168212020571697466980007381397736042;
    
    uint256 constant IC22x = 2629666617629208165185974402865129541163595345354008017902317417875325147388;
    uint256 constant IC22y = 13545036583111818445148615368571647694692313955202014062100607001656881179939;
    
    uint256 constant IC23x = 21440282668325006604584037374979563845992640999360410557361766932034844058334;
    uint256 constant IC23y = 16490502478730688097060322798248350915872953347780634429678227658764859014308;
    
    uint256 constant IC24x = 19391164976937235009404989764349460431461597759000598090714073559520117172981;
    uint256 constant IC24y = 13948396789618328447967668257254955447736612149839315078504698554613216792412;
    
    uint256 constant IC25x = 10576810518712770472661814212476269144341068243577462902405534517491236676002;
    uint256 constant IC25y = 5301311587952375557037093152058758955195568087554892465037623646036144524906;
    
    uint256 constant IC26x = 3596021669368220935976164254213918119290681289175110694630350103849655648095;
    uint256 constant IC26y = 4172550243160873565416613983480990359390467835384257357616619451913878496031;
    
    uint256 constant IC27x = 9263753227273148303555489866861487094365249426109495269651396816468999530524;
    uint256 constant IC27y = 12905874869429540866087511217343577629696758982249014589114287948116859773535;
    
    uint256 constant IC28x = 19470570793631074956038665062598130636429170520087721081905052533967600389762;
    uint256 constant IC28y = 10163018580481658438811424129863838203658327266909674171979038022502527934386;
    
    uint256 constant IC29x = 9097170170932613033600499433543012979513799179204821226924077607157830051658;
    uint256 constant IC29y = 13313460438506274459002072669572054155890145546598023712037965643376175126978;
    
    uint256 constant IC30x = 9555097274191639472437674036749295623230574633393265849992010065061440263847;
    uint256 constant IC30y = 8470303682053477884606202080471686830439943922430422984155922989623026260035;
    
    uint256 constant IC31x = 20207979532522361891282808777999671706388553809106488126773281372563788308511;
    uint256 constant IC31y = 14592099036993058313119190937123572289883825687780671374708293748490644484963;
    
    uint256 constant IC32x = 673262415428114996161260375346416156932011171976430279485079631558738117609;
    uint256 constant IC32y = 14409577003222470331295823430099129952207984226396328923517832126210281896845;
    
 
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
