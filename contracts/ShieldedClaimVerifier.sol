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
    uint256 constant deltax1 = 15681749956557624492535260546879279985268577988472456468523717709904992463800;
    uint256 constant deltax2 = 7903618726460247282115191797942417066407893550771092487677266752655154192562;
    uint256 constant deltay1 = 17042149100370882948052225886014012846619892146478652720930919577322397981144;
    uint256 constant deltay2 = 7955838671404780226296906271331609818596119642699731239380743507715390368669;

    
    uint256 constant IC0x = 303551468889722346240748853353764264226991872726860105426065063913537645635;
    uint256 constant IC0y = 1331726101454459191441977038602561276422006223962504320012584157738125425624;
    
    uint256 constant IC1x = 3775481129588532544015351595840393734244799823917330107288777298760699798785;
    uint256 constant IC1y = 10159847732914208639144561491757953593782766917540050256040340958897273831995;
    
    uint256 constant IC2x = 14023532122425475378268497672169656872209341655536385598016964620280668681608;
    uint256 constant IC2y = 20201013753413428913197427044788148399328716803093308499209823147531069403263;
    
    uint256 constant IC3x = 5167950270248467119261978478452059755780092267779054729740576905365209327317;
    uint256 constant IC3y = 20790560775723896317855543423514712249716393375156273639884411348382541058846;
    
    uint256 constant IC4x = 5107684687715595864512228217364746068921262049624754628657365493862829409465;
    uint256 constant IC4y = 2397832685756436250285406020440339919872873069221740406248004021203298312957;
    
    uint256 constant IC5x = 2608200059227500173884788723352317532245668223430724755832864981504122501266;
    uint256 constant IC5y = 17549751507308854361264554529579491311351699187985082832274516537224272627364;
    
    uint256 constant IC6x = 6001520023271751508730382568485094237829888280987823450428604152426045773397;
    uint256 constant IC6y = 14903042750665518086404020270556168671373066608093708677053148678721506202079;
    
    uint256 constant IC7x = 14151045329351507836993498375413744851933966630545442825480561607208659391663;
    uint256 constant IC7y = 20928792388534660427134065706550367952031447845959641523455458300528826267843;
    
    uint256 constant IC8x = 17983690915423585545401198110939365892193066439443185033206272932986701445290;
    uint256 constant IC8y = 9467006742392598783920058252841772286966180575848989898355481792846315669173;
    
    uint256 constant IC9x = 21558249123059554560529601847107981049203058429220172132903820293338592370486;
    uint256 constant IC9y = 7414562689133405079890396978040322160650055222984942502404363260856536751770;
    
    uint256 constant IC10x = 16219915100149406489241394057460938770700156598854905767476498366705407554024;
    uint256 constant IC10y = 20179937969903340607725395138759119841999597631898217330932056250694632727445;
    
    uint256 constant IC11x = 21645537411913898629897070210179731629230749709755583871078759694317002913848;
    uint256 constant IC11y = 8954450119646371844943918387914584180130674955721575531910389728648100980124;
    
    uint256 constant IC12x = 19004106888778363861404732393755981730434326310890871478743279430843590937655;
    uint256 constant IC12y = 8613418029095300622456605831996847426215674150703321486701747529474408294775;
    
    uint256 constant IC13x = 12713605558053451278634772794745667647371602364475109580534715301563817683824;
    uint256 constant IC13y = 15804048157578857018539439340578405662484123185745116333653483466322731424235;
    
    uint256 constant IC14x = 9572312131127308872455689219683889073416989321969719436410184005224470608532;
    uint256 constant IC14y = 15365877992599282658365528220843763953356258536557960009444410328489993778631;
    
    uint256 constant IC15x = 12194870036620687517914809707900595056353685832758596709962061872248900882285;
    uint256 constant IC15y = 21206593461041164286594346483654980536527021067308946617895058458432134119398;
    
    uint256 constant IC16x = 17930996976888002746326368746740226136513356454296900814562009582573467660634;
    uint256 constant IC16y = 11369344325779436210455982357451567602669068674308782544345619230207335054842;
    
    uint256 constant IC17x = 5096453242013585662471323120653191847589254973675005098202765170014192550118;
    uint256 constant IC17y = 1761795608144067471365843290667460206464271831689069398089726410056160829723;
    
    uint256 constant IC18x = 11275391614994787544260893122785984639854261909597730401273317083040429624175;
    uint256 constant IC18y = 6638720836390811113956436885627991137932405746634479570705850152603612833824;
    
    uint256 constant IC19x = 17295269318161019766350890981399268294952537370317241994758500148034446880371;
    uint256 constant IC19y = 13928907227939753465448345894566310471483672482667532306834991823781108428494;
    
    uint256 constant IC20x = 8434763198155069499968177677501912184211410766331246334164796688575960889075;
    uint256 constant IC20y = 9936431810074978879226024547802915633085748463364686978631416471819315444777;
    
    uint256 constant IC21x = 20574765949027556825637809689856838046494271712202955986957731610490764113555;
    uint256 constant IC21y = 11441100076943607322586026552485575624673334633145334736334451736583428622410;
    
    uint256 constant IC22x = 866970778339586557693770516762110113188660207971624009170044297170179532726;
    uint256 constant IC22y = 20493973530253337429159227714118505344883849273888328519794901767087412964764;
    
    uint256 constant IC23x = 804786406655020077601822327527820670049234424598535054552374106115545252480;
    uint256 constant IC23y = 2638854838083261724750612059962801042899121332001583616729878031949530455456;
    
    uint256 constant IC24x = 17742576065865831866426150184894880856352600337450217447449353365197403684809;
    uint256 constant IC24y = 21189208070653222704316100111198507359086260708590291406923999584487807475707;
    
    uint256 constant IC25x = 9000654618639813673772954938053179506581362678397904894472793545350272554978;
    uint256 constant IC25y = 1459901299717844035659364693005627007170800094666124271349127696004273675849;
    
    uint256 constant IC26x = 19161791395270112235879855242278161505498251976183442939661968157846354221107;
    uint256 constant IC26y = 11464863903972035778376942825306008520513728875801920289992841411504996262150;
    
    uint256 constant IC27x = 19478004253016041025426335533294283650854453118433130213424439586433874136770;
    uint256 constant IC27y = 9340155511364605988682102967838074920713132893594172913274982356266368451097;
    
 
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
