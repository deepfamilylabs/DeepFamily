// RESEARCH ONLY. Isolated EDR, real verifier, synthetic notes and ciphertexts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";
import hre from "hardhat";
import {build} from "./prepare-composition.mjs";

assert.ok(process.env.DEEPFAMILY_FUND_COMPOSITION_OUT,"Expected research output directory");
const out=path.resolve(process.env.DEEPFAMILY_FUND_COMPOSITION_OUT);
const read=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const manifest=read(path.join(out,"fund-manifest.json"));
const valid=manifest.cases.filter(c=>c.valid);
assert.equal(manifest.fundPublicNames.length,27);
const source=fs.readFileSync(path.join(out,"outer/FundCompositionVerifier.sol"),"utf8");
const consumerSource=fs.readFileSync(new URL("./FundCompositionConsumer.sol",import.meta.url),"utf8");
const solc=process.env.DEEPFAMILY_RESEARCH_SOLC??path.join(os.homedir(),"Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const compile={language:"Solidity",sources:{"FundVerifier.sol":{content:source},"FundConsumer.sol":{content:consumerSource}},settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}}};
const compiled=JSON.parse(execFileSync(solc,["--standard-json"],{input:JSON.stringify(compile),encoding:"utf8",maxBuffer:30*1024*1024}));
assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==="error"),[]);
const verifierArtifact=Object.values(compiled.contracts["FundVerifier.sol"]).find(a=>a.abi.some(f=>f.name==="verifyProof"));
const consumerArtifact=compiled.contracts["FundConsumer.sol"].FundCompositionConsumer;
const connection=await hre.network.create();
const {ethers}=connection,provider=ethers.provider;
const checks=[],gas={};
const mark=test=>checks.push({test,passed:true});
const errorIs=(...names)=>e=>names.some(n=>String(e.message).includes(n)||String(e.message).includes(ethers.id(n+"()").slice(0,10)));
const proofFor=c=>read(path.join(out,"outer",c.name,"proof.json"));
function args(c=valid[0],patch={}){
 const x={...c.extras,ciphertexts:c.ciphertexts,fundInputs:[...c.publicFund],proof:proofFor(c).solidityProof,...patch};
 return [x.messageId,x.ciphertexts,x.checkpointId,x.asOf,x.expiresAt,x.binding,x.fundInputs,x.proof];
}
async function time(t){await provider.send("evm_setNextBlockTimestamp",[Number(t)]);await provider.send("evm_mine",[]);}
try{
 const [signer,other]=await ethers.getSigners();
 const T=1900000000n;
 await time(T-2000n);
 const R=BigInt(valid[0].issuerSignals[0]);
 const initial=build([[R^1n,5n],[R^2n,9n]]),revoked=build([[R^1n,5n],[R^2n,9n],[R,1n]]);
 assert.equal(String(initial.hash),valid[0].extras.stateRoot);
 const verifier=await new ethers.ContractFactory(verifierArtifact.abi,verifierArtifact.evm.bytecode.object,signer).deploy();await verifier.waitForDeployment();
 const noteRoots=[...new Set(valid.flatMap(c=>c.publicFund.slice(16,18)))];
 const ctor=[await verifier.getAddress(),initial.hash,noteRoots,...valid[0].publicFund.slice(24,27)];
 const consumer=await new ethers.ContractFactory(consumerArtifact.abi,consumerArtifact.evm.bytecode.object,signer).deploy(...ctor);await consumer.waitForDeployment();
 assert.equal((await consumer.getAddress()).toLowerCase(),manifest.poolAddress.toLowerCase());
 const second=await new ethers.ContractFactory(consumerArtifact.abi,consumerArtifact.evm.bytecode.object,signer).deploy(...ctor);await second.waitForDeployment();
 await time(T-1900n);
 let snapshot=await provider.send("evm_snapshot",[]);
 const restore=async()=>{assert.equal(await provider.send("evm_revert",[snapshot]),true);snapshot=await provider.send("evm_snapshot",[]);};
 for(const c of valid){
  const p=proofFor(c);
  await verifier.verifyProof.staticCall(p.solidityProof,p.publicSignals);mark(c.name+": real exported Solidity verifier accepts");
  await consumer.fund.staticCall(...args(c));
  const tx=await(await consumer.fund(...args(c))).wait();gas[c.name]=tx.gasUsed.toString();
  const event=tx.logs.map(l=>{try{return consumer.interface.parseLog(l);}catch{return null;}}).find(e=>e?.name==="FundVerified");
  assert.equal(String(event.args.budgetCommitment),c.publicFund[20]);
  assert.equal(String(event.args.changeCommitment),c.publicFund[21]);
  mark(c.name+": actual transaction records exact verified outputs");
  await assert.rejects(()=>consumer.fund.staticCall(...args(c)),errorIs("AlreadyUsed"));mark(c.name+": duplicate rejected");
  // Message reuse is independent of donor/template nullifier reuse.
  await assert.rejects(()=>consumer.fund.staticCall(...args(c,{messageId:String(BigInt(c.extras.messageId)+100n)})),errorIs("AlreadyUsed"));
  mark(c.name+": spent Fund nullifier rejected even with new message id");
  await restore();
 }
 const c=valid[0];
 for(const [name,patch,expected]of[
  ["deadline",{expiresAt:"1900000100"},"InvalidProof"],
  ["message",{messageId:"999"},"InvalidProof"],
  ["recipient binding",{binding:String(BigInt(c.extras.binding)+1n)},"InvalidProof"],
  ["ciphertext",{ciphertexts:["0x"+"ab".repeat(512),c.ciphertexts[1]]},"InvalidCiphertext"]
 ]){await assert.rejects(()=>consumer.fund.staticCall(...args(c,patch)),errorIs(expected));mark("changed actual "+name+" rejected");}
 for(const [name,index,value,expected]of[
  ["budget output",20,String(BigInt(c.publicFund[20])+1n),"InvalidProof"],
  ["input note root",16,"123","InvalidFixtureRoot"],
  ["lineage root",24,"123","InvalidFixtureRoot"],
  ["public budget kind",3,"1","InvalidScope"],
  ["actual chain",0,"1","InvalidScope"],
  ["actual pool",1,String(BigInt(await second.getAddress())),"InvalidScope"]
 ]){const f=[...c.publicFund];f[index]=value;await assert.rejects(()=>consumer.fund.staticCall(...args(c,{fundInputs:f})),errorIs(expected));mark("changed "+name+" rejected");}
 await assert.rejects(()=>second.fund.staticCall(...args()),errorIs("InvalidScope"));mark("cross-pool replay rejected");
 for(const [name,index]of[["outer chain",0],["outer action",2],["outer pool",1]]){
  const p=proofFor(c),s=[...p.publicSignals];s[index]=String(BigInt(s[index])+1n);
  await assert.rejects(()=>verifier.verifyProof.staticCall(p.solidityProof,s));mark("changed "+name+" rejected by real verifier");
 }
 await assert.rejects(()=>consumer.connect(other).advanceFixtureCounterRoot(revoked.hash),errorIs("UnauthorizedFixtureDriver"));mark("nonfixture account cannot advance fixture roots");
 await time(T-1700n);
 await(await consumer.advanceFixtureCounterRoot(revoked.hash)).wait();
 const retired=(await consumer.checkpoints(1)).retiredAt;
 await time(retired+899n);await consumer.fund.staticCall(...args());mark("old-root Fund proof accepted at retirement+899");
 await time(retired+900n);await assert.rejects(()=>consumer.fund.staticCall(...args()),errorIs("CheckpointExpired"));mark("old-root Fund proof rejected at retirement+900");
 await restore();await time(T-1n);await consumer.fund.staticCall(...args());mark("Fund accepted at authenticated expiry-1");
 await time(T);await assert.rejects(()=>consumer.fund.staticCall(...args()),errorIs("ExpiredCode"));mark("Fund rejected at authenticated expiry with no grace");
 const result={scope:"real private Fund+issuer+counter proofs and minimal synthetic-root consumer; no value custody or live canonical tree",checks,gas,verifierBytecodeBytes:verifierArtifact.evm.deployedBytecode.object.length/2,consumerBytecodeBytes:consumerArtifact.evm.deployedBytecode.object.length/2,limitations:manifest.limitations};
 fs.writeFileSync(path.join(out,"fund-contract-results.json"),JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify({passed:true,checks:checks.length,gas,verifierBytecodeBytes:result.verifierBytecodeBytes},null,2));
}finally{await connection.close();}
