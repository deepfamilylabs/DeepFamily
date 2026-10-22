// RESEARCH ONLY. Fixed existing Fund R1CS, actual synthetic ciphertext hashes,
// and identity-disclosing issuance credentials. No production artifacts change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";
import {build,query} from "./prepare-composition.mjs";
import {createSharedRootFundCase} from "./add-shared-root-fund.mjs";

const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../.."));
const out=path.resolve(process.argv[3]??fs.mkdtempSync(path.join(os.tmpdir(),"deepfamily-fund-composition-")));
const viewFields=process.env.DEEPFAMILY_FUND_VIEW_BINDING==="1";
fs.mkdirSync(out,{recursive:true});
assert.ok(!out.startsWith(`${root}${path.sep}`),"Generated setup and proof artifacts must be outside the repository");
const originalCPUs=os.cpus;
os.cpus=()=>originalCPUs().slice(0,2);
const require=createRequire(path.join(root,"package.json"));
const {poseidon2,poseidon3,poseidon4,poseidon5,poseidon8}=require("poseidon-lite");
const {keccak256,getCreateAddress,concat}=require("ethers");
const snarkjs=require("snarkjs");
const {WitnessCalculatorBuilder}=require("circom_runtime");
const {readR1cs}=await import(pathToFileURL(require.resolve("r1csfile")));
const protocol=await import(pathToFileURL(path.join(root,"packages/protocol-core/index.js")));
const {buildShieldedFundingFixtures}=await import(pathToFileURL(path.join(root,"circuits/test/generate_shielded_funding_input.mjs")));
const {buildLineageFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_lineage_fixture.mjs")));
const {shieldedFixtureTag}=await import(pathToFileURL(path.join(root,"circuits/test/shielded_scope_fixture.mjs")));
const write=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,(_,v)=>typeof v==="bigint"?String(v):v)+"\n");
const log=x=>console.log(x);
const q=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function compile(source){
 const output=execFileSync(path.join(root,"bin/circom"),[source,"--r1cs","--wasm","--sym","--O2","--sanity_check","2","-l",path.join(root,"circuits"),"-l",path.join(root,"node_modules"),"-l",path.join(root,"node_modules/circomlib/circuits"),"-o",out],{cwd:out,encoding:"utf8"});
 log(output.trim());return output;
}
const chainId=31337n;
const sender="0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const poolAddress=getCreateAddress({from:sender,nonce:1});
const pool=BigInt(poolAddress);
const scoped=n=>shieldedFixtureTag(n,chainId,pool);
// Optional proposed schema is copied and compiled only in this isolated output.
// A different producer tag proves Fund provenance without adding a tree/leaf.
// Production Claim and its note codec are deliberately not modified here.
const researchFundPurpose=202610210301n,researchClaimPurpose=202610210302n;
function patchOnce(source,before,after){
 assert.equal(source.split(before).length,2,`Expected exactly one research patch anchor: ${before}`);
 return source.replace(before,after);
}
let fundSource=path.join(root,"circuits/shielded_fund.circom");
if(viewFields){
 let common=fs.readFileSync(path.join(root,"circuits/shielded_funding_common.circom"),"utf8");
 common=patchOnce(common,"    signal input ownerCommitment;\n    signal input rate;","    signal input ownerCommitment;\n    signal input viewKeyLo;\n    signal input viewKeyHi;\n    signal input rate;");
 common=patchOnce(common,"    component ownerAuthorization = Poseidon(3);","    component ownerAuthorization = Poseidon(5);");
 common=patchOnce(common,"    ownerAuthorization.inputs[2] <== keyMode;","    ownerAuthorization.inputs[2] <== keyMode;\n    ownerAuthorization.inputs[3] <== viewKeyLo;\n    ownerAuthorization.inputs[4] <== viewKeyHi;");
 fs.writeFileSync(path.join(out,"shielded_funding_common.circom"),common);
 let source=fs.readFileSync(fundSource,"utf8");
 source=patchOnce(source,"    signal input heirOwnerCommitment;","    signal input heirOwnerCommitment;\n    signal input heirViewKeyLo;\n    signal input heirViewKeyHi;\n    signal input oldBudgetIsClaim;");
 source=patchOnce(source,"    budgetTags.poolDomain <== sharedScope.domain;",`    budgetTags.poolDomain <== sharedScope.domain;
    // RESEARCH ONLY. Fixed producer purposes distinguish Fund from Claim.
    component researchFundTag = ShieldedScopedTag();
    researchFundTag.poolDomain <== sharedScope.domain;
    researchFundTag.purpose <== ${researchFundPurpose};
    component researchClaimTag = ShieldedScopedTag();
    researchClaimTag.poolDomain <== sharedScope.domain;
    researchClaimTag.purpose <== ${researchClaimPurpose};
    oldBudgetIsClaim * (1 - oldBudgetIsClaim) === 0;
    component researchViewLoBits = Num2Bits(128);
    researchViewLoBits.in <== heirViewKeyLo;
    component researchViewHiBits = Num2Bits(128);
    researchViewHiBits.in <== heirViewKeyHi;
    budgetKind * heirViewKeyLo === 0;
    budgetKind * heirViewKeyHi === 0;`);
 source=patchOnce(source,"    initial * oldBudgetKind === 0;","    initial * oldBudgetKind === 0;\n    initial * oldBudgetIsClaim === 0;");
 source=patchOnce(source,"    oldBudget.privateNoteTag <== budgetTags.privateNoteTag;","    oldBudget.privateNoteTag <== researchFundTag.tag + oldBudgetIsClaim * (researchClaimTag.tag - researchFundTag.tag);");
 source=patchOnce(source,"    budget.privateNoteTag <== budgetTags.privateNoteTag;","    budget.privateNoteTag <== researchFundTag.tag;");
 source=patchOnce(source,"    oldBudget.ownerCommitment <== oldHeirOwnerCommitment;","    oldBudget.ownerCommitment <== oldHeirOwnerCommitment;\n    oldBudget.viewKeyLo <== heirViewKeyLo;\n    oldBudget.viewKeyHi <== heirViewKeyHi;");
 source=patchOnce(source,"    budget.ownerCommitment <== heirOwnerCommitment;","    budget.ownerCommitment <== heirOwnerCommitment;\n    budget.viewKeyLo <== heirViewKeyLo;\n    budget.viewKeyHi <== heirViewKeyHi;");
 fundSource=path.join(out,"shielded_fund.circom");fs.writeFileSync(fundSource,source);
}
log(viewFields?"Compile isolated proposed Fund producer tag and view binding":"Compile fixed existing shielded_fund relation");
const fundCompile=compile(fundSource);
fs.writeFileSync(path.join(out,"fund-compile.log"),fundCompile);
const fundR1cs=path.join(out,"shielded_fund.r1cs");
const relation=await readR1cs(fundR1cs,true,false,true);
assert.equal(String(relation.prime),String(q));
const symbols=fs.readFileSync(path.join(out,"shielded_fund.sym"),"utf8").trim().split("\n").map(s=>s.split(","));
const names={};for(const s of symbols)if(s[3].startsWith("main."))names[s[3].slice(5)]=Number(s[1]);
const publicCount=relation.nOutputs+relation.nPubInputs;
const publicNames=Array.from({length:publicCount},(_,i)=>symbols.find(s=>Number(s[1])===i+1&&/^main\.[^.]+$/u.test(s[3]))?.[3].slice(5));
assert.ok(publicNames.every(Boolean));
const constraints=relation.constraints.map(c=>c.map(lc=>Object.entries(lc).map(([i,c])=>({i:Number(i),c:String(relation.F.toObject(c))}))));
const wireMap=Object.fromEntries(["chainId","pool","fundMode","budgetKind","heirIdentityCommitment","heirOwnerCommitment","keyMode","budgetNonce"].map(k=>[k,names[k]]));
if(viewFields)for(const name of ["heirViewKeyLo","heirViewKeyHi","oldBudgetIsClaim"])wireMap[name]=names[name];
assert.ok(Object.values(wireMap).every(x=>Number.isInteger(x)&&x>0));
const model={schema:"fixed-circom-r1cs-v1",prime:String(q),nVars:relation.nVars,nPublic:publicCount,nConstraints:relation.nConstraints,sourceR1csSHA256:createHash("sha256").update(fs.readFileSync(fundR1cs)).digest("hex"),publicNames,wireMap,constraints};
if(viewFields)model.viewFields=true;
const modelFile=path.join(out,"fund-relation.json");write(modelFile,model);

let issue=fs.readFileSync(path.join(root,"circuits/shielded_receive_code.circom"),"utf8");
issue=issue.replace("template ShieldedReceiveCode() {",`// RESEARCH ONLY. I is disclosed off chain to a Fund payer, private in outer proof.
template ShieldedReceiveCode() {
 signal output authorizationAlias;
 signal input authorizationCounter;
 signal input expiresAt;
`);
issue=issue.replace("    component viewLoBits = Num2Bits(128);",`    component aliasHash = Poseidon(3);
    aliasHash.inputs[0] <== 202610210001;
    aliasHash.inputs[1] <== identityCommitment;
    aliasHash.inputs[2] <== derivedSecretField;
    authorizationAlias <== aliasHash.out;
    component counterBits = Num2Bits(64); counterBits.in <== authorizationCounter;
    component expiryBits = Num2Bits(64); expiryBits.in <== expiresAt;
    component viewLoBits = Num2Bits(128);`);
issue=issue.replace("receiveCodeVersion]\n}","receiveCodeVersion, authorizationCounter, expiresAt]\n}");
const issueSource=path.join(out,"fund_receive_issuance.circom");fs.writeFileSync(issueSource,issue);compile(issueSource);
const cli=path.join(root,"node_modules/snarkjs/build/cli.cjs");
const zkey=path.join(out,"INSECURE-fund-issuer.zkey");
log("Research-only issuer setup");
await snarkjs.zKey.newZKey(path.join(out,"fund_receive_issuance.r1cs"),path.join(root,"circuits/ptau/ppot_0080_17.ptau"),zkey);
write(path.join(out,"research.vkey.json"),await snarkjs.zKey.exportVerificationKey(zkey));
const issueWasm=path.join(out,"fund_receive_issuance_js/fund_receive_issuance.wasm");
const issuerVK=JSON.parse(fs.readFileSync(path.join(out,"research.vkey.json"),"utf8"));
assert.equal(issuerVK.nPublic,12);
const lineage=buildLineageFixture().witness,secret=BigInt(lineage.derivedSecretField);
assert.equal(secret,333333n);
const identityModeKeys=protocol.deriveShieldedHeirKeyMaterial(secret);
const view=await protocol.deriveShieldedViewPublicKey(identityModeKeys.hpkeIkm);
const I=BigInt(buildShieldedFundingFixtures({chainId,poolAddress}).initial.heirIdentityCommitment);
const original=protocol.buildShieldedReceiveCodePublicSignals({identityCommitment:I,ownerCommitment:identityModeKeys.ownerCommitment,viewingKey:view});
const issuerBase={identityCommitment:String(I),ownerCommitment:String(identityModeKeys.ownerCommitment),viewKeyLo:String(original[2]),viewKeyHi:String(original[3]),keyMode:"0",identitySuiteId:"1",independentKeySuiteId:"1",independentKeyDerivationVersion:"1",receiveCodeVersion:"1",spendingSecret:String(identityModeKeys.ownerSecret),nameField:lineage.nameField,derivedSecretField:lineage.derivedSecretField,isBirthBC:lineage.isBirthBC,birthYear:lineage.birthYear,birthMonth:lineage.birthMonth,birthDay:lineage.birthDay,gender:lineage.gender,suiteId:"1",authorizationCounter:"0",expiresAt:"1900000000"};
const R=poseidon3([202610210001n,I,secret]);
async function makeIssuer(directory,mode,patch={}){
 fs.mkdirSync(directory,{recursive:true});
 const w={...issuerBase,keyMode:String(mode),...(mode?{spendingSecret:"123456789",ownerCommitment:String(protocol.computeShieldedOwnerCommitment(123456789n))}:{}),...patch};
 const p=await snarkjs.groth16.fullProve(w,issueWasm,zkey,undefined,{singleThread:true},{singleThread:true});
 assert.equal(await snarkjs.groth16.verify(issuerVK,p.publicSignals,p.proof),true);
 assert.equal(p.publicSignals.length,12);
 assert.equal(p.publicSignals[3],w.identityCommitment);
 assert.equal(p.publicSignals[4],w.ownerCommitment);
 assert.equal(p.publicSignals[7],w.keyMode);
 fs.copyFileSync(path.join(out,"research.vkey.json"),path.join(directory,"research.vkey.json"));
 write(path.join(directory,`mode-${mode}.proof.json`),p.proof);write(path.join(directory,`mode-${mode}.public.json`),p.publicSignals);
 return p.publicSignals;
}
const issuerDir=path.join(out,"issuance");
const issuers=[await makeIssuer(issuerDir,0),await makeIssuer(issuerDir,1)];
for(const p of issuers)assert.equal(p[0],String(R));

const fundCalc=await WitnessCalculatorBuilder(fs.readFileSync(path.join(out,"shielded_fund_js/shielded_fund.wasm")),{singleThread:true});
const state=build([[R^1n,5n],[R^2n,9n]]),incremented=build([[R^1n,5n],[R^2n,9n],[R,1n]]);
function binding(u,p){
 let ctx=poseidon3([202610210101n,BigInt(u.chainId),BigInt(u.consumer)]);
 for(const[a,b]of[[u.action,u.messageId],[u.cipherLo,u.cipherHi],[u.checkpointId,u.stateRoot],[u.asOf,u.expiresAt]])ctx=poseidon3([ctx,BigInt(a),BigInt(b)]);
 let r=poseidon3([202610210102n,BigInt(p[0]),BigInt(p[4])]);
 r=poseidon3([r,BigInt(p[7]),BigInt(p[5])]);r=poseidon3([r,BigInt(p[6]),BigInt(u.salt)]);
 return String(poseidon2([r,ctx]));
}
function extras(p,ciphertexts,id,tree=state){
 const hash=BigInt(keccak256(concat(ciphertexts))),mask=(1n<<128n)-1n;
 const u={chainId:String(chainId),consumer:String(pool),action:"1",messageId:String(id),cipherLo:String(hash&mask),cipherHi:String(hash>>128n),checkpointId:tree===state?"1":"2",stateRoot:String(tree.hash),asOf:"1899998100",expiresAt:p[2],salt:"7946872923111936231241238987982354435442293588393",...query(tree,BigInt(p[0]))};
 u.binding=binding(u,p);return u;
}
function validateRelation(w){
 for(const [index,c]of constraints.entries()){
  const lc=t=>t.reduce((sum,{i,c})=>(sum+BigInt(c)*w[i])%q,0n);
  assert.equal(lc(c[0])*lc(c[1])%q,lc(c[2]),`exported Fund relation constraint ${index}`);
 }
}
const cases=[];
const schemaWitnessChecks=[];
let id=20;
const variants=viewFields?[{fundMode:0},{fundMode:1,oldIsClaim:1},{fundMode:1,oldIsClaim:0}]:[{fundMode:0},{fundMode:1}];
for(const keyMode of [0,1])for(const {fundMode,oldIsClaim=0}of variants){
 const f=buildShieldedFundingFixtures({chainId,poolAddress,keyMode});
 const input={...(fundMode?f.continuation:f.initial)};
 if(viewFields){
  input.heirViewKeyLo=issuers[keyMode][5];input.heirViewKeyHi=issuers[keyMode][6];input.oldBudgetIsClaim=String(oldIsClaim);
  if(fundMode){
   const oldAuthorization=poseidon5([scoped(1033n),BigInt(input.oldHeirOwnerCommitment),BigInt(input.oldKeyMode),BigInt(input.heirViewKeyLo),BigInt(input.heirViewKeyHi)]);
   const oldBudget=poseidon8([scoped(oldIsClaim?researchClaimPurpose:researchFundPurpose),f.policy,f.enrollment,oldAuthorization,BigInt(input.rate),BigInt(input.oldBudgetRemaining),BigInt(input.oldBudgetNonce),BigInt(input.oldBudgetCiphertextHash)]);
   input.inputRoots=[input.inputRoots[0],String(oldBudget)];
   input.inputNullifiers=[input.inputNullifiers[0],String(poseidon4([scoped(1026n),BigInt(input.policySalt),oldBudget,BigInt(input.budgetUseNonce)]))];
  }
 }
 const ciphertexts=[0,1].map(index=>"0x"+Buffer.alloc(512,0x30+keyMode*8+fundMode*2+index).toString("hex"));
 const hashes=ciphertexts.map(c=>BigInt(keccak256(c))%q);
 input.ciphertextHashes=hashes.map(String);
 const rate=BigInt(input.rate),amount=rate*BigInt(input.budgetPeriods);
 const owner=BigInt(input.heirOwnerCommitment);
 const authorization=viewFields?poseidon5([scoped(1033n),owner,BigInt(keyMode),BigInt(input.heirViewKeyLo),BigInt(input.heirViewKeyHi)]):poseidon3([scoped(1033n),owner,BigInt(keyMode)]);
 const budget=poseidon8([scoped(viewFields?researchFundPurpose:1015n),f.policy,f.enrollment,authorization,rate,amount,BigInt(input.budgetNonce),hashes[0]]);
 const change=poseidon5([scoped(1014n),protocol.computeShieldedOwnerCommitment(BigInt(input.donorOwnerSecret)),BigInt(input.donorAmount)-amount,BigInt(input.changeNonce),hashes[1]]);
 input.outputCommitments=[String(budget),String(change)];
 const wires=await fundCalc.calculateWitness(input,1);validateRelation(wires);
 const name=`${fundMode?(viewFields&&!oldIsClaim?"refill-fund-template":"refill"):"first"}-mode-${keyMode}`;
 if(viewFields&&fundMode){
  // This is distinct from changing the issuer while leaving Fund untouched:
  // give the Fund circuit the new view and a consistent new output, but keep
  // the actual old template root. Old membership must prevent the key change.
  const changedView=BigInt(input.heirViewKeyLo)^1n;
  const changedAuthorization=poseidon5([scoped(1033n),owner,BigInt(keyMode),changedView,BigInt(input.heirViewKeyHi)]);
  const changedBudget=poseidon8([scoped(researchFundPurpose),f.policy,f.enrollment,changedAuthorization,rate,amount,BigInt(input.budgetNonce),hashes[0]]);
  const changedInput={...input,heirViewKeyLo:String(changedView),outputCommitments:[String(changedBudget),String(change)]};
  let rejected;
  try{await fundCalc.calculateWitness(changedInput,1);}catch(error){rejected=error;}
  assert.ok(rejected,`${name} accepted changed view against unchanged old root`);
  assert.match(String(rejected.message),/Assert Failed|Error in template|constraint/i);
  schemaWitnessChecks.push({name:`${name}-old-view-preserved`,passed:true,changed:["heirViewKeyLo","outputCommitments[0]"],heldFixed:["inputRoots[1]"],oldTemplateProducer:oldIsClaim?"Claim":"Fund",scope:"Circom witness constraint rejection; not proof-verifier rejection"});
 }
 const witnessFile=path.join(out,name+".witness.json"),extrasFile=path.join(out,name+".extras.json");
 const u=extras(issuers[keyMode],ciphertexts,id++);
 write(witnessFile,wires.map(String));write(extrasFile,u);
 const item={name,valid:true,inputDir:issuerDir,mode:String(keyMode),witnessFile,extrasFile,extras:u,publicFund:wires.slice(1,publicCount+1).map(String),ciphertexts,ciphertextHashes:hashes.map(String),issuerSignals:issuers[keyMode]};
 if(viewFields)item.budgetOpening={policy:String(f.policy),enrollment:String(f.enrollment),rate:String(rate),remaining:String(amount),nonce:input.budgetNonce,ciphertextHash:String(hashes[0]),commitment:String(budget),changeCommitment:String(change),keyMode:String(keyMode),owner:String(owner),viewLo:input.heirViewKeyLo,viewHi:input.heirViewKeyHi,noteTagPurpose:String(researchFundPurpose),noteTag:String(scoped(researchFundPurpose)),authorizationTag:String(scoped(1033n)),budgetKind:"0",producer:"Fund",oldTemplateProducer:fundMode?(oldIsClaim?"Claim":"Fund"):null};
 cases.push(item);
}
if(viewFields){
 // One independent first Fund permits two successful actions in the same
 // fixture ledger, so attachment proofs can share a root with multiple budgets.
 cases.push(await createSharedRootFundCase({root,fundDir:out,out,calculator:fundCalc,
  manifest:{viewFields:true,cases,chainId:String(chainId),poolAddress,fundPublicNames:publicNames}}));
}
function addBad(name,base,{inputDir=base.inputDir,mode=base.mode,signals=base.issuerSignals,usage=base.extras,wires}={}){
 const extrasFile=path.join(out,name+".extras.json");write(extrasFile,usage);
 let witnessFile=base.witnessFile;
 if(wires){witnessFile=path.join(out,name+".witness.json");write(witnessFile,wires);}
 cases.push({name,valid:false,inputDir,mode,witnessFile,extrasFile});
}
// Valid issuer credentials isolate each cross-protocol identity/key/mode link.
const independent=cases.find(c=>c.name==="first-mode-1"),identity=cases.find(c=>c.name==="first-mode-0");
const otherSecret=secret+1n;
const suite=poseidon4([1000n,1n,0n,0n]);
const packed=BigInt(lineage.birthYear)*33554432n+BigInt(lineage.birthMonth)*131072n+BigInt(lineage.birthDay)*512n+BigInt(lineage.gender)*2n+BigInt(lineage.isBirthBC);
const otherI=poseidon4([1002n,poseidon4([1001n,BigInt(lineage.nameField),otherSecret,suite]),packed,suite]);
const otherDir=path.join(out,"wrong-identity-issuer");const other=await makeIssuer(otherDir,1,{identityCommitment:String(otherI),derivedSecretField:String(otherSecret)});
addBad("wrong-authenticated-identity",independent,{inputDir:otherDir,signals:other,usage:extras(other,independent.ciphertexts,independent.extras.messageId)});
const ownerDir=path.join(out,"wrong-owner-issuer");const ownerOther=await makeIssuer(ownerDir,1,{spendingSecret:"987654321",ownerCommitment:String(protocol.computeShieldedOwnerCommitment(987654321n))});
addBad("wrong-authenticated-owner",independent,{inputDir:ownerDir,signals:ownerOther,usage:extras(ownerOther,independent.ciphertexts,independent.extras.messageId)});
const modeDir=path.join(out,"wrong-mode-issuer");const modeOther=await makeIssuer(modeDir,1,{spendingSecret:String(identityModeKeys.ownerSecret),ownerCommitment:String(identityModeKeys.ownerCommitment)});
addBad("wrong-authenticated-key-mode",identity,{inputDir:modeDir,mode:"1",signals:modeOther,usage:extras(modeOther,identity.ciphertexts,identity.extras.messageId)});
if(viewFields){
 const viewDir=path.join(out,"wrong-view-issuer");
 const viewOther=await makeIssuer(viewDir,1,{viewKeyLo:String(BigInt(independent.issuerSignals[5])^1n)});
 addBad("wrong-authenticated-view-key",independent,{inputDir:viewDir,signals:viewOther,usage:extras(viewOther,independent.ciphertexts,independent.extras.messageId)});
 const refill=cases.find(c=>c.name==="refill-mode-0"),wrongTagWires=JSON.parse(fs.readFileSync(refill.witnessFile,"utf8"));
 wrongTagWires[names.oldBudgetIsClaim]="0";
 addBad("wrong-old-template-producer-tag",refill,{wires:wrongTagWires});
}
const badT={...identity.extras,expiresAt:"1900000001"};badT.binding=binding(badT,identity.issuerSignals);addBad("wrong-authenticated-expiry",identity,{usage:badT});
addBad("revoked-counter-under-new-root",identity,{usage:extras(identity.issuerSignals,identity.ciphertexts,identity.extras.messageId,incremented)});
const badWires=JSON.parse(fs.readFileSync(identity.witnessFile,"utf8"));badWires[names.heirIdentityCommitment]=String(BigInt(badWires[names.heirIdentityCommitment])+1n);addBad("invalid-full-fund-relation",identity,{wires:badWires});
const constants={};const pkg=path.dirname(require.resolve("poseidon-lite"));
for(const n of [2,3]){const raw=require(path.join(pkg,`constants/${n}.js`)).default;const decode=x=>Array.isArray(x)?x.map(decode):BigInt("0x"+Buffer.from(x,"base64").toString("hex")).toString();constants[n]={C:decode(raw.C),M:decode(raw.M)};}
const constantsFile=path.join(out,"poseidon-constants.json");write(constantsFile,constants);
const manifest={scope:"Full existing Fund R1CS relation + identity-disclosing issuer authentication + private counter state; synthetic notes/ciphertexts, not real funds or HPKE E2E",relationFile:modelFile,constantsFile,chainId:String(chainId),poolAddress,issuerPublicSignalNames:["alias","counter","expiresAt","identityCommitment","ownerCommitment","viewKeyLo","viewKeyHi","keyMode","identitySuiteId","independentKeySuiteId","independentKeyDerivationVersion","receiveCodeVersion"],fundPublicNames:publicNames,publicSignalNames:["chainId","consumer","action","messageId","cipherLo","cipherHi","checkpointId","stateRoot","asOf","expiresAt","binding",...publicNames.map(x=>"fund."+x)],cases,limitations:["Actual 512-byte synthetic ciphertext hashes are bound; encryption correctness and recipient view-key recovery are not proved","Existing donor/template note roots and lineage roots are fixtures, not live pool state","Payer selectively learns I; I and all issuer public signals remain private on chain","Counter-update ownership authorization is not included; state fixture proves lookup only","No budgetR field, recovery secret, registration table or Claim formula changes"]};
if(viewFields){
 manifest.scope="Proposed research-only Fund producer-tag and viewing-key-bound budget schema + identity-disclosing issuer authentication + private counter state; no production Claim integration";
 manifest.viewFields=true;
 manifest.schemaWitnessChecks=schemaWitnessChecks;
 manifest.budgetSchema={researchOnly:true,authorizationArity:5,authorizationFields:["authorizationTag","ownerCommitment","keyMode","viewKeyLo","viewKeyHi"],fundProducerPurpose:String(researchFundPurpose),claimProducerPurpose:String(researchClaimPurpose),oldTemplateSelector:"oldBudgetIsClaim",oldViewBinding:"Old template and output reuse the same heirViewKeyLo/Hi authenticated by the outer circuit",outputLeaves:2};
 manifest.limitations=manifest.limitations.filter(s=>s!=="No budgetR field, recovery secret, registration table or Claim formula changes");
 manifest.limitations.push("Proposed Fund and common circuits are copied into this temp directory; production circuits, codecs and Claim remain unchanged", "Claim-tag old templates are synthetic commitment fixtures, not outputs of an executed modified Claim proof", "Existing baseline budget schema is not compatible with this optional proposal; production Claim/codec/recovery integration remains unimplemented", "The outer circuit must enforce heirViewKeyLo/Hi == authenticated issuer viewing-key limbs; JavaScript witness filling alone is not authentication", "No budgetR field, additional leaf, registration table or recovery secret is added");
}
write(path.join(out,"fund-manifest.json"),manifest);
log(JSON.stringify({out,manifest:path.join(out,"fund-manifest.json"),nConstraints:relation.nConstraints,nVars:relation.nVars,nPublic:publicCount,cases:cases.length,poolAddress}));
process.exit(0);
