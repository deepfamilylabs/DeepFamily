// Research only: anonymous credentials and private Fund-output attachment paths.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {build,query} from "./prepare-composition.mjs";
import {sharedPath,mergeSharedFund,extraFundName} from "./refresh-shared-root-attachments.mjs";

const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../.."));
assert.ok(process.argv[3],"Expected view-bound Fund research directory");
const fundDir=path.resolve(process.argv[3]);
const out=path.resolve(process.argv[4]??fs.mkdtempSync(path.join(os.tmpdir(),"deepfamily-attachment-")));
assert.ok(!out.startsWith(root+path.sep));fs.mkdirSync(out,{recursive:true});
const cpus=os.cpus;os.cpus=()=>cpus().slice(0,2);
const require=createRequire(path.join(root,"package.json"));
const {poseidon2,poseidon3,poseidon4,poseidon5,poseidon8}=require("poseidon-lite");
const {getCreateAddress,keccak256,hexlify}=require("ethers");
const snarkjs=require("snarkjs");
const protocol=await import(pathToFileURL(path.join(root,"packages/protocol-core/index.js")));
const {buildLineageFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_lineage_fixture.mjs")));
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,(_,v)=>typeof v==="bigint"?String(v):v,2)+"\n");
const {fund,extra}=mergeSharedFund(fundDir);
assert.equal(fund.viewFields,true,"Attachment requires view-authenticated Fund schema");
const funds=fund.cases.filter(c=>c.valid&&c.name!==extraFundName);
assert.ok(extra?.budgetOpening,"Shared roots need a separate valid Fund pair");
const fundManifestFile=path.join(out,"shared-fund-manifest.json");write(fundManifestFile,fund);
const chainId=31337n,pool=BigInt(fund.poolAddress),sender="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
// Fund verifier=nonce0, Fund consumer=nonce1, letter verifier=nonce2, letter consumer=nonce3.
const consumer=getCreateAddress({from:sender,nonce:3});
let source=fs.readFileSync(path.join(fundDir,"fund_receive_issuance.circom"),"utf8");
assert.ok(source.includes("public [identityCommitment, ownerCommitment,"));
source=source.replace("public [identityCommitment, ownerCommitment,","public [ownerCommitment,");
const sourceFile=path.join(out,"attachment_anonymous_issuance.circom");fs.writeFileSync(sourceFile,source);
console.log(execFileSync(path.join(root,"bin/circom"),[sourceFile,"--r1cs","--wasm","--O2","-l",path.join(root,"circuits"),"-l",path.join(root,"node_modules"),"-o",out],{encoding:"utf8"}).trim());
const zkey=path.join(out,"INSECURE-anonymous-issuer.zkey");
await snarkjs.zKey.newZKey(path.join(out,"attachment_anonymous_issuance.r1cs"),path.join(root,"circuits/ptau/ppot_0080_17.ptau"),zkey);
const vk=await snarkjs.zKey.exportVerificationKey(zkey);assert.equal(vk.nPublic,11);
const lineage=buildLineageFixture().witness;
const baseSecret=BigInt(lineage.derivedSecretField);
const I=BigInt(funds[0].issuerSignals[3]);
const material=protocol.deriveShieldedHeirKeyMaterial(baseSecret);
const view=await protocol.deriveShieldedViewPublicKey(material.hpkeIkm);
const base={identityCommitment:String(I),ownerCommitment:String(material.ownerCommitment),viewKeyLo:funds[0].issuerSignals[5],viewKeyHi:funds[0].issuerSignals[6],keyMode:"0",identitySuiteId:"1",independentKeySuiteId:"1",independentKeyDerivationVersion:"1",receiveCodeVersion:"1",spendingSecret:String(material.ownerSecret),nameField:lineage.nameField,derivedSecretField:String(baseSecret),isBirthBC:lineage.isBirthBC,birthYear:lineage.birthYear,birthMonth:lineage.birthMonth,birthDay:lineage.birthDay,gender:lineage.gender,suiteId:"1",authorizationCounter:"0",expiresAt:"1900000000"};
const wasm=path.join(out,"attachment_anonymous_issuance_js/attachment_anonymous_issuance.wasm");
async function issuer(name,mode,patch={}){
 const dir=path.join(out,name);fs.mkdirSync(dir,{recursive:true});
 const w={...base,...(mode?{spendingSecret:"123456789",ownerCommitment:String(protocol.computeShieldedOwnerCommitment(123456789n))}:{}),keyMode:String(mode),...patch};
 const p=await snarkjs.groth16.fullProve(w,wasm,zkey,undefined,{singleThread:true},{singleThread:true});
 assert.equal(await snarkjs.groth16.verify(vk,p.publicSignals,p.proof),true);
 assert.equal(p.publicSignals.length,11);assert.equal(p.publicSignals[3],w.ownerCommitment);
 write(path.join(dir,"research.vkey.json"),vk);write(path.join(dir,`mode-${mode}.proof.json`),p.proof);write(path.join(dir,`mode-${mode}.public.json`),p.publicSignals);
 return {dir,mode:String(mode),p:p.publicSignals};
}
const issuers=[await issuer("issuance-0",0),await issuer("issuance-1",1)];
for(let mode=0;mode<2;mode++)assert.equal(issuers[mode].p[0],funds.find(c=>c.mode===String(mode)).issuerSignals[0]);
const suite=poseidon4([1000n,1n,0n,0n]),otherSecret=baseSecret+1n;
const packed=BigInt(lineage.birthYear)*33554432n+BigInt(lineage.birthMonth)*131072n+BigInt(lineage.birthDay)*512n+BigInt(lineage.gender)*2n+BigInt(lineage.isBirthBC);
const otherI=poseidon4([1002n,poseidon4([1001n,BigInt(lineage.nameField),otherSecret,suite]),packed,suite]);
const other=await issuer("other-identity-same-independent-keys",1,{identityCommitment:String(otherI),derivedSecretField:String(otherSecret)});
assert.notEqual(other.p[0],issuers[1].p[0]);assert.deepEqual(other.p.slice(3),issuers[1].p.slice(3));
const wrongView=await issuer("wrong-view",1,{viewKeyLo:String(BigInt(base.viewKeyLo)+1n)});
const wrongOwner=await issuer("wrong-owner",1,{spendingSecret:"987654321",ownerCommitment:String(protocol.computeShieldedOwnerCommitment(987654321n))});
const R=BigInt(issuers[0].p[0]),state=build([[R^1n,5n],[R^2n,9n]]);
function binding(u,p){
 let x=poseidon3([202610210101n,chainId,BigInt(consumer)]);
 for(const[a,b]of[[u.action,u.messageId],[u.cipherLo,u.cipherHi],[u.checkpointId,u.stateRoot],[u.asOf,u.expiresAt]])x=poseidon3([x,BigInt(a),BigInt(b)]);
 let r=poseidon3([202610210102n,BigInt(p[0]),BigInt(p[3])]);r=poseidon3([r,BigInt(p[6]),BigInt(p[4])]);r=poseidon3([r,BigInt(p[5]),BigInt(u.salt)]);
 return String(poseidon2([r,x]));
}
const scoped=purpose=>poseidon3([1032n,poseidon3([1031n,chainId,pool]),BigInt(purpose)]);
function leaf(o,p,purpose=202610210301n){
 return poseidon8([scoped(purpose),BigInt(o.policy),BigInt(o.enrollment),poseidon5([scoped(1033n),BigInt(p[3]),BigInt(p[6]),BigInt(p[4]),BigInt(p[5])]),BigInt(o.rate),BigInt(o.remaining),BigInt(o.nonce),BigInt(o.ciphertextHash)]);
}
const cases=[];let message=100;
async function make(name,f,s,{valid=true,patch={},purpose=202610210301n,envelopeCommitment,selectSecond=false}={}){
 const selected=selectSecond?extra:f,o=selected.budgetOpening,commitment=leaf(o,s.p,purpose);
 const salt=String(999000n+BigInt(message));
 const envelope={version:1,body:"家书研究样例",budgetPool:fund.poolAddress,budgetCommitment:String(envelopeCommitment??o.commitment),salt};
 const ciphertext=hexlify(await protocol.encryptShieldedNote({chainId,poolAddress:consumer,recipientPublicKey:view,payload:new TextEncoder().encode(JSON.stringify(envelope))}));
 const digest=BigInt(keccak256(ciphertext));
 const u={chainId:String(chainId),consumer:String(BigInt(consumer)),action:"2",messageId:String(message++),cipherLo:String(digest&((1n<<128n)-1n)),cipherHi:String(digest>>128n),checkpointId:"1",stateRoot:String(state.hash),asOf:"1899998100",expiresAt:s.p[2],salt,...query(state,BigInt(s.p[0]))};
 u.binding=binding(u,s.p);
 // A malicious holder can recompute the relation using their own keys. Keep
 // the real source root/path so key and producer negatives test membership.
 const a={budgetPool:String(pool),...sharedPath(poseidon2,f.budgetOpening,extra.budgetOpening,selectSecond),relation:String(poseidon3([poseidon3([202610210401n,pool,commitment]),BigInt(u.binding),BigInt(salt)])),policy:o.policy,enrollment:o.enrollment,rate:o.rate,remaining:o.remaining,nonce:o.nonce,ciphertextHash:o.ciphertextHash,...patch};
 if(valid)assert.equal(String(commitment),o.commitment);
 const extrasFile=path.join(out,name+".extras.json"),attachmentFile=path.join(out,name+".attachment.json");write(extrasFile,u);write(attachmentFile,a);
 const recovered=JSON.parse(new TextDecoder().decode(await protocol.decryptShieldedNote({chainId,poolAddress:consumer,hpkeIkm:material.hpkeIkm,ciphertext})));
 const decryptedRelation=poseidon3([poseidon3([202610210401n,BigInt(recovered.budgetPool),BigInt(recovered.budgetCommitment)]),BigInt(u.binding),BigInt(recovered.salt)]);
 const envelopeMatches=String(decryptedRelation)===a.relation;
 if(valid&&envelopeCommitment===undefined)assert.equal(envelopeMatches,true);
 cases.push({name,valid,inputDir:s.dir,mode:s.mode,extrasFile,attachmentFile,extras:u,attachment:a,ciphertext,sourceFundCase:selected.name,sourceFundCases:[f.name,extra.name],budgetCommitment:o.commitment,sourceBudgetRoot:a.budgetRoot,envelopeMatches});
 return cases.at(-1);
}
for(const f of funds)await make("attach-"+f.name,f,issuers[Number(f.mode)]);
const m1=funds.find(c=>c.name==="first-mode-1"),m0=funds.find(c=>c.name==="first-mode-0");
const sharedM0=sharedPath(poseidon2,m0.budgetOpening,extra.budgetOpening);
await make("different-identity-same-independent-keys",m1,other);
const secondBudget=await make("shared-root-second-budget",m0,issuers[0],{selectSecond:true});
assert.equal(secondBudget.sourceBudgetRoot,cases.find(c=>c.name==="attach-first-mode-0").sourceBudgetRoot);
assert.notEqual(secondBudget.budgetCommitment,m0.budgetOpening.commitment);
await make("wrong-view",m1,wrongView,{valid:false});
await make("wrong-owner",m1,wrongOwner,{valid:false});
await make("wrong-mode",m0,issuers[1],{valid:false});
await make("wrong-membership-path",m0,issuers[0],{valid:false,patch:{siblings:["123",sharedM0.siblings[1],...Array(6).fill("0")]}});
await make("wrong-reference-relation",m0,issuers[0],{valid:false,patch:{relation:"123"}});
await make("zero-depth",m0,issuers[0],{valid:false,patch:{depth:"0"}});
await make("excess-depth",m0,issuers[0],{valid:false,patch:{depth:"9"}});
await make("inactive-index-bit",m0,issuers[0],{valid:false,patch:{index:"4"}});
await make("inactive-sibling",m0,issuers[0],{valid:false,patch:{siblings:[m0.budgetOpening.changeCommitment,sharedM0.siblings[1],"123",...Array(5).fill("0")]}});
// Claim has a separate fixed domain: keeping its opening cannot forge a Fund leaf.
const claimCopy=structuredClone(m0);claimCopy.budgetOpening.commitment=String(leaf(m0.budgetOpening,issuers[0].p,202610210302n));
await make("claim-budget-cannot-pose-as-fund",claimCopy,issuers[0],{valid:false});
// Deliberately malicious encrypted reference: proof about A can be valid, but
// decryption MUST reject display as attachment to B. This is not a circuit test.
const mismatch=await make("encrypted-reference-mismatch",m0,issuers[0],{envelopeCommitment:BigInt(m0.budgetOpening.commitment)+1n});
assert.equal(mismatch.envelopeMatches,false);
const constants={},pkg=path.dirname(require.resolve("poseidon-lite"));
for(const n of [2,3,5,8]){const raw=require(path.join(pkg,`constants/${n}.js`)).default;const decode=x=>Array.isArray(x)?x.map(decode):BigInt("0x"+Buffer.from(x,"base64").toString("hex")).toString();constants[n]={C:decode(raw.C),M:decode(raw.M)};}
const constantsFile=path.join(out,"poseidon-constants.json");write(constantsFile,constants);
write(path.join(out,"attachment-manifest.json"),{scope:"Research anonymous authentication + private Fund-domain budget membership + envelope relation; not production letter/archive integration",fundDir,fundManifestFile,constantsFile,consumer,poolAddress:fund.poolAddress,initialCounterRoot:String(state.hash),sharedBudgetRoots:true,cases,publicSignalNames:["chainId","consumer","action","messageId","cipherLo","cipherHi","checkpointId","stateRoot","asOf","expiresAt","binding","budgetPool","budgetRoot","relation"],recovery:{actualHPKE:true,recipientKey:"synthetic shared viewing fixture, not independent-key recovery UX",mismatchRejected:true},limitations:["Bounded depth8 membership; contract must authenticate root from the actual canonical pool","Shared four-leaf roots contain two distinct valid Fund budgets; this is a fixture leaf-selection test, not a formal privacy or production anonymity-set proof","Research Fund/Claim domain split requires all production budget producers and readers to update together","Fixture private openings and synthetic Fund ciphertexts; letter ciphertexts use actual HPKE","Proof does not assert encryption correctness: after decryption relation mismatch must suppress attachment display","No Archive integration, browser memory benchmark, real value custody or production Claim circuit integration"]});
console.log(JSON.stringify({out,cases:cases.length,valid:cases.filter(c=>c.valid).length,otherIdentityAcceptedByDesign:true,encryptedReferenceMismatchDetected:true}));
process.exit(0);
