import test from "node:test";
import assert from "node:assert/strict";
import {deriveReceiveKeyMaterial} from "../receive-code.js";
import {prepareShield,prepareUnshield} from "../value.js";
import {decryptShieldedNote} from "../shielded-hpke.js";
import {verifyShieldedNotePayload} from "../shielded-note-codec.js";
const scope={chainId:31337n,poolAddress:"0x2222222222222222222222222222222222222222"};
const proof={pi_a:[1,2],pi_b:[[3,4],[5,6]],pi_c:[7,8]};
const key=()=>deriveReceiveKeyMaterial({masterKey:new Uint8Array(32).fill(23),chainId:scope.chainId,authorizerScope:0x1111111111111111111111111111111111111111n,codeIndex:0n});
const shieldEcho=async w=>({proof,publicSignals:[w.chainId,w.pool,...w.outputCommitments,...w.ciphertextHashes,w.amount]});
const withdrawalEcho=async w=>({proof,publicSignals:[w.chainId,w.pool,...w.inputShardIds,...w.inputRoots,...w.inputNullifiers,
  ...w.outputCommitments,...w.ciphertextHashes,w.amount,w.recipient]});
// Echo callbacks test builders. Real proof acceptance is verified by the separate EVM test.
test("canonical Shield uses empty inputs and encrypts both real bound VALUE outputs",async()=>{
  const keys=await key();
  const out=await prepareShield({keyMaterial:keys,amount:100n,proveShield:shieldEcho},scope);
  assert.equal(out.publicSignals.length,7);assert.deepEqual(out.publicInput.inputRoots,[]);
  for(let i=0;i<2;++i) {
    const payload=await decryptShieldedNote({...scope,hpkeIkm:keys.hpkeIkm,ciphertext:out.outputCiphertexts[i]});
    const opened=verifyShieldedNotePayload({payload,ciphertext:out.outputCiphertexts[i],noteCommitment:out.outputCommitments[i]},scope);
    assert.equal(opened.note.amount,i===0?100n:0n);
  }
  await assert.rejects(prepareShield({keyMaterial:keys,amount:0n,proveShield:shieldEcho},scope));
  await assert.rejects(prepareShield({keyMaterial:keys,amount:10n,proveShield:async()=>({proof,publicSignals:[]})},scope),/different statement/u);
});
test("one and four slot withdrawals retain note ownership, conservation and unique nullifiers",async()=>{
  const keys=await key(),donors=[];
  for(let i=0;i<3;++i) {
    const out=await prepareShield({keyMaterial:keys,amount:10n,proveShield:shieldEcho},scope);
    donors.push({...out.notes[0],ownerSecret:keys.ownerSecret,viewingKey:keys.viewingKey,ciphertext:out.outputCiphertexts[0],
      membership:{root:out.outputCommitments[0],depth:0n,index:0n,siblings:[]}});
  }
  const base={recipient:"0x4444444444444444444444444444444444444444",proveUnshield:withdrawalEcho};
  const single=await prepareUnshield({...base,donor:donors[0],amount:7n},scope);
  assert.equal(single.publicSignals.length,11);assert.equal(single.notes[0].amount,3n);
  const multi=await prepareUnshield({...base,donors,amount:25n},scope);
  assert.equal(multi.capacity,4);assert.equal(multi.publicSignals.length,20);
  assert.equal(multi.notes[0].amount,5n);assert.equal(new Set(multi.publicInput.inputNullifiers.map(String)).size,4);
  await assert.rejects(prepareUnshield({...base,donors:[donors[0],donors[0]],amount:10n},scope),/Duplicate/u);
  await assert.rejects(prepareUnshield({...base,donor:donors[0],amount:11n},scope),/exceeds/u);
  await assert.rejects(prepareUnshield({...base,donor:{...donors[0],ownerSecret:keys.ownerSecret+1n},amount:5n},scope),/supplied note root/u);
});
