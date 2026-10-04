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
    uint256 constant deltax1 = 21777434281188516990601989816258874001722913095651423428582882418095802062449;
    uint256 constant deltax2 = 15301884803567886197300222564967312347197175930311775277314884436977132494379;
    uint256 constant deltay1 = 6817596064641095236400976622252817051894066655049978179979390953135265787616;
    uint256 constant deltay2 = 4227538594710686106860977214364528336105222988320146530402446733296620965789;

    
    uint256 constant IC0x = 21273445895543734367998235349004778965824611573256721514014091040966662742789;
    uint256 constant IC0y = 16028106953347464470763407226238422178280371672285951912465887983894756281691;
    
    uint256 constant IC1x = 7730370345060182460078696404784214772714235644785989453971864084578313352742;
    uint256 constant IC1y = 18035352149335945692650281304061687292823809221782466302140411285699206109468;
    
    uint256 constant IC2x = 877843853051173568209052624873588735027635342810470548237670266245801304255;
    uint256 constant IC2y = 3544270791949683903934818381395457035262430072167470843275715862552358684046;
    
    uint256 constant IC3x = 12686755827143224440351369849993800077081930998953501066324585074750705875468;
    uint256 constant IC3y = 9618364935929368791074604465014652456048748432301210177937741273301656038496;
    
    uint256 constant IC4x = 9770873989873579660223586898809894918388813733039364605340917780081602367029;
    uint256 constant IC4y = 3091814924200729042228766712149455079580988921920537567803590798220133292636;
    
    uint256 constant IC5x = 2014004924921866534074528963899213100153341434791813675718016734150496259888;
    uint256 constant IC5y = 5601449609158036631201336927805363026629725254893249869481409073432074706069;
    
    uint256 constant IC6x = 7442297407136938745623390677441406704886755362100492230890099098385805151111;
    uint256 constant IC6y = 4148290362158547394295096983472611884515378101377715850509084805039962494086;
    
    uint256 constant IC7x = 9006345274386363586278469146839892499254941041052473990225612432693889578766;
    uint256 constant IC7y = 906654277471561138577573319729922725466477994362247057573122202388594295600;
    
    uint256 constant IC8x = 16140421184137878828386262097205879158388264342295144564393227780280542116933;
    uint256 constant IC8y = 858333442559279459189137409074858380018461972438396001729334683405491645587;
    
    uint256 constant IC9x = 12954503384406260535640463976657314356423754666655070840549776565310768277984;
    uint256 constant IC9y = 18142421558726416948710786133662591576104941882642725975960064607567532729080;
    
    uint256 constant IC10x = 6737533078188099489170934984501530279034356795892190818522099598055161337690;
    uint256 constant IC10y = 2580439798101890919899609134185840672427315173066391596621545054802875560802;
    
    uint256 constant IC11x = 11771404949425800360777573515211347515929189117237881945075762575821475490924;
    uint256 constant IC11y = 16657774583293338555342242694469147908570102009772865207544097534105189566081;
    
    uint256 constant IC12x = 11826422812323802233167545397742036842319990118293335114292142022425805997415;
    uint256 constant IC12y = 16934337339896144470222936576926628878114591181962957046822511947611173328363;
    
    uint256 constant IC13x = 18911753041726334048627157974190673171417984954458404154547273491543055381048;
    uint256 constant IC13y = 15114516222206917913569317885165133633838522068270955541257006768871135677912;
    
    uint256 constant IC14x = 4366238622612624235141367160613905365844320309835584020499776267364531982933;
    uint256 constant IC14y = 8469974339263136345756781087307563257974973503278050016381015003730448530371;
    
    uint256 constant IC15x = 11412280147986491940843895711148472039027655949796720679049052210607113471923;
    uint256 constant IC15y = 15701859267341907580654172432400560416837660334013880783012585767674152398827;
    
    uint256 constant IC16x = 1910216272441795326926297160785199923234989034846800723978331077434598977648;
    uint256 constant IC16y = 18505667456908186805615811763502274699252296565902922534860349421935319129927;
    
    uint256 constant IC17x = 18835219720828910980124237111128168789760615422068874221052319719348083274350;
    uint256 constant IC17y = 1039608077616635541008235529519705669110108901573248374970011261895869215231;
    
    uint256 constant IC18x = 10423992689603484897259082446015708101400250609791660434304820299170270637488;
    uint256 constant IC18y = 4042009525683008956326525374118266110971870785228210231175513221424858167175;
    
    uint256 constant IC19x = 2192863905561845399381481366664019010834912656218130471807345289131304087546;
    uint256 constant IC19y = 6104618621902390357502907970984043944198984226542806972900385863819430443089;
    
    uint256 constant IC20x = 1035652482306173047501812654142508929742872697267380103345711357643213966898;
    uint256 constant IC20y = 348940952519202808807433549955528403242504499662809451226990889786937876658;
    
    uint256 constant IC21x = 19949796876302673356637497992037679949848179815964045736107398609412537738691;
    uint256 constant IC21y = 21072316451066467025722796757862332427029231146939908685069059590206769474070;
    
    uint256 constant IC22x = 6305986877707849429141693300114207183625988117622887312308931719239544739965;
    uint256 constant IC22y = 15150932308514608246481554258177368082283269214170786704380951557179923447644;
    
    uint256 constant IC23x = 18133485364707694250213060682853745699643359947358318046042173769830910199923;
    uint256 constant IC23y = 6588073337875678754388553893222453932126322713616825462399443764696328705922;
    
    uint256 constant IC24x = 5432310086674236276662082826969303279944630044240309559046882998497847480439;
    uint256 constant IC24y = 15844709554650519717944670275362703348072238951628587372501341038859706389411;
    
    uint256 constant IC25x = 14309017735809691510507393818112113899124047371467032141562477464573969828844;
    uint256 constant IC25y = 10078831716608277627319639053428286024375469382614023628922057307078532509089;
    
    uint256 constant IC26x = 20012934536729427423880095628917065490869022016763053951026906035763596793606;
    uint256 constant IC26y = 15777671233205828057036796106044763234119954714654976686624604879457771506918;
    
    uint256 constant IC27x = 10448055645063041407386161192280501528174820333977603925199620754391712797593;
    uint256 constant IC27y = 15632800702461288028469482881416054998330204955221084651733731832638091191483;
    
 
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
