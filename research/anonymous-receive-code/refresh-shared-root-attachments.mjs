// RESEARCH ONLY. Refresh witnesses without replacing issuance or outer setup.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";

const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,(_,v)=>typeof v==="bigint"?String(v):v,2)+"\n");
export const extraFundName="unrelated-first-mode-0";
export function sharedPath(hash2,target,extra,second=false){
 const targetPair=hash2([BigInt(target.commitment),BigInt(target.changeCommitment)]);
 const extraPair=hash2([BigInt(extra.commitment),BigInt(extra.changeCommitment)]);
 return {budgetRoot:String(hash2([targetPair,extraPair])),depth:"2",index:second?"2":"0",siblings:[second?extra.changeCommitment:target.changeCommitment,String(second?targetPair:extraPair),...Array(6).fill("0")]};
}
export function mergeSharedFund(fundDir,extraFile){
 const fund=read(path.join(fundDir,"fund-manifest.json"));
 let extra=fund.cases.find(c=>c.valid&&c.name===extraFundName);
 if(!extra){
  const source=read(extraFile??path.join(fundDir,"shared-root-extra-inputs/shared-root-fund-manifest.json"));
  extra=structuredClone(source.cases.find(c=>c.valid&&c.name===extraFundName));assert.ok(extra);
  extra.proofDirectory="shared-root-extra";fund.cases.push(extra);
 }
 return {fund,extra};
}

export async function refresh(root,fundDir,out,extraFile){
 root=fs.realpathSync(path.resolve(root));fundDir=path.resolve(fundDir);out=path.resolve(out);
 assert.ok(!out.startsWith(root+path.sep));
 const require=createRequire(path.join(root,"package.json"));
 const {poseidon2,poseidon3,poseidon5,poseidon8}=require("poseidon-lite");
 const {keccak256,hexlify}=require("ethers");
 const protocol=await import(pathToFileURL(path.join(root,"packages/protocol-core/index.js")));
 const {buildLineageFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_lineage_fixture.mjs")));
 const {fund,extra}=mergeSharedFund(fundDir,extraFile);assert.ok(extra.budgetOpening);
 const manifestFile=path.join(out,"attachment-manifest.json"),manifest=read(manifestFile);
 const originals=new Map(manifest.cases.map(c=>[c.name,c]));
 const pool=BigInt(manifest.poolAddress),chain=31337n,consumer=BigInt(manifest.consumer);
 const scoped=n=>poseidon3([1032n,poseidon3([1031n,chain,pool]),BigInt(n)]);
 const leaf=(a,p,purpose=202610210301n)=>poseidon8([scoped(purpose),BigInt(a.policy),BigInt(a.enrollment),poseidon5([scoped(1033n),BigInt(p[3]),BigInt(p[6]),BigInt(p[4]),BigInt(p[5])]),BigInt(a.rate),BigInt(a.remaining),BigInt(a.nonce),BigInt(a.ciphertextHash)]);
 const relation=(a,u,p)=>String(poseidon3([poseidon3([202610210401n,pool,leaf(a,p)]),BigInt(u.binding),BigInt(u.salt)]));
 function binding(u,p){
  let x=poseidon3([202610210101n,chain,consumer]);
  for(const[a,b]of[[u.action,u.messageId],[u.cipherLo,u.cipherHi],[u.checkpointId,u.stateRoot],[u.asOf,u.expiresAt]])x=poseidon3([x,BigInt(a),BigInt(b)]);
  let r=poseidon3([202610210102n,BigInt(p[0]),BigInt(p[3])]);r=poseidon3([r,BigInt(p[6]),BigInt(p[4])]);r=poseidon3([r,BigInt(p[5]),BigInt(u.salt)]);
  return String(poseidon2([r,x]));
 }
 const cases=[];
 for(const original of manifest.cases.filter(c=>c.name!=="shared-root-second-budget")){
  const c=structuredClone(original),a=read(c.attachmentFile),u=read(c.extrasFile),p=read(path.join(c.inputDir,`mode-${c.mode}.public.json`));
  const f=fund.cases.find(f=>f.name===c.sourceFundCase&&f.valid);assert.ok(f,`Unknown source ${c.sourceFundCase}`);
  const target={...f.budgetOpening};
  // Preserve the producer negative's Claim leaf rather than silently turning
  // it into the Fund commitment accepted by the fixed circuit.
  if(c.name==="claim-budget-cannot-pose-as-fund")target.commitment=c.budgetCommitment;
  Object.assign(a,sharedPath(poseidon2,target,extra.budgetOpening));
  a.relation=relation(a,u,p);
  if(c.name==="wrong-membership-path")a.siblings[0]="123";
  if(c.name==="wrong-reference-relation")a.relation="123";
  if(c.name==="zero-depth")a.depth="0";
  if(c.name==="excess-depth")a.depth="9";
  if(c.name==="inactive-index-bit")a.index="4";
  if(c.name==="inactive-sibling")a.siblings[2]="123";
  c.attachment=a;c.extras=u;c.sourceFundCases=[f.name,extra.name];c.sourceBudgetRoot=a.budgetRoot;
  if(["wrong-view","wrong-owner","wrong-mode","claim-budget-cannot-pose-as-fund"].includes(c.name))c.adaptiveRelation=true;
  write(c.attachmentFile,a);cases.push(c);
 }
 const first=cases.find(c=>c.name==="attach-first-mode-0"),target=fund.cases.find(c=>c.name==="first-mode-0");assert.ok(first&&target);
 const c=structuredClone(first),o=extra.budgetOpening,p=read(path.join(first.inputDir,"mode-0.public.json"));
 assert.deepEqual([o.owner,o.viewLo,o.viewHi,o.keyMode],p.slice(3,7));
 const message=String(cases.reduce((max,c)=>BigInt(c.extras.messageId)>max?BigInt(c.extras.messageId):max,0n)+1n),salt=String(999000n+BigInt(message));
 const material=protocol.deriveShieldedHeirKeyMaterial(BigInt(buildLineageFixture().witness.derivedSecretField));
 const view=await protocol.deriveShieldedViewPublicKey(material.hpkeIkm);
 const envelope={version:1,body:"家书研究样例",budgetPool:manifest.poolAddress,budgetCommitment:o.commitment,salt};
 const ciphertext=hexlify(await protocol.encryptShieldedNote({chainId:chain,poolAddress:manifest.consumer,recipientPublicKey:view,payload:new TextEncoder().encode(JSON.stringify(envelope))}));
 const digest=BigInt(keccak256(ciphertext));
 const u={...c.extras,messageId:message,salt,cipherLo:String(digest&((1n<<128n)-1n)),cipherHi:String(digest>>128n)};u.binding=binding(u,p);
 const a={...c.attachment,...sharedPath(poseidon2,target.budgetOpening,o,true),policy:o.policy,enrollment:o.enrollment,rate:o.rate,remaining:o.remaining,nonce:o.nonce,ciphertextHash:o.ciphertextHash};a.relation=relation(a,u,p);
 assert.equal(String(leaf(a,p)),o.commitment);
 const recovered=JSON.parse(new TextDecoder().decode(await protocol.decryptShieldedNote({chainId:chain,poolAddress:manifest.consumer,hpkeIkm:material.hpkeIkm,ciphertext})));
 assert.equal(recovered.budgetCommitment,o.commitment);assert.equal(recovered.salt,salt);
 c.name="shared-root-second-budget";c.sourceFundCase=extra.name;c.sourceFundCases=[target.name,extra.name];c.budgetCommitment=o.commitment;c.ciphertext=ciphertext;c.extras=u;c.attachment=a;c.sourceBudgetRoot=a.budgetRoot;c.envelopeMatches=true;
 c.extrasFile=path.join(out,c.name+".extras.json");c.attachmentFile=path.join(out,c.name+".attachment.json");write(c.extrasFile,u);write(c.attachmentFile,a);cases.push(c);
 assert.equal(c.sourceBudgetRoot,first.sourceBudgetRoot);assert.notEqual(c.budgetCommitment,first.budgetCommitment);
 // Refresh supplementary aliases while keeping ten unique negative conditions
 // in the main manifest. They need not be proved a second time.
 for(const file of ["additional-negatives-manifest.json","path-normalization-manifest.json"]){
  const full=path.join(out,file);if(!fs.existsSync(full))continue;
  const auxiliary=read(full);
  auxiliary.cases=auxiliary.cases.map(old=>{
   const base=cases.find(c=>c.name===old.name.replace(/-adaptive-relation$/u,""));assert.ok(base);
   const alias={...structuredClone(base),name:old.name,attachmentFile:old.attachmentFile};write(alias.attachmentFile,alias.attachment);return alias;
  });
  auxiliary.sharedBudgetRoots=true;write(full,auxiliary);
 }
 const sharedFund=path.join(out,"shared-fund-manifest.json");write(sharedFund,fund);
 manifest.fundManifestFile=sharedFund;manifest.proofDirectory="shared-outer";manifest.sharedBudgetRoots=true;
 manifest.sharedRootWitness={firstCase:first.name,secondCase:c.name,root:c.sourceBudgetRoot,distinctBudgetCommitments:[first.budgetCommitment,c.budgetCommitment],sourceFundCases:[target.name,extra.name]};
 manifest.cases=cases;manifest.limitations.push("Shared four-leaf research roots contain two distinct valid Fund budgets; this demonstrates hidden leaf selection within the fixture, not formal anonymity or production pool capacity");
 assert.equal(cases.filter(c=>c.valid).length,9);assert.equal(cases.filter(c=>!c.valid).length,10);
 for(const c of cases.filter(c=>c.valid)){
  const old=originals.get(c.name);if(old)assert.equal(c.extras.salt,old.extras.salt,"Refresh must retain existing randomizer definition/value");
 }
 write(manifestFile,manifest);write(path.join(out,"shared-root-attachment-manifest.json"),manifest);
 console.log(JSON.stringify({manifest:manifestFile,valid:9,uniqueInvalid:10,sharedRoot:manifest.sharedRootWitness.root,issuerSetupReused:true,outerSetupReused:true}));
 return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await refresh(process.argv[2]??path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."),process.argv[3]??"/tmp/deepfamily-fund-view-p0",process.argv[4]??"/tmp/deepfamily-attachment-p0",process.argv[5]);
}
