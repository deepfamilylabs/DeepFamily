// RESEARCH ONLY. No production codecs or circuit artifacts are changed.
// Reuse the actual fixed-width codec and HPKE envelope, adding a one-byte
// producer origin only in this isolated wrapper. All credentials are fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";

const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../.."));
const manifestFile=process.argv[3]?path.resolve(process.argv[3]):null;
const out=path.resolve(process.argv[4]??fs.mkdtempSync(path.join(os.tmpdir(),"deepfamily-budget-view-recovery-")));
fs.mkdirSync(out,{recursive:true});
const require=createRequire(path.join(root,"package.json"));
const {poseidon5,poseidon8}=require("poseidon-lite");
const {getBytes,hexlify}=require("ethers");
const p=await import(pathToFileURL(path.join(root,"packages/protocol-core/index.js")));
const {buildShieldedFundingFixtures}=await import(pathToFileURL(path.join(root,"circuits/test/generate_shielded_funding_input.mjs")));

const manifest=manifestFile?JSON.parse(fs.readFileSync(manifestFile,"utf8")):null;
const scope={chainId:BigInt(manifest?.chainId??31337),poolAddress:manifest?.poolAddress??"0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"};
const purposes=[202610210301n,202610210302n]; // Fund, Claim; research domains only.
const checks=[];
async function check(name,fn){await fn();checks.push({name,passed:true});}
const bytes=value=>getBytes(value);
const toBig=value=>BigInt(value);

function wrap(core,origin){
 assert.ok(origin===0||origin===1,"unsupported producer origin");
 const result=new Uint8Array(core.length+1);result.set(core);result[core.length]=origin;
 assert.ok(result.length<=p.SHIELDED_HPKE_MAX_PAYLOAD_BYTES);
 return result;
}
function unwrap(payload){
 assert.ok(payload instanceof Uint8Array&&[284,460].includes(payload.length),"unexpected research payload length");
 const origin=payload[payload.length-1];assert.ok(origin===0||origin===1,"unsupported producer origin");
 const core=payload.slice(0,-1);
 return {core,origin,note:p.decodeShieldedNotePayload(core,scope)};
}

function v2Commitment(note,viewPublicKey,ciphertextHashField,origin){
 assert.ok(origin===0||origin===1);
 const {policyCommitment,enrollmentCommitment}=p.getShieldedBudgetCommitments(note,scope);
 const {viewKeyLo,viewKeyHi}=p.splitShieldedViewPublicKey(viewPublicKey);
 const authorization=poseidon5([
  p.computeShieldedScopedPurpose(1033n,scope),toBig(note.heirOwnerCommitment),toBig(note.keyMode),viewKeyLo,viewKeyHi,
 ]);
 return {policyCommitment,enrollmentCommitment,authorization,commitment:poseidon8([
  p.computeShieldedScopedPurpose(purposes[origin],scope),policyCommitment,enrollmentCommitment,
  authorization,toBig(note.amountPerPeriod),toBig(note.remaining),toBig(note.nonce),toBig(ciphertextHashField),
 ])};
}

function makeNote(input,{owner,keyMode,remaining,nonce}={}){
 return Object.fromEntries(Object.entries({
  rootIdentityCommitment:input.rootIdentityCommitment,rootVersionIndex:input.rootVersionIndex,
  policySalt:input.policySalt,allocationKeyCommitment:input.allocationKeyCommitment,
  heirIdentityCommitment:input.heirIdentityCommitment,eligibleFrom:input.eligibleFrom,
  enrollmentSalt:input.enrollmentSalt,heirOwnerCommitment:owner??input.heirOwnerCommitment,
  amountPerPeriod:input.rate,remaining:remaining??toBig(input.rate)*toBig(input.budgetPeriods),
  nonce:nonce??input.budgetNonce,periodDays:input.periodDays,keyMode:keyMode??input.keyMode,
 }).map(([key,value])=>[key,toBig(value)]));
}

// This branch uses the actual production independent-credential Argon2id and
// HKDF derivation. Fixed inputs are synthetic test credentials, not user data.
const independentCredential={
 identity:{fullName:"First Heir",gender:2,birthYear:1960,birthMonth:5,birthDay:17,isBirthBC:false},
 rawPassphrase:"P0 fixture independent credential passphrase",
};
const independentRoot=Uint8Array.from({length:32},(_,i)=>i+1);
async function material(mode){
 if(mode===0){
  const keys=p.deriveShieldedHeirKeyMaterial(333333n);
  return {...keys,viewPublicKey:await p.deriveShieldedViewPublicKey(keys.hpkeIkm),keyMode:0};
 }
 const credentialSecret=await p.deriveShieldedIndependentKeyIdentitySecret(independentCredential);
 try{return await p.deriveShieldedIndependentKeyMaterial({independentKeyRoot:independentRoot,independentKeyIdentitySecret:credentialSecret});}
 finally{credentialSecret.fill(0);}
}

await check("production fixed payload and HPKE capacities",()=>{
 assert.equal(p.SHIELDED_BUDGET_NOTE_PAYLOAD_BYTES,283);
 assert.equal(p.SHIELDED_VALUE_WITH_RULE_MEMO_PAYLOAD_BYTES,459);
 assert.equal(p.SHIELDED_HPKE_MAX_PAYLOAD_BYTES,461);
});
await check("independent credential identity matches the synthetic budget heir",()=>{
 const I=p.computeIdentityFromDerivedSecret({identity:independentCredential.identity,identitySuiteId:1,derivedSecretField:333333n}).identityCommitment;
 assert.equal(I,toBig(buildShieldedFundingFixtures(scope).initial.heirIdentityCommitment));
});

let fixtureOpeningsChecked=0;
if(manifest){
 assert.equal(manifest.viewFields,true,"requires the viewing-key-bound Fund variant");
 for(const item of manifest.cases.filter(c=>c.valid)){
  await check("proven fixture opening: "+item.name,()=>{
   const f=buildShieldedFundingFixtures({...scope,keyMode:Number(item.mode)}),o=item.budgetOpening;
   const openingInput=item.inputFile?JSON.parse(fs.readFileSync(item.inputFile,"utf8")):f.initial;
   const note=makeNote(openingInput,{owner:o.owner,keyMode:o.keyMode,remaining:o.remaining,nonce:o.nonce});
   const core=p.encodeShieldedBudgetNotePayload(note,scope),decoded=p.decodeShieldedNotePayload(core,scope);
   assert.equal(core.length,283);
   const view=bytes("0x"+toBig(o.viewHi).toString(16).padStart(32,"0")+toBig(o.viewLo).toString(16).padStart(32,"0"));
   const reconstructed=v2Commitment(decoded,view,o.ciphertextHash,0);
   assert.equal(reconstructed.policyCommitment,toBig(o.policy));
   assert.equal(reconstructed.enrollmentCommitment,toBig(o.enrollment));
   assert.equal(reconstructed.commitment,toBig(o.commitment));
   fixtureOpeningsChecked++;
  });
 }
}

const keys=[await material(0),await material(1)];
await check("independent branch produces separate spending and viewing material",()=>{
 assert.notEqual(keys[0].ownerCommitment,keys[1].ownerCommitment);
 assert.notEqual(keys[0].hpkeIkm,keys[1].hpkeIkm);
 assert.notDeepEqual(keys[0].viewPublicKey,keys[1].viewPublicKey);
 const shared=manifest?.cases.find(c=>c.name==="first-mode-1")?.budgetOpening;
 if(shared){
  assert.notEqual(keys[1].ownerCommitment,toBig(shared.owner));
  assert.notEqual(hexlify(keys[1].viewPublicKey),"0x"+toBig(shared.viewHi).toString(16).padStart(32,"0")+toBig(shared.viewLo).toString(16).padStart(32,"0"));
 }
});
const donor=p.deriveShieldedHeirKeyMaterial(424243n);
donor.viewPublicKey=await p.deriveShieldedViewPublicKey(donor.hpkeIkm);
const samples=[];
for(const mode of [0,1]){
 const input=buildShieldedFundingFixtures({...scope,keyMode:mode}).initial;
 const restored=await material(mode); // derive again from original fixture credentials.
 await check(`mode ${mode}: keys restored from original materials`,()=>{
  assert.equal(restored.ownerCommitment,keys[mode].ownerCommitment);
  assert.equal(restored.hpkeIkm,keys[mode].hpkeIkm);
  assert.deepEqual(restored.viewPublicKey,keys[mode].viewPublicKey);
 });
 for(const origin of [0,1]){
  const name=`mode-${mode}-${origin?"Claim":"Fund"}`;
  const note=makeNote(input,{owner:keys[mode].ownerCommitment,keyMode:mode,remaining:origin?300n:400n,nonce:107n+BigInt(origin)});
  const core=p.encodeShieldedBudgetNotePayload(note,scope),payload=wrap(core,origin);
  const ciphertext=await p.encryptShieldedNote({...scope,recipientPublicKey:keys[mode].viewPublicKey,payload});
  const cipherHash=p.computeShieldedCiphertextHashField(ciphertext);
  const expected=v2Commitment(note,keys[mode].viewPublicKey,cipherHash,origin);
  let recovered;
  await check(`${name}: actual recipient HPKE and complete budget recovery`,async()=>{
   assert.equal(core.length,283);assert.equal(payload.length,284);assert.equal(ciphertext.length,512);
   const decrypted=await p.decryptShieldedNote({...scope,hpkeIkm:restored.hpkeIkm,ciphertext});
   const decoded=unwrap(decrypted);assert.equal(decoded.note.kind,"budget");assert.equal(decoded.origin,origin);
   assert.equal(decoded.note.heirOwnerCommitment,restored.ownerCommitment);assert.equal(decoded.note.keyMode,BigInt(mode));
   // The receiving public key is recovered from this decryption context,
   // rather than redundantly serialized inside the 283-byte budget payload.
   const view=await p.deriveShieldedViewPublicKey(restored.hpkeIkm);
   recovered=v2Commitment(decoded.note,view,cipherHash,decoded.origin);
   assert.deepEqual(recovered,expected);
  });

  const value={ownerCommitment:donor.ownerCommitment,amount:600n,nonce:109n,fundingMemo:{
   budgetCommitment:expected.commitment,budgetNote:note,allocationKey:toBig(input.allocationKey),viewingKey:keys[mode].viewPublicKey,
  }};
  const memoCore=p.encodeShieldedValueNotePayload(value,scope),memoPayload=wrap(memoCore,origin);
  const donorCiphertext=await p.encryptShieldedNote({...scope,recipientPublicKey:donor.viewPublicKey,payload:memoPayload});
  const donorValueCommitment=p.computeShieldedValueNoteCommitment({...value,ciphertextHashField:p.computeShieldedCiphertextHashField(donorCiphertext)},scope);
  let donorDecoded;
  await check(`${name}: actual donor HPKE and 459-byte production rule memo recovery`,async()=>{
   assert.equal(memoCore.length,459);assert.equal(memoPayload.length,460);assert.ok(memoPayload.length<=461);assert.equal(donorCiphertext.length,512);
   const decrypted=await p.decryptShieldedNote({...scope,hpkeIkm:donor.hpkeIkm,ciphertext:donorCiphertext});
   donorDecoded=unwrap(decrypted);const memo=donorDecoded.note.fundingMemo;
   assert.equal(donorDecoded.note.kind,"value");assert.ok(memo);assert.equal(donorDecoded.origin,origin);
   const result=p.verifyShieldedNotePayload({payload:donorDecoded.core,ciphertext:donorCiphertext,noteCommitment:donorValueCommitment},scope);
   assert.equal(result.noteCommitment,donorValueCommitment);
   assert.equal(memo.budgetCommitment,expected.commitment);
   assert.equal(p.computeShieldedAllocationKeyCommitment(memo.allocationKey,scope),memo.budgetNote.allocationKeyCommitment);
   assert.deepEqual(v2Commitment(memo.budgetNote,bytes(memo.viewingKey),cipherHash,donorDecoded.origin),expected);
  });
  await check(`${name}: changed viewing key cannot reproduce the budget commitment`,()=>{
   assert.notEqual(v2Commitment(note,donor.viewPublicKey,cipherHash,origin).commitment,expected.commitment);
   const memo=donorDecoded.note.fundingMemo;
   assert.notEqual(v2Commitment(memo.budgetNote,donor.viewPublicKey,cipherHash,origin).commitment,memo.budgetCommitment);
  });
  await check(`${name}: changed producer origin cannot reproduce the budget commitment`,()=>{
   assert.notEqual(v2Commitment(note,keys[mode].viewPublicKey,cipherHash,1-origin).commitment,expected.commitment);
  });
  await check(`${name}: unsupported producer origin rejected`,()=>{
   const malformed=payload.slice();malformed[malformed.length-1]=2;assert.throws(()=>unwrap(malformed));
  });
  await check(`${name}: wrong recipient material cannot decrypt`,async()=>{
   await assert.rejects(()=>p.decryptShieldedNote({...scope,hpkeIkm:donor.hpkeIkm,ciphertext}),{code:"SHIELDED_DECRYPTION_FAILED"});
  });
  await check(`${name}: wrong chain AAD cannot decrypt`,async()=>{
   await assert.rejects(()=>p.decryptShieldedNote({...scope,chainId:scope.chainId+1n,hpkeIkm:restored.hpkeIkm,ciphertext}),{code:"SHIELDED_DECRYPTION_FAILED"});
  });
  await check(`${name}: ciphertext tampering cannot decrypt`,async()=>{
   const changed=ciphertext.slice();changed[changed.length-1]^=1;
   await assert.rejects(()=>p.decryptShieldedNote({...scope,hpkeIkm:restored.hpkeIkm,ciphertext:changed}),{code:"SHIELDED_DECRYPTION_FAILED"});
  });
  await check(`${name}: production codec requires an explicit format update for the origin byte`,()=>{
   assert.throws(()=>p.decodeShieldedNotePayload(payload,scope));assert.throws(()=>p.decodeShieldedNotePayload(memoPayload,scope));
  });
  samples.push({name,keyMode:mode,origin,recipientCoreBytes:core.length,recipientResearchPayloadBytes:payload.length,
   donorCoreBytes:memoCore.length,donorResearchPayloadBytes:memoPayload.length,ciphertextBytes:ciphertext.length,
   recipientViewSource:mode?"production independent identity Argon2id + independent-root HKDF + HPKE context":"production identity-derived HPKE context",
   donorViewSource:"existing production private funding memo viewingKey field",
   commitment:String(expected.commitment),policy:String(expected.policyCommitment),enrollment:String(expected.enrollmentCommitment),
   independentCodecSampleHasFundProof:false});
 }
}

const result={scope:"Actual production payload codec + HPKE with an isolated one-byte producer-origin wrapper; proposed H5 view-bound budget reconstruction",
 nodeVersion:process.version,fixtureManifest:manifestFile,fixtureOpeningsChecked,checksPassed:checks.length,checks,samples,
 maxPayloadBytes:p.SHIELDED_HPKE_MAX_PAYLOAD_BYTES,productionSourcesModified:false,
 independentCredentialKdfProfile:p.INDEPENDENT_KEY_ARGON2ID_PROFILE,
 limitations:[
  "The appended origin byte is a research wrapper; production codec/version dispatch, note commitments and recovery services still need explicit implementation changes",
  "The independent sample uses actual production Argon2id, independent-root HKDF and HPKE derivation from synthetic identity/passphrase/root inputs; wallet signing, recovery-word UI, worker isolation and new-device UX are not exercised",
  "These newly encrypted codec samples do not have a Fund or Claim business proof; the optional fixture-opening checks separately match the already-proven synthetic Fund outputs",
  "Actual ciphertext hashes are used, but this is not canonical pool, on-chain event/archive fetching or full wallet recovery E2E",
  "Recipient budget opening reconstructs viewing key from decryption credentials; donor memo preserves the existing receiving viewing key field without another 32-byte duplicate",
 ]};
fs.writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({out,checksPassed:checks.length,samples:samples.length,fixtureOpeningsChecked,recipientPayloadBytes:284,donorMemoPayloadBytes:460,maxPayloadBytes:461}));
