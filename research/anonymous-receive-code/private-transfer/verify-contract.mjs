// RESEARCH ONLY. Fixed self/single/dual verifiers; fixture note/counter roots.
// Executes real proofs and replay/time checks, not value custody or a live tree.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import hre from "hardhat";

assert.ok(process.env.DEEPFAMILY_PRIVATE_TRANSFER_OUT, "Expected temporary PrivateTransfer research output directory");
const out = path.resolve(process.env.DEEPFAMILY_PRIVATE_TRANSFER_OUT);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const manifest = read(path.join(out, "transfer-manifest.json"));
for (const item of manifest.cases) item.transferPublic30 ??= item.transferPublic;
const valid = manifest.cases.filter(item => item.valid);
const shapes = ["self", "single", "dual"];
for (const shape of shapes) assert.ok(valid.some(item => item.shape === shape), "Missing valid shape " + shape);
const sourceFiles = {
  self: "SelfTransferVerifier.sol", single: "SingleTransferVerifier.sol", dual: "DualTransferVerifier.sol",
};
const sources = {"TransferConsumer.sol": {content: fs.readFileSync(new URL("./TransferConsumer.sol", import.meta.url), "utf8")}};
for (const shape of shapes) sources[sourceFiles[shape]] = {content: fs.readFileSync(path.join(out, shape, sourceFiles[shape]), "utf8")};
const solc = process.env.DEEPFAMILY_RESEARCH_SOLC ?? path.join(os.homedir(),
  "Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28+commit.7893614a");
const compile = {language: "Solidity", sources, settings: {optimizer: {enabled: true, runs: 1},
  viaIR: true, evmVersion: "cancun", outputSelection: {"*": {"*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"]}}}};
const compiled = JSON.parse(execFileSync(solc, ["--standard-json"], {
  input: JSON.stringify(compile), encoding: "utf8", maxBuffer: 50 * 1024 * 1024,
}));
assert.deepEqual((compiled.errors ?? []).filter(item => item.severity === "error"), []);
const artifactFor = shape => Object.values(compiled.contracts[sourceFiles[shape]])
  .find(item => item.abi.some(fn => fn.name === "verifyProof"));
const proofFor = item => read(item.proofFile ?? path.join(out, item.shape, item.name, "proof.json"));
const publicTransfer = item => [...item.transferPublic30];
const authFor = item => (item.auth ?? []).map(auth => auth.extras);
for (const item of valid) assert.equal(item.transferPublic30.length, 30);
const allAuth = valid.flatMap(item => authFor(item));
assert.ok(allAuth.length > 0);
const initialRoot = String(manifest.initialCounterRoot ?? allAuth[0].stateRoot);
for (const item of valid.filter(item => item.shape !== "self")) {
  const auth = authFor(item);
  for (const current of auth) assert.deepEqual([current.checkpointId, current.stateRoot, current.asOf],
    [auth[0].checkpointId, auth[0].stateRoot, auth[0].asOf], "A transaction uses one counter checkpoint context");
  if (String(auth[0].checkpointId) === "1") assert.equal(String(auth[0].stateRoot), initialRoot);
}
const earliestAsOf = allAuth.reduce((smallest, item) => BigInt(item.asOf) < smallest ? BigInt(item.asOf) : smallest, BigInt(allAuth[0].asOf));
const startTime = earliestAsOf - 100n;
const pairs = [...new Map(valid.flatMap(item => Array.from({length: 8}, (_, index) => {
  const shard = String(item.transferPublic30[2 + index]);
  const root = String(item.transferPublic30[10 + index]);
  return [shard + ":" + root, [shard, root]];
}))).values()];
const connection = await hre.network.create();
const checks = [], gas = {}, bytecode = {};
const mark = test => checks.push({test, passed: true});
const errorIs = name => error => String(error.message).includes(name)
  || String(error.message).includes(connection.ethers.id(name + "()").slice(0, 10));

try {
  const {ethers} = connection, provider = ethers.provider;
  const [signer, other] = await ethers.getSigners();
  const time = async value => {
    await provider.send("evm_setNextBlockTimestamp", [Number(value)]);
    await provider.send("evm_mine", []);
  };
  await time(startTime);
  const verifiers = {};
  for (const shape of shapes) {
    const artifact = artifactFor(shape);
    assert.ok(artifact, "Missing verifier ABI for " + shape);
    const verifier = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
    await verifier.waitForDeployment();
    verifiers[shape] = verifier;
    bytecode[shape] = artifact.evm.deployedBytecode.object.length / 2;
  }
  const artifact = compiled.contracts["TransferConsumer.sol"].TransferConsumer;
  const deployConsumer = async () => {
    const contract = await new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(
      await verifiers.self.getAddress(), await verifiers.single.getAddress(), await verifiers.dual.getAddress(),
      initialRoot, pairs.map(item => item[0]), pairs.map(item => item[1]),
    );
    await contract.waitForDeployment();
    return contract;
  };
  const consumer = await deployConsumer();
  const expectedPool = manifest.poolAddress ?? "0x" + BigInt(valid[0].transferPublic30[1]).toString(16).padStart(40, "0");
  assert.equal((await consumer.getAddress()).toLowerCase(), expectedPool.toLowerCase(), "Fixture consumer deploy nonce");
  const second = await deployConsumer();
  bytecode.consumer = artifact.evm.deployedBytecode.object.length / 2;
  await time(earliestAsOf);
  let snapshot = await provider.send("evm_snapshot", []);
  const restore = async () => {
    assert.equal(await provider.send("evm_revert", [snapshot]), true);
    snapshot = await provider.send("evm_snapshot", []);
  };

  function args(item, patch = {}) {
    const auth = authFor(item);
    const common = {ciphertexts: item.ciphertexts, transfer: publicTransfer(item), proof: proofFor(item).solidityProof,
      messageId: auth[0]?.messageId, checkpointId: auth[0]?.checkpointId, asOf: auth[0]?.asOf,
      expiresAt: auth[0]?.expiresAt, binding: auth[0]?.binding, slot: item.slot, ...patch};
    if (item.shape === "self") return [common.ciphertexts, common.transfer, common.proof];
    if (item.shape === "single") return [common.messageId, common.ciphertexts, common.checkpointId,
      common.asOf, common.expiresAt, common.binding, common.transfer, common.slot, common.proof];
    return [common.messageId, common.ciphertexts, common.checkpointId, common.asOf,
      patch.expiries ?? auth.map(item => item.expiresAt), patch.bindings ?? auth.map(item => item.binding),
      common.transfer, common.proof];
  }
  const methodFor = item => item.shape === "self" ? "transferSelf" : item.shape === "single" ? "transferSingle" : "transferDual";
  const invoke = (item, patch = {}, target = consumer) => target.getFunction(methodFor(item)).staticCall(...args(item, patch));
  const directVerify = async (item, signals) => {
    const proof = proofFor(item);
    const encoded = verifiers[item.shape].interface.getFunction("verifyProof").inputs[0].type === "uint256[8]"
      ? Array.from(ethers.AbiCoder.defaultAbiCoder().decode(["uint256[8]"], proof.solidityProof)[0])
      : proof.solidityProof;
    return verifiers[item.shape].verifyProof.staticCall(encoded, signals ?? proof.publicSignals);
  };

  for (const item of valid) {
    const proof = proofFor(item);
    assert.equal(proof.publicSignals.length, {self: 30, single: 42, dual: 52}[item.shape]);
    await directVerify(item);
    mark(item.name + ": real exported " + item.shape + " verifier accepts");
    const changed = [...proof.publicSignals]; changed[0] = String(BigInt(changed[0]) + 1n);
    await assert.rejects(() => directVerify(item, changed));
    mark(item.name + ": changed public chain rejected by real verifier");
    const context = authFor(item)[0];
    if (context && String(context.checkpointId) !== "1") {
      assert.equal(String(context.checkpointId), "2", "Research fixture supports one renewal step");
      await assert.rejects(() => invoke(item), errorIs("InvalidCheckpoint"));
      mark(item.name + ": new-counter proof cannot use a checkpoint before activation");
      await time(BigInt(context.asOf) - 1n);
      await (await consumer.advanceFixtureCounterRoot(context.stateRoot)).wait();
      assert.equal(String(await consumer.currentCheckpointId()), "2");
      mark(item.name + ": renewed counter proof usable immediately after fixture activation");
    }
    const receipt = await (await consumer.getFunction(methodFor(item))(...args(item))).wait();
    gas[item.name] = receipt.gasUsed.toString();
    const event = receipt.logs.map(log => {try {return consumer.interface.parseLog(log);} catch {return null;}})
      .find(event => event?.name === "TransferVerified");
    assert.equal(String(event.args.output0), item.transferPublic30[26]);
    assert.equal(String(event.args.output1), item.transferPublic30[27]);
    assert.equal(Number(event.args.shape), shapes.indexOf(item.shape));
    for (const nullifier of item.transferPublic30.slice(18, 26)) assert.equal(await consumer.usedNullifiers(nullifier), true);
    mark(item.name + ": transaction records exact proved outputs and all input nullifiers");
    await assert.rejects(() => invoke(item), errorIs("AlreadyUsed"));
    mark(item.name + ": duplicate rejected");
    if (item.shape !== "self") {
      await assert.rejects(() => invoke(item, {messageId: String(BigInt(authFor(item)[0].messageId) + 1000n)}), errorIs("AlreadyUsed"));
      mark(item.name + ": new message cannot replay spent nullifiers");
    }
    await restore();
  }

  for (const shape of shapes) {
    const item = valid.find(item => item.shape === shape);
    const transfer = publicTransfer(item);
    const changedOutput = [...transfer]; changedOutput[26] = String(BigInt(changedOutput[26]) + 1n);
    await assert.rejects(() => invoke(item, {transfer: changedOutput}), errorIs("InvalidProof"));
    mark(shape + ": changed output commitment rejected");
    const changedCipher = [...item.ciphertexts];
    changedCipher[0] = "0x" + "ab".repeat(512);
    await assert.rejects(() => invoke(item, {ciphertexts: changedCipher}), errorIs("InvalidCiphertext"));
    mark(shape + ": actual ciphertext hash checked");
    const changedRoot = [...transfer]; changedRoot[10] = "123";
    await assert.rejects(() => invoke(item, {transfer: changedRoot}), errorIs("InvalidFixtureRoot"));
    mark(shape + ": unregistered input root rejected");
    const changedShard = [...transfer]; changedShard[2] = String(1n << 120n);
    await assert.rejects(() => invoke(item, {transfer: changedShard}), errorIs("InvalidFixtureRoot"));
    mark(shape + ": known root cannot be rebound to an unregistered shard");
    const changedChain = [...transfer]; changedChain[0] = String(BigInt(changedChain[0]) + 1n);
    await assert.rejects(() => invoke(item, {transfer: changedChain}), errorIs("InvalidScope"));
    mark(shape + ": actual chain checked");
    await assert.rejects(() => invoke(item, {}, second), errorIs("InvalidScope"));
    mark(shape + ": cross-consumer replay rejected");
  }

  const single = valid.find(item => item.shape === "single");
  await assert.rejects(() => invoke(single, {slot: 1 - Number(single.slot)}), errorIs("InvalidProof"));
  mark("single: changing the external slot cannot turn the other output into self");
  const slotOne = valid.find(item => item.shape === "single" && Number(item.slot) === 1);
  assert.ok(slotOne, "A valid slot-one external fixture is required");
  await invoke(slotOne); mark("single: slot one external receiver is independently authenticated");
  await assert.rejects(() => invoke(single, {expiresAt: String(BigInt(authFor(single)[0].expiresAt) + 1n)}), errorIs("InvalidProof"));
  mark("single: unauthenticated deadline extension rejected");
  await assert.rejects(() => invoke(single, {asOf: String(startTime - 1n)}), errorIs("InvalidCheckpoint"));
  mark("single: state time before checkpoint creation rejected");
  await assert.rejects(() => invoke(single, {asOf: String(earliestAsOf + 1000n)}), errorIs("InvalidCheckpoint"));
  mark("single: future state time rejected");
  await time(BigInt(authFor(single)[0].expiresAt) - 1n); await invoke(single);
  mark("single: authenticated expiry-1 accepted");
  await time(BigInt(authFor(single)[0].expiresAt));
  await assert.rejects(() => invoke(single), errorIs("ExpiredCode"));
  mark("single: authenticated expiry rejected immediately");
  await restore();
  const dual = valid.find(item => item.shape === "dual" && BigInt(authFor(item)[1].expiresAt) < BigInt(authFor(item)[0].expiresAt));
  assert.ok(dual, "A valid dual fixture with shorter second deadline is required");
  const dualAuth = authFor(dual);
  await assert.rejects(() => invoke(dual, {expiries: [dualAuth[0].expiresAt, String(BigInt(dualAuth[1].expiresAt) + 1n)]}), errorIs("InvalidProof"));
  mark("dual: changing only the second authenticated deadline rejected");
  await time(BigInt(dualAuth[1].expiresAt) - 1n); await invoke(dual);
  mark("dual: both actual deadlines accepted before shorter second expiry");
  await time(BigInt(dualAuth[1].expiresAt));
  assert.ok(BigInt(dualAuth[1].expiresAt) < BigInt(dualAuth[0].expiresAt));
  await assert.rejects(() => invoke(dual), errorIs("ExpiredCode"));
  mark("dual: second receiver expiry rejects while first receiver remains unexpired");
  await restore();

  const changedRoot = String(BigInt(initialRoot) + 1n);
  await assert.rejects(() => consumer.connect(other).advanceFixtureCounterRoot(changedRoot), errorIs("UnauthorizedFixtureDriver"));
  mark("nonfixture account cannot replace counter roots");
  await time(earliestAsOf + 100n); await (await consumer.advanceFixtureCounterRoot(changedRoot)).wait();
  const retiredAt = (await consumer.checkpoints(1)).retiredAt;
  await time(retiredAt + 899n); await invoke(single);
  mark("external receiver accepts retired counter checkpoint at +899");
  await assert.rejects(() => invoke(single, {asOf: String(retiredAt + 1n)}), errorIs("InvalidCheckpoint"));
  mark("retired checkpoint cannot certify a state time after retirement");
  await time(retiredAt + 900n);
  await assert.rejects(() => invoke(single), errorIs("CheckpointExpired"));
  mark("external receiver rejects retired counter checkpoint at +900");
  const self = valid.find(item => item.shape === "self");
  const latestExpiry = allAuth.reduce((latest, item) => BigInt(item.expiresAt) > latest ? BigInt(item.expiresAt) : latest, 0n);
  await time(latestExpiry + 1000n); await invoke(self);
  mark("self: actual owner proof remains usable after all fixture code deadlines and counter retirement");
  await restore();

  const proverEvidence = {};
  for (const shape of shapes) {
    const file = path.join(out, shape, "cases-summary.json");
    if (fs.existsSync(file)) proverEvidence[shape] = {file, results: read(file)};
  }
  const requiredNegativeWitnesses = [
    ["self", "self-cannot-hide-external"],
    ["self", "same-identity-different-owner-not-self"],
    ["single", "single-second-external-cannot-hide-as-change"],
    ["dual", "dual-second-revoked-counter-current-root"],
    ["dual", "dual-second-authenticated-expiry-mismatch"],
  ];
  for (const [shape, name] of requiredNegativeWitnesses) {
    const row = proverEvidence[shape]?.results.cases.find(item => item.name === name);
    assert.ok(row?.passed && row.expectedValid === false && row.constraintSolveRejected === true,
      "Actual prover rejection evidence required: " + name);
  }
  const result = {scope: "Real self/single/dual PrivateTransfer proofs with actual EVM ciphertext, nullifier and expiry/checkpoint checks; fixture input roots and no value custody",
    checks, gas, verifierRuntimeBytes: bytecode, proverEvidence,
    actualProverNegativeEvidence: requiredNegativeWitnesses.map(([shape, name]) => ({shape, name,
      scope: "Actual prover constraint rejection before proof generation, separately recorded from EVM checks"})),
    limitations: [
      "Every entry uses a fixed shape verifier; the complete circuit proves actual spending-owner classification rather than trusting a client self flag",
      "Shape/slot/authentication cardinality is public in this research ABI; no production privacy encoding is frozen",
      "Input shard/root pairs and counter-root writes are fixture-driven; no production pool tree, real owner-authorized counter update or asset custody is integrated here",
      "Output commitments and ciphertext hashes are bound, but HPKE encryption correctness and full wallet recovery are not proved",
      "Invalid private witnesses rejected before proof generation belong to the separate actual-prover evidence, not EVM verifier rejections",
      "Local development setup and desktop EDR measurements are not a production ceremony, browser/mobile proof result or formal privacy audit",
    ]};
  fs.writeFileSync(path.join(out, "contract-results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({passed: true, checks: checks.length, gas, verifierRuntimeBytes: bytecode}, null, 2));
} finally {
  await connection.close();
}
