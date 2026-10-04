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
    uint256 constant deltax1 = 7481732949416331122931155703365511541408721203005833559461861242873369632654;
    uint256 constant deltax2 = 18281072039547323964269477231917707521773089591404117267163400763541643773497;
    uint256 constant deltay1 = 1890781613609337715987556539239576777243269916727642478770565887749954723053;
    uint256 constant deltay2 = 8894006518009001352765804224994707199147824780004677491561319561521761562826;

    
    uint256 constant IC0x = 4384733750371504999398302120793212801528128233061037243981136817872050405407;
    uint256 constant IC0y = 10565598725133970473448677533863743538780235425159322417441303631711853171145;
    
    uint256 constant IC1x = 17083094244525908895841078273992093490815357380182552379467522302319190811573;
    uint256 constant IC1y = 6130542311038213518575694886991072048304552821832025578174279876051704850385;
    
    uint256 constant IC2x = 2842704526779048992759042351419783308109674388600268518478381720473306108024;
    uint256 constant IC2y = 10180561367599440490627006857524084652731349384550612756697126293311230710093;
    
    uint256 constant IC3x = 11684006653312075929809777969630602226960391678700379251850573237401897589277;
    uint256 constant IC3y = 17700622174425247628421650026275467866831234542941479105473796729085821796088;
    
    uint256 constant IC4x = 4648087416550616752202624880166661360890196597916443408603593139600670141467;
    uint256 constant IC4y = 2603436039185956545634551769589083884048420608344104799540412718003046601356;
    
    uint256 constant IC5x = 14440229224176064264061253457730395886899409440012555573090330494853581704797;
    uint256 constant IC5y = 15152364706551543904473602592187310118531573207750023666929886821656378020144;
    
    uint256 constant IC6x = 14372560328450842011838151460348573303272109364104645265529083683770385062990;
    uint256 constant IC6y = 9898832723968102983770471744966699488522614897642948574196050390774309027958;
    
    uint256 constant IC7x = 20718792964101491080286038886557677779298239050288248253753543648418575619546;
    uint256 constant IC7y = 11691489648108064187209735668922920873274284922641058562734291132636671233963;
    
    uint256 constant IC8x = 21760357112715543579145562333148163128504993971941815839599848074070083776433;
    uint256 constant IC8y = 21264683487510600291761822043608640272321722452382073018401930836371116768657;
    
    uint256 constant IC9x = 15458020987500171821782891409061710923996495744305859605772633224941036127692;
    uint256 constant IC9y = 1679035856645769447881183769930409028341736987533008742471984956048922669385;
    
    uint256 constant IC10x = 18046319514293821014030908328662209058457506032948189758312779811016770617315;
    uint256 constant IC10y = 13555822650906858972067846852351344415817119807655226547764555580153985240604;
    
    uint256 constant IC11x = 16536820713002429015272792422603586214580780446984064377816163843086591434593;
    uint256 constant IC11y = 488673809887883827271153242749047989715733823339890999478136138888060533702;
    
    uint256 constant IC12x = 12670964371269702289265175940509819091274913073963004576978101190457855888667;
    uint256 constant IC12y = 10000013600851010265876389189979376418771538735302815583521895021223801254462;
    
    uint256 constant IC13x = 15740508736518432533745964944274444186982132571625246861537120390121648706696;
    uint256 constant IC13y = 3392697536085833405181403375297845708982817913677544545070184352057532671231;
    
    uint256 constant IC14x = 15511230560188712040293337902947833911663349389064065916769923856815086438765;
    uint256 constant IC14y = 4586019973983646330267454843931026671543579122689505159111465455043529549561;
    
    uint256 constant IC15x = 18374035250206931869914794518691546485017468280700864850643580283991596437674;
    uint256 constant IC15y = 10156116496994688544711658025729701015915906380338619295679587268139405306199;
    
    uint256 constant IC16x = 18004425051840527171623762744733776342695509480816573850512227505204271454204;
    uint256 constant IC16y = 8795115041018187212521782723546298746861830324585806056543835874784514329088;
    
    uint256 constant IC17x = 5642466972092160469856248474069952906242996528213922451572719053230872976783;
    uint256 constant IC17y = 16976991271312337075093246397444128697969899265926737342699414868378500507996;
    
    uint256 constant IC18x = 11851882740835083221714533079140099385012060160735605810928295165864179501136;
    uint256 constant IC18y = 11679711928886366506047523244285695244560625841644394501342119477316649744178;
    
    uint256 constant IC19x = 735949464992574976772115581798291968346223922452511759251355452710020893631;
    uint256 constant IC19y = 11193716758015916446644980590596634319311606136865808001624952365162085223179;
    
    uint256 constant IC20x = 10888434081552416676422720569912041435206083422584094279873480470702259559737;
    uint256 constant IC20y = 14271322875001048732086993505720294114330599706913128532379858458728109286838;
    
    uint256 constant IC21x = 2264858849876101006464838809600891821315701808447101680461915446399804530754;
    uint256 constant IC21y = 20744115107995165577641170414449196341802068975767658855824230742308297141802;
    
    uint256 constant IC22x = 20294422513969331646429740366149130498792595044325078871723802878951140130259;
    uint256 constant IC22y = 21339332441168444881147677634978020942848865564858606205511327077185848685026;
    
    uint256 constant IC23x = 3697726960150653295209253332960873847106674714022199056778139517917130911004;
    uint256 constant IC23y = 18239902334335911885158182493984645282764164564803260278954420275738631502766;
    
    uint256 constant IC24x = 17676388885774834417721163619752366764538590934299006152375956873722733860572;
    uint256 constant IC24y = 19114979516724184203433092293521538254948461541117913709114475693278579992021;
    
    uint256 constant IC25x = 13668717016641295199016478320049048282452052357452524114686672303350987892190;
    uint256 constant IC25y = 16357841013593218010406854465763938035989022513244694037124482277327599622003;
    
    uint256 constant IC26x = 18757236306083611791568439207359686504183914645028208694517836455944701289968;
    uint256 constant IC26y = 19407259659478470343067336943800513616535522683361513383943029483863650038875;
    
    uint256 constant IC27x = 12410530535337764243546779157955740267063117808132968158680970906158005327497;
    uint256 constant IC27y = 6321880597238802718132564226667368818672540034906500541329168697821887805547;
    
 
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
