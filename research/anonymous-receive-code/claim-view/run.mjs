// RESEARCH ONLY. All identity data and note openings are synthetic fixtures.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {prepare} from "./prepare.mjs";

const root=path.resolve(process.argv[2]??path.join(path.dirname(fileURLToPath(import.meta.url)),"../../.."));
const out=path.resolve(process.argv[3]??"/tmp/deepfamily-claim-view-p0");
const originalCPUs=os.cpus;os.cpus=()=>originalCPUs().slice(0,2);
const require=createRequire(path.join(root,"package.json")),snarkjs=require("snarkjs");
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+"\n");
const manifest=await prepare(root,out,process.argv[4]);
const zkey=path.join(out,"INSECURE-claim-view.zkey"),ptau=path.join(root,"circuits/ptau/ppot_0080_17.ptau");
const start=performance.now();console.log("Development Claim setup from pinned ptau17; max two workers");
await snarkjs.zKey.newZKey(manifest.r1cs,ptau,zkey);
const setupMillis=Math.round(performance.now()-start),vk=await snarkjs.zKey.exportVerificationKey(zkey);
write("verification-key.json",vk);
const template=fs.readFileSync(path.join(root,"node_modules/snarkjs/templates/verifier_groth16.sol.ejs"),"utf8");
fs.writeFileSync(path.join(out,"ClaimViewVerifier.sol"),(await snarkjs.zKey.exportSolidityVerifier(zkey,{groth16:template})).replace("contract Groth16Verifier","contract ClaimViewVerifier"));
const proofs=[],tamperChecks=[];const provedCases=new Set();
for(const c of manifest.cases){
 for(const source of c.inputSources)if(source.producer==="Claim")assert.ok(provedCases.has(source.sourceCase),`Claim source ${source.sourceCase} must have a verified real proof first`);
 const input=JSON.parse(fs.readFileSync(c.inputFile,"utf8")),proveStart=performance.now();
 const p=await snarkjs.groth16.fullProve(input,manifest.wasm,zkey,undefined,{singleThread:true},{singleThread:true});
 assert.deepEqual(p.publicSignals,c.publicSignals);assert.equal(await snarkjs.groth16.verify(vk,p.publicSignals,p.proof),true);
 const proveMillis=Math.round(performance.now()-proveStart);write(c.name+".proof.json",p.proof);write(c.name+".public.json",p.publicSignals);
 const calldata=JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(p.proof,p.publicSignals)}]`);
 write(c.name+".solidity.json",{a:calldata[0],b:calldata[1],c:calldata[2],publicSignals:calldata[3]});
 for(let i=0;i<p.publicSignals.length;i++){
  const changed=[...p.publicSignals];changed[i]=String(BigInt(changed[i])+1n);
  assert.equal(await snarkjs.groth16.verify(vk,changed,p.proof),false);
 }
 tamperChecks.push({name:c.name,rejections:p.publicSignals.length,scope:"real Groth16 verifier rejects each public signal mutation"});
 proofs.push({name:c.name,passed:true,proveMillis,publicSignalCount:p.publicSignals.length});provedCases.add(c.name);
 console.log(`Real Claim proof verified ${c.name}: ${proveMillis} ms`);
}
const report={scope:manifest.scope,constraints:manifest.constraints,publicCount:manifest.publicCount,preparationMillis:manifest.preparationMillis,setupMillis,sourceR1csSHA256:manifest.sourceR1csSHA256,schema:manifest.schema,validProofs:proofs,negativeWitnessChecks:manifest.negativeChecks,publicTamperChecks:tamperChecks,counts:{validRealProofs:proofs.length,negativeWitnessRejections:manifest.negativeChecks.length,realPublicTamperRejections:tamperChecks.reduce((n,c)=>n+c.rejections,0)},limitations:manifest.limitations,paths:{manifest:path.join(out,"claim-manifest.json"),verifier:path.join(out,"ClaimViewVerifier.sol")}};
write("summary.json",report);console.log(`SUCCESS ${JSON.stringify(report.counts)}`);
if(globalThis.curve_bn128?.terminate)await globalThis.curve_bn128.terminate();
process.exit(0);
