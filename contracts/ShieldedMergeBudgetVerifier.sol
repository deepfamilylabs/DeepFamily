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

contract ShieldedMergeBudgetVerifier {
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
    uint256 constant deltax1 = 8383844522818217370410746136669627019569294460220622902460392115342329390033;
    uint256 constant deltax2 = 15253694526322856890965111227839427779887787509188099815796150413069624609546;
    uint256 constant deltay1 = 17588463397259177292481511698610500776959906097007896753847620019329921141426;
    uint256 constant deltay2 = 19204750144121423934921847396920254917316344468582295208723517255308035529157;

    
    uint256 constant IC0x = 1996416831760001164861415982013052506302487740557632088629300967042256493721;
    uint256 constant IC0y = 585874566540502251843447472015325879842076187391472545744763313049502329443;
    
    uint256 constant IC1x = 16471540991117585895856335028101268200882479370598630957264755361142370830521;
    uint256 constant IC1y = 18371461758314195780654479502981646052959671782208664140764381847236531208744;
    
    uint256 constant IC2x = 3540457470326514962492283981134246588335026930645767229516778707973672977475;
    uint256 constant IC2y = 8357640231863910010246057410400989702665035571510931204260231300919296617183;
    
    uint256 constant IC3x = 9156544622982942715038320855497317133042500087086418294872341788343041858574;
    uint256 constant IC3y = 5023095196602244875890378719804040390389235774428478072737019577049878972295;
    
    uint256 constant IC4x = 14278378786573087664760250173026650875854773374346062936986046317642260018670;
    uint256 constant IC4y = 10211870422138103247283358074987774116612046697608339289928327841963488240451;
    
    uint256 constant IC5x = 20448124925800780368935804797764978446984136009839615274290125326280545907175;
    uint256 constant IC5y = 10989287186989262321376183953071375950430487864549316125385332494068698242504;
    
    uint256 constant IC6x = 19747832120328051521836249887383012536019471231156603832687568181054678782950;
    uint256 constant IC6y = 16515735285392441355194160566423403143087537455803351917894477445315829390945;
    
    uint256 constant IC7x = 11503584825864792540586344697677853648534118876121703530999298001174810419232;
    uint256 constant IC7y = 9981092072452962063786172555450238275412216331843948681432323974104165455491;
    
    uint256 constant IC8x = 5323155187471208442622784431705851448435191660301745787408695778223431250222;
    uint256 constant IC8y = 20553789475210232175339530662720786694917926720025553432338337943180183183988;
    
    uint256 constant IC9x = 4692565555320378497368310982590243929339241221997856043593175883789854591675;
    uint256 constant IC9y = 11047414367240322317169265437060462684640307631356619971170423301951094881121;
    
    uint256 constant IC10x = 11202021755390133006810728154511452249517405238984350347538296641309347109727;
    uint256 constant IC10y = 4661236629130179448350850507007543763153084083238424851191190691080565692682;
    
    uint256 constant IC11x = 10922513344030332376291994229224766822195468291534392778354774223622716450551;
    uint256 constant IC11y = 7685274990952352468155483385494377862345571238459679004485355371434021804995;
    
    uint256 constant IC12x = 1889522944607321399319923800312295984215454299667182627501231598354973674060;
    uint256 constant IC12y = 3578030467219853765466025529032841206339766626434005644799444067747916087744;
    
    uint256 constant IC13x = 17804687153708085538634804448515567444201278783671754486061907006891946458831;
    uint256 constant IC13y = 4086295789716790656711567770567901468596650119523483748373803961398051386081;
    
    uint256 constant IC14x = 3444885164804708209392762369192060742316112872900469721951770778721931838603;
    uint256 constant IC14y = 9480068245517861123751774238539037026894846595970587375951830742630271303429;
    
    uint256 constant IC15x = 2096825517105670791635740634587514283021218630076740483194799018599280770074;
    uint256 constant IC15y = 5392425804930680637052448392592969640470405504771607349997603564857109975968;
    
    uint256 constant IC16x = 722259401621116337112085844161651607609132366652009434019220553679161712965;
    uint256 constant IC16y = 7594189061342464726627510610117351844288358701116792977293445933714410237395;
    
    uint256 constant IC17x = 5415123093831008332938504694331028130440195165971774798900884154843138208338;
    uint256 constant IC17y = 15440247079619467022913819621297439757608601556484752879659528542811358528878;
    
    uint256 constant IC18x = 19528535463591114657297892471737783688884267207661340094404654995581483568045;
    uint256 constant IC18y = 17737097827134729901423065538963467313925935059490855077423037416867978979950;
    
    uint256 constant IC19x = 15397143349258933823258271923413767908484954137188837660643613702077996394595;
    uint256 constant IC19y = 15315794906681477390257884392018421642077896352126571777549701618223505260334;
    
    uint256 constant IC20x = 14124827923493865901965601172945404335138015144801292538463771857415022968913;
    uint256 constant IC20y = 12020107444421629176420312692530439802916444782524631828290402790817837369476;
    
    uint256 constant IC21x = 19651496911275677174142140688297063727626870117512141665090189996095832462853;
    uint256 constant IC21y = 11436537832326836065104051718351940824028425319471012978791333540460369386604;
    
    uint256 constant IC22x = 13385096185745112497251277369996520858144818423784106485395781793494391853929;
    uint256 constant IC22y = 11391872652069410938096608607732654596903541974345356228054402440096222535475;
    
    uint256 constant IC23x = 12362889658542204265664793713179213278616902558698092768376110356205934307584;
    uint256 constant IC23y = 12340882954891059475680922437656562572521295122829563355967554471903817678406;
    
    uint256 constant IC24x = 3666176837252441132591112193466971018058595541702480313434795621354163888690;
    uint256 constant IC24y = 12500073905810705650670825192039117551984385793051511079751428708581395794354;
    
    uint256 constant IC25x = 2082216629103373531929557664563412321525395399048099317866368232245300030192;
    uint256 constant IC25y = 6669326362782620622932145607022781121968717835781448671151171082605014180509;
    
    uint256 constant IC26x = 5944963716470052627116658948603876526903222161103990624109988731295736698604;
    uint256 constant IC26y = 16163604682899434382555321524979516119659855986348008755205802869796340941234;
    
    uint256 constant IC27x = 9801270538505344203026037142210923268019075707908979127590090762693742734391;
    uint256 constant IC27y = 20389194554477893932708466605734783173377462223422810192495686587163132112095;
    
    uint256 constant IC28x = 1733237969851385768220643076859519771231760598119875744560045754283416604066;
    uint256 constant IC28y = 18917758984979828156000560444133577160535105741125961203752657560106396148941;
    
    uint256 constant IC29x = 8655110075595038508092723842785178855542084777649933997392419338325435672590;
    uint256 constant IC29y = 842434179307391992566694531845532138199383436218009859358468795516966094968;
    
    uint256 constant IC30x = 10289980293928331999522451558733538780233198907037323156722259109725386054259;
    uint256 constant IC30y = 3963254497763365669214846634986880564952978779122974086910898141787572359589;
    
    uint256 constant IC31x = 5295669654081014891960060854884349948503885432895139681020745578391903330703;
    uint256 constant IC31y = 21285989036419413921634805944744358534570579643287008564100165915876996949529;
    
    uint256 constant IC32x = 10239747130614466291495350331528406629217492448569077166110321220939899450488;
    uint256 constant IC32y = 21532632016634374650588911429886287505395692452024085730237764565193623568857;
    
 
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
