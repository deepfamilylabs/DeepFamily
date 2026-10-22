#!/usr/bin/env node
// Synthetic research fixture only. Never pass real identity secrets to this script.
// node run.mjs <repoRoot> <composition-inputs.json> [temporary-output-directory]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.ok(process.argv[2] && process.argv[3], 'Expected repoRoot and composition-inputs.json');
const repoRoot = fs.realpathSync(path.resolve(process.argv[2]));
const compositionFile = path.resolve(process.argv[3]);
const out = path.resolve(process.argv[4] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'deepfamily-owner-counter-update-')));
fs.mkdirSync(out, { recursive: true });
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
assert.ok(!out.startsWith(`${repoRoot}${path.sep}`), 'Generated artifacts must be outside the repository');
// ffjavascript's setup path has no singleThread option. Cap its local process
// worker pool to two; the actual proof generation below is explicitly single-threaded.
const originalCPUs = os.cpus;
os.cpus = () => originalCPUs().slice(0, 2);
const requireRepo = createRequire(path.join(repoRoot, 'package.json'));
const snarkjs = requireRepo('snarkjs');
const { WitnessCalculatorBuilder } = requireRepo('circom_runtime');
const { poseidon3, poseidon6 } = requireRepo('poseidon-lite');
const { build, query } = await import(pathToFileURL(path.join(repoRoot, 'research/anonymous-receive-code/prepare-composition.mjs')));
const { buildLineageFixture } = await import(pathToFileURL(path.join(repoRoot, 'circuits/test/generate_lineage_fixture.mjs')));
const { buildShieldedClaimFixture } = await import(pathToFileURL(path.join(repoRoot, 'circuits/test/generate_shielded_claim_input.mjs')));
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(out, name), `${JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v, 2)}\n`);
const log = (value) => { fs.appendFileSync(path.join(out, 'run.log'), `${value}\n`); console.log(value); };
const manifest = read(compositionFile);
const lineage = buildLineageFixture().witness;
const I = buildShieldedClaimFixture().heirIdentityCommitment;
const secret = BigInt(lineage.derivedSecretField);
const R = poseidon3([202610210001n, I, secret]);
const initialCode = read(path.join(manifest.cases[0].inputDir, 'mode-0.public.json'));
assert.equal(String(R), initialCode[0]);
assert.equal(initialCode[1], '0', 'This integration fixture starts at default counter zero');
const neighbors = [[R ^ 1n, 5n], [R ^ 2n, 9n]];
const initial = build(neighbors);
const incremented = build([...neighbors, [R, 1n]]);
assert.equal(String(initial.hash), manifest.initialRoot);
assert.equal(String(incremented.hash), manifest.incrementedRoot);
const privateNames = ['nameField', 'derivedSecretField', 'isBirthBC', 'birthYear', 'birthMonth', 'birthDay', 'gender', 'suiteId'];
const identityWitness = Object.fromEntries(privateNames.map((name) => [name, lineage[name]]));
const publicSignalNames = ['authNullifier', 'chainId', 'consumer', 'aliasR', 'oldRoot', 'newRoot', 'oldCounter', 'newCounter'];
const report = {
  scope: 'Research-only owner-authenticated counter insert/update; synthetic identity; development setup',
  compositionFile, publicSignalNames, maxSetupWorkers: 2, proofSingleThread: true,
  validProofs: [], witnessChecks: [], proofTamperChecks: [],
  limitations: [
    'Depth-8 compressed SMT fixture, not production capacity or a scalability result.',
    'Local Groth16 setup from pinned repository ptau17; generated keys must not be deployed.',
    'I and the identity preimage are private circuit wires; public alias R remains linkable.',
    'The consumer must check actual chain/address, oldRoot == liveRoot, and strict state transition before activating the next checkpoint.',
    'This script does not itself deploy a consumer or establish the 900-second checkpoint retirement integration.',
  ],
};

function witness(entries, oldCounter, newCounter = oldCounter + 1n) {
  const prior = build(entries);
  const p = query(prior, R);
  const next = build([...entries.filter(([key]) => key !== R), [R, newCounter]]);
  return {
    chainId: '31337', consumer: String(BigInt(manifest.consumer)), aliasR: String(R),
    oldRoot: String(prior.hash), newRoot: String(next.hash),
    oldCounter: String(oldCounter), newCounter: String(newCounter),
    ...identityWitness, siblings: p.siblings,
    oldKey: oldCounter === 0n ? p.oldKey : String(R),
    oldValue: oldCounter === 0n ? p.oldValue : String(oldCounter),
    isOld0: p.isOld0,
  };
}
function expectedPublic(input) {
  const n = poseidon6([202610210201n, BigInt(input.derivedSecretField), BigInt(input.aliasR), BigInt(input.chainId), BigInt(input.consumer), BigInt(input.oldCounter)]);
  return [String(n), ...publicSignalNames.slice(1).map((name) => input[name])];
}

const circuitPath = path.join(sourceDir, 'owner_counter_update.circom');
const compileStart = performance.now();
log(`Compiling isolated owner-counter circuit; artifacts: ${out}`);
const compileLog = execFileSync(path.join(repoRoot, 'bin/circom'), [
  circuitPath, '--r1cs', '--wasm', '--sym', '--O2', '--sanity_check', '2',
  '-l', path.join(repoRoot, 'circuits'), '-l', path.join(repoRoot, 'node_modules'), '-o', out,
], { cwd: out, encoding: 'utf8' });
fs.writeFileSync(path.join(out, 'compile.log'), compileLog);
report.compileMilliseconds = Math.round(performance.now() - compileStart);
report.compileLog = compileLog.trim();
log(compileLog.trim());
const baseName = 'owner_counter_update';
const r1cs = path.join(out, `${baseName}.r1cs`);
const wasm = path.join(out, `${baseName}_js/${baseName}.wasm`);
const zkey = path.join(out, 'INSECURE-owner-counter-update.zkey');
const ptau = path.join(repoRoot, 'circuits/ptau/ppot_0080_17.ptau');
log('Development Groth16 setup from pinned ptau17 (at most two setup workers)');
await snarkjs.zKey.newZKey(r1cs, ptau, zkey);
const vkey = await snarkjs.zKey.exportVerificationKey(zkey);
write('verification-key.json', vkey);
const template = fs.readFileSync(path.join(repoRoot, 'node_modules/snarkjs/templates/verifier_groth16.sol.ejs'), 'utf8');
let solidity = await snarkjs.zKey.exportSolidityVerifier(zkey, { groth16: template });
solidity = solidity.replace('contract Groth16Verifier', 'contract OwnerCounterUpdateVerifier');
fs.writeFileSync(path.join(out, 'OwnerCounterUpdateVerifier.sol'), solidity);
const calculator = await WitnessCalculatorBuilder(fs.readFileSync(wasm), { singleThread: true });

const zeroToOne = witness(neighbors, 0n);
const oneToTwo = witness([...neighbors, [R, 1n]], 1n);
assert.equal(zeroToOne.oldRoot, manifest.initialRoot);
assert.equal(zeroToOne.newRoot, manifest.incrementedRoot);
async function prove(name, input) {
  write(`${name}.input.json`, input);
  const start = performance.now();
  const data = await snarkjs.groth16.fullProve(input, wasm, zkey, undefined, { singleThread: true }, { singleThread: true });
  assert.equal(await snarkjs.groth16.verify(vkey, data.publicSignals, data.proof), true);
  assert.deepEqual(data.publicSignals, expectedPublic(input));
  assert.equal(data.publicSignals.length, publicSignalNames.length);
  assert.equal(data.publicSignals.some((value) => BigInt(value) === I), false);
  write(`${name}.proof.json`, data.proof);
  write(`${name}.public.json`, data.publicSignals);
  const calldata = JSON.parse(`[${await snarkjs.groth16.exportSolidityCallData(data.proof, data.publicSignals)}]`);
  write(`${name}.solidity.json`, { a: calldata[0], b: calldata[1], c: calldata[2], publicSignals: calldata[3] });
  report.validProofs.push({ name, passed: true, milliseconds: Math.round(performance.now() - start) });
  log(`Real proof verified: ${name}`);
  return data;
}
const firstProof = await prove('counter-0-to-1', zeroToOne);
await prove('counter-1-to-2', oneToTwo);
await calculator.calculateWitness(witness([], 0n), 1);
report.witnessChecks.push({ name: 'insert into genuinely empty tree', passed: true, expected: 'witness accepts' });

async function reject(name, input) {
  let rejected = false;
  try { await calculator.calculateWitness(input, 1); } catch (error) {
    assert.match(String(error?.message ?? error), /Assert Failed\./u, `${name}: expected a constraint failure`);
    rejected = true;
  }
  assert.equal(rejected, true, name);
  report.witnessChecks.push({ name, passed: true, expected: 'constraint/witness rejection, not a proof-verifier check' });
}
await reject('wrong identity secret cannot authorize canonical R', { ...zeroToOne, derivedSecretField: String(secret + 1n) });
await reject('wrong alias cannot be chosen by the owner witness', { ...zeroToOne, aliasR: String(R + 1n) });
await reject('wrong old root', { ...zeroToOne, oldRoot: String(BigInt(zeroToOne.oldRoot) + 1n) });
await reject('wrong new root', { ...zeroToOne, newRoot: String(BigInt(zeroToOne.newRoot) + 1n) });
await reject('counter cannot skip from 0 to 2', witness(neighbors, 0n, 2n));
await reject('existing counter1 cannot masquerade as absent default0', witness([...neighbors, [R, 1n]], 0n));
await reject('wrong SMT sibling', { ...zeroToOne, siblings: [String(BigInt(zeroToOne.siblings[0]) + 1n), ...zeroToOne.siblings.slice(1)] });
await reject('uint64 counter cannot wrap from MAX to zero', witness([...neighbors, [R, (1n << 64n) - 1n]], (1n << 64n) - 1n, 0n));
for (let index = 0; index < publicSignalNames.length; index++) {
  const changed = [...firstProof.publicSignals];
  changed[index] = String(BigInt(changed[index]) + 1n);
  assert.equal(await snarkjs.groth16.verify(vkey, changed, firstProof.proof), false);
  report.proofTamperChecks.push({ name: `alter public ${publicSignalNames[index]}`, passed: true, expected: 'real verifier returns false' });
}
report.paths = { output: out, solidityVerifier: path.join(out, 'OwnerCounterUpdateVerifier.sol'), firstProof: path.join(out, 'counter-0-to-1.solidity.json'), nextProof: path.join(out, 'counter-1-to-2.solidity.json') };
report.counts = { validRealProofs: report.validProofs.length, witnessChecks: report.witnessChecks.length, realPublicTamperRejections: report.proofTamperChecks.length };
write('summary.json', report);
log(`SUCCESS ${JSON.stringify(report.counts)}; ${path.join(out, 'summary.json')}`);
if (globalThis.curve_bn128?.terminate) await globalThis.curve_bn128.terminate();
process.exit(0);
