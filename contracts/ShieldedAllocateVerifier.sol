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

contract ShieldedAllocateVerifier {
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
    uint256 constant deltax1 = 2498915974986888971922900026389131059430985926138014396681323555951821304374;
    uint256 constant deltax2 = 3409939580256234687840806189327577205824051213108432730887607287935898134791;
    uint256 constant deltay1 = 9671337724124754501658817529675187717101518429893286073771680992488452202631;
    uint256 constant deltay2 = 18054710883809825890819377891638140227124160488210128486024341276856340187818;

    
    uint256 constant IC0x = 19060344078745238439350537842339704640545914796338532958717010390969528468471;
    uint256 constant IC0y = 7625382188519400161537234095028488515636736402950208004361134280837866161198;
    
    uint256 constant IC1x = 17258763752263645646398753211674557102070483187866992925954782086056447384078;
    uint256 constant IC1y = 20268517523048633582648564680209669462695652487266782547002821662782702172816;
    
    uint256 constant IC2x = 17258668765978762883571898677327923078132507010486957898862948401021245852982;
    uint256 constant IC2y = 2131013929925550251576560726917747178139709537704974722308605272951602256075;
    
    uint256 constant IC3x = 9284930852451348949846306677360927772705490593147851286404643166817562575335;
    uint256 constant IC3y = 4215499989350377392354633446920991164311787432894516084676116872998069512143;
    
    uint256 constant IC4x = 9040485846115067612342822411967785945078345588578710489894489034916713519623;
    uint256 constant IC4y = 10075286209610689671743091448142887008191100709241015910421267210219328773248;
    
    uint256 constant IC5x = 7904879269700001880703126257336299229507713479841886962244304694802057376288;
    uint256 constant IC5y = 8201695561216073635499110557031149895427510336880889941357222691610524481615;
    
    uint256 constant IC6x = 17512995136831613894401800335816672431223214452532087740035388691138972057494;
    uint256 constant IC6y = 20985195941170593274997214739514213051761311279941772436948620365767884122792;
    
    uint256 constant IC7x = 21151509372697894636089699795970416672713947012463544810129802865428872355781;
    uint256 constant IC7y = 9047797284079714645851206676801261086377597367573712442252100529919224038324;
    
    uint256 constant IC8x = 14253873982948003683795556300465287658518760772150129742860489158626906182307;
    uint256 constant IC8y = 11617715164913257238556229727977054772355343124328263698793853018745050580552;
    
    uint256 constant IC9x = 14585941955927856028059706756796020091406437314177973912474744697582273717744;
    uint256 constant IC9y = 6967982932851431637131614638438905979160556912845726858681237311950667455692;
    
    uint256 constant IC10x = 20636678933812344337561652310486120671178811358065091689645561558497090340758;
    uint256 constant IC10y = 5003341201769276234206124075146493445460238861746115417057728409905051781799;
    
    uint256 constant IC11x = 2915834932378666582904528688187867329857473795178476644544187974767719977080;
    uint256 constant IC11y = 15685565117638122245294456817138455022118734106327609663749391281066215865207;
    
    uint256 constant IC12x = 4962640827568554725791235326902268410389631271789580315467494907486731209317;
    uint256 constant IC12y = 13969034569700826072059057349108699036169332196833193333672703138382755083132;
    
    uint256 constant IC13x = 4212772485450988005635329306381962292982848363624350097590036294640465569419;
    uint256 constant IC13y = 17572942790380217482407778837873672430802263773520102282460356507429568568237;
    
    uint256 constant IC14x = 9688673016586619210302993356610042588429465385715133528071593674322491547773;
    uint256 constant IC14y = 9552031572984882989876289829726263926710962215467934160095581772072114731282;
    
    uint256 constant IC15x = 20867933520301819810324750237226988399508497285986134172966296762935005894057;
    uint256 constant IC15y = 10186055785377086750265812267848914854562569445333136332031104276978466595519;
    
    uint256 constant IC16x = 10646702628917236219796453740078082553290807093006305764792778166797770175907;
    uint256 constant IC16y = 19983315205480134995700817841484766033024584802273122911862786391508091427675;
    
    uint256 constant IC17x = 5303143463462542261211813295606721072269833112967014811051002174559296245160;
    uint256 constant IC17y = 3104950972202574754166455497219930920274583659517673694703720433399664251315;
    
    uint256 constant IC18x = 5302313488577287702529743556177394248458724663742776512485680593481444879119;
    uint256 constant IC18y = 18737492672713705626422734143831930232815219109947960883795952510671728301317;
    
    uint256 constant IC19x = 17052920973162638823974460524949269727650731754498347046037205636534308150718;
    uint256 constant IC19y = 19067756226773451169862635222312934868328946622430736593588871129343225341200;
    
    uint256 constant IC20x = 3353395166935201671530831160679110812140442444692845519817121046887494401003;
    uint256 constant IC20y = 14195762085080931815387112051428242872968650637705961199801802065978249027166;
    
    uint256 constant IC21x = 7177766095066997320274484915015411608847833974520254429561260213273245751184;
    uint256 constant IC21y = 11218972387723070081843593459011327145972298513459317534975943850354958281293;
    
    uint256 constant IC22x = 20536082155590761664645576308446367096866304920706675318315853462750722520915;
    uint256 constant IC22y = 8682513142910562282378886848305851216046686958019578717925520737342048878537;
    
    uint256 constant IC23x = 18997653742007863326971562599615856149113475885034898233519710835439684796930;
    uint256 constant IC23y = 3582917682819137127820892132428136714691988122452993067955791949045900516460;
    
    uint256 constant IC24x = 444482228602446049368705436950705138753560407001363089924125285254349679305;
    uint256 constant IC24y = 12747003347954304769764695751312404728243281832257731017681246978837793126473;
    
    uint256 constant IC25x = 18324451433249505309924903919916901014633468558487970799489493807021521950717;
    uint256 constant IC25y = 16182965641761818868850050283863255037690942774711533634617343171320651260661;
    
    uint256 constant IC26x = 21225393811030837644746812285757833039197524572308534832725974188303943208401;
    uint256 constant IC26y = 20025435515274535778610977238149623195972566409029114651705366982925079907664;
    
    uint256 constant IC27x = 12046971106561925642534134351512772109029633467484944964230832624817326770924;
    uint256 constant IC27y = 10644800805568706537550483064227689965392398295019944092418700908103990070586;
    
    uint256 constant IC28x = 7761937735322549791233045129396351130752558454377264114726045010448483796900;
    uint256 constant IC28y = 14324961676965763627402720552190916766792620746390516425893187199998357230167;
    
    uint256 constant IC29x = 13633990893630864233578241877437569499950854034951855005554028499658078641330;
    uint256 constant IC29y = 10525238150343304033375268841468283256958181202705873768059161401576513194573;
    
    uint256 constant IC30x = 17361124184682316105616477745257203310197173156213366224188219035640099782778;
    uint256 constant IC30y = 3401254477881974557632955353274987812255617989264890894413191841862410272647;
    
    uint256 constant IC31x = 2982577248475253985463840375828348125463120040519662201588982962043301863826;
    uint256 constant IC31y = 3170574402425503907791242625269765059605254353053011581047632655909519227602;
    
    uint256 constant IC32x = 656333022444959248326799999410996319252767129838878126168563328401773404222;
    uint256 constant IC32y = 13357627686076185001456917856362733498089305235944670150020471024266286101718;
    
 
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
