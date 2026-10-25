import { getAddress } from "ethers";
import { poseidon2 } from "poseidon-lite";
import { bigintFrom, wipeBytes } from "./bytes.js";
import { MAX_UINT128, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { encryptShieldedNote } from "./shielded-hpke.js";
import { encodeShieldedValueNotePayload } from "./shielded-note-codec.js";
import { computeShieldedCiphertextHashField, computeShieldedOwnerCommitment,
  computeShieldedValueNoteCommitment,computeShieldedSpendNullifier,
  generateShieldedRandomField,normalizeShieldedScope } from "./shielded-inheritance.js";
import {computeShieldedDummyInputNullifierForSlot} from "./shielded-value-capacity.js";

const fail=(ok,message)=>protocolAssert(ok,"INVALID_VALUE",message);
const field=(v,n)=>bigintFrom(v,n,SNARK_SCALAR_FIELD-1n);
const nonzero=(v,n)=>{const x=field(v,n);fail(x>0n,`${n} must be nonzero`);return x;};
const amount=(v,n)=>bigintFrom(v,n,MAX_UINT128);
const nonce=(value)=>value===undefined?generateShieldedRandomField():nonzero(value,"nonce");
async function proofOf(prove,verify,witness,signals) {
  fail(typeof prove==="function","A local boundary prover is required");
  const result=await prove(witness);
  fail(result?.proof && Array.isArray(result.publicSignals),"Boundary prover did not return a statement");
  const actual=result.publicSignals.map((v,i)=>field(v,`publicSignals[${i}]`));
  fail(actual.length===signals.length && actual.every((v,i)=>v===signals[i]),"Boundary prover returned a different statement");
  if(verify) fail(await verify(result.proof,signals)===true,"Boundary proof failed local verification");
  return result.proof;
}
async function outputsFor(key,amounts,nonces,scope) {
  const ownerSecret=nonzero(key.ownerSecret,"ownerSecret");
  const ownerCommitment=computeShieldedOwnerCommitment(ownerSecret);
  if(key.ownerCommitment!==undefined) fail(field(key.ownerCommitment,"ownerCommitment")===ownerCommitment,"Spending key binding differs");
  const notes=amounts.map((value,i)=>({ownerCommitment,amount:amount(value,"outputAmount"),nonce:nonces[i]}));
  const payloads=notes.map(note=>encodeShieldedValueNotePayload(note,scope));
  let outputCiphertexts;
  try { outputCiphertexts=await Promise.all(payloads.map(payload=>encryptShieldedNote({...scope,recipientPublicKey:key.viewingKey,payload}))); }
  finally { payloads.forEach(wipeBytes); }
  const ciphertextHashes=outputCiphertexts.map(computeShieldedCiphertextHashField);
  const outputCommitments=notes.map((note,i)=>computeShieldedValueNoteCommitment({...note,ciphertextHashField:ciphertextHashes[i]},scope));
  return {notes,outputCiphertexts,ciphertextHashes,outputCommitments};
}

/** Canonical Shield has no input slots, qualification fields or receive-code counter. */
export async function prepareShield(input,scope) {
  const normalized=normalizeShieldedScope(scope),value=amount(input.amount,"amount");
  fail(value>0n,"Shield amount must be nonzero");
  const outputNonces=[nonce(input.nonce),nonce(input.dummyNonce)];
  const outputs=await outputsFor(input.keyMaterial,[value,0n],outputNonces,normalized);
  const publicInput={chainId:normalized.chainId,pool:BigInt(normalized.poolAddress),amount:value,
    inputShardIds:[],inputRoots:[],inputNullifiers:[],outputCommitments:outputs.outputCommitments,ciphertextHashes:outputs.ciphertextHashes};
  const publicSignals=[normalized.chainId,BigInt(normalized.poolAddress),...outputs.outputCommitments,...outputs.ciphertextHashes,value];
  const witness={chainId:normalized.chainId,pool:BigInt(normalized.poolAddress),amount:value,
    outputCommitments:outputs.outputCommitments,ciphertextHashes:outputs.ciphertextHashes,
    ownerSecret:nonzero(input.keyMaterial.ownerSecret,"ownerSecret"),outputAmounts:[value,0n],outputNonces};
  const proof=await proofOf(input.proveShield,input.verifyShield,witness,publicSignals);
  return {...outputs,amount:value,publicInput,publicSignals,proof};
}

function donorOf(donor,scope) {
  const ownerSecret=nonzero(donor.ownerSecret,"ownerSecret"),ownerCommitment=computeShieldedOwnerCommitment(ownerSecret);
  const value=amount(donor.amount,"donorAmount");fail(value>0n,"Donor amount must be nonzero");
  const donorNonce=nonzero(donor.nonce,"donorNonce");
  const hash=donor.ciphertext===undefined?field(donor.ciphertextHashField,"donorCiphertextHash"):
    computeShieldedCiphertextHashField(donor.ciphertext);
  const commitment=computeShieldedValueNoteCommitment({ownerCommitment,amount:value,nonce:donorNonce,ciphertextHashField:hash},scope);
  const path=donor.membership,depth=Number(bigintFrom(path.depth,"depth",32n));
  const index=bigintFrom(path.index,"index",(1n<<BigInt(depth))-1n);
  fail(Array.isArray(path.siblings) && path.siblings.length>=depth && path.siblings.length<=32,"Invalid donor note path");
  const siblings=Array.from({length:32},(_,i)=>field(path.siblings[i]??0n,"sibling"));
  let root=commitment;
  for(let i=0;i<depth;++i) root=((index>>BigInt(i))&1n)?poseidon2([siblings[i],root]):poseidon2([root,siblings[i]]);
  fail(root===nonzero(path.root,"inputRoot"),"Donor does not belong to the supplied note root");
  return {ownerSecret,ownerCommitment,amount:value,nonce:donorNonce,hash,commitment,root,index,depth:BigInt(depth),siblings,
    shardId:bigintFrom(donor.shardId??0n,"shardId",MAX_UINT128),
    nullifier:computeShieldedSpendNullifier({ownerSecret,noteCommitment:commitment},scope),viewingKey:donor.viewingKey};
}

/** Withdraw one to four notes of the same owner; unused four-slot witnesses are canonical. */
export async function prepareUnshield(input,scope) {
  const normalized=normalizeShieldedScope(scope),value=amount(input.amount,"amount");
  fail(value>0n,"Withdrawal amount must be nonzero");
  const recipient=getAddress(input.recipient);
  fail(BigInt(recipient)>0n && recipient!==normalized.poolAddress,"Invalid withdrawal recipient");
  const donors=(input.donors??[input.donor]);
  fail(Array.isArray(donors) && donors.length>=1 && donors.length<=4 && donors.every(Boolean),"Choose one to four donor notes");
  const sources=donors.map(donor=>donorOf(donor,normalized)),first=sources[0];
  fail(sources.every(source=>source.ownerSecret===first.ownerSecret),"Withdrawal inputs must share one owner");
  fail(new Set(sources.map(source=>String(source.nullifier))).size===sources.length,"Duplicate withdrawal input");
  const total=sources.reduce((sum,source)=>sum+source.amount,0n);
  fail(total>=value && total-value<=MAX_UINT128,"Withdrawal exceeds funds or change capacity");
  const outputNonces=[nonce(input.changeNonce),nonce(input.dummyNonce)];
  const outputs=await outputsFor(first,[total-value,0n],outputNonces,normalized);
  const capacity=sources.length===1?1:4;
  const slot=(key,filler=0n)=>Array.from({length:capacity},(_,i)=>sources[i]?.[key]??filler);
  const inputShardIds=slot("shardId",first.shardId),inputRoots=slot("root",first.root);
  const inputNullifiers=Array.from({length:capacity},(_,i)=>sources[i]?.nullifier??
    computeShieldedDummyInputNullifierForSlot(first.ownerSecret,first.commitment,i,normalized));
  const publicInput={chainId:normalized.chainId,pool:BigInt(normalized.poolAddress),inputShardIds,inputRoots,inputNullifiers,
    outputCommitments:outputs.outputCommitments,ciphertextHashes:outputs.ciphertextHashes,amount:value,recipient:BigInt(recipient)};
  const publicSignals=[normalized.chainId,BigInt(normalized.poolAddress),...inputShardIds,...inputRoots,...inputNullifiers,
    ...outputs.outputCommitments,...outputs.ciphertextHashes,value,BigInt(recipient)];
  const witness={...publicInput,inputEnabled:Array.from({length:capacity},(_,i)=>i<sources.length?1n:0n),
    inputOwnerSecrets:slot("ownerSecret"),inputAmounts:slot("amount"),inputNonces:slot("nonce"),
    inputCiphertextHashes:slot("hash"),inputDepths:slot("depth"),inputIndices:slot("index"),
    inputSiblings:Array.from({length:capacity},(_,i)=>sources[i]?.siblings??Array(32).fill(0n)),
    changeAmount:total-value,changeNonce:outputNonces[0],dummyNonce:outputNonces[1]};
  const proof=await proofOf(witness=>input.proveUnshield(witness,capacity),input.verifyUnshield,witness,publicSignals);
  return {...outputs,amount:value,recipient,capacity,publicInput,publicSignals,proof};
}
