import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const root=path.resolve(process.argv[2]??process.env.DEEPFAMILY_REPO_ROOT??process.cwd());
const out=path.resolve(process.argv[3]??fs.mkdtempSync(path.join(os.tmpdir(),"deepfamily-anonymous-counter-state-")));
fs.mkdirSync(out,{recursive:true});
const requireRepo=createRequire(path.join(root,"package.json"));
const snarkjs=requireRepo("snarkjs");
const {poseidon2,poseidon3,poseidon4}=requireRepo("poseidon-lite");
const {WitnessCalculatorBuilder}=requireRepo("circom_runtime");
const {buildShieldedClaimFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_shielded_claim_input.mjs")));
const {buildLineageFixture}=await import(pathToFileURL(path.join(root,"circuits/test/generate_lineage_fixture.mjs")));
const I=buildShieldedClaimFixture().heirIdentityCommitment;
const identitySecret=BigInt(buildLineageFixture().witness.derivedSecretField);
const R=poseidon3([202610210001n,I,identitySecret]);
const write=(name,obj)=>fs.writeFileSync(path.join(out,name),JSON.stringify(obj,(_,v)=>typeof v==="bigint"?String(v):v,2));
const log=s=>{fs.appendFileSync(path.join(out,"run-state.log"),s+"\n");console.log(s);};
const results={scope:"ISOLATED RESEARCH: private counter lookup only, NOT bound to issuance, NOT a production circuit or contract test",publicSignals:["usageCommitment","stateRoot"],proofChecks:[],witnessChecks:[],policySimulationChecks:[],caveats:[]};
const circuit=`pragma circom 2.2.3;
include "circomlib/circuits/smt/smtverifier.circom";
// RESEARCH ONLY. alias is privately supplied, not authenticated by issuance here.
// stateRoot is the only public input; use commitment is a randomized public output.
template PrivateCounterState() {
  signal output usageCommitment;
  signal input stateRoot;
  signal input alias;
  signal input counter;
  signal input salt;
  signal input siblings[8];
  signal input oldKey;
  signal input oldValue;
  signal input isOld0;
  signal input fnc;
  fnc*(1-fnc)===0;
  isOld0*(1-isOld0)===0;
  // Absence means the default counter is exactly zero.
  fnc*counter===0;
  component counterBits=Num2Bits(64);
  counterBits.in <== counter;
  component saltZero=IsZero();
  saltZero.in <== salt;
  saltZero.out===0;
  component lookup=SMTVerifier(8);
  lookup.enabled <== 1;
  lookup.root <== stateRoot;
  lookup.key <== alias;
  lookup.value <== counter;
  lookup.siblings <== siblings;
  lookup.oldKey <== oldKey;
  lookup.oldValue <== oldValue;
  lookup.isOld0 <== isOld0;
  lookup.fnc <== fnc;
  component use=Poseidon(4);
  use.inputs[0] <== 202610210002;
  use.inputs[1] <== alias;
  use.inputs[2] <== counter;
  use.inputs[3] <== salt;
  usageCommitment <== use.out;
}
component main {public [stateRoot]} = PrivateCounterState();
`;
fs.writeFileSync(path.join(out,"private_counter_state.circom"),circuit);
log("Compiling isolated private-counter SMTVerifier(8) circuit");
const compileLog=execFileSync(path.join(root,"bin/circom"),[path.join(out,"private_counter_state.circom"),"--r1cs","--wasm","--sym","--O2","--sanity_check","2","-l",path.join(root,"node_modules"),"-l",path.join(root,"node_modules/circomlib/circuits"),"-o",out],{cwd:out,encoding:"utf8"});
fs.writeFileSync(path.join(out,"compile-state.log"),compileLog);results.constraints=compileLog;
log(compileLog.trim());
const cli=path.join(root,"node_modules/snarkjs/build/cli.cjs");
const zkeyPath=path.join(out,"INSECURE-local-state.zkey");
const vkeyPath=path.join(out,"state.vkey.json");
const wasmPath=path.join(out,"private_counter_state_js/private_counter_state.wasm");
log("Development setup from repository ptau17; no production ceremony claim");
fs.writeFileSync(path.join(out,"setup-state.log"),execFileSync(process.execPath,[cli,"groth16","setup",path.join(out,"private_counter_state.r1cs"),path.join(root,"circuits/ptau/ppot_0080_17.ptau"),zkeyPath],{cwd:out,encoding:"utf8",maxBuffer:20*1024*1024}));
execFileSync(process.execPath,[cli,"zkey","export","verificationkey",zkeyPath,vkeyPath],{cwd:out,stdio:"pipe"});
const vkey=JSON.parse(fs.readFileSync(vkeyPath,"utf8"));
const calculator=await WitnessCalculatorBuilder(fs.readFileSync(wasmPath),{singleThread:true});
// Minimal compressed binary sparse Merkle tree. Zero = empty; leaf=H3(key,value,1).
// Keys follow least-significant bit first, matching circomlib SMTVerifier.
function build(entries,depth=0){
  if(!entries.length)return {kind:"empty",hash:0n};
  if(entries.length===1){const [key,value]=entries[0];return {kind:"leaf",key,value,hash:poseidon3([key,value,1n])};}
  assert.ok(depth<7,"research tree must diverge above level 7");
  const left=build(entries.filter(([k])=>((k>>BigInt(depth))&1n)===0n),depth+1);
  const right=build(entries.filter(([k])=>((k>>BigInt(depth))&1n)===1n),depth+1);
  return {kind:"branch",left,right,hash:poseidon2([left.hash,right.hash])};
}
function lookup(tree,key){
  const siblings=[];let node=tree,depth=0;
  while(node.kind==="branch"){
    const bit=Number((key>>BigInt(depth))&1n);
    siblings.push(bit===0?node.right.hash:node.left.hash);
    node=bit===0?node.left:node.right;depth++;
  }
  const found=node.kind==="leaf"&&node.key===key;
  while(siblings.length<8)siblings.push(0n);
  assert.equal(siblings.length,8);
  return {found,siblings,oldKey:found||node.kind==="empty"?0n:node.key,oldValue:found||node.kind==="empty"?0n:node.value,isOld0:node.kind==="empty"?1n:0n,fnc:found?0n:1n,counter:found?node.value:0n};
}
function witness(tree,key,salt){
  const p=lookup(tree,key);
  return {stateRoot:String(tree.hash),alias:String(key),counter:String(p.counter),salt:String(salt),siblings:p.siblings.map(String),oldKey:String(p.oldKey),oldValue:String(p.oldValue),isOld0:String(p.isOld0),fnc:String(p.fnc)};
}
const neighbors=[[R^1n,5n],[R^2n,9n]];
const empty=build([]);
const initial=build(neighbors);
const incremented=build([...neighbors,[R,1n]]);
const unrelatedUpdate=build([[R^1n,6n],[R^2n,9n],[R,1n]]);
const before=witness(initial,R,111111n);
const after=witness(incremented,R,222222n);
assert.equal(before.fnc,"1");assert.equal(before.counter,"0");assert.equal(before.isOld0,"0");
assert.equal(after.fnc,"0");assert.equal(after.counter,"1");
let proofs={};
async function prove(name,input){
  log(`Proving ${name}`);
  const started=performance.now();
  const data=await snarkjs.groth16.fullProve(input,wasmPath,zkeyPath,undefined,{singleThread:true},{singleThread:true});
  assert.equal(await snarkjs.groth16.verify(vkey,data.publicSignals,data.proof),true);
  assert.deepEqual(data.publicSignals,[String(poseidon4([202610210002n,BigInt(input.alias),BigInt(input.counter),BigInt(input.salt)])),input.stateRoot]);
  assert.equal(data.publicSignals.length,2);
  assert.equal(data.publicSignals.some(x=>BigInt(x)===I||BigInt(x)===R),false);
  write(`${name}.proof.json`,data.proof);write(`${name}.public.json`,data.publicSignals);
  results.proofChecks.push({test:name,passed:true,proofMs:Math.round(performance.now()-started)});
  for(const [index,label]of [[0,"randomized use commitment"],[1,"state root"]]){
    const changed=[...data.publicSignals];changed[index]=String(BigInt(changed[index])+1n);
    assert.equal(await snarkjs.groth16.verify(vkey,changed,data.proof),false);
    results.proofChecks.push({test:`${name}: modified public ${label}`,passed:true,expected:"real verifier rejected"});
  }
  proofs[name]=data;return data;
}
await prove("default-zero-empty-tree",witness(empty,R,101010n));
await prove("default-zero-collision-noninclusion",before);
await prove("increment-one-membership",after);
// This holder-side witness is constructed from public tree entries + R/counter/salt.
// It contains no identity secret, name, identity commitment, or spending secret.
const refreshed=witness(unrelatedUpdate,R,333333n);
const allowedKeys=["stateRoot","alias","counter","salt","siblings","oldKey","oldValue","isOld0","fnc"];
assert.deepEqual(Object.keys(refreshed).sort(),allowedKeys.sort());
await prove("refresh-after-unrelated-update-no-identity-secret",refreshed);
 // Negative control: a different, unauthenticated alias can use default0.
 // This MUST succeed in this isolated lookup circuit, showing that issuance
 // authentication is a necessary separate constraint in a complete protocol.
 await prove("unbound-alias-default0-negative-control",witness(incremented,R^4n,444444n));
async function reject(name,patch,source=after){
 let failed=false;try{await calculator.calculateWitness({...source,...patch},1);}catch(e){
   assert.match(String(e?.message??e),/Assert Failed\./u,name+": must fail a constraint");
   failed=true;
 }
 assert.equal(failed,true,name);results.witnessChecks.push({test:name,passed:true,expected:"constraint/witness rejection, not a Groth16 verifier assertion"});
}
await reject("old zero counter under incremented root",{counter:"0"});
await reject("reuse old default0 exclusion path with new root",{stateRoot:String(incremented.hash)},before);
await reject("wrong alias with original path",{alias:String(R^1n)});
await reject("wrong Merkle sibling",{siblings:[String(BigInt(after.siblings[0])+1n),...after.siblings.slice(1)]});
await reject("default0 cannot be claimed for included target",{fnc:"1",oldKey:"0",oldValue:"0",isOld0:"1",counter:"0"});
await reject("noninclusion must mean counter0",{counter:"1"},before);
await reject("out of uint64 counter",{counter:String(1n<<64n)});
await reject("zero randomization salt",{salt:"0"});
// Additional actual invalid-witness proof: modify the private counter wire in a
// valid .wtns without recalculating the path or other dependent wires.
const raw=Buffer.from(await calculator.calculateWTNSBin(after,1));
const sym=fs.readFileSync(path.join(out,"private_counter_state.sym"),"utf8");
const counterWire=Number(sym.split("\n").find(x=>x.endsWith(",main.counter")).split(",")[1]);
assert.ok(counterWire>2);
let cursor=12,dataOffset=-1,fieldBytes=-1;
for(let s=0;s<raw.readUInt32LE(8);s++){
 const kind=raw.readUInt32LE(cursor),size=Number(raw.readBigUInt64LE(cursor+4)),begin=cursor+12;
 if(kind===1)fieldBytes=raw.readUInt32LE(begin);if(kind===2)dataOffset=begin;cursor=begin+size;
}
assert.equal(fieldBytes,32);assert.ok(dataOffset>0);
const forged=Buffer.from(raw);forged.fill(0,dataOffset+counterWire*32,dataOffset+(counterWire+1)*32);
const forgedPath=path.join(out,"FORGED-counter-zero.wtns");fs.writeFileSync(forgedPath,forged);
const forgedProof=await snarkjs.groth16.prove(zkeyPath,forgedPath,undefined,{singleThread:true});
assert.deepEqual(forgedProof.publicSignals,proofs["increment-one-membership"].publicSignals);
assert.equal(await snarkjs.groth16.verify(vkey,forgedProof.publicSignals,forgedProof.proof),false);
write("FORGED-counter-zero.proof.json",forgedProof.proof);
results.proofChecks.push({test:"forged private counter0 witness for actual counter1 root",passed:true,expected:"real Groth16 verifier rejected"});
// POLICY SIMULATION ONLY, separate from the state circuit and any deployed contract.
// Checkpoint id / asOf are metadata here, not circuit-bound inputs. This is NOT a
// sufficient implementation of a secure real checkpoint envelope.
const checkpoints=new Map();let activeId=null;
function activate(id,stateRoot,createdAt){
 if(activeId!==null){const old=checkpoints.get(activeId);old.retiredAt??=createdAt;}
 assert.equal(checkpoints.has(id),false);
 checkpoints.set(id,{id,stateRoot:String(stateRoot),createdAt,retiredAt:null});activeId=id;
}
function acceptPolicy(id,stateRoot,asOf,now,expiresAt=999999){
 const c=checkpoints.get(id);if(!c||String(stateRoot)!==c.stateRoot)return false;
 if(now>=expiresAt||asOf<c.createdAt||asOf>now)return false;
 if(c.retiredAt!==null&&(asOf>c.retiredAt||now>=c.retiredAt+900))return false;
 return true;
}
function checkPolicy(name,fn,expected){assert.equal(fn(),expected);results.policySimulationChecks.push({test:name,passed:true,expected,scope:"JS policy simulation only; NOT contract/circuit end-to-end"});}
activate("cp-before",initial.hash,900);
activate("cp-increment",incremented.hash,1000);
checkPolicy("old proof accepted at retirement+899",()=>acceptPolicy("cp-before",initial.hash,950,1899),true);
checkPolicy("old proof rejected at retirement+900",()=>acceptPolicy("cp-before",initial.hash,950,1900),false);
activate("cp-unrelated1",unrelatedUpdate.hash,1100);
activate("cp-unrelated2",build([[R^1n,7n],[R^2n,9n],[R,1n]]).hash,1200);
checkPolicy("unrelated updates do not shorten old window",()=>acceptPolicy("cp-before",initial.hash,950,1899),true);
checkPolicy("unrelated updates do not renew old window",()=>acceptPolicy("cp-before",initial.hash,950,1900),false);
checkPolicy("asOf after retiredAt is rejected",()=>acceptPolicy("cp-before",initial.hash,1001,1500),false);
checkPolicy("asOf before checkpoint creation is rejected",()=>acceptPolicy("cp-before",initial.hash,899,1500),false);
checkPolicy("expiresAt enforced without retirement grace",()=>acceptPolicy("cp-before",initial.hash,950,1500,1500),false);
// A new checkpoint does not mutate the old checkpoint's first retirement.
// Binding checkpoint id to a real proof remains outside this isolated prototype.
activate("cp-same-root-new-id",initial.hash,2000);
checkPolicy("root reappearance does not renew old checkpoint record",()=>acceptPolicy("cp-before",initial.hash,950,2000),false);
assert.equal(checkpoints.get("cp-before").retiredAt,1000);
results.caveats=[
"Research-only circuit uses depth8 compressed SMT with deliberately tiny fixtures; production depth, full state replay, authorization updates and gas were not validated.",
"Counter0 absence is tested both on an empty tree and via a different compressed leaf; counter1 inclusion is tested after insertion.",
"The alias input is NOT authenticated or bound to the receive-code issuance proof here. Composing this with issuance is still required. A valid proof for an unrelated absent alias is included as a negative control.",
"Only root and randomized use commitment are public. Structural absence of alias/counter/path is demonstrated; this is not a formal privacy proof.",
"The holder refresh witness uses R, counter and public SMT data only; no identity or spending secrets are needed after receiving those materials.",
"A public legacy identityCommitment→counter tree would still leak identity by enumeration; this experiment intentionally uses secret-derived alias keys instead.",
"JS checkpoint tests simulate fixed retiredAt+900s acceptance. Checkpoint id/asOf and expiry are NOT circuit-bound in this isolated state circuit, and policy simulation is NOT secure contract E2E evidence.",
"Root reappearance is tested only for preserving an old checkpoint record's retiredAt, not as a proof of safe new-id issuance or full historical root handling.",
"An old counter proof can remain accepted for the agreed 900s retirement window; current-root proof with an old counter fails.",
"Randomized commitment includes an arbitrary nonzero fixture salt. Production must generate a fresh high-entropy salt, then bind the commitment to the actual operation.",
"Local setup from existing ptau is not a production ceremony. No production source, deployment manifest or plan was edited."
];
results.counts={realProofChecks:results.proofChecks.length,witnessChecks:results.witnessChecks.length,jsPolicyChecks:results.policySimulationChecks.length};
write("summary-state.json",results);
fs.writeFileSync(path.join(out,"SUMMARY-state.md"),`# Private counter-state research prototype\n\n${results.scope}\n\nPassed ${results.proofChecks.length} real Groth16 assertions (${5} valid proofs and one forged-witness proof rejected), ${results.witnessChecks.length} separate witness constraint checks, and ${results.policySimulationChecks.length} JS-only checkpoint policy assertions.\n\n`+results.caveats.map(x=>`- ${x}`).join("\n")+"\n");
log(`SUCCESS ${JSON.stringify(results.counts)}; files: ${out}`);process.exit(0);
