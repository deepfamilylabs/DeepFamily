import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? process.env.DEEPFAMILY_REPO_ROOT ?? process.cwd());
const out = path.resolve(process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-anonymous-issuance-")));
const fixtureCounter = BigInt(process.argv[4] ?? "3");
assert.ok(fixtureCounter >= 0n && fixtureCounter < (1n << 64n) - 1n);
fs.mkdirSync(out, {recursive:true});
const requireRepo = createRequire(path.join(root, "package.json"));
const snarkjs = requireRepo("snarkjs");
const { WitnessCalculatorBuilder } = requireRepo("circom_runtime");
const { poseidon3 } = requireRepo("poseidon-lite");
const protocol = await import(pathToFileURL(path.join(root, "packages/protocol-core/index.js")));
const { buildShieldedClaimFixture } = await import(pathToFileURL(path.join(root, "circuits/test/generate_shielded_claim_input.mjs")));
const { buildLineageFixture } = await import(pathToFileURL(path.join(root, "circuits/test/generate_lineage_fixture.mjs")));
const results = { scope: "ISOLATED RESEARCH: issuance authentication only; no production setup or protocol changes", domain: "202610210001 (research-only, not protocol assigned)", realProofChecks: [], witnessChecks: [], caveats: [] };
const log = (s) => { fs.appendFileSync(path.join(out, "run.log"), s + "\n"); console.log(s); };
const write = (name, obj) => fs.writeFileSync(path.join(out, name), JSON.stringify(obj, null, 2));

let src = fs.readFileSync(path.join(root, "circuits/shielded_receive_code.circom"), "utf8");
src = src.replace("template ShieldedReceiveCode() {", `// RESEARCH ONLY: canonical authorization alias hides the direct identity field.
// This does not prove enrollment/current counter status, nor unlink codes sharing keys/alias.
template ShieldedReceiveCode() {
    signal output authorizationAlias;
    signal input authorizationCounter;
    signal input expiresAt;
`);
src = src.replace("    component viewLoBits = Num2Bits(128);", `    component aliasHash = Poseidon(3);
    aliasHash.inputs[0] <== 202610210001;
    aliasHash.inputs[1] <== identityCommitment;
    aliasHash.inputs[2] <== derivedSecretField;
    authorizationAlias <== aliasHash.out;
    component counterBits = Num2Bits(64);
    counterBits.in <== authorizationCounter;
    component expiryBits = Num2Bits(64);
    expiryBits.in <== expiresAt;

    component viewLoBits = Num2Bits(128);`);
src = src.replace("public [identityCommitment, ownerCommitment, viewKeyLo, viewKeyHi, keyMode, identitySuiteId, independentKeySuiteId, independentKeyDerivationVersion, receiveCodeVersion]", "public [ownerCommitment, viewKeyLo, viewKeyHi, keyMode, identitySuiteId, independentKeySuiteId, independentKeyDerivationVersion, receiveCodeVersion, authorizationCounter, expiresAt]");
fs.writeFileSync(path.join(out, "anonymous_receive_issuance.circom"), src);
log("Compiling isolated circuit");
const compileLog = execFileSync(path.join(root, "bin/circom"), [path.join(out,"anonymous_receive_issuance.circom"), "--r1cs", "--wasm", "--sym", "--O2", "--sanity_check", "2", "-l", path.join(root,"circuits"), "-l", path.join(root,"node_modules"), "-l", path.join(root,"node_modules/circomlib/circuits"), "-o", out], {cwd: out, encoding: "utf8"});
fs.writeFileSync(path.join(out,"compile.log"), compileLog);
log(compileLog.trim());
const r1cs = path.join(out, "anonymous_receive_issuance.r1cs");
const wasmPath = path.join(out, "anonymous_receive_issuance_js/anonymous_receive_issuance.wasm");
const zkeyPath = path.join(out, "research-insecure-setup.zkey");
const vkeyPath = path.join(out, "research.vkey.json");
const cli = path.join(root, "node_modules/snarkjs/build/cli.cjs");
log("Local development Groth16 setup, NOT a production ceremony");
fs.writeFileSync(path.join(out,"setup.log"),execFileSync(process.execPath,[cli,"groth16","setup",r1cs,path.join(root,"circuits/ptau/ppot_0080_17.ptau"),zkeyPath],{cwd:out,encoding:"utf8",maxBuffer:20*1024*1024}));
execFileSync(process.execPath,[cli,"zkey","export","verificationkey",zkeyPath,vkeyPath],{cwd:out,stdio:"pipe"});
const vkey=JSON.parse(fs.readFileSync(vkeyPath,"utf8"));
const calc=await WitnessCalculatorBuilder(fs.readFileSync(wasmPath),{singleThread:true});
const lineage=buildLineageFixture().witness;
const I=buildShieldedClaimFixture().heirIdentityCommitment;
const secret=BigInt(lineage.derivedSecretField);
const keys=protocol.deriveShieldedHeirKeyMaterial(secret);
const vk=await protocol.deriveShieldedViewPublicKey(keys.hpkeIkm);
const original=protocol.buildShieldedReceiveCodePublicSignals({identityCommitment:I,ownerCommitment:keys.ownerCommitment,viewingKey:vk});
const base={identityCommitment:String(I),ownerCommitment:String(keys.ownerCommitment),viewKeyLo:String(original[2]),viewKeyHi:String(original[3]),keyMode:"0",identitySuiteId:"1",independentKeySuiteId:"1",independentKeyDerivationVersion:"1",receiveCodeVersion:"1",spendingSecret:String(keys.ownerSecret),nameField:lineage.nameField,derivedSecretField:lineage.derivedSecretField,isBirthBC:lineage.isBirthBC,birthYear:lineage.birthYear,birthMonth:lineage.birthMonth,birthDay:lineage.birthDay,gender:lineage.gender,suiteId:"1",authorizationCounter:String(fixtureCounter),expiresAt:"1900000000"};
const independent={...base,keyMode:"1",spendingSecret:"987654321",ownerCommitment:String(protocol.computeShieldedOwnerCommitment(987654321n))};
const expectedAlias=poseidon3([202610210001n,I,secret]);
const publicNames=["authorizationAlias","authorizationCounter","expiresAt","ownerCommitment","viewKeyLo","viewKeyHi","keyMode","identitySuiteId","independentKeySuiteId","independentKeyDerivationVersion","receiveCodeVersion"];
results.publicSignalNames=publicNames;
results.publicIdentityAbsent=true;
results.constraintLog=compileLog.trim();
const proofs=[];
for(const [mode,witness] of [[0,base],[1,independent]]){
  const name=`mode-${mode}`;
  log(`Proving ${name}`);
  const proofStart=performance.now();
  const built=await snarkjs.groth16.fullProve(witness,wasmPath,zkeyPath,undefined,{singleThread:true},{singleThread:true});
  const proofMs=performance.now()-proofStart;
  assert.equal(await snarkjs.groth16.verify(vkey,built.publicSignals,built.proof),true);
  assert.equal(built.publicSignals.length,publicNames.length);
  assert.equal(BigInt(built.publicSignals[0]),expectedAlias);
  assert.equal(built.publicSignals.some(x=>BigInt(x)===I),false);
  const wanted=[expectedAlias,...publicNames.slice(1).map(k=>BigInt(witness[k]))].map(String);
  assert.deepEqual(built.publicSignals,wanted);
  write(`${name}.proof.json`,built.proof); write(`${name}.public.json`,built.publicSignals);
  results.realProofChecks.push({test:`valid ${name}`,passed:true,proofMs:Math.round(proofMs)});
  for(let i=0;i<publicNames.length;i++){
    const changed=[...built.publicSignals];changed[i]=String(BigInt(changed[i])+1n);
    assert.equal(await snarkjs.groth16.verify(vkey,changed,built.proof),false);
    results.realProofChecks.push({test:`${name}: mutate authenticated public ${publicNames[i]}`,passed:true,expected:"verifier returns false"});
  }
  proofs.push(built);
}
// Force an inconsistent PRIVATE identity wire into a real witness, bypassing
// the normal calculator's constraint rejection, then prove and verify it.
// A prover is not a constraint checker: it can emit a proof object for invalid
// witnesses, which must be rejected by the Groth16 verifier.
const validWtns = Buffer.from(await calc.calculateWTNSBin(base, 1));
const sym = fs.readFileSync(path.join(out,"anonymous_receive_issuance.sym"),"utf8");
const identityLine = sym.split("\n").find(x=>x.endsWith(",main.identityCommitment"));
assert.ok(identityLine);
const identityWire = Number(identityLine.split(",")[1]);
assert.ok(identityWire > publicNames.length);
let cursor=12, witnessDataStart=-1, fieldBytes=-1;
for(let s=0;s<validWtns.readUInt32LE(8);s++){
  const type=validWtns.readUInt32LE(cursor);
  const length=Number(validWtns.readBigUInt64LE(cursor+4));
  const begin=cursor+12;
  if(type===1)fieldBytes=validWtns.readUInt32LE(begin);
  if(type===2)witnessDataStart=begin;
  cursor=begin+length;
}
assert.equal(fieldBytes,32);assert.ok(witnessDataStart>0);
const forged=Buffer.from(validWtns);
const wrongIdentity=I+1n;
for(let i=0;i<fieldBytes;i++)forged[witnessDataStart+identityWire*fieldBytes+i]=Number((wrongIdentity>>BigInt(8*i))&255n);
const forgedPath=path.join(out,"FORGED-private-identity.wtns");
fs.writeFileSync(forgedPath,forged);
const invalidIdentityProof=await snarkjs.groth16.prove(zkeyPath,forgedPath,undefined,{singleThread:true});
assert.deepEqual(invalidIdentityProof.publicSignals,proofs[0].publicSignals);
assert.equal(await snarkjs.groth16.verify(vkey,invalidIdentityProof.publicSignals,invalidIdentityProof.proof),false);
write("FORGED-private-identity.proof.json",invalidIdentityProof.proof);
results.realProofChecks.push({test:"forged private identity wire with unchanged authenticated public signals",passed:true,expected:"actual Groth16 prover emitted proof object; verifier rejected it"});
log("Forged private-identity witness proof rejected by real verifier");

assert.equal(proofs[0].publicSignals[0],proofs[1].publicSignals[0]);
results.realProofChecks.push({test:"canonical alias is equal across both key modes",passed:true});
async function rejectsWitness(name,patch,source=base){
  let rejected=false;
  try{await calc.calculateWitness({...source,...patch},1);}catch(e){
    assert.match(String(e?.message ?? e), /Assert Failed\./u, `${name}: must be a constraint failure`);
    rejected=true;
  }
  assert.equal(rejected,true,name);
  results.witnessChecks.push({test:name,passed:true,expected:"witness calculator rejects constraint violation; this is NOT a proof-verifier test"});
}
await rejectsWitness("change identity without its preimage",{identityCommitment:String(I+1n)});
await rejectsWitness("change identity-derived secret without matching identity",{derivedSecretField:String(secret+1n)});
await rejectsWitness("change identity-mode owner without secret",{ownerCommitment:String(keys.ownerCommitment+1n)});
await rejectsWitness("change independent owner without spending secret",{ownerCommitment:String(BigInt(independent.ownerCommitment)+1n)},independent);
await rejectsWitness("zero viewing key",{viewKeyLo:"0",viewKeyHi:"0"});
await rejectsWitness("viewing key out of range",{viewKeyHi:String(1n<<128n)});
await rejectsWitness("counter out of uint64 range",{authorizationCounter:String(1n<<64n)});
await rejectsWitness("expiry out of uint64 range",{expiresAt:String(1n<<64n)});
await rejectsWitness("independent secret presented as identity mode",{keyMode:"0"},independent);
// Issuance knows the issuer's secret, so it MAY legitimately choose new metadata.
// Merely adding expiry/counter public inputs is not a current-state or revocation check.
const changedAuthorized={...base,authorizationCounter:String(fixtureCounter+1n),expiresAt:"1900000001"};
log("Proving issuer-authorized new metadata (expected success, not a holder bypass)");
const renewed=await snarkjs.groth16.fullProve(changedAuthorized,wasmPath,zkeyPath,undefined,{singleThread:true},{singleThread:true});
assert.equal(await snarkjs.groth16.verify(vkey,renewed.publicSignals,renewed.proof),true);
assert.equal(renewed.publicSignals[0],proofs[0].publicSignals[0]);
write("authorized-new-metadata.proof.json",renewed.proof);write("authorized-new-metadata.public.json",renewed.publicSignals);
results.realProofChecks.push({test:"issuer with identity secret can sign/prove changed counter and expiry",passed:true,expected:"verification true; current counter validation belongs in presentation/state proof"});
results.caveats=[
"Research circuit and insecure local Groth16 setup only; zkey is NOT a trusted production artifact.",
"Structural absence of identityCommitment/personHash from public signals is demonstrated. This is not a formal cryptographic privacy proof or anonymity-set analysis.",
"The public alias is stable and intentionally identical across both modes, so it links all codes carrying that alias. Stable owner/view keys also correlate codes.",
"Aliases must not be published alongside identityCommitment during issuance, counter updates, or funding; such a mapping would undo identity privacy.",
"Issuance proves knowledge of a consistent identity preimage; it does NOT establish chain enrollment, a current authorization counter, checkpoint freshness, or expiry execution-time enforcement.",
"Changed expiry/counter fails if altering an existing proof. A legitimate issuer retaining identity secrets can generate a new issuance proof. Holders without issuer secrets were not simulated by leaking these test fixtures.",
"Holder presentation/recursive verification, private current-counter queries, letters, delegated funding, recipient offline handling, and full production protocol remain outside this prototype.",
"No production circuit, protocol schema, deployment, source file, or plan was modified."
];
results.counts={realProofChecks:results.realProofChecks.length,witnessChecks:results.witnessChecks.length};
write("summary.json",results);
fs.writeFileSync(path.join(out,"SUMMARY.md"),`# Anonymous receive-code issuance prototype\n\n${results.scope}\n\nPassed ${results.realProofChecks.length} actual Groth16 proof/verification checks and ${results.witnessChecks.length} separate witness-constraint rejection checks. Two original valid proofs and one issuer-authorized metadata-change proof were generated and verified; a fourth proof object generated from a forged private identity witness was rejected by the verifier.\n\nPublic signals: ${publicNames.join(", ")}. identityCommitment remains a private witness. Alias is Poseidon(202610210001, identityCommitment, identity-derived secret).\n\n`+results.caveats.map(x=>`- ${x}`).join("\n")+"\n");
log(`SUCCESS ${JSON.stringify(results.counts)}; files: ${out}`);
process.exit(0);
