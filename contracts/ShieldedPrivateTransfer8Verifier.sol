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

contract ShieldedPrivateTransfer8Verifier {
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
    uint256 constant deltax1 = 17841799812993197700158769630872184156491990182034544501695933849226117421335;
    uint256 constant deltax2 = 7152341086127381114245493921299031324849640446860726957349326945031052592303;
    uint256 constant deltay1 = 3802118149136356659626648326874609970963862855842763347216350304018370495398;
    uint256 constant deltay2 = 2050719696258462084475839159929050182833465970320517729507475224374598248528;

    
    uint256 constant IC0x = 14725090934557964351253630990549077711908009517571538360278233565261235477810;
    uint256 constant IC0y = 4057780477563461378365561368026102088097568322083121998151505238935704234555;
    
    uint256 constant IC1x = 8771683133554572746667545010584197700127860605304706977174027046104928599973;
    uint256 constant IC1y = 21377804704393366824543112317777800335423547660908131749022382719940859600275;
    
    uint256 constant IC2x = 21460596368963471368809785290171919264783979780207433592582333008943475599121;
    uint256 constant IC2y = 11921670979649475652367424876096770660885980825493389852097210254168824879814;
    
    uint256 constant IC3x = 11046576904763344123977579081198280098933417782563732172334469448875299920500;
    uint256 constant IC3y = 415714449345141503360218557992896022062669580860519932902938899487268589546;
    
    uint256 constant IC4x = 18211245429365681265033853839055054583133279599749796178972633158238277380725;
    uint256 constant IC4y = 19885370969579903123051477491889576781368407682558734758782309582749009081445;
    
    uint256 constant IC5x = 8541869929771843267826335929288948166899307271158845458331632122471939556165;
    uint256 constant IC5y = 99762994042546986483025254148423664650257548904475480743049022080313035746;
    
    uint256 constant IC6x = 7624646119937568819685863686758582382685274094849544009400097623969761098976;
    uint256 constant IC6y = 14644574886491319942013007250003965114891680193750462370919648635541113895643;
    
    uint256 constant IC7x = 9130742676993085887984549122053555382908247605382950856037649452306277928452;
    uint256 constant IC7y = 18427767009135279025053141939199064514376742950199552603303786415861977136830;
    
    uint256 constant IC8x = 15617543566215431723087393812862364857618762668008855272390553120328553912388;
    uint256 constant IC8y = 3469704434210177027368098696416500573493912802484886384009859078736106713135;
    
    uint256 constant IC9x = 6076426298144397965289528958001139582843701801960400900432884224119520337379;
    uint256 constant IC9y = 14272793844065952365385876250978190172306694587397092590153413002070779086886;
    
    uint256 constant IC10x = 7496768896893747463388744625103448431513408818916536051108881522722101084336;
    uint256 constant IC10y = 3961495381515600101061419889651736166240473406266122144153818934043096306612;
    
    uint256 constant IC11x = 13619234449172988117930622537805287029667737858682665100496005138594834816251;
    uint256 constant IC11y = 16629464206390207667768576972354063278540082575567071618211890315396177188924;
    
    uint256 constant IC12x = 14613764718639689273900272458439040331716204415306008402327658805022095053017;
    uint256 constant IC12y = 1278970977359446633055077228656268333237711842209115296029835641212964494813;
    
    uint256 constant IC13x = 20870907081706645905964758085105955652066523256483347004633356821418614095469;
    uint256 constant IC13y = 9034939010485079786352324451620826793963142753319428167762497929093314310730;
    
    uint256 constant IC14x = 19018792090953773634872678525950891261705952320184687186040336691923590887912;
    uint256 constant IC14y = 2089365660430162096982178657911341617207638969221744398740843384725524859563;
    
    uint256 constant IC15x = 11756219879421983708970054811899283260897282035768083229331770637020791598432;
    uint256 constant IC15y = 17732368841099068783329518745046480087405911747753149091985835510034933222163;
    
    uint256 constant IC16x = 3715719533892287060403642293073210981035486330336888261186470889535095895720;
    uint256 constant IC16y = 15438315743071206817325821454975020264720735225123179835216961886079835288476;
    
    uint256 constant IC17x = 8121537389578456526567878092673923885617746134013861521938187177365527329058;
    uint256 constant IC17y = 14550843153911969353583587583204766360362712555536438093241493715876128373488;
    
    uint256 constant IC18x = 18658637084547883331429871386780799295416446937959297671915281198855925349607;
    uint256 constant IC18y = 15807528515759674113108849649446091132059502439653603275559014368052063009970;
    
    uint256 constant IC19x = 10163089444757335059629066599417640671701343937409007776846267820386444786760;
    uint256 constant IC19y = 12412862771107066452134427758800992979575308115236344453913619135458292959256;
    
    uint256 constant IC20x = 15157589111481056227175899637324590614624469679057163929733419647348949374389;
    uint256 constant IC20y = 9308695760322927546448663880410273632860144371393183034443597046578748622016;
    
    uint256 constant IC21x = 14250187355518558879115728801092810386128564190382438993758717413653696204141;
    uint256 constant IC21y = 5552334182766420326342770409141643596027598416307563042287289174327581790916;
    
    uint256 constant IC22x = 272598071510028732476037965373806017873467546639017083577011700526393866319;
    uint256 constant IC22y = 17896082106562974528280597682049731051932062940413611330322101913250633576997;
    
    uint256 constant IC23x = 9889601998237902982388899523999429664581903419290552760407819857481091564657;
    uint256 constant IC23y = 5168077768160886492090287700152355437461007745755492341390200636082331321876;
    
    uint256 constant IC24x = 17095001154151659028046837989241097955454235499224855316286251003455300512401;
    uint256 constant IC24y = 10522302619646058478314867993612970599849386080535379023944603229273846197633;
    
    uint256 constant IC25x = 4693643428313850460932312666897466562669300855305637496266390817001782585436;
    uint256 constant IC25y = 16665455407101839132072212206772513385413074057153715421674374663883349041856;
    
    uint256 constant IC26x = 21006686885213169058867051003209666007353096444534190766876166373012462218064;
    uint256 constant IC26y = 2798862535183052180508552070811188249074182551430898626844980365411617220100;
    
    uint256 constant IC27x = 20113850413904885539108558592687954980777902746471216716556323366029846893488;
    uint256 constant IC27y = 3936607177167531841963746840433504531257873834427645032604385079666370016115;
    
    uint256 constant IC28x = 17788778565975988718326681401827376466900907163969390584436190434234287643726;
    uint256 constant IC28y = 5375637139539786154369691543290541174037177829628125155322850926549014846899;
    
    uint256 constant IC29x = 9469076934969448650947189909507335417867502109295200547059770622260289614149;
    uint256 constant IC29y = 9336314388498452710141168422962632805847172937356304834334339781372752226215;
    
    uint256 constant IC30x = 18052702011965613287151922785301456202344734163232634464956863507477988158282;
    uint256 constant IC30y = 7927030506507784614165686396292042599424285085935387578909753030408144523595;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[30] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
