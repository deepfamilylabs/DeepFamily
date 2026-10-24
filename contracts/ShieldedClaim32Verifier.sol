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

contract ShieldedClaim32Verifier {
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
    uint256 constant deltax1 = 5343575823890676942765731928416239880637007921906389497313052040657288501565;
    uint256 constant deltax2 = 3566541912168089387117705652566545499073426711424492022775946836442765285397;
    uint256 constant deltay1 = 1644171219422735736433777788043706623266384981733988180345011054265824704942;
    uint256 constant deltay2 = 6903627931198592677519068499284727314384737244487833569620769039003724469215;

    
    uint256 constant IC0x = 63260442021428422636009525084190169998914512712997519977766149353276141054;
    uint256 constant IC0y = 7019255870508571184020822844743987592586137079864751972356460775123753138634;
    
    uint256 constant IC1x = 6406148363940311261182599403446918756605422255325270961980705598121566823848;
    uint256 constant IC1y = 18033988445624124143426186671376582448275552301151997206518406127072682906237;
    
    uint256 constant IC2x = 21248339710324756453042420063901009930350874719301828406100641599465963000155;
    uint256 constant IC2y = 7268867842383713759672532128672795677556423659449994093673068876359468341650;
    
    uint256 constant IC3x = 3701674231011291328824333302247332093510160733747552391490695225425599959058;
    uint256 constant IC3y = 17539132825334186576843813636006540865880379640625029253385418011090869804493;
    
    uint256 constant IC4x = 10616932957189011292772733570821177558909429982172488324328822288112871057942;
    uint256 constant IC4y = 845882069813390329637227850697314742854079910768897549419125977176797785003;
    
    uint256 constant IC5x = 5950238681116562182369113967231817068879426510136482292278456692256742857616;
    uint256 constant IC5y = 1331716427739597270504291770607953945251367686039764653400537343898835760337;
    
    uint256 constant IC6x = 7805639852568207618475651011972171377897196723230626548777473483208180342625;
    uint256 constant IC6y = 18188741984976024955303383505891717884745670975456779328333837679157301751614;
    
    uint256 constant IC7x = 14702600553223435878882732994097606320348156818079353363764568732651165126943;
    uint256 constant IC7y = 13748855518288210772341826448217127227936025827793982512940937293824712284133;
    
    uint256 constant IC8x = 15245625149077756829136899284322717975171264365758239273630555879956277720564;
    uint256 constant IC8y = 3696555385962568317002081007139377410802431606392844952733673933481735248487;
    
    uint256 constant IC9x = 9877939293061477918409260692083005151760926031682577669352112580221823792772;
    uint256 constant IC9y = 6266864907551395593886614302433257237608445335623450003535308238783050720773;
    
    uint256 constant IC10x = 1727393881820042330351310591791205452814102889622036641798766567160666591477;
    uint256 constant IC10y = 5417921426210831633784353712218504155867390792472006724271356375901370138618;
    
    uint256 constant IC11x = 15457081093556966552469356251395667926010106752287193687850567700167304269369;
    uint256 constant IC11y = 21314520939928121339693855986729967751627253273563155726275473417315292613927;
    
    uint256 constant IC12x = 9204847903370096209986913257336421752830443791863966872924271427199655695669;
    uint256 constant IC12y = 10492296528010773148065460019979067523010240179746503941659028326079196661509;
    
    uint256 constant IC13x = 5760767025332508790941048240353121043696511328254556864097492848174614755290;
    uint256 constant IC13y = 20639521035367788071540400663264905506940483709350445145005756910280471022500;
    
    uint256 constant IC14x = 7521090392314508739043212653803696681831408430446906409837149842494013576115;
    uint256 constant IC14y = 8612019357466552498066829165859324765276254292610908683199687231882222850381;
    
    uint256 constant IC15x = 10280440670867952246733477263293994534837053650750696335331402509118043877977;
    uint256 constant IC15y = 16850057086066887485434859698177039320771796002442076119852960919011702920303;
    
 
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
