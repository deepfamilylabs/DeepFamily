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
    uint256 constant deltax1 = 19423332998111306591024848314147298827641181241687709187044064716056035997171;
    uint256 constant deltax2 = 19145469885206773674136648801192031553534701051770283868037651653211217141071;
    uint256 constant deltay1 = 7217772004913010616480540200095637149654421313353868467420774260931845383186;
    uint256 constant deltay2 = 7457722065745373236369793725373448904193509868904601979085637513288103277318;

    
    uint256 constant IC0x = 16360225872054588152406114130877877868341898439823487986517957125739866063266;
    uint256 constant IC0y = 21184970760069436743741109048570401889233073201805893229863305544637169606226;
    
    uint256 constant IC1x = 4275284465815124736427643148964549252985552452272899643781038342043209571670;
    uint256 constant IC1y = 9957778860038945871874373367026573521212722011111355574511091772605653817998;
    
    uint256 constant IC2x = 7461494079545882056291954225574869095272448813006056176241445571841975446344;
    uint256 constant IC2y = 2692543674672829237441618671604128244941040103979080357202842405413998359885;
    
    uint256 constant IC3x = 19387434039524241347579332159817004009351293186556896726598340267072440613698;
    uint256 constant IC3y = 17774956970184193405046934519402693434117986361510717003506833168444633039755;
    
    uint256 constant IC4x = 919376794237962770955938870724237283568042188098686752717797881101213609641;
    uint256 constant IC4y = 17185044125040159518514517767336543512153339910360905286594497425834270049446;
    
    uint256 constant IC5x = 3263350494561847232116618283645406541121778430288342928886880875980550619305;
    uint256 constant IC5y = 21394095892001150063951042685864852322187414721429205316377200883480225671877;
    
    uint256 constant IC6x = 7983301242882769850995918237739513277921767032578948563866833731616771218930;
    uint256 constant IC6y = 15610600883463838329414263612630562048055171942874057868900150623903502566662;
    
    uint256 constant IC7x = 15347574964153214983337333545534691133144498913786817580273221980964156506606;
    uint256 constant IC7y = 20511023434020077658731770131071580381570186850265328810087649652267347206160;
    
    uint256 constant IC8x = 9274089306245864002355446246515863251795848548717578727887941446131556579893;
    uint256 constant IC8y = 12083844440171046989042456322740477428066343525031651203026756005576947248494;
    
    uint256 constant IC9x = 160046956777129484642891633444503000896185674691725622361690520887911984370;
    uint256 constant IC9y = 9082381905435029522819027858305226484709068728823959133181012864429021285183;
    
    uint256 constant IC10x = 3983484164745739105174454989646138477746912646137724015613871937220413766952;
    uint256 constant IC10y = 5376268080647166745768813021507843888371800642729503955213617709683104079516;
    
    uint256 constant IC11x = 20725387083929925612653662051466812681534552266177864893127226921885017629207;
    uint256 constant IC11y = 7291529289229698647745997016531047325934861715856300855814134055053165726833;
    
    uint256 constant IC12x = 49517073004979514562731177802319735236439716156146154129091062473831215893;
    uint256 constant IC12y = 11708263363600120108859972760824848446481257819322947655356997189654314681228;
    
    uint256 constant IC13x = 17772534201351494887440530173406144999134450736881383840267384291682210704226;
    uint256 constant IC13y = 7561116575591816956589774285807783314725780993607740761286319955786500625125;
    
    uint256 constant IC14x = 4444651777166461756969273397253717517229122887954792114015865996744674952971;
    uint256 constant IC14y = 17935956069750541067971079826367618270575677479951276494821819999888891190874;
    
    uint256 constant IC15x = 7798906993531923873469364754062347387419547630327790395164345705165368426795;
    uint256 constant IC15y = 18707234163562502735148746035485218311722831973508452721419279525579593187919;
    
    uint256 constant IC16x = 12772857847197086868582147660571439337602963270542927040606654260821860882473;
    uint256 constant IC16y = 6347120425745040942537941466967575898751067992904908116207060148615601953701;
    
    uint256 constant IC17x = 2701079291783165450115894070055481174803642139509247732921987745109024093303;
    uint256 constant IC17y = 20376662515874456152452379253748673617352791029891790482922094336226579201015;
    
    uint256 constant IC18x = 317521775178497162408954376683878196444058974996476874669447083628105969181;
    uint256 constant IC18y = 15319511033022421011225780553023984638668316847934184093967290822354242697848;
    
    uint256 constant IC19x = 8924860040264246628041054875384578600146472045770053366913149480167249272678;
    uint256 constant IC19y = 6219288318374164976189028999374492582821689198409038135031842451180801861690;
    
    uint256 constant IC20x = 17606805024284806666057875615387718171587711226949762030923021776557161918530;
    uint256 constant IC20y = 10943223989707041132676559745881254373445748300737523025093340308718036241420;
    
    uint256 constant IC21x = 273954948574140343573401599594811927773602649519291384638810193873648904968;
    uint256 constant IC21y = 9417611013992176376393595331212503110204558491406665148870754755370414771255;
    
    uint256 constant IC22x = 9801087060920128406421081692746932669410858557443904452375734417469513805784;
    uint256 constant IC22y = 16898199449221176766832603515500485572672334399602380111711061134728678179286;
    
    uint256 constant IC23x = 16943075163936792006687905364235125920197274923718054032584325189469188624755;
    uint256 constant IC23y = 3689484466829914342390365106147288707869217032433748760590020786672492588676;
    
    uint256 constant IC24x = 11279381709691088111118511507617990778856395411269089341324224090811327906186;
    uint256 constant IC24y = 17626784193191507385997459279003468013308726744083201070653493512230259847765;
    
    uint256 constant IC25x = 5199888637205770295644855485431668854593222033095222046855128355011836613045;
    uint256 constant IC25y = 12144759413727854321177790856803854174097369489453676508661193389705491029801;
    
    uint256 constant IC26x = 21032191553448360414221370618942998800456455999919619726828159009752377985510;
    uint256 constant IC26y = 10312319078115066244015646992375358828599848828924678160843848380081729335310;
    
    uint256 constant IC27x = 7815218388771372902264083635387232812562058407951623859675827908301179541025;
    uint256 constant IC27y = 15452113728530118457356369428218026639947195844341674137925801251513217455919;
    
 
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
