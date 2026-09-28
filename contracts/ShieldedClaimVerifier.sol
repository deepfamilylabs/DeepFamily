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
    uint256 constant deltax1 = 15545429547612312353706207356271106305313350872992426072552830158512647760445;
    uint256 constant deltax2 = 8494105048461183403829477269637139277448685125310334464814411188626755815291;
    uint256 constant deltay1 = 11273260125880552704378163850631104124749201145869203744037853799954530284688;
    uint256 constant deltay2 = 16204048803491953975795036331495042656692089251502235908340737621814568958593;

    
    uint256 constant IC0x = 15979777679952089251473286607425435401202344546602658118472997752266101770970;
    uint256 constant IC0y = 13236076161352644486572728959255086112235396969001292190168968436582186012755;
    
    uint256 constant IC1x = 11726656801534777162690783172209561664059874957601799239669274528024547764980;
    uint256 constant IC1y = 17930534988827616818477489685401634267293430715516065838098564627967413540902;
    
    uint256 constant IC2x = 7052842704099895599646149621966991228866594451250080885421237913939635603956;
    uint256 constant IC2y = 18789538258462585119120129224482142326776508115015255855573563800315927669118;
    
    uint256 constant IC3x = 6527343025669645372660489437879295052497957591243329018412794302725660622652;
    uint256 constant IC3y = 21756395911966722923391525916849991965230676159408893031804668084118444046709;
    
    uint256 constant IC4x = 14784984200901037629569803694625448911161239185206880010307141779468844405538;
    uint256 constant IC4y = 482929284834198797861985641284462778624992321502592297869486182241685153348;
    
    uint256 constant IC5x = 17543710756135315757660991470716872047051575608877789043082885159376183442773;
    uint256 constant IC5y = 20499403209185788294455416063266552177453454440879220262662837926307115489751;
    
    uint256 constant IC6x = 9792804815484865927564782529487205785280295140045935116982161097580680300973;
    uint256 constant IC6y = 3625599498964081542960282070888908547482126910565871417466398929908683998021;
    
    uint256 constant IC7x = 16617148730723654816546624575802838910992759868362756334926784577348238062895;
    uint256 constant IC7y = 7546597480605052133867678510281013854526522764377216776309355822124131449398;
    
    uint256 constant IC8x = 9057093157132603356496168305743134337842530691232341381552828566919281662617;
    uint256 constant IC8y = 5632912427531005692442617239336202490635848031819839610205078467311238959927;
    
    uint256 constant IC9x = 20340104971106926659949281396403402696463653699309576658472168281393651643680;
    uint256 constant IC9y = 15879544249643675399741711504808766273242904094356464453230394519351945584421;
    
    uint256 constant IC10x = 10345632856732748321686009731512505997562138138105883113633128507703750763469;
    uint256 constant IC10y = 10638707889649509939203074393523555519922886403200323577265312875660210115964;
    
    uint256 constant IC11x = 12194964526879086993546096786409191489818302174132309805308826928561181106279;
    uint256 constant IC11y = 14111506659681445863610584026736144719495218702854219775086086660216580578288;
    
    uint256 constant IC12x = 14787700620020706554675931390763790697350431826891904845208215981897908568217;
    uint256 constant IC12y = 485818864824399436279196139153354991928284396299293030217005375866950372914;
    
    uint256 constant IC13x = 3475988103556592276856348181114847588868180581843895714766288005649595373784;
    uint256 constant IC13y = 5923462164771593574235335205630381044062912318470168696017286751007387224132;
    
    uint256 constant IC14x = 13946186837386335624296824839249195783886392756774628097520541406745690469241;
    uint256 constant IC14y = 9336892635520672611627758412627760349214138748674889414552626139556328971262;
    
    uint256 constant IC15x = 10860659230371572404506473941036389004650393812594499502852261126145428512426;
    uint256 constant IC15y = 15599113677002634293356424444892527560303118942603472507288851182552210023478;
    
    uint256 constant IC16x = 6058117424687541156498826903993911996756109198097509705458423994088193188613;
    uint256 constant IC16y = 12762640828682191277574573404173703170256834999296174517915695057969928716898;
    
    uint256 constant IC17x = 2994107690134462007225091916790008023131487735574253252474167176463902469022;
    uint256 constant IC17y = 17913992592213875791024715409679195749169652401863334621758138739732281993875;
    
    uint256 constant IC18x = 14225455409077863590682997512627590552715115037294136733275629637364424213530;
    uint256 constant IC18y = 12106954255104485191585064883093532723714987058621271748124821790223168781096;
    
    uint256 constant IC19x = 3446441878832407608785503444796189351962316955560176296493142517496321731816;
    uint256 constant IC19y = 759545270276277549946539049119309378748277219777908864195708031801977088137;
    
    uint256 constant IC20x = 3276162643439781252662202450482872505988575071644280885261244362865350877687;
    uint256 constant IC20y = 9355216972343348926410420343085780824234026522093025125444959179435881667120;
    
    uint256 constant IC21x = 17214278170104522846582798095562795479133104680106182393312415765153323937749;
    uint256 constant IC21y = 6138740655276370460823745350901547833158517571211704137607783439544085393411;
    
    uint256 constant IC22x = 15814872216315304826644770685400369419251538936402922658855120752383935142808;
    uint256 constant IC22y = 10328053244586635343689920369182727341188407272878509270308549016361735324500;
    
    uint256 constant IC23x = 15407239250503085947184763271621874978863879593930347215184112686351223743635;
    uint256 constant IC23y = 18297608842320658260028502660895125054548253781629500309181445307674068451705;
    
    uint256 constant IC24x = 11397497914839220198727585004622125728171183111802356754434474373484530231719;
    uint256 constant IC24y = 13951284188910168233767243425892924467040413464414508722107816841883144218713;
    
    uint256 constant IC25x = 8332144086832209054723671085835081550846408564924498972193169017537507746810;
    uint256 constant IC25y = 12104725747128006950815606902728251355653341542625830654006647127235475029902;
    
    uint256 constant IC26x = 1375951060175632541513055979356979039505343276220221603694016117810370001468;
    uint256 constant IC26y = 17035756164906529409736552192916320170461660777736354967515863876810093386366;
    
    uint256 constant IC27x = 2229320502155430076837767224826076059032478024703377391099933078375210544260;
    uint256 constant IC27y = 9443468262131006118116168783518921537070677677203000503570015688434364095813;
    
    uint256 constant IC28x = 13427813108841691098536021793920339499510958643410721350675524844484402864857;
    uint256 constant IC28y = 5611363433539800483556751771854714761116981771565985756421156322325195111226;
    
    uint256 constant IC29x = 21073490410203182322256275996643741191868190442035081808890872595991652494232;
    uint256 constant IC29y = 5736722537081745848559633455600117059402316301560011937807421862192938642406;
    
    uint256 constant IC30x = 7105075219361295578479492251418549035885889580138102164547676462180309680216;
    uint256 constant IC30y = 4791560103733949107270872716421987869963457767419261553525603620915304650306;
    
    uint256 constant IC31x = 8077899965019281077832460233316308195623764082824920226155038209155886015635;
    uint256 constant IC31y = 12343725894147147361295497617310333583733923702236771988511148481862689168860;
    
    uint256 constant IC32x = 12959876232536088530026521853582565826826664875874084183347680226745647473024;
    uint256 constant IC32y = 14791720707039901044037471323818654844117174173760271398920599412456621134020;
    
 
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
