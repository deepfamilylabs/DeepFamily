// Independently check browser-produced proofs with the exported EVM verifier.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "node:child_process";
import hre from "hardhat";
assert.ok(process.env.DEEPFAMILY_BROWSER_RESULT,"Expected results.json from the actual browser");
const resultFile=path.resolve(process.env.DEEPFAMILY_BROWSER_RESULT);
const read=file=>JSON.parse(fs.readFileSync(file,"utf8"));
const results=read(resultFile),config=read(results.configFile);
const successes=results.jobs.filter(j=>j.completed);
assert.ok(successes.length,"No completed browser proofs to verify");
const sources={};
for(const j of successes){
 const c=config.jobs.find(c=>c.name===j.name);
 sources[j.name+".sol"]={content:fs.readFileSync(c.solidityVerifier,"utf8")};
}
const solc=process.env.DEEPFAMILY_RESEARCH_SOLC??path.join(os.homedir(),"Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const input={language:"Solidity",sources,settings:{optimizer:{enabled:true,runs:1},viaIR:true,evmVersion:"cancun",outputSelection:{"*":{"*":["abi","evm.bytecode.object"]}}}};
const compiled=JSON.parse(execFileSync(solc,["--standard-json"],{input:JSON.stringify(input),encoding:"utf8",maxBuffer:30*1024*1024}));
assert.deepEqual((compiled.errors??[]).filter(e=>e.severity==="error"),[]);
const connection=await hre.network.create(),{ethers}=connection,checks=[];
try{
 const[signer]=await ethers.getSigners();
 for(const j of successes){
  const artifact=Object.values(compiled.contracts[j.name+".sol"]).find(a=>a.abi.some(f=>f.name==="verifyProof"));
  const verifier=await new ethers.ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy();await verifier.waitForDeployment();
  for(const p of j.result.proofs){
   await verifier.verifyProof.staticCall(p.solidityProof,p.publicSignals);
   checks.push({job:j.name,iteration:p.iteration,test:"actual browser-generated proof accepted by independently deployed EVM verifier",passed:true});
   const changed=[...p.publicSignals];changed[0]=String(BigInt(changed[0])+1n);
   await assert.rejects(()=>verifier.verifyProof.staticCall(p.solidityProof,changed));
   checks.push({job:j.name,iteration:p.iteration,test:"changed public signal rejected on EVM",passed:true});
  }
 }
 const report={scope:"EVM verification of actual browser-produced proofs, not a full business entry point",sourceResult:resultFile,checks};
 fs.writeFileSync(path.join(path.dirname(resultFile),"contract-results.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({passed:true,checks:checks.length}));
}finally{await connection.close();}
