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

contract ShieldedAllocateVerifier {
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
    uint256 constant deltax1 = 2615747993015849008156174264859547244662486911798925549005239788580185783161;
    uint256 constant deltax2 = 15117226251490623903886799911741865149173361982738065061206853510750254289522;
    uint256 constant deltay1 = 1413363253337215775709348493309675717868155032659030442555271459416425070514;
    uint256 constant deltay2 = 12487894346829282851136364844222292668512546784008409137905788402441566445501;

    
    uint256 constant IC0x = 775844599313385973790685029301272154044995840844431398974483901924973500011;
    uint256 constant IC0y = 15212648611491577280134920249596180288786691853671705997346704136039854134620;
    
    uint256 constant IC1x = 12737495192363567100458284369925696783378026617826304735923053939923316524054;
    uint256 constant IC1y = 16339501164216853396133301498294558468108540302119003691777726873532854662224;
    
    uint256 constant IC2x = 8946847714399491811632054368169556221447821923702156787368072602369145202400;
    uint256 constant IC2y = 16609432441835577539062167932640350456215329355919419818501245137963739932520;
    
    uint256 constant IC3x = 14816818785012248226346510776652940224094235532832710544506801216966469227858;
    uint256 constant IC3y = 11425528631902247856029464374805089428613203796268151125313192488768432372499;
    
    uint256 constant IC4x = 3731451653524860752293784207838160542766366864349766070434138069119301350809;
    uint256 constant IC4y = 20761626101555544705579961986719160892900507270956066744479530441482468793649;
    
    uint256 constant IC5x = 20507527706449597346587103615715141834901023893085601563237063985091674039061;
    uint256 constant IC5y = 1584460367133876748805271528283297923546250483611923431610110328521256619651;
    
    uint256 constant IC6x = 1497837151857901309584746329516633913892796937468909678891576772965031004200;
    uint256 constant IC6y = 1241810218206357009972456611890104471530574682480817574716174202494506022999;
    
    uint256 constant IC7x = 20751562981506752949820837611406563184261393155495791247247952531389718706082;
    uint256 constant IC7y = 13489571420411575968320421386658326362503260844114883078989168610727296517381;
    
    uint256 constant IC8x = 4014923900802166087714999913167204456390159609793744209761114512527440465113;
    uint256 constant IC8y = 19609498232201432921102549721138088266416481786323445675209446072653696215038;
    
    uint256 constant IC9x = 3376271314971008749272333607270985278243879422824160606397963961689973119168;
    uint256 constant IC9y = 16350448022513180255939347907572182911167829238887626942007287961448947817272;
    
    uint256 constant IC10x = 3254954751912780840614185005257405493169368552876488288975062779686021538210;
    uint256 constant IC10y = 1997908944485345460816145983196460612851653829655170365927867689495686197848;
    
    uint256 constant IC11x = 18216991252913428731746317396521116305884399499380628048190396592895657090236;
    uint256 constant IC11y = 7058963636700649625907845007706546222231155023878872283158673950763683397848;
    
    uint256 constant IC12x = 11767802618151965960751960984667772701130080746343084897371492487430138772087;
    uint256 constant IC12y = 18373145380707230684506759759457208344740860393515594880474286842765594704402;
    
    uint256 constant IC13x = 19737530212363112819706076676181379964821821348734998779708727458305758397177;
    uint256 constant IC13y = 13914374913512239307748925700561192447241517481252148559630211754557014941618;
    
    uint256 constant IC14x = 9237556277935459850581678838374425785855517609232099935446545595241301886243;
    uint256 constant IC14y = 9522430578794752878590090092016228505921218504997790128565516869381055740174;
    
    uint256 constant IC15x = 11462888042093416025053066215353103767661250442906916302137976446429798385642;
    uint256 constant IC15y = 8868978689470535207850409274397108549048849544343307654069998469343973696990;
    
 
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
