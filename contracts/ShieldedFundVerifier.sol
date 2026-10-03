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
    uint256 constant deltax1 = 16350272448178629479319546882074802401281653360944182769468392296295387259891;
    uint256 constant deltax2 = 12686391285189373165572597027160743212571481759655613842312102298357531339933;
    uint256 constant deltay1 = 702529831885026824976161601118991531145637806826047578389778568669359093409;
    uint256 constant deltay2 = 20059902481771836920584680481277563546806260712192767819253135023476422815327;

    
    uint256 constant IC0x = 15135037872378932335229986858693252086738064923809010576245909384108246317326;
    uint256 constant IC0y = 11270297731796950916605424517873666053286855098606758197974703951401351543614;
    
    uint256 constant IC1x = 4849941492862562846344458746012096579337636580294203959306802253793058424612;
    uint256 constant IC1y = 2749445926833687625034576910806237026143585107284161645162101003302778535314;
    
    uint256 constant IC2x = 760634453142096600357334775561960424316701525934658924419072021633119467715;
    uint256 constant IC2y = 12183750868499927850704042471468907323970950870965871543781942469747985749002;
    
    uint256 constant IC3x = 6435411703209057102022169201446706921054461081967338554317055100274069255038;
    uint256 constant IC3y = 5672630764275375615485191279862903390481334316926419053641692460493190579426;
    
    uint256 constant IC4x = 10394073364682270543951345926349209348422222475248222259329603182589957394349;
    uint256 constant IC4y = 8771612836533899060419365817246939831757428666597936772686646528249441834707;
    
    uint256 constant IC5x = 14208645423492499856151730529313035735983761221066686888648046034212458445606;
    uint256 constant IC5y = 14160545088248762819661801382230968303194791849856287806814207863716205851836;
    
    uint256 constant IC6x = 14757529892500025670507453663951643548241968312764321880095976736721084897192;
    uint256 constant IC6y = 10606780558015659007486476882700683082735902201058153328787907927087362144390;
    
    uint256 constant IC7x = 4293102319441729870243544454855324569014494788203513967562057883709437053333;
    uint256 constant IC7y = 14125963741752298671775365099894114016498427473533789771174614223413510052828;
    
    uint256 constant IC8x = 21146669028953007921312016321927608083812680290182709997936838511751377716472;
    uint256 constant IC8y = 13990257344167137538532610519664994866591153781520574911880102816687089354344;
    
    uint256 constant IC9x = 20452940042380681416440331333960275202216353627653873414293139127351370137786;
    uint256 constant IC9y = 8996605535962202843522356071372837334492419773822042594490540702514065602966;
    
    uint256 constant IC10x = 3703332897081736751199877707420461814066746495292551345746676810040948372545;
    uint256 constant IC10y = 5679340983764631610334725270349932244873502730127775989174058104337636701173;
    
    uint256 constant IC11x = 4427342251145834240064807466856158169968330866493763666185866501740446628665;
    uint256 constant IC11y = 4336530699115624285937603109122887135060313238726844215427336466964796434167;
    
    uint256 constant IC12x = 1431824508735292244551832166677344456326068901641374995449342846937923381860;
    uint256 constant IC12y = 7513013967606025986799968585224134452539081547697020575440565128717791511269;
    
    uint256 constant IC13x = 5789833981446345116419933188590107806658799265148752123933574344665860151563;
    uint256 constant IC13y = 11640058453241775906375808561024781004894196710501986138550706876556984890233;
    
    uint256 constant IC14x = 4125638593945012179964618276974444778048768861289643371774527109225491151588;
    uint256 constant IC14y = 11081076935943981601534497439570276002223842589073721093881000083905503520659;
    
    uint256 constant IC15x = 7836411286746971004838889754264154107724601553078658581360914168606454988931;
    uint256 constant IC15y = 19182217958626252927655896524386521644426858165064505615238104700420978673870;
    
    uint256 constant IC16x = 20592290821861933843575712105494573453479287177252204660824560676106000869244;
    uint256 constant IC16y = 1376305486239238559937591505228002157071464041859722082012819831797979358826;
    
    uint256 constant IC17x = 1413425383825099391776155995199309057266061544081521922964259665269111651095;
    uint256 constant IC17y = 16654235266662516415080841883984073178936748897624855966045264918112868697013;
    
    uint256 constant IC18x = 1302875218028365440042323295999716366076992139597288080272533211480697663248;
    uint256 constant IC18y = 15775898550476036905045557609121626586639729099791864225066396505844269364511;
    
    uint256 constant IC19x = 10381200876101565645951718924706545549715501555989910335753076451898816466210;
    uint256 constant IC19y = 19400192662677884335174675696022837541178123044988635345954065373779781354398;
    
    uint256 constant IC20x = 10912976635944727853050474063916781379544651533519871345737969071710290576957;
    uint256 constant IC20y = 20159167581504271778309111608849666398073742393936183902059187915518169738233;
    
    uint256 constant IC21x = 10565318206127967543019722762338916591377709585768117013992722063520937242196;
    uint256 constant IC21y = 16700064682739045263478775449377785085093717117974755041667733277239955315070;
    
    uint256 constant IC22x = 6392312878630675180238596523841982910237164464205081222475080257824218063203;
    uint256 constant IC22y = 15980994585079622936077012421049678898646965782087710181450017950816215523423;
    
    uint256 constant IC23x = 4544951930599404178612100346245533523891281520750789516510377650561744202529;
    uint256 constant IC23y = 20042931390676408498877038552538065535102646340986886089102784858315710056294;
    
    uint256 constant IC24x = 10496864113163367275831099471016548203329653127860722703668184245651493809400;
    uint256 constant IC24y = 1411472537605116762156960183700710007241686808046758573973811760924092932551;
    
    uint256 constant IC25x = 13588775893807110439704521908007666361658558528689943368736940208980280209000;
    uint256 constant IC25y = 7144778390449132033148578170798411320349482319550328374022487488524432445161;
    
    uint256 constant IC26x = 13910970019888611162718398648085930870578756449919191560396908198792951102117;
    uint256 constant IC26y = 525990925530258991929177052401969107339530088004249167285170505008644373199;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[26] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
