import { getBytes, keccak256, toUtf8Bytes } from "ethers";
import { poseidon3, poseidon4, poseidon5, poseidon7 } from "poseidon-lite";
import { asUint8Array, bigintFrom, bytesToHex, concatBytes, copyBytes, wipeBytes } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD, ZERO_BYTES32 } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { encryptFormat1Compressed, decryptFormat1Compressed } from "./envelope.js";
import { gzipV1, gunzipV1Strict } from "./gzip.js";
import { deriveReceiveKeyMaterial } from "./receive-code.js";
import { decodeBudgetNotePayload, verifyBudgetNotePayload } from "./budget.js";
import { decryptShieldedNote } from "./shielded-hpke.js";
import { verifyShieldedNotePayload } from "./shielded-note-codec.js";
import { computeShieldedSpendNullifier, normalizeShieldedScope } from "./shielded-inheritance.js";

const FIELD = SNARK_SCALAR_FIELD - 1n;
const MAGIC = Uint8Array.of(0x44, 0x46, 0x57, 0x42, 1);
const DOMAIN = keccak256(toUtf8Bytes("DeepFamily:WalletBackup"));
const MAX_BACKUP_PLAINTEXT = 256 * 1024;
const fail = (ok, message) => protocolAssert(ok, "INVALID_WALLET", message);
const field = (value, name) => bigintFrom(value, name, FIELD);
const nonzero = (value, name) => { const n=field(value,name); fail(n>0n,`${name} must be nonzero`); return n; };
const uint64 = (value, name) => bigintFrom(value, name, MAX_UINT64);
const addressField = value => {
  const n = typeof value === "string" && /^0x[\da-f]{40}$/iu.test(value) ? BigInt(value) : value;
  const parsed=bigintFrom(n,"authorizerScope",(1n<<160n)-1n);
  fail(parsed>0n,"authorizerScope must be nonzero"); return parsed;
};
function fixed(n,width) { return getBytes(`0x${BigInt(n).toString(16).padStart(width*2,"0")}`); }
function integer(bytes) { return BigInt(bytesToHex(bytes)); }
function credentialOf(input, rootSecret, chainId, authorizerScope) {
  const result={};
  for (const name of ["issueNonce","familyRoot","endorser","parentVersion","xChild","xEndorse","xTrust","credentialSalt"])
    result[name]=nonzero(input[name],name);
  fail(result.endorser < 1n<<160n,"Invalid credential endorser");
  uint64(result.parentVersion,"parentVersion");
  result.credentialIndex=bigintFrom(input.credentialIndex,"credentialIndex",(1n<<32n)-1n);
  const u=poseidon3([73204n,rootSecret,result.issueNonce]);
  const a=poseidon7([73101n,u,result.familyRoot,result.endorser,result.parentVersion,result.xChild,result.xEndorse]);
  const b=poseidon5([73102n,result.familyRoot,result.endorser,result.parentVersion,result.xTrust]);
  result.credentialCommitment=poseidon5([73400n,a,b,result.credentialSalt,poseidon3([74000n,chainId,authorizerScope])]);
  if (input.credentialCommitment!==undefined) fail(field(input.credentialCommitment,"credentialCommitment")===result.credentialCommitment,
    "Credential opening does not belong to this wallet subject and registry");
  return result;
}

/** Private state only. Nothing returned here belongs in a receive code or chain call. */
export function normalizeWalletState(input) {
  fail(input?.version===1,"Unsupported wallet version");
  const chainId=uint64(input.chainId,"chainId"); fail(chainId>0n,"chainId must be nonzero");
  const authorizerScope=addressField(input.authorizerScope);
  const masterKey=copyBytes(input.masterKey,"masterKey");
  fail(masterKey.length===32 && masterKey.some(Boolean),"A nonzero 32-byte master key is required");
  const codeRootSecret=nonzero(input.codeRootSecret,"codeRootSecret");
  const nextCodeIndex=uint64(input.nextCodeIndex,"nextCodeIndex");
  fail(Array.isArray(input.credentials) && input.credentials.length<=64,"Invalid credential set");
  const credentials=input.credentials.map(item=>credentialOf(item,codeRootSecret,chainId,authorizerScope));
  fail(new Set(credentials.map(item=>String(item.credentialCommitment))).size===credentials.length,"Duplicate credential");
  fail(Array.isArray(input.revocationRoles) && input.revocationRoles.length<=256,"Invalid controller role set");
  const revocationRoles=input.revocationRoles.map(item=>({role:Number(bigintFrom(item.role,"role",2n)),secret:nonzero(item.secret,"roleSecret")}));
  fail(new Set(revocationRoles.map(item=>`${item.role}:${item.secret}`)).size===revocationRoles.length,"Duplicate controller role");
  return {version:1,chainId,authorizerScope,masterKey,codeRootSecret,nextCodeIndex,credentials,revocationRoles};
}

export async function createWalletState(input) {
  let masterKey;
  if (input.masterKey===undefined) {
    fail(typeof globalThis.crypto?.getRandomValues==="function","Secure randomness is unavailable");
    masterKey=globalThis.crypto.getRandomValues(new Uint8Array(32));
  } else masterKey=copyBytes(input.masterKey,"masterKey");
  try {
    const key=await deriveReceiveKeyMaterial({...input,masterKey,codeIndex:0n});
    return normalizeWalletState({version:1,chainId:key.chainId,authorizerScope:key.authorizerScope,
      masterKey,codeRootSecret:key.codeRootSecret,nextCodeIndex:input.nextCodeIndex??0n,
      credentials:input.credentials??[],revocationRoles:input.revocationRoles??[]});
  } finally { wipeBytes(masterKey); }
}

/** Persist/export the returned state before sharing the newly allocated code. */
export function allocateWalletCode(input) {
  const wallet=normalizeWalletState(input);
  fail(wallet.nextCodeIndex<MAX_UINT64," code index exhausted");
  return {codeIndex:wallet.nextCodeIndex,state:{...wallet,nextCodeIndex:wallet.nextCodeIndex+1n}};
}

function context(wallet) {
  return {chainId:wallet.chainId,deepFamilyProxy:`0x${wallet.authorizerScope.toString(16).padStart(40,"0")}`,
    personHash:DOMAIN,fatherHash:ZERO_BYTES32,fatherVersionIndex:0n,motherHash:ZERO_BYTES32,motherVersionIndex:0n,versionCommitment:1n};
}
function serialized(wallet) {
  return JSON.stringify({version:1,chainId:String(wallet.chainId),authorizerScope:String(wallet.authorizerScope),
    masterKey:bytesToHex(wallet.masterKey),codeRootSecret:String(wallet.codeRootSecret),nextCodeIndex:String(wallet.nextCodeIndex),
    credentials:wallet.credentials.map(item=>Object.fromEntries(Object.entries(item).map(([k,v])=>[k,String(v)]))),
    revocationRoles:wallet.revocationRoles.map(item=>({role:item.role,secret:String(item.secret)}))});
}

/** Reuses the project's Argon2id/AES-256-GCM envelope with a wallet-only AAD domain. */
export async function encryptWalletBackup({wallet:input,rawPassphrase}) {
  const wallet=normalizeWalletState(input);
  let plaintext,compressed;
  try {
    plaintext=toUtf8Bytes(serialized(wallet));
    compressed=gzipV1(plaintext,{maximumInputBytes:MAX_BACKUP_PLAINTEXT});
    const {envelope}=await encryptFormat1Compressed({compressedPlaintext:compressed,rawPassphrase,context:context(wallet)});
    return concatBytes(MAGIC,fixed(wallet.chainId,8),fixed(wallet.authorizerScope,20),envelope);
  } finally { wipeBytes(wallet.masterKey);wipeBytes(plaintext);wipeBytes(compressed); }
}

export async function decryptWalletBackup({backup,rawPassphrase,chainId,authorizerScope}) {
  const bytes=asUint8Array(backup,"backup");
  fail(bytes.length>33 && MAGIC.every((value,i)=>bytes[i]===value),"Invalid wallet backup header");
  const storedChain=integer(bytes.subarray(5,13)),storedScope=integer(bytes.subarray(13,33));
  if(chainId!==undefined) fail(uint64(chainId,"chainId")===storedChain,"Backup belongs to another chain");
  if(authorizerScope!==undefined) fail(addressField(authorizerScope)===storedScope,"Backup belongs to another registry");
  let compressed,plaintext;
  try {
    ({compressedPlaintext:compressed}=await decryptFormat1Compressed({envelope:bytes.subarray(33),rawPassphrase,
      context:context({chainId:storedChain,authorizerScope:storedScope})}));
    plaintext=gunzipV1Strict(compressed,{maximumOutputBytes:MAX_BACKUP_PLAINTEXT});
    const text=new TextDecoder("utf-8",{fatal:true}).decode(plaintext);
    const decoded=JSON.parse(text);
    decoded.masterKey=getBytes(decoded.masterKey);
    const wallet=normalizeWalletState(decoded);
    fail(wallet.chainId===storedChain && wallet.authorizerScope===storedScope,"Backup header and private contents differ");
    fail(serialized(wallet)===text,"Noncanonical wallet backup");
    return wallet;
  } finally { wipeBytes(compressed);wipeBytes(plaintext); }
}

/** Scan all supplied public pool events locally; it never queries an address or identity index. */
export async function recoverWalletNotes({wallet:input,events,spentNullifiers=[],firstCodeIndex=0n,lastCodeIndex},scope) {
  const wallet=normalizeWalletState(input),normalized=normalizeShieldedScope(scope);
  fail(normalized.chainId===wallet.chainId,"Wallet belongs to another chain");
  const first=uint64(firstCodeIndex,"firstCodeIndex");
  const last=lastCodeIndex===undefined?wallet.nextCodeIndex:uint64(lastCodeIndex,"lastCodeIndex");
  fail(first<=last && last<=wallet.nextCodeIndex && last-first<=512n,"Recover code indices in batches of at most 512");
  fail(Array.isArray(events),"Public pool events are required");
  const spent=new Set(Array.from(spentNullifiers,String)),seen=new Set(),recovered=[];
  try {
    for(let codeIndex=first;codeIndex<last;++codeIndex) {
      const keyMaterial=await deriveReceiveKeyMaterial({...wallet,codeIndex});
      for(const event of events) {
        const commitment=nonzero(event.commitment,"commitment");
        if(seen.has(String(commitment))) continue;
        let plaintext;
        try {
          const ciphertext=copyBytes(event.ciphertext,"ciphertext");
          plaintext=await decryptShieldedNote({...normalized,hpkeIkm:keyMaterial.hpkeIkm,ciphertext});
          let kind,note;
          if(plaintext[0]===0x44 && plaintext[1]===0x46 && plaintext[2]===0x42 && plaintext[3]===0x4e) {
            note=decodeBudgetNotePayload(plaintext,normalized);
            verifyBudgetNotePayload({payload:plaintext,ciphertext,noteCommitment:commitment},normalized);
            fail(poseidon4([73103n,wallet.codeRootSecret,keyMaterial.nonce,keyMaterial.codeSecret])===note.codeAlias &&
              note.codeNonce===keyMaterial.nonce,"Recovered budget does not belong to this code");
            kind="budget";
          } else {
            const parsed=verifyShieldedNotePayload({payload:plaintext,ciphertext,noteCommitment:commitment},normalized);
            fail(parsed.note.kind==="value","Unsupported note kind");
            note=parsed.note;kind="value";
          }
          fail(BigInt(note.ownerCommitment)===keyMaterial.ownerCommitment,"Recovered note spending key differs");
          const nullifier=computeShieldedSpendNullifier({ownerSecret:keyMaterial.ownerSecret,noteCommitment:commitment},normalized);
          seen.add(String(commitment));
          const amount=kind==="value"?BigInt(note.amount):BigInt(note.remaining);
          if(amount>0n && !spent.has(String(nullifier))) recovered.push({kind,note,codeIndex,keyMaterial,commitment,
            shardId:uint64(event.shardId,"shardId"),leafIndex:uint64(event.leafIndex,"leafIndex"),ciphertext,nullifier});
        } catch { /* Every event is tried locally; unrelated or forged ciphertexts reveal no note. */ }
        finally { wipeBytes(plaintext); }
      }
    }
    return recovered;
  } finally { wipeBytes(wallet.masterKey); }
}
