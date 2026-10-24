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

contract ShieldedFundContinuationVerifier {
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
    uint256 constant deltax1 = 5849049739564689194029133682559834626144121185732064758710908522656035247478;
    uint256 constant deltax2 = 5152222740296778168827716678363295184023292095500398696625068897363576060636;
    uint256 constant deltay1 = 635269545334260417130462154741185915092010111428897189273314060039674863541;
    uint256 constant deltay2 = 9973618078124723395512163914451207480641591632348564111724668662322449360036;

    
    uint256 constant IC0x = 9928413023398865460303279768170128638441918934487699956311936232100612704743;
    uint256 constant IC0y = 4773283116748833157272862020438277643191483977428645706135863230936244687451;
    
    uint256 constant IC1x = 18583051853785656687453514774817785958126942829255705311341204393500544112962;
    uint256 constant IC1y = 873860204811163581735429033091570737194415342677450340937587952669941700928;
    
    uint256 constant IC2x = 9581239883467215569357338585040698876213044475739705771417822266417572140280;
    uint256 constant IC2y = 14651979423421769358474553336824960830874174513741497969883065451245306369778;
    
    uint256 constant IC3x = 14606809416845172000752972866462227003578627767365647405185907941358568814850;
    uint256 constant IC3y = 17977736340186152881034710063535776272345648519165049778504827688724845909412;
    
    uint256 constant IC4x = 13158434497960234725599734568735620661928197349132977576995009436544796518946;
    uint256 constant IC4y = 11452561263974913126902501741045969802812614176210592187331123315728337981465;
    
    uint256 constant IC5x = 15614923085212410680841783350643472916973980241782456454013458664783366965389;
    uint256 constant IC5y = 13144909877053774030258833457148435241972305066516378015903352170434720571701;
    
    uint256 constant IC6x = 12653083190772547588764381106826761569210603765972792750826986327872272563292;
    uint256 constant IC6y = 18774353827567740874787249556359606925545199112326134836573539040732035879113;
    
    uint256 constant IC7x = 13774273820065821105878843576909797737815907709658527566305966164715893417927;
    uint256 constant IC7y = 21688926975811677382364853272808674108015518106452114511081469366788013620229;
    
    uint256 constant IC8x = 20230983141862592847926584780235721050116364804714853569523819036695279560853;
    uint256 constant IC8y = 5516010967481218252003099023941344390312207990979570641162559691235108579025;
    
    uint256 constant IC9x = 4973628910653501909973906358695509652297426063657115239325020111848635066656;
    uint256 constant IC9y = 19637912684328186998710620601536588996201374389640865774034959196376852406957;
    
    uint256 constant IC10x = 5116648967208062902461623913822245817110376753415574063915460947067904904665;
    uint256 constant IC10y = 6536602356969223980651740216453331519719326370080088249834918325037872933883;
    
    uint256 constant IC11x = 7963203347682239976103417734665625499661762679897754354263044165094042572672;
    uint256 constant IC11y = 10180819902763482397265565162139238917491320177726899708838451925950711649438;
    
    uint256 constant IC12x = 9790537021281415090662977018659643907524547645011603041318897299356254208089;
    uint256 constant IC12y = 18166474107799179450996053057698245306714411351358760938978062702907612486234;
    
    uint256 constant IC13x = 15350565431306833359103934407388458332135745225535750472857065158000187785514;
    uint256 constant IC13y = 11884363956083160349222648411652891087315041499718094451776290315019189352924;
    
    uint256 constant IC14x = 15208507572828308442198924986245673060756122908922150005926970001237239777252;
    uint256 constant IC14y = 16249392701365039034146966258484398097239183719209175508526699701973072527069;
    
    uint256 constant IC15x = 18644012904430827191339177324610218806963255491970288540862655593499442274494;
    uint256 constant IC15y = 12226645210807643045879904447797738570854653282739378244198366503922197109192;
    
    uint256 constant IC16x = 18170140409811696757158604617882533409105186939125954243666944165470710467494;
    uint256 constant IC16y = 13674705797297552370620563472489061329409740012616129622366788722442009413652;
    
    uint256 constant IC17x = 19342627020112391364447174046355151539486307052820888247356068018551760868829;
    uint256 constant IC17y = 21472241090114937483019310363830957060126025719627112934217408937459780223458;
    
    uint256 constant IC18x = 237432220247794800349396005962534538384918437303267407585119906765139418687;
    uint256 constant IC18y = 16133051356980611828212094643067421680104724248201498569021358157671853699465;
    
    uint256 constant IC19x = 12978334638370193487335948307506628435654982504438383602366720456672059325809;
    uint256 constant IC19y = 11020350168265775065433477804591563914617780094425195920644593139165433080492;
    
    uint256 constant IC20x = 15436855523832201664829074718760681499163168355698127662558778301966222750971;
    uint256 constant IC20y = 17275070602773035916883088629386296105814173337081789989978800588901226546006;
    
    uint256 constant IC21x = 7147342129611187111047334376121432050957964551603675863656764131358262046152;
    uint256 constant IC21y = 12878448513427780713495172240674154308200729531824377693628590599834601806647;
    
    uint256 constant IC22x = 10247355781471854581946778143762411172651923097845094530526280591165786495101;
    uint256 constant IC22y = 3900765721277351545795848437884058183449386000690997810603224361742337081251;
    
    uint256 constant IC23x = 9375569828158582700950991388799136178049020320802830585654937728602973206296;
    uint256 constant IC23y = 21877532037451932664430954913946395962633820524288395169973624158040320660433;
    
    uint256 constant IC24x = 9975936137753722024690451669460526276015822049462268266044844656530394955265;
    uint256 constant IC24y = 7059541368305223342262614445173419910609307269697899491344823232159220480512;
    
    uint256 constant IC25x = 10586872215674228819499614373892160184345116853494795880306773336872922355354;
    uint256 constant IC25y = 14403328700391425798359516869527810715003973156587579452880808457103927472339;
    
    uint256 constant IC26x = 18842017383395770486673043282741720381403510088183002619239917879535876337697;
    uint256 constant IC26y = 16789008824023332914137476173797498670829839476146226335653651961107275458770;
    
    uint256 constant IC27x = 5203147163274878961961041350737461428346100159527711834159167731549037661141;
    uint256 constant IC27y = 15535243108468643533889586615171720846904998686599608197683721779849810809847;
    
    uint256 constant IC28x = 15376208473608623193916810799314126507341574447642659522182701435688839144782;
    uint256 constant IC28y = 21198241797571317266768640284912271368496477574615331384062805295600029574424;
    
    uint256 constant IC29x = 12945449674382411183435269527366268560375590642738121841195442509963459734070;
    uint256 constant IC29y = 8389531806144564080074973975388765409846416936045969608831247441466521188329;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[29] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
