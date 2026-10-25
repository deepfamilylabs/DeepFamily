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

// DEVELOPMENT ONLY: generated from an isolated local setup; not production keys.
pragma solidity ^0.8.24;

contract BudgetClaimVerifier {
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
    uint256 constant deltax1 = 15013901200999331305765650947328257459061478137650909581664753333198793545496;
    uint256 constant deltax2 = 442145515740787712772135290977400147834418724306343542592390688979532900777;
    uint256 constant deltay1 = 17649782694414917566025158067572319093301838994694323700463849962725960382338;
    uint256 constant deltay2 = 21081051232530435184684015358736577588017732229597738102507255868706473383497;

    
    uint256 constant IC0x = 4923541760728366626863322556213980315917788641999436621771737921218818674863;
    uint256 constant IC0y = 14183411207780774040831575034057188660947740317132892102093999321789617701674;
    
    uint256 constant IC1x = 7424702403613727269442215279469393225297088344236801087487950541193252724647;
    uint256 constant IC1y = 7328095048631476582192407737277149015997264550149033447192941201150338594480;
    
    uint256 constant IC2x = 10329998843433181289939609092432156124846956135704558642926840600875520887207;
    uint256 constant IC2y = 3646048588440733112242409552152587660507758869180695044338321065857168801506;
    
    uint256 constant IC3x = 8756649588812670338595647933967693741174498716784148909396751171092486229491;
    uint256 constant IC3y = 3181768104134229265283181675342086089871121104269671588514191655631153259852;
    
    uint256 constant IC4x = 2158711094955195320464188520069890976253793854329657115365205357140429553067;
    uint256 constant IC4y = 8270985174427185286315487641517453119075995540501555357060419430444538670340;
    
    uint256 constant IC5x = 3983923481642699510386415921893681553858455666394482692780909649809102508800;
    uint256 constant IC5y = 882288693754166083982264477549749845432839301492486326167559669150763249800;
    
    uint256 constant IC6x = 2823627605927867477780501729504441947835626605530976171563817051315753271602;
    uint256 constant IC6y = 10461466077059488445464008644702414809629882226401833266966593300898238861505;
    
    uint256 constant IC7x = 18843563272075328742965507340428394550676585340209460473568221134567852942982;
    uint256 constant IC7y = 2338082498075444197503856910839376900134527987150288252860908488309994209464;
    
    uint256 constant IC8x = 21510517788055140850210773041674259279724917620676585439826219961050342194062;
    uint256 constant IC8y = 15203635141520386839853497320359832232048378382413356588925019986652965413203;
    
    uint256 constant IC9x = 16215825496184155058215226772093648572637570732797103856127131937571221569155;
    uint256 constant IC9y = 4575705680193692337515820747116673232367657046285205658125191071837512967773;
    
    uint256 constant IC10x = 6734785327679547821549356425105210506517913930628825465224662559863741688144;
    uint256 constant IC10y = 8841686058349662962450634960573520669930345876557115848735119016415103541017;
    
    uint256 constant IC11x = 17975478282501128681653074299198388514944037248802758886053819434692131080047;
    uint256 constant IC11y = 21732469186116449826511576874092304555688366488080514993100160437339181973353;
    
    uint256 constant IC12x = 19730761958639550847722509458538910001890332660680201123827153681077166250255;
    uint256 constant IC12y = 15144226638255303001487993935281262349959979886232434771455388662853639913503;
    
    uint256 constant IC13x = 9378938256022433727971089280442081565083910610979519409616771060148942504691;
    uint256 constant IC13y = 3821053981425286913579671562706147260173422960528736127962286684728135795422;
    
    uint256 constant IC14x = 7314823996894424673185323401686131956049329839219356034300120705648592868313;
    uint256 constant IC14y = 20623231538652663599442876268867366363832636913792424017169307531770436019021;
    
    uint256 constant IC15x = 18705501548875921389975312427345836966452583116927841960744679934557949452633;
    uint256 constant IC15y = 1778658277849688877837510503349669433728968477449956016848505618839137075706;
    
    uint256 constant IC16x = 3512503702600775553567891874299791108427809640513703868827079689420464523238;
    uint256 constant IC16y = 3587595028152434409500634023460152822174393387871648819698136727595289615263;
    
    uint256 constant IC17x = 16946142792399987753139531118174202796146899430541146750713046135644825055378;
    uint256 constant IC17y = 11498900188655448811194198214229469564010903878343473000411823537053207864292;
    
    uint256 constant IC18x = 15262650390493295527329073817980915805097462930645519876557029137671635963832;
    uint256 constant IC18y = 25368056663571122550146324853060817865566179989212771792155328569232953915;
    
    uint256 constant IC19x = 7593393194729483706648557666240156067092623276820503516074453053955793974103;
    uint256 constant IC19y = 14848422208429016992402333983983285460673241464949950978128694753002112039821;
    
    uint256 constant IC20x = 21792304619958436127429279985269747551923787644518395501238179462336391082805;
    uint256 constant IC20y = 11190674274368677425362638042614487723823300036307727485774396140832833550081;
    
    uint256 constant IC21x = 9079558640628364536054859426786204519359475563818136696924193795899771258802;
    uint256 constant IC21y = 6099289938393901594813103734671021430196755169168468170250768970795248717006;
    
    uint256 constant IC22x = 14236953206565752453547834478591333985946338829626179730739076751667448534091;
    uint256 constant IC22y = 15257076775047617818961087255601856564180024590860888378538207446526739370488;
    
    uint256 constant IC23x = 4710507218841038964489083533902370702786768425574911444971747527335062574419;
    uint256 constant IC23y = 16310751149956143287793019615691788179617959698428063425831611251258702218425;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[23] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
