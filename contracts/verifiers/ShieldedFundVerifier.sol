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
    uint256 constant deltax1 = 15218571708748745836641109747731775625228779714747101226849744286452946615286;
    uint256 constant deltax2 = 10060604096453807253487328472148604462738506558271707174501904454006935456021;
    uint256 constant deltay1 = 6417145624520374026958976492896091226225133087463183632726788287933554791866;
    uint256 constant deltay2 = 3156101466336600261718773873541172254131227615787285957047267144876210019781;

    
    uint256 constant IC0x = 20332537521996391833801793817527733188583018287825091937950736421277589608530;
    uint256 constant IC0y = 17652734689727749624040595342857947911918735811166509995681508032776776671938;
    
    uint256 constant IC1x = 17163711848609649818850384652659295588775229808434649577642756710052331078593;
    uint256 constant IC1y = 3792293495835548565914013816814672977570746089333183889886349838289091090604;
    
    uint256 constant IC2x = 4227131458130080636372666200744773534887862922031353968529280632902077634128;
    uint256 constant IC2y = 10669845050923220358591804884919644637894017759138298742865237509166558865884;
    
    uint256 constant IC3x = 1056507532782320911296518547543968422745212370927596910906521562456344363975;
    uint256 constant IC3y = 9469061182683248391454564531198317442334746203820356614241319888829101620306;
    
    uint256 constant IC4x = 2873097258488128060764836159414418905312842826535826278438445141559841233131;
    uint256 constant IC4y = 1048772267267626887607691119914327933819828746000684165950154742789978706831;
    
    uint256 constant IC5x = 4489066818617653028181376589040946781339269205469744826319172717325936367309;
    uint256 constant IC5y = 6364491650204517937005802586914134256251322832386462844388902403320054209377;
    
    uint256 constant IC6x = 360785209043918420775525504674725973311900794793703079946178084177863267904;
    uint256 constant IC6y = 20665235971215279779152955312229025221080540763629473281465035251925574829121;
    
    uint256 constant IC7x = 14387319282402986396510415245037642093447291926141908522046016451237823730381;
    uint256 constant IC7y = 10437084628470280211271976542770478386345691787150136037831522668091876857480;
    
    uint256 constant IC8x = 19590151762213559542450030845653440126331323705487423077839801804701606882970;
    uint256 constant IC8y = 15456510929714924520899256773758353236383088342640737941227817311585114743039;
    
    uint256 constant IC9x = 2137394081379823558398741104011907415698209449831807022631759147643433468872;
    uint256 constant IC9y = 1093096357999405876700632621066207890507192274414714851715123993132364371444;
    
    uint256 constant IC10x = 10704280296182129629116333710157608886687293103462536746034395527016477213675;
    uint256 constant IC10y = 10679658912738319375593406341119975362316676231971253841614952925461976365199;
    
    uint256 constant IC11x = 6445710639332943277086494602221419156795913093600929952812468162267405589880;
    uint256 constant IC11y = 21094922259025641335620580197844995505335401100928360717882114039540683414167;
    
    uint256 constant IC12x = 4588867877697556339382863804409247610187514067213651793275687143075664506337;
    uint256 constant IC12y = 7576100984810004557550595738374268152172887571539446062088799031086358956319;
    
    uint256 constant IC13x = 10305475284940022908928697121876350152687878243738222245127373022136945953628;
    uint256 constant IC13y = 15310945233673432581953665699566429549115121763459185774881252442594557706629;
    
    uint256 constant IC14x = 21795850756740402591246118306593854401897630644591584547648329432387294841305;
    uint256 constant IC14y = 19880843159841903938695689044694698020402088304669827255792259758191876236178;
    
    uint256 constant IC15x = 5846207300334253381669270574114835047467459755771882419460009690988573591526;
    uint256 constant IC15y = 16556180834501766936503780899172286019815160772445591995896407676102164449482;
    
    uint256 constant IC16x = 17593475415215679524730864992034787852015131622436142300372259116990303638209;
    uint256 constant IC16y = 2542010855634182596228226518991744786415755974799947923274549921520123871346;
    
    uint256 constant IC17x = 488580553189836150857114088574097997984517291534241593502214913415603916854;
    uint256 constant IC17y = 1308047005056456497382260670799631796639022785045283406271229974128458587683;
    
    uint256 constant IC18x = 6904244431718570839546029774955160445197578710981335983591359342402458223984;
    uint256 constant IC18y = 7089435851995230254182317182742149412175966304284809755305833420072768674248;
    
    uint256 constant IC19x = 14488064467216938951010533780905545946056653798786256782983957785467551451694;
    uint256 constant IC19y = 6189907370790008426437762051942824184260446647403989243165090668340166135261;
    
    uint256 constant IC20x = 14442027018852563281978602175222922221599789093463893420870073554150860956348;
    uint256 constant IC20y = 16912966124714885097374907038145698467700647882392523640217331092839019649076;
    
    uint256 constant IC21x = 19903435924177732879058631913661640018100178012394973519319761381575962345482;
    uint256 constant IC21y = 6034662834007486538005336647078536398243005823811498770601195843656971016984;
    
    uint256 constant IC22x = 14473610405729152166721918350665807234236433026929598129873266584638696249962;
    uint256 constant IC22y = 14706444447543832370098590898122552361912567043936687522607662013796649822461;
    
    uint256 constant IC23x = 21798797926680894060771782269806511369859008970578291600714373014947726469149;
    uint256 constant IC23y = 16812351156036440082953870088021481514390914236982356173940564935010076128419;
    
    uint256 constant IC24x = 14831427586099507555713034655956648818125058575452388884119596570054748130588;
    uint256 constant IC24y = 11318048124458339836495236644060402810531147487695712375389157109380967162517;
    
    uint256 constant IC25x = 12518329500661168138941700997069103152178806618444376771006286578839966186159;
    uint256 constant IC25y = 18480336300283161974963178993741837272505703973743236825905929185707826640584;
    
    uint256 constant IC26x = 17031324601919154721694652716266812943061231021377638003827359340473289889401;
    uint256 constant IC26y = 12904282229431104110185313225274907724034904361397234037312491137508121184103;
    
    uint256 constant IC27x = 30553307278746788103283629716509382114081038905072608496602448403179169843;
    uint256 constant IC27y = 18148809818419307087987924021102269375328621690905736214671917098219332294119;
    
 
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
