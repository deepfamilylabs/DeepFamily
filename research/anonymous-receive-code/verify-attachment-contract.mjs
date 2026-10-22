// Isolated research: real Fund creates the root; an anonymous proof consumes it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import hre from "hardhat";
import {poseidon2,poseidon3} from "poseidon-lite";
import * as protocol from "../../packages/protocol-core/index.js";
import {buildLineageFixture} from "../../circuits/test/generate_lineage_fixture.mjs";

assert.ok(process.env.DEEPFAMILY_ATTACHMENT_OUT,"Expected temporary attachment output");
const out=path.resolve(process.env.DEEPFAMILY_ATTACHMENT_OUT);
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const manifest=read(path.join(out,"attachment-manifest.json")),fund=read(manifest.fundManifestFile??path.join(manifest.fundDir,"fund-manifest.json"));
const valid=manifest.cases.filter(c=>c.valid);
const sources={};
sources["FundVerifier.sol"]={content:fs.readFileSync(path.join(manifest.fundDir,"outer/FundCompositionVerifier.sol"),"utf8")};
sources["LetterVerifier.sol"]={content:fs.readFileSync(path.join(out,"outer/AttachmentVerifier.sol"),"utf8")};
for(const name of ["FundCompositionConsumer.sol","AttachmentConsumer.sol"])sources[name]={content:fs.readFileSync(new URL("./"+name,import.meta.url),"utf8")};
// Use the installed package's deployable library bytecode. Compiling its large
// assembly body as a contract through viaIR can exceed EIP-170's size limit.
const poseidonDeployment=createRequire(import.meta.url)("poseidon-solidity/deploy/PoseidonT3.js");
const solc=process.env.DEEPFAMILY_RESEARCH_SOLC??path.join(os.homedir(),"Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const input={language:"Solidity",sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}}};
const compiled=JSON.parse(execFileSync(solc,["--standard-json"],{input:JSON.stringify(input),encoding:"utf8",maxBuffer:40*1024*1024}));
assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==="error"),[]);
const findVerifier=file=>Object.values(compiled.contracts[file]).find(a=>a.abi.some(f=>f.name==="verifyProof"));
const connection=await hre.network.create(),{ethers}=connection,provider=ethers.provider;
const checks=[],gas={};const mark=test=>checks.push({test,passed:true});
const err=(...names)=>e=>names.some(n=>String(e.message).includes(n)||String(e.message).includes(ethers.id(n+"()").slice(0,10)));
const proofFor=c=>read(path.join(out,manifest.proofDirectory??"outer",c.name,"proof.json"));
function args(c=valid[0],patch={}){
 const x={...c.extras,...c.attachment,budgetPool:manifest.poolAddress,ciphertext:c.ciphertext,proof:proofFor(c).solidityProof,...patch};
 return [x.messageId,x.ciphertext,x.checkpointId,x.asOf,x.expiresAt,x.binding,x.budgetPool,x.budgetRoot,x.relation,x.proof];
}
async function time(t){await provider.send("evm_setNextBlockTimestamp",[Number(t)]);await provider.send("evm_mine",[]);}
try{
 const [signer,other]=await ethers.getSigners();
 const deploy=async(a,s,...ctor)=>{const c=await new ethers.ContractFactory(a.abi,a.evm.bytecode.object,s).deploy(...ctor);await c.waitForDeployment();return c;};
 const T=1900000000n;await time(T-2000n);
 const hasher=await deploy({abi:["function hash(uint256[2]) pure returns (uint256)"],evm:{bytecode:{object:poseidonDeployment.bytecode}}},other);
 assert.equal(String(await hasher.hash([1,2])),String(poseidon2([1n,2n])));mark("contract Poseidon2 matches independent JS reference");
 const fv=await deploy(findVerifier("FundVerifier.sol"),signer);
 const funds=fund.cases.filter(c=>c.valid),roots=[...new Set(funds.flatMap(c=>c.publicFund.slice(16,18)))];
 const source=await deploy(compiled.contracts["AttachmentConsumer.sol"].FundAttachmentSource,signer,
  await fv.getAddress(),manifest.initialCounterRoot,roots,...funds[0].publicFund.slice(24,27),await hasher.getAddress());
 assert.equal((await source.getAddress()).toLowerCase(),manifest.poolAddress.toLowerCase());
 const lv=await deploy(findVerifier("LetterVerifier.sol"),signer);
 const consumer=await deploy(compiled.contracts["AttachmentConsumer.sol"].AttachmentConsumer,signer,await lv.getAddress(),await source.getAddress());
 assert.equal((await consumer.getAddress()).toLowerCase(),manifest.consumer.toLowerCase());
 const second=await deploy(compiled.contracts["AttachmentConsumer.sol"].AttachmentConsumer,signer,await lv.getAddress(),await source.getAddress());
 await time(T-1900n);
 let snapshot=await provider.send("evm_snapshot",[]);
 const restore=async()=>{assert.equal(await provider.send("evm_revert",[snapshot]),true);snapshot=await provider.send("evm_snapshot",[]);};
 async function createSource(c){
  let receipt;
  for(const name of c.sourceFundCases??[c.sourceFundCase]){
   const f=funds.find(x=>x.name===name),p=read(path.join(manifest.fundDir,f.proofDirectory??"outer",f.name,"proof.json")),u=f.extras;
   receipt=await(await source.fund(u.messageId,f.ciphertexts,u.checkpointId,u.asOf,u.expiresAt,u.binding,f.publicFund,p.solidityProof)).wait();
  }
  assert.equal(await source.knownFundRoots(c.sourceBudgetRoot),true);
  const event=receipt.logs.map(l=>{try{return source.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==="VerifiedFundRoot");
  assert.equal(String(event.args.root),c.sourceBudgetRoot);
 }
 const sharedA=valid.find(c=>c.name==="attach-first-mode-0"),sharedB=valid.find(c=>c.name==="shared-root-second-budget");
 assert.ok(sharedA&&sharedB,"shared-root privacy fixture is required");
 assert.notEqual(sharedA.budgetCommitment,sharedB.budgetCommitment);
 assert.equal(sharedA.sourceBudgetRoot,sharedB.sourceBudgetRoot);
 assert.equal(sharedA.attachment.budgetRoot,sharedB.attachment.budgetRoot);
 mark("two distinct verified Fund budgets use the same public shared root");
 const hpkeIkm=protocol.deriveShieldedHeirKeyMaterial(BigInt(buildLineageFixture().witness.derivedSecretField)).hpkeIkm;
 for(const c of valid){
  await assert.rejects(()=>consumer.getFunction("attach").staticCall(...args(c)),err("InvalidSource"));mark(c.name+": unregistered root rejected before successful Fund");
  await createSource(c);mark(c.name+": source root created by actual successful Fund proof");
  const p=proofFor(c);await lv.verifyProof.staticCall(p.solidityProof,p.publicSignals);
  const receipt=await(await consumer.getFunction("attach")(...args(c))).wait();gas[c.name]=receipt.gasUsed.toString();
  mark(c.name+": real anonymous attachment transaction accepted");
  await assert.rejects(()=>consumer.getFunction("attach").staticCall(...args(c)),err("AlreadyUsed"));mark(c.name+": duplicate rejected");
  const plaintext=await protocol.decryptShieldedNote({chainId:31337n,poolAddress:manifest.consumer,hpkeIkm,ciphertext:c.ciphertext});
  const envelope=JSON.parse(new TextDecoder().decode(plaintext));
  const relation=poseidon3([poseidon3([202610210401n,BigInt(envelope.budgetPool),BigInt(envelope.budgetCommitment)]),BigInt(c.extras.binding),BigInt(envelope.salt)]);
  const matches=String(relation)===c.attachment.relation;
  assert.equal(matches,c.name!=="encrypted-reference-mismatch");
  mark(c.name+(matches?": actual HPKE recovery confirms encrypted budget reference":": actual HPKE recovery rejects display for forged encrypted budget reference"));
  await restore();
 }
 const c=valid[0];await createSource(c);
 for(const[name,patch,expected]of[
  ["ciphertext",{ciphertext:"0x010203"},"InvalidProof"],
  ["relation",{relation:String(BigInt(c.attachment.relation)+1n)},"InvalidProof"],
  ["message",{messageId:"999"},"InvalidProof"],
  ["expiry",{expiresAt:"1900000010"},"InvalidProof"],
  ["fake pool",{budgetPool:other.address},"InvalidSource"],
  ["zero root",{budgetRoot:"0"},"InvalidSource"]
 ]){await assert.rejects(()=>consumer.getFunction("attach").staticCall(...args(c,patch)),err(expected));mark("changed actual "+name+" rejected");}
 await assert.rejects(()=>second.getFunction("attach").staticCall(...args()),err("InvalidProof"));mark("cross-letter-contract replay rejected");
 for(const[name,i]of[["chain",0],["action",2]]){const p=proofFor(c),s=[...p.publicSignals];s[i]=String(BigInt(s[i])+1n);await assert.rejects(()=>lv.verifyProof.staticCall(p.solidityProof,s));mark("changed "+name+" rejected by real verifier");}
 await time(T-1700n);await(await source.advanceFixtureCounterRoot(BigInt(manifest.initialCounterRoot)+1n)).wait();
 const retired=(await source.checkpoints(1)).retiredAt;
 await time(retired+899n);await consumer.getFunction("attach").staticCall(...args());mark("shared Fund counter retirement+899 accepted");
 await time(retired+900n);await assert.rejects(()=>consumer.getFunction("attach").staticCall(...args()),err("CheckpointExpired"));mark("shared Fund counter retirement+900 rejected");
 await restore();await createSource(c);await time(T-1n);await consumer.getFunction("attach").staticCall(...args());mark("attachment accepted at authenticated expiry-1");
 await time(T);await assert.rejects(()=>consumer.getFunction("attach").staticCall(...args()),err("ExpiredCode"));mark("attachment rejected immediately at authenticated expiry");
 const result={scope:"two real Fund transactions to one four-leaf shared root to anonymous attachment proof to actual HPKE reference check; isolated fixture state",checks,gas,limitations:manifest.limitations};
 fs.writeFileSync(path.join(out,"attachment-contract-results.json"),JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify({passed:true,checks:checks.length,gas},null,2));
}finally{await connection.close();}
