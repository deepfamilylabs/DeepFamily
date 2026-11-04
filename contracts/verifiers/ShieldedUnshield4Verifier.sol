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

contract ShieldedUnshield4Verifier {
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
    uint256 constant deltax1 = 19052796629028329649585321691941055769660561362056155281354094638970212317378;
    uint256 constant deltax2 = 21053818022434293927551318645283176512790977138905317746880411044712167887687;
    uint256 constant deltay1 = 3375891878631381504068052935777931319409828218399602566048220265736487330410;
    uint256 constant deltay2 = 15344038420965951001343218188337329669688378639213590367843786173078064252815;

    
    uint256 constant IC0x = 9372339419766259938854434552778961152871703497531396310407303965599551949756;
    uint256 constant IC0y = 16178086486682394603854985254503966147479979215750675974359513438521268401482;
    
    uint256 constant IC1x = 3504965377245759660739995691478091320348859659820356115011886448348942576543;
    uint256 constant IC1y = 13554764192071465372847613950631161243145203371108008720390853250806360884744;
    
    uint256 constant IC2x = 1547405980264870698272641518955008925664481969007098717871787312420195722099;
    uint256 constant IC2y = 9434757649919752553311567033164940962521325043006009829839489635973256943821;
    
    uint256 constant IC3x = 1616618650582592988902366598850966916644447622695588123636518729180962606763;
    uint256 constant IC3y = 18789796317938885252867840653027667910169111592523534082304612763371557614583;
    
    uint256 constant IC4x = 4991718847006022603441252947439355014037525079467761561176703417923581856888;
    uint256 constant IC4y = 2602833949360610320167567958219496116901983129234064404855023410264314017546;
    
    uint256 constant IC5x = 19152338611308310395099841109059646984509746648591998628707016579208343969585;
    uint256 constant IC5y = 3951134620641401318964020561003958643721887333982445689038740140535021232019;
    
    uint256 constant IC6x = 2884160091605597940787004570628353500838234518218777121482962954508353962357;
    uint256 constant IC6y = 1951163253897799558259089199024806160050717764909579920412103941484371444926;
    
    uint256 constant IC7x = 968337246631930338285756876959283503154747414159992382225331694814722941192;
    uint256 constant IC7y = 21111362321534688915033296374746077713772709555553672429605652248241163468319;
    
    uint256 constant IC8x = 12243256987390186233909135826004606097683592366063630805495570028351619330113;
    uint256 constant IC8y = 9755939718807620833669077058949082739875568286268556786536330557738769551072;
    
    uint256 constant IC9x = 2098228431754836367715631770016419384985883198385496305075820421007790151861;
    uint256 constant IC9y = 3744339802211999399959068784820292162371435991443255059096695241381499517501;
    
    uint256 constant IC10x = 7586069567456011659136793282824786066961776582503803460976791117130235842312;
    uint256 constant IC10y = 7670740552193341196592962443705154347889862165432863853760996904197810377612;
    
    uint256 constant IC11x = 19661958971841675154242485125083677688942677677247895076462802233450967360411;
    uint256 constant IC11y = 10602676503323676909150061643378189221007632211824604028471780939756475142002;
    
    uint256 constant IC12x = 1100623151384215268838861895957528595555900052089407656619068166265580585568;
    uint256 constant IC12y = 18392426577907002932696442757759237020072154649455022795088946724036896212935;
    
    uint256 constant IC13x = 13538533078040218800748494109260025743293972781407513162058299067122675508908;
    uint256 constant IC13y = 17198900855799062125822144957695195163960695116501663127181725980824489609007;
    
    uint256 constant IC14x = 5854047224631619413895004432272478072644258032411674490403899206624557684572;
    uint256 constant IC14y = 4944340930099141589136275837853343797694629098828872082381764377283962429062;
    
    uint256 constant IC15x = 19086145700476463115314854345729698272821882308013922487805942056068965227931;
    uint256 constant IC15y = 15078329107569326412286676836594640526595256609678922545113462548184941135697;
    
    uint256 constant IC16x = 7336594568843659965899973160465750256599355552671472902072367318621903584441;
    uint256 constant IC16y = 3953354442907021806023443625014059663481150962347609853278877176857785414670;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[16] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
