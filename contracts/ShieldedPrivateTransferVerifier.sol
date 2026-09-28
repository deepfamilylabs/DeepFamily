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

contract ShieldedPrivateTransferVerifier {
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
    uint256 constant deltax1 = 9062797423704432116982089134370694395638071274874144411580869536258749915308;
    uint256 constant deltax2 = 14158061649217670913400556178873976694092725018339607819319294787077555896953;
    uint256 constant deltay1 = 7755259797944749750888314267400340334685257007317401790769504508732169888191;
    uint256 constant deltay2 = 16780900866567903009660803577854371176039461273460905884924538768644405508435;

    
    uint256 constant IC0x = 4384782883649228144636586678596022103465415518247983282994572567538459511483;
    uint256 constant IC0y = 3414577022014710821584906188698953280206914966427991200791827702254172550635;
    
    uint256 constant IC1x = 13222223254709955341770389878988464816498235809468787529889144274597074699508;
    uint256 constant IC1y = 18885658439548645329052782280728540467004208322141549526661032294591826765221;
    
    uint256 constant IC2x = 17084995457441250744517160643653121129886983175951771940219432652507999235036;
    uint256 constant IC2y = 8315234261124927236299353280182598790786556323993780342806720065617109996219;
    
    uint256 constant IC3x = 14601779796033900354860064345624629478091075332071710229518349787138363696348;
    uint256 constant IC3y = 60559542093933659387364874450879766722730438702827451758171977422144644975;
    
    uint256 constant IC4x = 18958626787398521948196887998756058725270646660691619530494686496755279464120;
    uint256 constant IC4y = 9028744546484158592568999513474271624523468773025448852360392989545948595179;
    
    uint256 constant IC5x = 19210595996263533908815757999470875662302071944884073445898492130745744160020;
    uint256 constant IC5y = 17907665048495348167409742969393156986805117105041102206995861665247671003080;
    
    uint256 constant IC6x = 14254055066454283873015456967146585422709358678455179563449999340701732682190;
    uint256 constant IC6y = 4446649594953413008331405207825582105352084226699106368498213465375539373236;
    
    uint256 constant IC7x = 20699501959896201596258687783233349373006932983173732453389042463979488681627;
    uint256 constant IC7y = 11336491663064549224666961229706054659266455531709414394662662867459226963844;
    
    uint256 constant IC8x = 1048519297409420894528317651433551189179950269299453839193841676982614105683;
    uint256 constant IC8y = 10987947705960083768220487376702385109603814284557907588658208618441478879882;
    
    uint256 constant IC9x = 21508099855009250651285699374358940336443002822601067006631121364683132756008;
    uint256 constant IC9y = 5409594283103270118928374283967790110594714429938680125171009496837887491058;
    
    uint256 constant IC10x = 8674419165005226312428776426033419125853551689570515803407980661772453745874;
    uint256 constant IC10y = 15847137366985719136934571337024468132629881621660357546107757525716874710425;
    
    uint256 constant IC11x = 1787747787172104607403892473608831989348586087932347707983888508730384836018;
    uint256 constant IC11y = 17835734275774400355742551301025331227892898374358729002721814930949370752243;
    
    uint256 constant IC12x = 5448405560360505163599582556207415695544278400745608901315572446146297350057;
    uint256 constant IC12y = 17488170470715904981961411705022556567394923973237792376323139478409685529585;
    
    uint256 constant IC13x = 4064178594778005373479728658748877316116553150732023204274264358149630069414;
    uint256 constant IC13y = 10129238500594546459463714314094233168542419109191786666012496903796825786920;
    
    uint256 constant IC14x = 5368103280603816097518771029270472627153660021278237460270982086214002997099;
    uint256 constant IC14y = 9967614144347445224123757838795487820423909680421003762172350587102164702734;
    
    uint256 constant IC15x = 14402039731645312290000841418557419136884254807758123864121144617840858221802;
    uint256 constant IC15y = 9785424979974269789872911643683567476723522647117513388070319468201578061993;
    
    uint256 constant IC16x = 2177766957101990470014898344126431822529447058088429843565046518318781553698;
    uint256 constant IC16y = 3750890244390092551472683680448040882347798050904543052798884740930022532996;
    
    uint256 constant IC17x = 8719560156508598978333006908186828905645684283117066353735114400639338225129;
    uint256 constant IC17y = 25710927259980528558744973348793896777784282850649972364919925112663142075;
    
    uint256 constant IC18x = 11867288603286562412726254721057877764710647181495576222907674421774999401050;
    uint256 constant IC18y = 16774915015615684019512258595082927351256604691155846685528269549348243520486;
    
    uint256 constant IC19x = 6555624723623597974884322474604137760890732499440944953712110003641476440346;
    uint256 constant IC19y = 11262114359598295324594192815227592678838231719705310693974614215110093611726;
    
    uint256 constant IC20x = 15705552888152629227747674792606155521834621072562066068614497058506490576546;
    uint256 constant IC20y = 18526549333796599559293268227358393550153600746397240419737513868887069135894;
    
    uint256 constant IC21x = 1019486196866738832969804295729010426383179115650700653846881318196436771666;
    uint256 constant IC21y = 14671640824058908258107455833376158182727411738261590090111859688081760010159;
    
    uint256 constant IC22x = 9171884900016368600985882431552791053673492736634692690222002096151087420511;
    uint256 constant IC22y = 17206328104740909503021194445786426254926742251509238021210314508949232458707;
    
    uint256 constant IC23x = 7928727410804591040023077994045141836052355201644890555633371256292430540338;
    uint256 constant IC23y = 42495417916872410551125644099607328185594466771668272768006821627807642146;
    
    uint256 constant IC24x = 2647714127883689650825863165808223470992778534124179177232795538998939271206;
    uint256 constant IC24y = 21443229775605140218099932312059200119726651821909336284669839136038235475363;
    
    uint256 constant IC25x = 6633884304267819580117091519558843232977691069534007105162895290660252982180;
    uint256 constant IC25y = 9130485349880170831176295404875042914998593774139914184696330614847799773059;
    
    uint256 constant IC26x = 2610588938720945848769629340534478719476343291136331470517775410444331732404;
    uint256 constant IC26y = 13381656693681788425495441120346834399931914398017799542728891387742251788771;
    
    uint256 constant IC27x = 7958536256961766093094557552599766902900952792009344327680993654990605250471;
    uint256 constant IC27y = 4298363032563996819049667254465146943393490550578373445605436005496547940394;
    
    uint256 constant IC28x = 14391544300010342136355638605528255244333468276309610569666681075326773581531;
    uint256 constant IC28y = 12613762874917094482226763194668006512628406296437375181968069136633730613979;
    
    uint256 constant IC29x = 11356888813832289161867736149745271028741232690328208737816929848338128938353;
    uint256 constant IC29y = 16224750768947151233393504759967412404449908132026509622050340329580838498009;
    
    uint256 constant IC30x = 8680110672929830148878792156632612868047349848395809516953462375505632052844;
    uint256 constant IC30y = 14044954955877188247329645373426719910777999646495514177171679717670493239576;
    
    uint256 constant IC31x = 842742542957979912853456977952200734068412234711599099320392514147042813014;
    uint256 constant IC31y = 8234272833794151987451349887059500106040088132310301145918336795490122023974;
    
    uint256 constant IC32x = 6526363025745144212385470991909439720737577322215623711333997476063617383843;
    uint256 constant IC32y = 19137710409876922592074742040770049881870558814896163255419395082870384437801;
    
 
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
