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

contract ShieldedClaim64Verifier {
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
    uint256 constant deltax1 = 2570070093135861806494173626794603891457930716314915691861113276375189959304;
    uint256 constant deltax2 = 18081363164605096619390000728528102126240031768587657200458044448283266355149;
    uint256 constant deltay1 = 3690497889638956027487255746561512733298813177369796258424392790614888516734;
    uint256 constant deltay2 = 2428211356779436251458943168003777153062766122153851779970838735208697392632;

    
    uint256 constant IC0x = 10316934866999272905971320026335713919445312519497108472882185596360178347099;
    uint256 constant IC0y = 5104809746583327053091028747328505811338764028270839470008767682517570748154;
    
    uint256 constant IC1x = 8371044671306474837272950261411438842104121999934551903241407182632597773197;
    uint256 constant IC1y = 5468143595937209533866316146328933852134479274903919243879199161508592315264;
    
    uint256 constant IC2x = 9763106676593152889412135969100750034040413373812418354830934423382639917198;
    uint256 constant IC2y = 17583842962716044003742816229623618807779820128725247888374738237256566681247;
    
    uint256 constant IC3x = 17863184760571484070880630890207077254296086401411613038158833401489676621101;
    uint256 constant IC3y = 9542131640164274096843377826135852968565513563966601110788206071050691791116;
    
    uint256 constant IC4x = 3748989035491850405022549905418962289053891226817479092783342171209607328277;
    uint256 constant IC4y = 12902886335886811061243477587210770911558453956084653511338837438132818745971;
    
    uint256 constant IC5x = 1810487696171956730311352987628841580091143695597493378196975549667506243943;
    uint256 constant IC5y = 6363035365921148639246002622009635099111308083193439335978715472197251374718;
    
    uint256 constant IC6x = 14657105071683667941783661837079273097678359857828784502941047433049891125115;
    uint256 constant IC6y = 18385578614404932207043294979422867860189421668166673201068713226920620208285;
    
    uint256 constant IC7x = 12062727892813445697247313663508695318054505437870651522203001898197411998005;
    uint256 constant IC7y = 2489047468833239234404984198380315008197397610078133988771459567709322669804;
    
    uint256 constant IC8x = 3198367603083805651518371949680567799008998225513458211342944024585828184317;
    uint256 constant IC8y = 7017611142931973670423658004057893385884883230982401678798819122101439969756;
    
    uint256 constant IC9x = 1483885736396632721267237638367705997536299811261683951745125300258188246547;
    uint256 constant IC9y = 18489658491190535920361190183482084833498696184275652544310760148380707990176;
    
    uint256 constant IC10x = 9264672174524490230851903325174690619750776631810416737841879102172389782076;
    uint256 constant IC10y = 1919355086406172560858428468325625771173424424336768699384171279897894117310;
    
    uint256 constant IC11x = 21278373628085741128371285115158162210422493710851517297868016032804601634129;
    uint256 constant IC11y = 5826324101599958224452567112623443071031893555540808908194733505968198518991;
    
    uint256 constant IC12x = 15894014301910770715463041232711028577225031627919354187151096499049728870351;
    uint256 constant IC12y = 10814449278533485063653618650599754149471583113817977282515452526252989486566;
    
    uint256 constant IC13x = 16239615382075741998674140301881545970769407262183727934514403648909350844617;
    uint256 constant IC13y = 8898712327353126384026724621102225087945532190688993232184390562879113712963;
    
    uint256 constant IC14x = 21563699960628601361862338075661062974627252227892292735426842299860338025500;
    uint256 constant IC14y = 11918100961653282239705757115933813212897920158665467978538033073030443206092;
    
    uint256 constant IC15x = 15154859130684792409042786047025290903432950542381076437648954637619396636012;
    uint256 constant IC15y = 6738058936376011147122283194517568198612189173985121937007810890828784698133;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[15] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
