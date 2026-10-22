// Run with the isolated config and DEEPFAMILY_COMPOSITION_OUT pointing to temp.
// Only a local EDR chain is used. No mainnet/testnet RPC or wallet is configured.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";
import hre from "hardhat";
import {build} from "./prepare-composition.mjs";
const out=path.resolve(process.env.DEEPFAMILY_COMPOSITION_OUT??"");
assert.ok(process.env.DEEPFAMILY_COMPOSITION_OUT,"DEEPFAMILY_COMPOSITION_OUT must name the research temp output");
const manifest=JSON.parse(fs.readFileSync(path.join(out,"composition-inputs.json"),"utf8"));
const proof=JSON.parse(fs.readFileSync(path.join(out,"outer/proof.json"),"utf8"));
const source=fs.readFileSync(path.join(out,"outer/CompositionVerifier.sol"),"utf8");
const consumerSource=fs.readFileSync(new URL("./CompositionConsumer.sol",import.meta.url),"utf8");
const counterDir=process.env.DEEPFAMILY_COUNTER_UPDATE_OUT;
const counterSource=counterDir?fs.readFileSync(path.join(counterDir,"OwnerCounterUpdateVerifier.sol"),"utf8"):null;
// Reuse an already downloaded local compiler, without modifying project assets.
const solcPath=process.env.DEEPFAMILY_RESEARCH_SOLC??path.join(os.homedir(),"Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const compilerInput={language:"Solidity",sources:{"CompositionVerifier.sol":{content:source},"CompositionConsumer.sol":{content:consumerSource}},settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["abi","evm.bytecode.object","evm.deployedBytecode.object"]}}}};
if(counterSource)compilerInput.sources["OwnerCounterUpdateVerifier.sol"]={content:counterSource};
const compiled=JSON.parse(execFileSync(solcPath,["--standard-json"],{input:JSON.stringify(compilerInput),encoding:"utf8",maxBuffer:30*1024*1024}));
const errors=(compiled.errors??[]).filter(e=>e.severity==="error");assert.deepEqual(errors,[]);
const contracts=compiled.contracts;
const verifierName=Object.keys(contracts["CompositionVerifier.sol"]).find(n=>(contracts["CompositionVerifier.sol"][n].abi??[]).some(f=>f.name==="verifyProof"));
assert.ok(verifierName);
const vArtifact=contracts["CompositionVerifier.sol"][verifierName],cArtifact=contracts["CompositionConsumer.sol"].CompositionConsumer;
const connection=await hre.network.create();
const {ethers}=connection;
const provider=ethers.provider;
const checks=[];
const mark=(name)=>checks.push({test:name,passed:true});
const isRevert=(...names)=>error=>names.some(name=>String(error.message).includes(name)||String(error.message).includes(ethers.id(name+"()").slice(0,10)));
const T=1900000000n;
async function time(timestamp){await provider.send("evm_setNextBlockTimestamp",[Number(timestamp)]);await provider.send("evm_mine",[]);}
function args(data=manifest.cases[0].extras,changes={}){
 const a={messageId:data.messageId,ciphertext:manifest.ciphertext,checkpointId:data.checkpointId,asOf:data.asOf,expiresAt:data.expiresAt,binding:data.binding,proof:proof.solidityProof,...changes};
 return [a.messageId,a.ciphertext,a.checkpointId,a.asOf,a.expiresAt,a.binding,a.proof];
}
try{
 const [signer,other]=await ethers.getSigners();
 assert.equal(signer.address.toLowerCase(),manifest.sender);
 await time(BigInt(manifest.baseTime));
 const verifier=await new ethers.ContractFactory(vArtifact.abi,vArtifact.evm.bytecode.object,signer).deploy();await verifier.waitForDeployment();
 const consumer=await new ethers.ContractFactory(cArtifact.abi,cArtifact.evm.bytecode.object,signer).deploy(await verifier.getAddress(),manifest.initialRoot);await consumer.waitForDeployment();
 assert.equal((await consumer.getAddress()).toLowerCase(),manifest.consumer.toLowerCase());
 const second=await new ethers.ContractFactory(cArtifact.abi,cArtifact.evm.bytecode.object,signer).deploy(await verifier.getAddress(),manifest.initialRoot);await second.waitForDeployment();
 await time(T-1900n);
 await verifier.verifyProof.staticCall(proof.solidityProof,proof.publicSignals);
 mark("real exported Groth16 Solidity verifier accepts composed proof");
 await consumer.accept.staticCall(...args());mark("consumer accepts authentic code plus private nonmembership default0 and actual operation");
 for(const caseName of ["anonymous-mode-1"]){
  const sample=manifest.cases.find(c=>c.name===caseName);
  const p=JSON.parse(fs.readFileSync(path.join(out,"cases",caseName,"proof.json"),"utf8"));
  await consumer.accept.staticCall(...args(sample.extras,{proof:p.solidityProof}));mark(caseName+" accepted by same real consumer");
 }
 let counterVerifier,counterFirst,counterSecond;
 const counterArgs=(p,changes={})=>{
  const s=p.publicSignals;
  const x={authNullifier:s[0],aliasR:s[3],oldRoot:s[4],newRoot:s[5],oldCounter:s[6],newCounter:s[7],...changes};
  return [x.authNullifier,x.aliasR,x.oldRoot,x.newRoot,x.oldCounter,x.newCounter,p.a,p.b,p.c];
 };
 if(counterSource){
  const artifact=Object.values(contracts["OwnerCounterUpdateVerifier.sol"]).find(a=>a.abi.some(f=>f.name==="verifyProof"));
  counterVerifier=await new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object,other).deploy();await counterVerifier.waitForDeployment();
  await (await consumer.installCounterVerifier(await counterVerifier.getAddress())).wait();
  counterFirst=JSON.parse(fs.readFileSync(path.join(counterDir,"counter-0-to-1.solidity.json"),"utf8"));
  counterSecond=JSON.parse(fs.readFileSync(path.join(counterDir,"counter-1-to-2.solidity.json"),"utf8"));
 }
 let snapshot=await provider.send("evm_snapshot",[]);
 const restore=async()=>{await provider.send("evm_revert",[snapshot]);snapshot=await provider.send("evm_snapshot",[]);};
 const receipt=await (await consumer.accept(...args())).wait();mark("actual operation transaction succeeds");
 await assert.rejects(()=>consumer.accept.staticCall(...args()),isRevert("DuplicateMessage"));mark("duplicate message rejected");
 const acceptGas=receipt.gasUsed.toString();
 await restore();
 for(const [name,changes]of [
  ["different actual ciphertext",{ciphertext:"0x010203"}],
  ["different actual message id",{messageId:"77"}],
  ["changed execution deadline",{expiresAt:String(T+100n)}],
  ["changed state time",{asOf:String(T-1899n)}],
  ["changed recipient operation binding",{binding:String(BigInt(manifest.cases[0].extras.binding)+1n)}]
 ]){
  if(name==="changed state time")await time(T-1800n);
  await assert.rejects(()=>consumer.accept.staticCall(...args(undefined,changes)),isRevert("InvalidProof"));mark(name+" rejected by real verifier");
 }
 await restore();
 await assert.rejects(()=>second.accept.staticCall(...args()),isRevert("InvalidProof"));
 const changedConsumer=[...proof.publicSignals];changedConsumer[1]=String(BigInt(await second.getAddress()));
 await assert.rejects(()=>verifier.verifyProof.staticCall(proof.solidityProof,changedConsumer));mark("cross-contract replay rejected by real verifier");
 const changedChain=[...proof.publicSignals];changedChain[0]="1";
 await assert.rejects(()=>verifier.verifyProof.staticCall(proof.solidityProof,changedChain));mark("cross-chain signal replay rejected by real verifier");
 const changedAction=[...proof.publicSignals];changedAction[2]="2";
 await assert.rejects(()=>verifier.verifyProof.staticCall(proof.solidityProof,changedAction));mark("cross-action signal replay rejected by real verifier");
 await restore();
 await assert.rejects(()=>consumer.connect(other).advance(manifest.incrementedRoot),isRevert("UnauthorizedFixtureDriver"));mark("nonfixture account cannot replace canonical roots");
 await time(T-1700n);
 if(counterFirst){
  await assert.rejects(()=>consumer.updateCounter.staticCall(...counterArgs(counterFirst,{aliasR:String(BigInt(counterFirst.publicSignals[3])+1n)})),isRevert("InvalidProof"));mark("counter proof cannot be moved to another alias");
  await assert.rejects(()=>consumer.updateCounter.staticCall(...counterArgs(counterFirst,{newCounter:"2"})),isRevert("InvalidCounterIncrement"));mark("counter cannot skip an increment");
  const updateReceipt=await (await consumer.connect(other).updateCounter(...counterArgs(counterFirst))).wait();
  mark("identity-owner proof submitted by an unrelated account advances canonical counter0 to1");
  checks.push({test:"owner-authorized counter-update gas",passed:true,gas:updateReceipt.gasUsed.toString()});
  await assert.rejects(()=>consumer.updateCounter.staticCall(...counterArgs(counterFirst)),isRevert("StaleCounterRoot"));mark("counter update cannot reuse a historical root");
 }else await (await consumer.advance(manifest.incrementedRoot)).wait();
 const retired=(await consumer.checkpoints(1)).retiredAt;
 await time(T-1600n);
 const renewedCase=manifest.cases.find(c=>c.name==="new-counter-immediately");
 const renewedProof=JSON.parse(fs.readFileSync(path.join(out,"cases/new-counter-immediately/proof.json"),"utf8"));
 await consumer.accept.staticCall(...args(renewedCase.extras,{proof:renewedProof.solidityProof}));mark("new authenticated counter1 code usable immediately after its owner update");
 if(counterSecond){
  await (await consumer.connect(other).updateCounter(...counterArgs(counterSecond))).wait();
  mark("same owner can advance an existing counter1 entry to2");
 }
 const issuerSignals=JSON.parse(fs.readFileSync(path.join(out,"issuance/mode-0.public.json"),"utf8"));
 const R=BigInt(issuerSignals[0]);
 for(const next of [6n,7n,8n])await (await consumer.advance(build([[R^1n,next],[R^2n,9n],[R,counterSecond?2n:1n]]).hash)).wait();
 assert.equal((await consumer.checkpoints(1)).retiredAt,retired);mark("unrelated root updates do not renew the first retirement");
 await time(retired+899n);await consumer.accept.staticCall(...args());mark("same composed proof accepted at retirement plus 899 seconds");
 await time(retired+900n);await assert.rejects(()=>consumer.accept.staticCall(...args()),isRevert("CheckpointExpired"));mark("same composed proof rejected at retirement plus 900 seconds");
 await (await consumer.advance(manifest.initialRoot)).wait();
 await assert.rejects(()=>consumer.accept.staticCall(...args()),isRevert("CheckpointExpired"));mark("root recurrence cannot renew the old checkpoint id");
 const latestCheckpoint=String(await consumer.currentCheckpointId());
 await assert.rejects(()=>consumer.accept.staticCall(...args(undefined,{checkpointId:latestCheckpoint})),isRevert("InvalidStateTime","InvalidProof"));mark("old proof cannot be rebound to a new checkpoint id");
 await restore();await time(T-1n);await consumer.accept.staticCall(...args());mark("code accepted strictly before authenticated expiresAt");
 await time(T);await assert.rejects(()=>consumer.accept.staticCall(...args()),isRevert("ExpiredCode"));mark("code rejected at authenticated expiresAt with no grace");
 const result={scope:"real composed Groth16 proof on isolated EDR; synthetic operation and fixture-owner canonical roots",checks,acceptGas,verifierBytecodeBytes:vArtifact.evm.deployedBytecode.object.length/2,consumerBytecodeBytes:cArtifact.evm.deployedBytecode.object.length/2,compiler:solcPath,limitations:manifest.limitations};
 fs.writeFileSync(path.join(out,"contract-results.json"),JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify({passed:true,checks:checks.length,acceptGas,verifierBytecodeBytes:result.verifierBytecodeBytes},null,2));
}finally{await connection.close();}
