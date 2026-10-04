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
    uint256 constant deltax1 = 5331089063652308124045943677576881760730190048018486929603525167079414873254;
    uint256 constant deltax2 = 12834857686315545642684711435824735144510751919904033700188843051759836449328;
    uint256 constant deltay1 = 14953594075111910993558335440610272338388698725611859682502640384883205752306;
    uint256 constant deltay2 = 4588075624081571301781114837457059823082658697454881291268289207074697954703;

    
    uint256 constant IC0x = 18658588805366920184658715938029850925549406623160063612039316530246898810954;
    uint256 constant IC0y = 18681866065563927920599901129075314972238926769595954005228505697763714032986;
    
    uint256 constant IC1x = 8948126382620946521001396318146169002452551947358237096181102673050034422111;
    uint256 constant IC1y = 6194351622720063521552264960233290412802977853973614757015166969561590847829;
    
    uint256 constant IC2x = 7015002680552512934400675919685216123209911698323810658534280008299762000359;
    uint256 constant IC2y = 14328101677701927286892635069021571280813170051248329116333731945067756738682;
    
    uint256 constant IC3x = 10979974633623692318398877217742964152202052080506711414814706569018955674462;
    uint256 constant IC3y = 8257356270391565879397182476513437594914763735878589327712299454448849616149;
    
    uint256 constant IC4x = 3447311290446656665637767558619534982027961921054314292576907864784748240834;
    uint256 constant IC4y = 19376882585612459580151386215269816766570562211637983933639896518295198024283;
    
    uint256 constant IC5x = 1849560164366712487724577188946536254161756228860144453710579191702560497393;
    uint256 constant IC5y = 4003183017749234962815267973856967067878218156277600352618685015180057989322;
    
    uint256 constant IC6x = 20255597182632101207910453467364050288389636574512552804775212012535880199901;
    uint256 constant IC6y = 12300420615803609626620388128083384198647600389144643199507369383791139562114;
    
    uint256 constant IC7x = 20909884595998515604912777211074712343008641663906841521629875160145991572293;
    uint256 constant IC7y = 1823210285759160107500980290486284914251205055728879396534397354974736166324;
    
    uint256 constant IC8x = 11394446497831964071639179330146799375584596486017160931455494349263633674268;
    uint256 constant IC8y = 19990266628264276213803126284451839031718047984848516894241179010137837712180;
    
    uint256 constant IC9x = 15082139472361185685656029325146079159607479972363928235374828424601308129509;
    uint256 constant IC9y = 16956688217531919852283059745505231871239673427276557531226184177092829816674;
    
    uint256 constant IC10x = 21488316281249578969444703513264533626080146968896563184808721994195550484259;
    uint256 constant IC10y = 20748668787777994979464751330715280495422419800257452169737037457051353427868;
    
    uint256 constant IC11x = 11790244636034182155422576154263724017144317512336098868732180453090742501121;
    uint256 constant IC11y = 15215120422950489770151623492552721564654527524255723745087942419335138837753;
    
    uint256 constant IC12x = 18699500342888743971801549383697785301138049789200943026610678302595420441734;
    uint256 constant IC12y = 1269521466946611691736906019159529659902651269882546807630775064528855621498;
    
    uint256 constant IC13x = 15284712931542104564130923084711996307403502310521655822261343925591007102262;
    uint256 constant IC13y = 6701948796322323456422224092039053439151707050921478718261308384455736580423;
    
    uint256 constant IC14x = 16716272762860027576439438098604219278282140988461715126410308658724384473778;
    uint256 constant IC14y = 13419048283438794143760955040008214586274852620541812041050164206493806505585;
    
    uint256 constant IC15x = 2751022824245383147782736085110150645392196852124712024359448190683929687916;
    uint256 constant IC15y = 8260563941090262423627363026921205535589561321205370229791945751497796561651;
    
    uint256 constant IC16x = 14029553339254229069108419334680980543759117500314605046843581682868912106377;
    uint256 constant IC16y = 20878939624335967847111207450724827747674946262007815055134136265368399374290;
    
    uint256 constant IC17x = 11149886419958376716989664472862412129666241481738400826107954329451057103318;
    uint256 constant IC17y = 3557999311162266820984128291187084943397427889652221465161316963249928489238;
    
    uint256 constant IC18x = 2649458372511282596721097432079977970225015013124696037403784659394494286443;
    uint256 constant IC18y = 11143037183984041560157055492086934403058785982204723776836538680136581690287;
    
    uint256 constant IC19x = 20579741270366197111309906049690077359810940013106752386534956699517740769990;
    uint256 constant IC19y = 4038379932472177695855456622505537418156445048436125473101650019234640724548;
    
    uint256 constant IC20x = 17891209958685067175471873630886537254530977111906324499453395042598327976317;
    uint256 constant IC20y = 17240671510798021979912783905308135618936154041375191152640538321752001067098;
    
    uint256 constant IC21x = 19906622250149324162454004433654047802375545405699308102504070874072987095000;
    uint256 constant IC21y = 1627264017209165008084555105421808338404586618032223001475572463401847427719;
    
    uint256 constant IC22x = 16710454279324841036582435400142151924933595882252626084724367088924090218469;
    uint256 constant IC22y = 12026988478725808491057689472400002488789778825356789411459960249875188181327;
    
    uint256 constant IC23x = 21218273045057859489840313862020719334227301590795443444025339399526484862152;
    uint256 constant IC23y = 2607992519881743331594912488985361443024734171075547596438584512794041740963;
    
    uint256 constant IC24x = 14273043055262595787459589877088602557104525213811154056885049296319267962290;
    uint256 constant IC24y = 971595435394223774766072285295745867049239816574007316048803282894870888353;
    
    uint256 constant IC25x = 18736824532888199875759960986561045005417620109677563679551840544456074892859;
    uint256 constant IC25y = 193532074233651751712622902012145839642592466502117466346165879731130746432;
    
    uint256 constant IC26x = 21693725080127133111898160028219440206631957517239483106498399788664601738786;
    uint256 constant IC26y = 9736694997256138554750433512263017950394433709567785872461889386571452595327;
    
    uint256 constant IC27x = 14655278612516430717460591523104065680914119825373503741295562359793545702226;
    uint256 constant IC27y = 18603981880108945730324171816882315607230208943092348723022097779446107733770;
    
 
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
