// RESEARCH ONLY. Proposed Fund/Claim producer tags and full view-key binding.
// Generated sources and all synthetic witnesses stay outside the repository.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createHash} from "node:crypto";

const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,(_,v)=>typeof v==="bigint"?String(v):v,2)+"\n");
const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
function patch(source,before,after){assert.equal(source.split(before).length,2,`Expected one patch anchor: ${before}`);return source.replace(before,after);}

export async function prepare(root,out,fundManifestFile="/tmp/deepfamily-fund-view-p0/fund-manifest.json"){
 root=fs.realpathSync(path.resolve(root));out=path.resolve(out);
 assert.ok(!out.startsWith(root+path.sep));fs.mkdirSync(out,{recursive:true});
 const require=createRequire(path.join(root,"package.json"));
 const {poseidon2,poseidon3,poseidon4,poseidon5,poseidon8}=require("poseidon-lite");
 const {keccak256}=require("ethers");
 const {WitnessCalculatorBuilder}=require("circom_runtime");
 const {readR1cs}=await import(pathToFileURL(require.resolve("r1csfile")));
 const {buildShieldedClaimFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_shielded_claim_input.mjs")));
 const {shieldedFixtureTag}=await import(pathToFileURL(path.join(root,"circuits/test/shielded_scope_fixture.mjs")));
 const fund=read(fundManifestFile);assert.equal(fund.viewFields,true);
 const chainId=BigInt(fund.chainId),pool=BigInt(fund.poolAddress),scoped=n=>shieldedFixtureTag(n,chainId,pool);
 const FUND=202610210301n,CLAIM=202610210302n,q=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
 let common=fs.readFileSync(path.join(root,"circuits/shielded_funding_common.circom"),"utf8");
 common=patch(common,"    signal input ownerCommitment;\n    signal input rate;","    signal input ownerCommitment;\n    signal input viewKeyLo;\n    signal input viewKeyHi;\n    signal input rate;");
 common=patch(common,"    component ownerAuthorization = Poseidon(3);","    component ownerAuthorization = Poseidon(5);");
 common=patch(common,"    ownerAuthorization.inputs[2] <== keyMode;","    ownerAuthorization.inputs[2] <== keyMode;\n    ownerAuthorization.inputs[3] <== viewKeyLo;\n    ownerAuthorization.inputs[4] <== viewKeyHi;");
 fs.writeFileSync(path.join(out,"shielded_funding_common.circom"),common);
 let source=fs.readFileSync(path.join(root,"circuits/shielded_claim.circom"),"utf8");
 source=patch(source,"    signal input ownerSecret;","    signal input ownerSecret;\n    signal input heirViewKeyLo;\n    signal input heirViewKeyHi;\n    signal input inputIsClaim;\n    signal input secondInputIsClaim;");
 source=patch(source,"    budgetTags.poolDomain <== sharedScope.domain;",`    budgetTags.poolDomain <== sharedScope.domain;
    // RESEARCH ONLY. Producer tags are fixed circuit constants.
    component researchFundTag = ShieldedScopedTag();
    researchFundTag.poolDomain <== sharedScope.domain;
    researchFundTag.purpose <== ${FUND};
    component researchClaimTag = ShieldedScopedTag();
    researchClaimTag.poolDomain <== sharedScope.domain;
    researchClaimTag.purpose <== ${CLAIM};
    inputIsClaim * (1 - inputIsClaim) === 0;
    secondInputIsClaim * (1 - secondInputIsClaim) === 0;
    (1 - hasSecondInput) * secondInputIsClaim === 0;
    component researchViewLoBits = Num2Bits(128);
    researchViewLoBits.in <== heirViewKeyLo;
    component researchViewHiBits = Num2Bits(128);
    researchViewHiBits.in <== heirViewKeyHi;
    budgetKind * heirViewKeyLo === 0;
    budgetKind * heirViewKeyHi === 0;`);
 source=patch(source,"    oldBudget.privateNoteTag <== budgetTags.privateNoteTag;","    oldBudget.privateNoteTag <== researchFundTag.tag + inputIsClaim * (researchClaimTag.tag - researchFundTag.tag);");
 source=patch(source,"    secondBudget.privateNoteTag <== budgetTags.privateNoteTag;","    secondBudget.privateNoteTag <== researchFundTag.tag + secondInputIsClaim * (researchClaimTag.tag - researchFundTag.tag);");
 source=patch(source,"    nextBudget.privateNoteTag <== budgetTags.privateNoteTag;","    nextBudget.privateNoteTag <== researchClaimTag.tag;");
 for(const name of ["oldBudget","secondBudget","nextBudget"]){
  source=patch(source,`    ${name}.ownerCommitment <== ownerCommitment.out;`,`    ${name}.ownerCommitment <== ownerCommitment.out;\n    ${name}.viewKeyLo <== heirViewKeyLo;\n    ${name}.viewKeyHi <== heirViewKeyHi;`);
 }
 fs.writeFileSync(path.join(out,"shielded_claim.circom"),source);
 const start=performance.now();
 const compileLog=execFileSync(path.join(root,"bin/circom"),[path.join(out,"shielded_claim.circom"),"--r1cs","--wasm","--sym","--O2","--sanity_check","2","-l",path.join(root,"circuits"),"-l",path.join(root,"node_modules"),"-l",path.join(root,"node_modules/circomlib/circuits"),"-o",out],{cwd:out,encoding:"utf8"});
 fs.writeFileSync(path.join(out,"compile.log"),compileLog);console.log(compileLog.trim());
 const r1cs=path.join(out,"shielded_claim.r1cs"),wasm=path.join(out,"shielded_claim_js/shielded_claim.wasm");
 const relation=await readR1cs(r1cs,false,false,true);
 const publicCount=relation.nOutputs+relation.nPubInputs;
 assert.ok(relation.nConstraints+publicCount+1<131072,"Claim proposal exceeds pinned ptau17 capacity; do not silently download another setup");
 const calculator=await WitnessCalculatorBuilder(fs.readFileSync(wasm),{singleThread:true});
 const cases=[],negativeChecks=[];let caseId=0;
 const authorization=o=>poseidon5([scoped(1033n),BigInt(o.owner),BigInt(o.keyMode),BigInt(o.viewLo),BigInt(o.viewHi)]);
 const commitment=o=>poseidon8([scoped(o.noteTagPurpose),BigInt(o.policy),BigInt(o.enrollment),authorization(o),BigInt(o.rate),BigInt(o.remaining),BigInt(o.nonce),BigInt(o.ciphertextHash)]);
 const zeros=()=>Array(32).fill("0");
 function sourceFromFund(name){
  const c=fund.cases.find(c=>c.name===name&&c.valid);assert.ok(c?.budgetOpening);
  const opening={...c.budgetOpening};assert.equal(String(commitment(opening)),opening.commitment);
  return {opening,root:String(poseidon2([BigInt(opening.commitment),BigInt(opening.changeCommitment)])),depth:"1",index:"0",siblings:[opening.changeCommitment,...Array(31).fill("0")],producer:"Fund",sourceCase:name,sourceManifest:fundManifestFile};
 }
 async function makeCase(name,keyMode,first,second=null,periodStart=0,claimCount=2){
  const f=buildShieldedClaimFixture({chainId,poolAddress:fund.poolAddress,keyMode,claimCount,remainingPeriods:Number(BigInt(first.opening.remaining)/BigInt(first.opening.rate)),secondRemainingPeriods:second?Number(BigInt(second.opening.remaining)/BigInt(second.opening.rate)):0});
  const input={...f.witness};
  assert.equal(String(f.policy),first.opening.policy);assert.equal(String(f.enrollment),first.opening.enrollment);
  input.heirViewKeyLo=first.opening.viewLo;input.heirViewKeyHi=first.opening.viewHi;
  input.inputIsClaim=first.producer==="Claim"?"1":"0";input.secondInputIsClaim=second?.producer==="Claim"?"1":"0";
  input.budgetNonce=first.opening.nonce;input.budgetCiphertextHash=first.opening.ciphertextHash;
  input.noteDepth=first.depth;input.noteIndex=first.index;input.noteSiblings=first.siblings;
  input.inputRoots=[first.root,second?.root??first.root];
  if(second){
   assert.equal(second.opening.policy,first.opening.policy);assert.equal(second.opening.enrollment,first.opening.enrollment);
   assert.equal(second.opening.viewLo,first.opening.viewLo);assert.equal(second.opening.viewHi,first.opening.viewHi);
   input.secondBudgetNonce=second.opening.nonce;input.secondBudgetCiphertextHash=second.opening.ciphertextHash;
   input.secondNoteDepth=second.depth;input.secondNoteIndex=second.index;input.secondNoteSiblings=second.siblings;
  }
  const ownerSecret=BigInt(input.ownerSecret),old=BigInt(first.opening.commitment),secondOld=BigInt(second?.opening.commitment??0);
  input.inputNullifiers=[String(poseidon3([scoped(1016n),ownerSecret,old])),String(poseidon3([scoped(second?1016n:1021n),ownerSecret,second?secondOld:old]))];
  const indices=Array.from({length:12},(_,i)=>i<claimCount?BigInt(periodStart+i):0n);
  input.periodIndices=indices.map(String);
  input.asOf=String(BigInt(input.eligibleFrom)+BigInt(periodStart+claimCount)*BigInt(input.periodDays)*86400n);
  input.periodNullifiers=indices.map((v,i)=>String(i<claimCount?poseidon4([scoped(1017n),BigInt(input.derivedSecretField),f.policy,v]):poseidon4([scoped(1019n),ownerSecret,old,BigInt(i)])));
  input.newBudgetNonce=String(91000+caseId*10);input.payoutNonce=String(92000+caseId*10);
  const ciphertexts=[0,1].map(i=>"0x"+Buffer.alloc(512,0x90+caseId*2+i).toString("hex"));
  input.ciphertextHashes=ciphertexts.map(c=>String(BigInt(keccak256(c))%q));
  const remaining=BigInt(first.opening.remaining)+BigInt(second?.opening.remaining??0)-BigInt(input.rate)*BigInt(claimCount);
  const opening={...first.opening,noteTagPurpose:String(CLAIM),nonce:input.newBudgetNonce,ciphertextHash:input.ciphertextHashes[0],remaining:String(remaining),producer:"Claim"};
  const next=commitment(opening),payout=poseidon5([scoped(1014n),f.ownerCommitment,BigInt(input.rate)*BigInt(claimCount),BigInt(input.payoutNonce),BigInt(input.ciphertextHashes[1])]);
  opening.commitment=String(next);opening.changeCommitment=String(payout);
  input.outputCommitments=[String(next),String(payout)];
  const wires=await calculator.calculateWitness(input,1);
  const inputFile=path.join(out,name+".input.json");write(inputFile,input);
  const c={name,keyMode,hasSecondInput:Boolean(second),inputFile,publicSignals:wires.slice(1,publicCount+1).map(String),inputSources:[first,...(second?[second]:[])],outputOpening:opening,ciphertexts};
  cases.push(c);caseId++;
  return {c,input,source:{opening,root:String(poseidon2([next,payout])),depth:"1",index:"0",siblings:[String(payout),...Array(31).fill("0")],producer:"Claim",sourceCase:name}};
 }
 async function reject(name,input){
  let error;try{await calculator.calculateWitness(input,1);}catch(e){error=e;}
  assert.ok(error,`${name}: invalid witness accepted`);assert.match(String(error.message),/Assert Failed|Error in template|constraint/i);
  negativeChecks.push({name,passed:true,scope:"Circom witness constraint rejection; no invalid proof was produced"});
 }
 for(const mode of [0,1]){
  const a=sourceFromFund(`first-mode-${mode}`),b=sourceFromFund(`refill-mode-${mode}`);
  const first=await makeCase(`fund-single-mode-${mode}`,mode,a,null,0,2);
  const other=await makeCase(`fund-refill-single-mode-${mode}`,mode,b,null,2,2);
  await makeCase(`claim-single-mode-${mode}`,mode,first.source,null,2,1);
  const dual=await makeCase(`fund-dual-mode-${mode}`,mode,a,b,0,2);
  await makeCase(`claim-dual-mode-${mode}`,mode,first.source,other.source,4,2);
  const changedView=BigInt(first.input.heirViewKeyLo)^1n;
  const changedOutput={...first.c.outputOpening,viewLo:String(changedView)};
  await reject(`mode-${mode}-view-change-with-consistent-output-and-fixed-old-root`,{...first.input,heirViewKeyLo:String(changedView),outputCommitments:[String(commitment(changedOutput)),first.input.outputCommitments[1]]});
  const differentSecond={...b.opening,viewLo:String(BigInt(b.opening.viewLo)^1n)};
  const differentCommitment=commitment(differentSecond),differentRoot=poseidon2([differentCommitment,BigInt(b.opening.changeCommitment)]);
  await reject(`mode-${mode}-dual-inputs-with-different-view`,{...dual.input,inputRoots:[dual.input.inputRoots[0],String(differentRoot)],inputNullifiers:[dual.input.inputNullifiers[0],String(poseidon3([scoped(1016n),BigInt(dual.input.ownerSecret),differentCommitment]))]});
  await reject(`mode-${mode}-wrong-first-origin`,{...first.input,inputIsClaim:"1"});
  await reject(`mode-${mode}-wrong-second-origin`,{...dual.input,secondInputIsClaim:"1"});
  await reject(`mode-${mode}-nonboolean-origin`,{...first.input,inputIsClaim:"2"});
 }
 const manifest={scope:"Research-only full Claim relation with proposed producer tags and preserved view; actual prior Fund commitments and internally generated Claim continuations, fixture lineage and roots, no production/contract integration",chainId:String(chainId),poolAddress:fund.poolAddress,fundManifestFile,r1cs,wasm,preparationMillis:Math.round(performance.now()-start),constraints:relation.nConstraints,publicCount,sourceR1csSHA256:createHash("sha256").update(fs.readFileSync(r1cs)).digest("hex"),schema:{fundPurpose:String(FUND),claimPurpose:String(CLAIM),authorizationArity:5,privateViewFields:["heirViewKeyLo","heirViewKeyHi"],privateOriginFields:["inputIsClaim","secondInputIsClaim"],outputs:2},cases,negativeChecks,limitations:["Generated sources are temporary copies; production Claim/common/codecs/recovery are unchanged", "No live pool/lineage roots or ledger nullifier state is enforced by this standalone proof script", "The cases include alternative branches; they are not one sequential shared-ledger transaction history", "Fund sources are commitments from the existing v2 Fund proof fixture; this script does not itself submit Fund or Claim transactions", "Ciphertexts are 512-byte synthetic bytes; hash binding is exercised, not HPKE encryption correctness", "Local development setup is not a production ceremony; depth/lineage fixtures are not production scalability evidence"]};
 write(path.join(out,"claim-manifest.json"),manifest);return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../../.."));
 const manifest=await prepare(root,path.resolve(process.argv[3]??"/tmp/deepfamily-claim-view-p0"),process.argv[4]);
 console.log(JSON.stringify({constraints:manifest.constraints,publicCount:manifest.publicCount,validWitnesses:manifest.cases.length,negativeWitnesses:manifest.negativeChecks.length}));
 process.exit(0);
}
