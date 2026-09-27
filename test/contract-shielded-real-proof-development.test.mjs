import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2, poseidon8 } from "poseidon-lite";
import {
  buildShieldedPoolPublicSignals,
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedDummyInputNullifier,
  computeShieldedDummyPeriodNullifier,
  computeShieldedEnrollmentCommitment,
  computeShieldedEnrollmentNullifier,
  computeShieldedOwnerCommitment,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedPolicyNoteCommitment,
  computeShieldedRegistrationLeaf,
  computeShieldedSpendNullifier,
  computeShieldedTopUpUseNullifier,
  computeShieldedValueNoteCommitment,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedPolicyNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  splitShieldedViewPublicKey,
  verifyShieldedNotePayload,
} from "@deepfamily/protocol-core";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { buildShieldedClaimFixture } from "../circuits/test/generate_shielded_claim_input.mjs";
import { buildShieldedFundingFixtures } from "../circuits/test/generate_shielded_funding_input.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEV_ARTIFACTS = path.join(ROOT, "zk-artifacts", "shielded");
const MANIFEST = path.join(DEV_ARTIFACTS, "development-manifest.json");
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const PERIOD = 2_592_000n;
const CIRCUIT_SOURCES = {
  createPolicy: "shielded_create_policy",
  privateTransfer: "shielded_private_transfer",
  topUp: "shielded_top_up",
};
const sha256 = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const zeroData = () => ({
  inputShardIds: [0n, 0n],
  inputRoots: [0n, 0n],
  inputNullifiers: [0n, 0n],
  periodNullifiers: Array(12).fill(0n),
  outputCommitments: [0n, 0n],
  outputCiphertexts: ["0x", "0x"],
  relation0: 0n,
  relation1: 0n,
  asOf: 0n,
  registryRoot: 0n,
  registryShardId: 0n,
});

function circuitFiles(action) {
  const source = CIRCUIT_SOURCES[action] ?? `shielded_${action}`;
  return {
    source,
    circuit: path.join(ROOT, "circuits", `${source}.circom`),
    r1cs: path.join(DEV_ARTIFACTS, `${source}.r1cs`),
    wasm: path.join(DEV_ARTIFACTS, `${source}_js`, `${source}.wasm`),
    zkey: path.join(DEV_ARTIFACTS, `${source}_dev_final.zkey`),
    vkey: path.join(DEV_ARTIFACTS, `${source}.vkey.json`),
    verifier: path.join(DEV_ARTIFACTS, "verifiers", `${source}.sol`),
  };
}

function checkedDevelopmentArtifacts(actions) {
  const paths = [
    MANIFEST,
    ...actions.flatMap((action) =>
      Object.entries(circuitFiles(action))
        .filter(([kind]) => kind !== "source")
        .map(([, file]) => file),
    ),
  ];
  const missing = paths.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) return { missing };

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  assert.equal(manifest.developmentOnly, true, "Only development proving keys may run this test");
  assert.equal(manifest.productionReady, false, "This test must never use production keys");
  for (const action of actions) {
    const files = circuitFiles(action);
    const item = manifest.circuits?.[action];
    assert.equal(item?.source, files.source, `Missing development manifest entry for ${action}`);
    for (const [kind, digest] of [
      ["circuit", item.sourceSha256],
      ["r1cs", item.r1csSha256],
      ["wasm", item.wasmSha256],
      ["zkey", item.zkeySha256],
      ["vkey", item.verificationKeySha256],
      ["verifier", item.verifierSha256],
    ]) {
      assert.equal(
        sha256(files[kind]),
        digest,
        `${action} ${kind} changed after development setup`,
      );
    }
  }
  return { manifest };
}

async function deployGeneratedDevelopmentVerifiers(actions, signer) {
  // Compile ignored, development-only snarkjs output in memory. It is never
  // copied into contracts/, frontend/public/, ABI releases, or deployments.
  const compilerModule = path.join(
    ROOT,
    "node_modules",
    "hardhat",
    "dist",
    "src",
    "internal",
    "builtin-plugins",
    "solidity",
    "build-system",
    "compiler",
    "index.js",
  );
  const { getCompiler } = await import(pathToFileURL(compilerModule).href);
  const compiler = await getCompiler("0.8.28", { preferWasm: false });
  const sources = Object.fromEntries(
    actions.map((action) => [
      `${action}.sol`,
      { content: fs.readFileSync(circuitFiles(action).verifier, "utf8") },
    ]),
  );
  const compiled = await compiler.compile({
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 1 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  });
  const errors = compiled.errors?.filter((entry) => entry.severity === "error") ?? [];
  assert.deepEqual(
    errors,
    [],
    `Development verifier compilation failed: ${JSON.stringify(errors)}`,
  );
  const deployed = {};
  for (const action of actions) {
    const artifact = compiled.contracts[`${action}.sol`].Groth16Verifier;
    const factory = new hre.ethers.ContractFactory(
      artifact.abi,
      `0x${artifact.evm.bytecode.object}`,
      signer,
    );
    deployed[action] = await factory.deploy();
    await deployed[action].waitForDeployment();
  }
  return deployed;
}

async function encryptPayloadNote(input, payload) {
  const ciphertext = await encryptShieldedNote({
    recipientPublicKey: input.viewingKey,
    payload,
    chainId: input.chainId,
    poolAddress: input.poolAddress,
  });
  const ciphertextHex = hre.ethers.hexlify(ciphertext);
  const ciphertextHashField = BigInt(hre.ethers.keccak256(ciphertextHex)) % FIELD;
  return { payload, ciphertext, ciphertextHex, ciphertextHashField };
}

async function encryptValueNote(input) {
  const payload = encodeShieldedValueNotePayload({
    ownerCommitment: input.ownerCommitment,
    amount: input.amount,
    nonce: input.nonce,
  });
  const encrypted = await encryptPayloadNote(input, payload);
  const commitment = computeShieldedValueNoteCommitment({
    ownerCommitment: input.ownerCommitment,
    amount: input.amount,
    nonce: input.nonce,
    ciphertextHashField: encrypted.ciphertextHashField,
  });
  return { amount: input.amount, nonce: input.nonce, ...encrypted, commitment };
}

function compactMembership(proof) {
  return {
    depth: String(proof.proofDepth),
    index: String(proof.proofIndex),
    siblings: [...proof.siblings.map(String), ...Array(32 - proof.siblings.length).fill("0")],
  };
}

function syntheticFullMerklePath(leaf, depth, index, siblingSeed) {
  let root = BigInt(leaf);
  const siblings = [];
  for (let level = 0; level < depth; level += 1) {
    const sibling = BigInt(siblingSeed + level);
    siblings.push(sibling.toString());
    root =
      ((index >> BigInt(level)) & 1n) === 1n
        ? poseidon2([sibling, root])
        : poseidon2([root, sibling]);
  }
  return { root, siblings, index: index.toString(), depth: depth.toString() };
}

async function prove(action, witness, expectedSignals) {
  const files = circuitFiles(action);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-e2e-"));
  const inputPath = path.join(temporary, "input.json");
  const proofPath = path.join(temporary, "proof.json");
  const publicPath = path.join(temporary, "public.json");
  const cli = path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");
  const runSnarkjs = (args) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  try {
    fs.writeFileSync(inputPath, JSON.stringify(witness));
    runSnarkjs(["groth16", "fullprove", inputPath, files.wasm, files.zkey, proofPath, publicPath]);
    const publicSignals = JSON.parse(fs.readFileSync(publicPath, "utf8"));
    assert.deepEqual(
      publicSignals.map(BigInt),
      expectedSignals,
      `${action} circuit signal order drifted`,
    );
    assert.match(
      runSnarkjs(["groth16", "verify", files.vkey, publicPath, proofPath]),
      /OK!/u,
      `${action} proof did not verify with its development verification key`,
    );
    const proof = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    return encodeGroth16AbcProofData(normalizeGroth16Proof(proof));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function assertInvalidCircuitWitness(action, witness, expectedFailure) {
  const files = circuitFiles(action);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-invalid-"));
  const inputPath = path.join(temporary, "input.json");
  const witnessPath = path.join(temporary, "witness.wtns");
  const cli = path.join(ROOT, "node_modules", "snarkjs", "build", "cli.cjs");
  try {
    fs.writeFileSync(inputPath, JSON.stringify(witness));
    const result = spawnSync(
      process.execPath,
      [cli, "wtns", "calculate", files.wasm, inputPath, witnessPath],
      { cwd: ROOT, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    assert.notEqual(result.status, 0, `${action} unexpectedly accepted an invalid witness`);
    assert.match(`${result.stdout}${result.stderr}`, expectedFailure);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

describe("Shielded pool real Groth16 development integration", function () {
  this.timeout(1_200_000);

  it("proves one synthetic full 64/32 path and twelve periods with real development keys", async function () {
    const artifacts = checkedDevelopmentArtifacts(["claim"]);
    if (artifacts.missing) {
      console.log(
        `Skipping development-only full-path proof; run npm run zk:shielded:development:setup (${artifacts.missing.length} artifacts absent)`,
      );
      this.skip();
    }
    const { witness, inputBudget, heirIdentityCommitment } = buildShieldedClaimFixture({
      claimCount: 12,
      remainingPeriods: 12,
    });
    const note = syntheticFullMerklePath(inputBudget, 32, (1n << 31n) | 5n, 1100);
    witness.noteDepth = note.depth;
    witness.noteIndex = note.index;
    witness.noteSiblings = note.siblings;
    witness.publicSignals[4] = note.root.toString();
    witness.publicSignals[6] = note.root.toString();

    const endorser = hre.ethers.toBeHex(BigInt(witness.endorser), 20);
    const parentsDigest = computeLineageParentsDigest({
      fatherIdentityCommitment: witness.fatherIdentityCommitment,
      motherIdentityCommitment: witness.motherIdentityCommitment,
    });
    const rootIdentityCommitment =
      witness.rootIsMother === "1"
        ? witness.motherIdentityCommitment
        : witness.fatherIdentityCommitment;
    const endorsementLeaf = computeLineageEndorsementLeaf({
      identityCommitment: heirIdentityCommitment,
      parentsDigest,
      versionIndex: witness.versionIndex,
      endorser,
      writtenAt: witness.writtenAt,
    });
    const trustedLeaf = computeLineageTrustedLeaf({
      rootIdentityCommitment,
      rootVersionIndex: witness.rootVersionIndex,
      account: endorser,
    });
    const endorsement = syntheticFullMerklePath(endorsementLeaf, 64, (1n << 63n) | 9n, 1200);
    const trusted = syntheticFullMerklePath(trustedLeaf, 64, (1n << 62n) | 7n, 1300);
    witness.endorsementDepth = endorsement.depth;
    witness.endorsementIndex = endorsement.index;
    witness.endorsementSiblings = endorsement.siblings;
    witness.publicSignals[27] = endorsement.root.toString();
    witness.trustedDepth = trusted.depth;
    witness.trustedIndex = trusted.index;
    witness.trustedSiblings = trusted.siblings;
    witness.publicSignals[28] = trusted.root.toString();

    const start = performance.now();
    const proof = await prove("claim", witness, witness.publicSignals.map(BigInt));
    const nodeProofMs = Math.ceil(performance.now() - start);
    assert.ok(proof.length > 2);
    if (process.env.SHIELDED_FULL_DEPTH_PROOF_REPORT === "1") {
      console.log(
        JSON.stringify({
          type: "shielded-local-synthetic-full-path-proof",
          releaseEvidence: false,
          proofEnvironment: "Node.js, not a target browser",
          lineageDepth: 64,
          noteDepth: 32,
          claimedPeriods: 12,
          nodeProofMs,
        }),
      );
    }
  });

  it("uses real shield and unshield proofs through Solidity verifiers and the pool", async function () {
    const artifacts = checkedDevelopmentArtifacts(["shield", "unshield"]);
    if (artifacts.missing) {
      console.log(
        `Skipping development-only real proof test; run npm run zk:shielded:development:setup (${artifacts.missing.length} artifacts absent)`,
      );
      this.skip();
    }

    const [depositor, recipient] = await hre.ethers.getSigners();
    const generated = await deployGeneratedDevelopmentVerifiers(["shield", "unshield"], depositor);
    const shieldAdapter = await hre.ethers.deployContract("ShieldedGroth16ActionAdapter", [
      await generated.shield.getAddress(),
      0,
    ]);
    const unshieldAdapter = await hre.ethers.deployContract("ShieldedGroth16ActionAdapter", [
      await generated.unshield.getAddress(),
      7,
    ]);
    const mockAdapter = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const keyRegistry = await hre.ethers.deployContract("ShieldedPoolKeyRegistryMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all(
      [shieldAdapter, unshieldAdapter, mockAdapter, token, lineage, keyRegistry, poseidon].map(
        (contract) => contract.waitForDeployment(),
      ),
    );
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const mockAddress = await mockAdapter.getAddress();
    const verifierAddresses = Array(8).fill(mockAddress);
    verifierAddresses[0] = await shieldAdapter.getAddress();
    verifierAddresses[7] = await unshieldAdapter.getAddress();
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await keyRegistry.getAddress(),
      verifierAddresses,
    );
    await pool.waitForDeployment();
    const poolAddress = await pool.getAddress();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const ownerSecret = 424242n;
    const ownerCommitment = computeShieldedOwnerCommitment(ownerSecret);
    const hpkeIkm = hre.ethers.getBytes(hre.ethers.zeroPadValue("0x1234", 32));
    const viewingKey = await deriveShieldedViewPublicKey(hpkeIkm);
    const noteInput = { ownerCommitment, viewingKey, chainId, poolAddress };
    const initialNotes = await Promise.all([
      encryptValueNote({ ...noteInput, amount: 100n, nonce: 11n }),
      encryptValueNote({ ...noteInput, amount: 0n, nonce: 12n }),
    ]);
    const shieldData = {
      ...zeroData(),
      outputCommitments: initialNotes.map((note) => note.commitment),
      outputCiphertexts: initialNotes.map((note) => note.ciphertextHex),
    };
    const shieldSignals = buildShieldedPoolPublicSignals({
      action: 0,
      chainId,
      poolAddress,
      ...shieldData,
      amount: 100n,
    });
    const shieldProof = await prove(
      "shield",
      {
        publicSignals: shieldSignals.map(String),
        ownerSecret: String(ownerSecret),
        outputAmounts: ["100", "0"],
        outputNonces: ["11", "12"],
      },
      shieldSignals,
    );
    expect(await shieldAdapter.verifyProof(shieldProof, shieldSignals)).to.equal(true);
    await token.mint(depositor.address, 100n);
    await token.approve(poolAddress, 100n);
    await expect(pool.shield(101n, shieldData, shieldProof)).to.be.revertedWithCustomError(
      pool,
      "InvalidZKProof",
    );
    const originalLastByte = Number.parseInt(shieldData.outputCiphertexts[0].slice(-2), 16);
    const alteredCiphertext = `${shieldData.outputCiphertexts[0].slice(0, -2)}${(
      originalLastByte ^ 1
    )
      .toString(16)
      .padStart(2, "0")}`;
    await expect(
      pool.shield(
        100n,
        { ...shieldData, outputCiphertexts: [alteredCiphertext, shieldData.outputCiphertexts[1]] },
        shieldProof,
      ),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    const shieldReceipt = await (await pool.shield(100n, shieldData, shieldProof)).wait();
    expect(await pool.totalShielded()).to.equal(100n);
    expect(await token.balanceOf(poolAddress)).to.equal(100n);
    const recovered = await decryptShieldedNote({
      ciphertext: initialNotes[0].ciphertext,
      hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: recovered,
        ciphertext: initialNotes[0].ciphertext,
        noteCommitment: initialNotes[0].commitment,
      }).note.amount,
    ).to.equal(100n);

    const root = (await pool.noteShard(0)).root;
    const pathProof = await pool.getNoteMerkleProof(0, 0);
    expect(pathProof.proofDepth).to.equal(1n);
    const spendNullifier = computeShieldedSpendNullifier({
      ownerSecret,
      noteCommitment: initialNotes[0].commitment,
    });
    const dummyNullifier = computeShieldedDummyInputNullifier({
      ownerSecret,
      noteCommitment: initialNotes[0].commitment,
    });
    const changeNotes = await Promise.all([
      encryptValueNote({ ...noteInput, amount: 70n, nonce: 13n }),
      encryptValueNote({ ...noteInput, amount: 0n, nonce: 14n }),
    ]);
    const unshieldData = {
      ...zeroData(),
      inputRoots: [root, root],
      inputNullifiers: [spendNullifier, dummyNullifier],
      outputCommitments: changeNotes.map((note) => note.commitment),
      outputCiphertexts: changeNotes.map((note) => note.ciphertextHex),
    };
    const unshieldSignals = buildShieldedPoolPublicSignals({
      action: 7,
      chainId,
      poolAddress,
      ...unshieldData,
      amount: 30n,
      recipient: recipient.address,
    });
    const unshieldProof = await prove(
      "unshield",
      {
        publicSignals: unshieldSignals.map(String),
        ownerSecret: String(ownerSecret),
        inputAmount: "100",
        inputNonce: "11",
        inputCiphertextHash: String(initialNotes[0].ciphertextHashField),
        noteDepth: String(pathProof.proofDepth),
        noteIndex: String(pathProof.proofIndex),
        noteSiblings: [
          ...pathProof.siblings.map(String),
          ...Array(32 - pathProof.siblings.length).fill("0"),
        ],
        changeAmount: "70",
        changeNonce: "13",
        dummyNonce: "14",
      },
      unshieldSignals,
    );
    expect(await unshieldAdapter.verifyProof(unshieldProof, unshieldSignals)).to.equal(true);
    await expect(
      pool.unshield(depositor.address, 30n, unshieldData, unshieldProof),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    const unshieldReceipt = await (
      await pool.unshield(recipient.address, 30n, unshieldData, unshieldProof)
    ).wait();
    expect(await token.balanceOf(recipient.address)).to.equal(30n);
    expect(await token.balanceOf(poolAddress)).to.equal(70n);
    expect(await pool.totalShielded()).to.equal(70n);
    expect(await pool.nullifierSpent(spendNullifier)).to.equal(true);
    expect(await pool.nullifierSpent(dummyNullifier)).to.equal(true);
    await expect(
      pool.unshield(recipient.address, 30n, unshieldData, unshieldProof),
    ).to.be.revertedWithCustomError(pool, "NullifierAlreadySpent");
    console.log(
      `development-only Hardhat gas: shield=${shieldReceipt.gasUsed} unshield=${unshieldReceipt.gasUsed}`,
    );
  });

  it("allocates, tops up, and claims one or twelve full periods with real proofs", async function () {
    const actions = ["shield", "createPolicy", "allocate", "topUp", "claim"];
    const artifacts = checkedDevelopmentArtifacts(actions);
    if (artifacts.missing) {
      console.log(
        `Skipping development-only allocation/claim proof test; run npm run zk:shielded:development:setup (${artifacts.missing.length} artifacts absent)`,
      );
      this.skip();
    }

    const [depositor] = await hre.ethers.getSigners();
    const generated = await deployGeneratedDevelopmentVerifiers(actions, depositor);
    const mockAdapter = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
    const verifierAddresses = Array(8).fill(await mockAdapter.getAddress());
    for (const [action, actionIndex] of [
      ["shield", 0],
      ["createPolicy", 1],
      ["allocate", 2],
      ["topUp", 3],
      ["claim", 5],
    ]) {
      const adapter = await hre.ethers.deployContract("ShieldedGroth16ActionAdapter", [
        await generated[action].getAddress(),
        actionIndex,
      ]);
      await adapter.waitForDeployment();
      verifierAddresses[actionIndex] = await adapter.getAddress();
    }
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const keyRegistry = await hre.ethers.deployContract("ShieldedPoolKeyRegistryMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all(
      [mockAdapter, token, lineage, keyRegistry, poseidon].map((contract) =>
        contract.waitForDeployment(),
      ),
    );
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await keyRegistry.getAddress(),
      verifierAddresses,
    );
    await pool.waitForDeployment();
    const poolAddress = await pool.getAddress();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const donorOwnerSecret = 424242n;
    const donorOwnerCommitment = computeShieldedOwnerCommitment(donorOwnerSecret);
    const donorIkm = hre.ethers.getBytes(hre.ethers.zeroPadValue("0x1234", 32));
    const donorViewingKey = await deriveShieldedViewPublicKey(donorIkm);
    const donorNoteInput = {
      ownerCommitment: donorOwnerCommitment,
      viewingKey: donorViewingKey,
      chainId,
      poolAddress,
    };

    // Real Shield creates a two-leaf tree, allowing its value note to be spent
    // without exposing a unique one-leaf root in the next public transaction.
    const firstDonorNote = await encryptValueNote({
      ...donorNoteInput,
      amount: 2000n,
      nonce: 101n,
    });
    const firstDummyNote = await encryptValueNote({
      ...donorNoteInput,
      amount: 0n,
      nonce: 102n,
    });
    const shieldData = {
      ...zeroData(),
      outputCommitments: [firstDonorNote.commitment, firstDummyNote.commitment],
      outputCiphertexts: [firstDonorNote.ciphertextHex, firstDummyNote.ciphertextHex],
    };
    const shieldSignals = buildShieldedPoolPublicSignals({
      action: 0,
      chainId,
      poolAddress,
      ...shieldData,
      amount: 2000n,
    });
    const shieldProof = await prove(
      "shield",
      {
        publicSignals: shieldSignals.map(String),
        ownerSecret: String(donorOwnerSecret),
        outputAmounts: ["2000", "0"],
        outputNonces: ["101", "102"],
      },
      shieldSignals,
    );
    await token.mint(depositor.address, 2000n);
    await token.approve(poolAddress, 2000n);
    await (await pool.shield(2000n, shieldData, shieldProof)).wait();

    const fundingFixture = buildShieldedFundingFixtures({ donorAmount: 2000n });
    const allocationWitness = fundingFixture.allocate;
    const claimFixture = buildShieldedClaimFixture({ claimCount: 12, remainingPeriods: 12 });
    const heirKeys = deriveShieldedHeirKeyMaterial(claimFixture.witness.derivedSecretField);
    assert.equal(heirKeys.ownerCommitment, BigInt(allocationWitness.heirOwnerCommitment));
    const heirViewingKey = await deriveShieldedViewPublicKey(heirKeys.hpkeIkm);
    const { viewKeyHi, viewKeyLo } = splitShieldedViewPublicKey(heirViewingKey);
    const rootIdentityCommitment = BigInt(allocationWitness.rootIdentityCommitment);
    const rootVersionIndex = BigInt(allocationWitness.rootVersionIndex);
    const rate = 100n;
    const policySalt = BigInt(allocationWitness.policySalt);
    const allocationKey = BigInt(allocationWitness.allocationKey);
    const allocationKeyCommitment = computeShieldedAllocationKeyCommitment(allocationKey);
    const policyCommitment = computeShieldedPolicyCommitment({
      rootIdentityCommitment,
      rootVersionIndex,
      amountPerPeriod: rate,
      policySalt,
      allocationKeyCommitment,
    });
    const policyNonce = 104n;
    const policyPayload = encodeShieldedPolicyNotePayload({
      rootIdentityCommitment,
      rootVersionIndex,
      amountPerPeriod: rate,
      policySalt,
      allocationKey,
      nonce: policyNonce,
    });
    const encryptedPolicy = await encryptPayloadNote(
      { viewingKey: donorViewingKey, chainId, poolAddress },
      policyPayload,
    );
    const policyNoteCommitment = computeShieldedPolicyNoteCommitment({
      policyCommitment,
      nonce: policyNonce,
      ciphertextHashField: encryptedPolicy.ciphertextHashField,
    });
    const renewedDonorNote = await encryptValueNote({
      ...donorNoteInput,
      amount: 2000n,
      nonce: 103n,
    });
    const shieldRoot = (await pool.noteShard(0)).root;
    const firstDonorMembership = compactMembership(await pool.getNoteMerkleProof(0, 0));
    const createPolicyData = {
      ...zeroData(),
      inputRoots: [shieldRoot, shieldRoot],
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: firstDonorNote.commitment,
        }),
        computeShieldedDummyInputNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: firstDonorNote.commitment,
        }),
      ],
      outputCommitments: [policyNoteCommitment, renewedDonorNote.commitment],
      outputCiphertexts: [encryptedPolicy.ciphertextHex, renewedDonorNote.ciphertextHex],
    };
    const createPolicySignals = buildShieldedPoolPublicSignals({
      action: 1,
      chainId,
      poolAddress,
      ...createPolicyData,
    });
    const createPolicyProof = await prove(
      "createPolicy",
      {
        publicSignals: createPolicySignals.map(String),
        ownerSecret: String(donorOwnerSecret),
        inputAmount: "2000",
        inputNonce: "101",
        inputCiphertextHash: String(firstDonorNote.ciphertextHashField),
        noteDepth: firstDonorMembership.depth,
        noteIndex: firstDonorMembership.index,
        noteSiblings: firstDonorMembership.siblings,
        rootIdentityCommitment: String(rootIdentityCommitment),
        rootVersionIndex: String(rootVersionIndex),
        rate: String(rate),
        policySalt: String(policySalt),
        allocationKey: String(allocationKey),
        policyNonce: String(policyNonce),
        changeNonce: "103",
      },
      createPolicySignals,
    );
    const createPolicyReceipt = await (
      await pool.createPolicy(createPolicyData, createPolicyProof)
    ).wait();
    expect(await pool.totalShielded()).to.equal(2000n);

    const heirIdentityCommitment = BigInt(allocationWitness.heirIdentityCommitment);
    const heirOwnerCommitment = BigInt(allocationWitness.heirOwnerCommitment);
    const registeredHeirLeaf = computeShieldedRegistrationLeaf({
      identityCommitment: heirIdentityCommitment,
      ownerCommitment: heirOwnerCommitment,
      viewKeyHi,
      viewKeyLo,
    });
    const unrelatedViewingKey = await deriveShieldedViewPublicKey(
      hre.ethers.getBytes(hre.ethers.zeroPadValue("0x5678", 32)),
    );
    const unrelatedKeyLimbs = splitShieldedViewPublicKey(unrelatedViewingKey);
    const unrelatedLeaf = computeShieldedRegistrationLeaf({
      identityCommitment: 123456n,
      ownerCommitment: 7891011n,
      ...unrelatedKeyLimbs,
    });
    const registryRoot = poseidon2([registeredHeirLeaf, unrelatedLeaf]);
    await keyRegistry.setKnownRoot(0, registryRoot, true, 2);
    const endorsementRoot = BigInt(claimFixture.witness.publicSignals[27]);
    const trustedRoot = BigInt(claimFixture.witness.publicSignals[28]);
    await lineage.setRoot(0, endorsementRoot);
    await lineage.setRoot(1, trustedRoot);

    const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const eligibleFrom = asOf + 7200n;
    const enrollmentSalt = BigInt(allocationWitness.enrollmentSalt);
    const enrollmentCommitment = computeShieldedEnrollmentCommitment({
      policyCommitment,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
    });
    const budgetNonce = 107n;
    const initialBudgetPayload = encodeShieldedBudgetNotePayload({
      rootIdentityCommitment,
      rootVersionIndex,
      policySalt,
      allocationKeyCommitment,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 1200n,
      nonce: budgetNonce,
    });
    const encryptedBudget = await encryptPayloadNote(
      { viewingKey: heirViewingKey, chainId, poolAddress },
      initialBudgetPayload,
    );
    const budgetCommitment = computeShieldedBudgetNoteCommitment({
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 1200n,
      nonce: budgetNonce,
      ciphertextHashField: encryptedBudget.ciphertextHashField,
    });
    const donorChange = await encryptValueNote({
      ...donorNoteInput,
      amount: 800n,
      nonce: 109n,
    });
    const preAllocationRoot = (await pool.noteShard(0)).root;
    const donorMembership = compactMembership(await pool.getNoteMerkleProof(0, 3));
    const policyMembership = compactMembership(await pool.getNoteMerkleProof(0, 2));
    assert.equal(donorMembership.depth, "2");
    assert.equal(policyMembership.depth, "2");
    const allocationData = {
      ...zeroData(),
      inputRoots: [preAllocationRoot, preAllocationRoot],
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: renewedDonorNote.commitment,
        }),
        computeShieldedEnrollmentNullifier({
          allocationKey,
          policyCommitment,
          heirIdentityCommitment,
        }),
      ],
      outputCommitments: [budgetCommitment, donorChange.commitment],
      outputCiphertexts: [encryptedBudget.ciphertextHex, donorChange.ciphertextHex],
      relation0: endorsementRoot,
      relation1: trustedRoot,
      asOf,
      registryRoot,
      registryShardId: 0n,
    };
    const allocationSignals = buildShieldedPoolPublicSignals({
      action: 2,
      chainId,
      poolAddress,
      ...allocationData,
    });
    const realAllocationWitness = {
      ...allocationWitness,
      publicSignals: allocationSignals.map(String),
      donorNonce: "103",
      donorCiphertextHash: String(renewedDonorNote.ciphertextHashField),
      donorDepth: donorMembership.depth,
      donorIndex: donorMembership.index,
      donorSiblings: donorMembership.siblings,
      policyNonce: String(policyNonce),
      policyCiphertextHash: String(encryptedPolicy.ciphertextHashField),
      policyDepth: policyMembership.depth,
      policyIndex: policyMembership.index,
      policySiblings: policyMembership.siblings,
      viewKeyHi: String(viewKeyHi),
      viewKeyLo: String(viewKeyLo),
      registrationDepth: "1",
      registrationIndex: "0",
      registrationSiblings: [String(unrelatedLeaf), ...Array(31).fill("0")],
      eligibleFrom: String(eligibleFrom),
      budgetPeriods: "12",
      budgetNonce: String(budgetNonce),
      changeNonce: "109",
    };
    const allocationProof = await prove("allocate", realAllocationWitness, allocationSignals);
    await keyRegistry.setKnownRoot(0, registryRoot, false, 0);
    await expect(pool.allocate(allocationData, allocationProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownKeyRegistryRoot",
    );
    await keyRegistry.setKnownRoot(0, registryRoot, true, 1);
    await expect(pool.allocate(allocationData, allocationProof)).to.be.revertedWithCustomError(
      pool,
      "SingleLeafKeyRegistryRoot",
    );
    await keyRegistry.setKnownRoot(0, registryRoot, true, 2);
    await lineage.setRoot(0, endorsementRoot + 1n);
    await expect(pool.allocate(allocationData, allocationProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    await lineage.setRoot(0, endorsementRoot);
    const allocateReceipt = await (await pool.allocate(allocationData, allocationProof)).wait();
    expect(await pool.nullifierSpent(allocationData.inputNullifiers[1])).to.equal(true);
    expect(await pool.totalShielded()).to.equal(2000n);
    expect(await token.balanceOf(poolAddress)).to.equal(2000n);

    // The old child budget is a read-only template: this action spends only
    // the donor's 800-value change note and creates a separate 300-value budget.
    const topUpUseNonce = 114n;
    const topUpBudgetNonce = 111n;
    const topUpChangeNonce = 113n;
    const topUpBudgetPayload = encodeShieldedBudgetNotePayload({
      rootIdentityCommitment,
      rootVersionIndex,
      policySalt,
      allocationKeyCommitment,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 300n,
      nonce: topUpBudgetNonce,
    });
    const encryptedTopUpBudget = await encryptPayloadNote(
      { viewingKey: heirViewingKey, chainId, poolAddress },
      topUpBudgetPayload,
    );
    const topUpBudgetCommitment = computeShieldedBudgetNoteCommitment({
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 300n,
      nonce: topUpBudgetNonce,
      ciphertextHashField: encryptedTopUpBudget.ciphertextHashField,
    });
    const topUpDonorChange = await encryptValueNote({
      ...donorNoteInput,
      amount: 500n,
      nonce: topUpChangeNonce,
    });
    const preTopUpRoot = (await pool.noteShard(0)).root;
    const topUpDonorMembership = compactMembership(await pool.getNoteMerkleProof(0, 5));
    const topUpBudgetMembership = compactMembership(await pool.getNoteMerkleProof(0, 4));
    const topUpData = {
      ...zeroData(),
      inputRoots: [preTopUpRoot, preTopUpRoot],
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: donorChange.commitment,
        }),
        computeShieldedTopUpUseNullifier({
          policySalt,
          budgetNoteCommitment: budgetCommitment,
          useNonce: topUpUseNonce,
        }),
      ],
      outputCommitments: [topUpBudgetCommitment, topUpDonorChange.commitment],
      outputCiphertexts: [encryptedTopUpBudget.ciphertextHex, topUpDonorChange.ciphertextHex],
      registryRoot,
      registryShardId: 0n,
    };
    const topUpSignals = buildShieldedPoolPublicSignals({
      action: 3,
      chainId,
      poolAddress,
      ...topUpData,
    });
    const topUpWitness = {
      ...fundingFixture.topUp,
      publicSignals: topUpSignals.map(String),
      donorAmount: "800",
      donorNonce: "109",
      donorCiphertextHash: String(donorChange.ciphertextHashField),
      donorDepth: topUpDonorMembership.depth,
      donorIndex: topUpDonorMembership.index,
      donorSiblings: topUpDonorMembership.siblings,
      viewKeyHi: String(viewKeyHi),
      viewKeyLo: String(viewKeyLo),
      registrationDepth: "1",
      registrationIndex: "0",
      registrationSiblings: [String(unrelatedLeaf), ...Array(31).fill("0")],
      eligibleFrom: String(eligibleFrom),
      oldBudgetRemaining: "1200",
      oldBudgetRemainingPeriods: "12",
      oldBudgetNonce: String(budgetNonce),
      oldBudgetCiphertextHash: String(encryptedBudget.ciphertextHashField),
      oldBudgetDepth: topUpBudgetMembership.depth,
      oldBudgetIndex: topUpBudgetMembership.index,
      oldBudgetSiblings: topUpBudgetMembership.siblings,
      budgetUseNonce: String(topUpUseNonce),
      topUpPeriods: "3",
      newBudgetNonce: String(topUpBudgetNonce),
      changeNonce: String(topUpChangeNonce),
    };
    const topUpProof = await prove("topUp", topUpWitness, topUpSignals);
    const tamperedTopUp = {
      ...topUpData,
      outputCommitments: [topUpBudgetCommitment + 1n, topUpDonorChange.commitment],
    };
    await expect(pool.topUp(tamperedTopUp, topUpProof)).to.be.revertedWithCustomError(
      pool,
      "InvalidZKProof",
    );
    const topUpReceipt = await (await pool.topUp(topUpData, topUpProof)).wait();
    expect(await pool.nullifierSpent(topUpData.inputNullifiers[0])).to.equal(true);
    expect(await pool.nullifierSpent(topUpData.inputNullifiers[1])).to.equal(true);
    expect(
      await pool.nullifierSpent(
        computeShieldedSpendNullifier({
          ownerSecret: heirKeys.ownerSecret,
          noteCommitment: budgetCommitment,
        }),
      ),
    ).to.equal(false);
    expect(await pool.commitmentExists(budgetCommitment)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(2000n);
    expect(await token.balanceOf(poolAddress)).to.equal(2000n);
    const recoveredTopUpPayload = await decryptShieldedNote({
      ciphertext: encryptedTopUpBudget.ciphertext,
      hpkeIkm: heirKeys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: recoveredTopUpPayload,
        ciphertext: encryptedTopUpBudget.ciphertext,
        noteCommitment: topUpBudgetCommitment,
      }).note.remaining,
    ).to.equal(300n);
    await expect(pool.topUp(topUpData, topUpProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );

    const preClaimRoot = (await pool.noteShard(0)).root;
    const budgetMembership = compactMembership(await pool.getNoteMerkleProof(0, 4));
    assert.equal(budgetMembership.depth, "3");
    const spendBudgetTag = computeShieldedSpendNullifier({
      ownerSecret: heirKeys.ownerSecret,
      noteCommitment: budgetCommitment,
    });
    const dummyBudgetTag = computeShieldedDummyInputNullifier({
      ownerSecret: heirKeys.ownerSecret,
      noteCommitment: budgetCommitment,
    });
    const makeClaim = async (count) => {
      const claimAsOf = eligibleFrom + BigInt(count) * PERIOD;
      const remaining = 1200n - BigInt(count) * rate;
      const nextBudgetNonce = 99999n;
      const payoutNonce = 123456n;
      const nextBudgetPayload = encodeShieldedBudgetNotePayload({
        rootIdentityCommitment,
        rootVersionIndex,
        policySalt,
        allocationKeyCommitment,
        heirIdentityCommitment,
        eligibleFrom,
        enrollmentSalt,
        heirOwnerCommitment,
        amountPerPeriod: rate,
        remaining,
        nonce: nextBudgetNonce,
      });
      const nextBudgetCiphertext = await encryptPayloadNote(
        { viewingKey: heirViewingKey, chainId, poolAddress },
        nextBudgetPayload,
      );
      const nextBudgetCommitment = computeShieldedBudgetNoteCommitment({
        policyCommitment,
        enrollmentCommitment,
        heirOwnerCommitment,
        amountPerPeriod: rate,
        remaining,
        nonce: nextBudgetNonce,
        ciphertextHashField: nextBudgetCiphertext.ciphertextHashField,
      });
      const payoutNote = await encryptValueNote({
        ownerCommitment: heirOwnerCommitment,
        viewingKey: heirViewingKey,
        chainId,
        poolAddress,
        amount: BigInt(count) * rate,
        nonce: payoutNonce,
      });
      const periodNullifiers = Array.from({ length: 12 }, (_, slot) =>
        slot < count
          ? computeShieldedPeriodNullifier({
              derivedSecretField: claimFixture.witness.derivedSecretField,
              policyCommitment,
              periodIndex: slot,
            })
          : computeShieldedDummyPeriodNullifier({
              ownerSecret: heirKeys.ownerSecret,
              budgetNoteCommitment: budgetCommitment,
              slotIndex: slot,
            }),
      );
      assert.equal(new Set(periodNullifiers.map(String)).size, 12);
      const claimData = {
        ...zeroData(),
        inputRoots: [preClaimRoot, preClaimRoot],
        inputNullifiers: [spendBudgetTag, dummyBudgetTag],
        periodNullifiers,
        outputCommitments: [nextBudgetCommitment, payoutNote.commitment],
        outputCiphertexts: [nextBudgetCiphertext.ciphertextHex, payoutNote.ciphertextHex],
        relation0: endorsementRoot,
        relation1: trustedRoot,
        asOf: claimAsOf,
      };
      const claimSignals = buildShieldedPoolPublicSignals({
        action: 5,
        chainId,
        poolAddress,
        ...claimData,
      });
      const baseWitness = buildShieldedClaimFixture({
        claimCount: count,
        remainingPeriods: 12,
      }).witness;
      const witness = {
        ...baseWitness,
        publicSignals: claimSignals.map(String),
        eligibleFrom: String(eligibleFrom),
        remaining: "1200",
        remainingPeriods: "12",
        budgetNonce: String(budgetNonce),
        budgetCiphertextHash: String(encryptedBudget.ciphertextHashField),
        noteDepth: budgetMembership.depth,
        noteIndex: budgetMembership.index,
        noteSiblings: budgetMembership.siblings,
        newBudgetNonce: String(nextBudgetNonce),
        payoutNonce: String(payoutNonce),
      };
      return {
        claimAsOf,
        claimData,
        claimSignals,
        witness,
        payoutNote,
        nextBudgetCiphertext,
        nextBudgetCommitment,
      };
    };

    const branch = await hre.networkHelpers.takeSnapshot();
    const onePeriod = await makeClaim(1);
    const oneProof = await prove("claim", onePeriod.witness, onePeriod.claimSignals);
    // Identity knowledge must match the endorsed, registered child and the
    // budget owner. Merely changing the secret cannot authorize this payout.
    assertInvalidCircuitWitness(
      "claim",
      {
        ...onePeriod.witness,
        derivedSecretField: String(BigInt(onePeriod.witness.derivedSecretField) + 1n),
      },
      /Assert Failed/u,
    );
    // At the start of the last second before period 0 matures, the same
    // credential and budget cannot produce a valid claim proof.
    const earlySignals = onePeriod.claimSignals.map((signal, index) =>
      index === 29 ? String(eligibleFrom + PERIOD - 1n) : String(signal),
    );
    assertInvalidCircuitWitness(
      "claim",
      { ...onePeriod.witness, publicSignals: earlySignals },
      /Assert Failed/u,
    );
    await expect(pool.claim(onePeriod.claimData, oneProof)).to.be.revertedWithCustomError(
      pool,
      "InvalidClaimTime",
    );
    await hre.networkHelpers.time.increaseTo(Number(onePeriod.claimAsOf));
    // Mirror the lineage index's leaf update: clearing the endorsement changes
    // the current root, so an otherwise valid old proof is no longer usable.
    const parentsDigest = computeLineageParentsDigest({
      fatherIdentityCommitment: onePeriod.witness.fatherIdentityCommitment,
      motherIdentityCommitment: onePeriod.witness.motherIdentityCommitment,
    });
    const firstEndorsementLeaf = computeLineageEndorsementLeaf({
      identityCommitment: heirIdentityCommitment,
      parentsDigest,
      versionIndex: onePeriod.witness.versionIndex,
      endorser: hre.ethers.getAddress(hre.ethers.toBeHex(BigInt(onePeriod.witness.endorser), 20)),
      writtenAt: onePeriod.witness.writtenAt,
    });
    const endorsementTree = createLineageTree([101n, firstEndorsementLeaf, 303n, 0n, 505n]);
    expect(endorsementTree.root).to.equal(endorsementRoot);
    endorsementTree.update(1, 0n);
    await lineage.setRoot(0, endorsementTree.root);
    await expect(pool.claim(onePeriod.claimData, oneProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    // Re-endorse a new version for the same personHash. It still uses the
    // original private policy/enrollment and preserves the unpaid period.
    const renewedVersionIndex = BigInt(onePeriod.witness.versionIndex) + 1n;
    const renewedWrittenAt = onePeriod.claimAsOf - 60n;
    const renewedLeaf = computeLineageEndorsementLeaf({
      identityCommitment: heirIdentityCommitment,
      parentsDigest,
      versionIndex: renewedVersionIndex,
      endorser: hre.ethers.getAddress(hre.ethers.toBeHex(BigInt(onePeriod.witness.endorser), 20)),
      writtenAt: renewedWrittenAt,
    });
    endorsementTree.update(1, renewedLeaf);
    const renewedRoot = endorsementTree.root;
    const renewedPath = endorsementTree.generateProof(1);
    await lineage.setRoot(0, renewedRoot);
    await expect(pool.claim(onePeriod.claimData, oneProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    const renewedClaimData = { ...onePeriod.claimData, relation0: renewedRoot };
    const renewedClaimSignals = buildShieldedPoolPublicSignals({
      action: 5,
      chainId,
      poolAddress,
      ...renewedClaimData,
    });
    const renewedWitness = {
      ...onePeriod.witness,
      publicSignals: renewedClaimSignals.map(String),
      versionIndex: String(renewedVersionIndex),
      writtenAt: String(renewedWrittenAt),
      endorsementDepth: String(renewedPath.siblings.length),
      endorsementIndex: String(renewedPath.index),
      endorsementSiblings: [
        ...renewedPath.siblings.map(String),
        ...Array(64 - renewedPath.siblings.length).fill("0"),
      ],
    };
    const renewedProof = await prove("claim", renewedWitness, renewedClaimSignals);
    const oneReceipt = await (await pool.claim(renewedClaimData, renewedProof)).wait();
    expect(await pool.nullifierSpent(onePeriod.claimData.periodNullifiers[0])).to.equal(true);
    expect(await pool.commitmentExists(onePeriod.claimData.outputCommitments[0])).to.equal(true);
    const onePayoutPayload = await decryptShieldedNote({
      ciphertext: onePeriod.payoutNote.ciphertext,
      hpkeIkm: heirKeys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: onePayoutPayload,
        ciphertext: onePeriod.payoutNote.ciphertext,
        noteCommitment: onePeriod.payoutNote.commitment,
      }).note.amount,
    ).to.equal(100n);
    const oneRemainingPayload = await decryptShieldedNote({
      ciphertext: onePeriod.nextBudgetCiphertext.ciphertext,
      hpkeIkm: heirKeys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: oneRemainingPayload,
        ciphertext: onePeriod.nextBudgetCiphertext.ciphertext,
        noteCommitment: onePeriod.nextBudgetCommitment,
      }).note.remaining,
    ).to.equal(1100n);
    await branch.restore();

    // This separate top-up budget contains only three whole periods. A four
    // period claim is invalid even though all four periods are already due.
    const fourPeriods = await makeClaim(4);
    const topUpClaimMembership = compactMembership(await pool.getNoteMerkleProof(0, 6));
    const underfundedClaimData = {
      ...fourPeriods.claimData,
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: heirKeys.ownerSecret,
          noteCommitment: topUpBudgetCommitment,
        }),
        computeShieldedDummyInputNullifier({
          ownerSecret: heirKeys.ownerSecret,
          noteCommitment: topUpBudgetCommitment,
        }),
      ],
      periodNullifiers: Array.from({ length: 12 }, (_, slot) =>
        slot < 4
          ? fourPeriods.claimData.periodNullifiers[slot]
          : computeShieldedDummyPeriodNullifier({
              ownerSecret: heirKeys.ownerSecret,
              budgetNoteCommitment: topUpBudgetCommitment,
              slotIndex: slot,
            }),
      ),
      // Match the field arithmetic the circuit would perform without its
      // uint128/uint64 range checks. This isolates the underflow guard: all
      // input membership, note ownership, and output hashes still line up.
      outputCommitments: [
        poseidon8([
          1015n,
          policyCommitment,
          enrollmentCommitment,
          heirOwnerCommitment,
          rate,
          FIELD - 100n,
          99999n,
          fourPeriods.nextBudgetCiphertext.ciphertextHashField,
        ]),
        fourPeriods.claimData.outputCommitments[1],
      ],
    };
    const underfundedClaimSignals = buildShieldedPoolPublicSignals({
      action: 5,
      chainId,
      poolAddress,
      ...underfundedClaimData,
    });
    assertInvalidCircuitWitness(
      "claim",
      {
        ...fourPeriods.witness,
        publicSignals: underfundedClaimSignals.map(String),
        remaining: "300",
        remainingPeriods: "3",
        budgetNonce: String(topUpBudgetNonce),
        budgetCiphertextHash: String(encryptedTopUpBudget.ciphertextHashField),
        noteDepth: topUpClaimMembership.depth,
        noteIndex: topUpClaimMembership.index,
        noteSiblings: topUpClaimMembership.siblings,
      },
      /ShieldedClaim.*line: 294/u,
    );

    const twelvePeriods = await makeClaim(12);
    const twelveProof = await prove("claim", twelvePeriods.witness, twelvePeriods.claimSignals);
    // The circuit's private count is range constrained even though all public
    // period slots have the same fixed shape.
    assertInvalidCircuitWitness(
      "claim",
      { ...twelvePeriods.witness, claimCount: "13" },
      /ShieldedClaim.*line: 248/u,
    );
    expect(onePeriod.claimData.periodNullifiers[0]).to.equal(
      twelvePeriods.claimData.periodNullifiers[0],
    );
    await hre.networkHelpers.time.increaseTo(Number(twelvePeriods.claimAsOf));
    await lineage.setRoot(1, trustedRoot + 1n);
    await expect(pool.claim(twelvePeriods.claimData, twelveProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    await lineage.setRoot(1, trustedRoot);
    const twelveReceipt = await (await pool.claim(twelvePeriods.claimData, twelveProof)).wait();
    for (const periodTag of twelvePeriods.claimData.periodNullifiers) {
      expect(await pool.nullifierSpent(periodTag)).to.equal(true);
    }
    expect(await pool.nullifierSpent(spendBudgetTag)).to.equal(true);
    expect(await pool.totalShielded()).to.equal(2000n);
    const payoutPayload = await decryptShieldedNote({
      ciphertext: twelvePeriods.payoutNote.ciphertext,
      hpkeIkm: heirKeys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: payoutPayload,
        ciphertext: twelvePeriods.payoutNote.ciphertext,
        noteCommitment: twelvePeriods.payoutNote.commitment,
      }).note.amount,
    ).to.equal(1200n);
    await expect(pool.claim(twelvePeriods.claimData, twelveProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );
    expect(() => buildShieldedClaimFixture({ claimCount: 13, remainingPeriods: 13 })).to.throw(
      RangeError,
    );
    console.log(
      `development-only Hardhat gas: createPolicy=${createPolicyReceipt.gasUsed} allocate=${allocateReceipt.gasUsed} topUp=${topUpReceipt.gasUsed} claim1=${oneReceipt.gasUsed} claim12=${twelveReceipt.gasUsed}`,
    );
  });

  it("privately transfers two owners' notes through a real proof without changing pool assets", async function () {
    const artifacts = checkedDevelopmentArtifacts(["shield", "privateTransfer"]);
    if (artifacts.missing) {
      console.log(
        `Skipping development-only private transfer proof test; run npm run zk:shielded:development:setup (${artifacts.missing.length} artifacts absent)`,
      );
      this.skip();
    }

    const [depositor] = await hre.ethers.getSigners();
    const generated = await deployGeneratedDevelopmentVerifiers(
      ["shield", "privateTransfer"],
      depositor,
    );
    const shieldAdapter = await hre.ethers.deployContract("ShieldedGroth16ActionAdapter", [
      await generated.shield.getAddress(),
      0,
    ]);
    const transferAdapter = await hre.ethers.deployContract("ShieldedGroth16ActionAdapter", [
      await generated.privateTransfer.getAddress(),
      6,
    ]);
    const mockAdapter = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const keyRegistry = await hre.ethers.deployContract("ShieldedPoolKeyRegistryMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all(
      [shieldAdapter, transferAdapter, mockAdapter, token, lineage, keyRegistry, poseidon].map(
        (contract) => contract.waitForDeployment(),
      ),
    );
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const verifierAddresses = Array(8).fill(await mockAdapter.getAddress());
    verifierAddresses[0] = await shieldAdapter.getAddress();
    verifierAddresses[6] = await transferAdapter.getAddress();
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await keyRegistry.getAddress(),
      verifierAddresses,
    );
    await pool.waitForDeployment();
    const poolAddress = await pool.getAddress();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;

    const sourceOwners = [1101n, 2202n];
    const sourceAmounts = [70n, 30n];
    const sourceNonces = [11n, 21n];
    const sourceNotes = [];
    await token.mint(depositor.address, 100n);
    await token.approve(poolAddress, 100n);
    for (let index = 0; index < 2; index += 1) {
      const ownerSecret = sourceOwners[index];
      const ownerCommitment = computeShieldedOwnerCommitment(ownerSecret);
      const hpkeIkm = hre.ethers.getBytes(
        hre.ethers.zeroPadValue(index === 0 ? "0x1111" : "0x2222", 32),
      );
      const viewingKey = await deriveShieldedViewPublicKey(hpkeIkm);
      const noteInput = { ownerCommitment, viewingKey, chainId, poolAddress };
      const realNote = await encryptValueNote({
        ...noteInput,
        amount: sourceAmounts[index],
        nonce: sourceNonces[index],
      });
      const dummyNote = await encryptValueNote({
        ...noteInput,
        amount: 0n,
        nonce: sourceNonces[index] + 1n,
      });
      const shieldData = {
        ...zeroData(),
        outputCommitments: [realNote.commitment, dummyNote.commitment],
        outputCiphertexts: [realNote.ciphertextHex, dummyNote.ciphertextHex],
      };
      const shieldSignals = buildShieldedPoolPublicSignals({
        action: 0,
        chainId,
        poolAddress,
        ...shieldData,
        amount: sourceAmounts[index],
      });
      const shieldProof = await prove(
        "shield",
        {
          publicSignals: shieldSignals.map(String),
          ownerSecret: String(ownerSecret),
          outputAmounts: [String(sourceAmounts[index]), "0"],
          outputNonces: [String(sourceNonces[index]), String(sourceNonces[index] + 1n)],
        },
        shieldSignals,
      );
      await (await pool.shield(sourceAmounts[index], shieldData, shieldProof)).wait();
      sourceNotes.push(realNote);
    }

    const sourceRoot = (await pool.noteShard(0)).root;
    const sourceMemberships = [0, 2].map(async (leafIndex) =>
      compactMembership(await pool.getNoteMerkleProof(0, leafIndex)),
    );
    const memberships = await Promise.all(sourceMemberships);
    const recipients = await Promise.all(
      [
        { ownerSecret: 3303n, amount: 40n, nonce: 31n, hpkeIkm: "0x3333" },
        { ownerSecret: 4404n, amount: 60n, nonce: 32n, hpkeIkm: "0x4444" },
      ].map(async (recipient) => {
        const hpkeIkm = hre.ethers.getBytes(hre.ethers.zeroPadValue(recipient.hpkeIkm, 32));
        const ownerCommitment = computeShieldedOwnerCommitment(recipient.ownerSecret);
        const viewingKey = await deriveShieldedViewPublicKey(hpkeIkm);
        const note = await encryptValueNote({
          ownerCommitment,
          viewingKey,
          chainId,
          poolAddress,
          amount: recipient.amount,
          nonce: recipient.nonce,
        });
        return { ...recipient, hpkeIkm, ownerCommitment, note };
      }),
    );
    const inputNullifiers = sourceNotes.map((note, index) =>
      computeShieldedSpendNullifier({
        ownerSecret: sourceOwners[index],
        noteCommitment: note.commitment,
      }),
    );
    const transferData = {
      ...zeroData(),
      inputRoots: [sourceRoot, sourceRoot],
      inputNullifiers,
      outputCommitments: recipients.map(({ note }) => note.commitment),
      outputCiphertexts: recipients.map(({ note }) => note.ciphertextHex),
    };
    const transferSignals = buildShieldedPoolPublicSignals({
      action: 6,
      chainId,
      poolAddress,
      ...transferData,
    });
    const transferProof = await prove(
      "privateTransfer",
      {
        publicSignals: transferSignals.map(String),
        inputOwnerSecrets: sourceOwners.map(String),
        inputAmounts: sourceAmounts.map(String),
        inputNonces: sourceNonces.map(String),
        inputCiphertextHashes: sourceNotes.map((note) => String(note.ciphertextHashField)),
        inputDepths: memberships.map((proof) => proof.depth),
        inputIndices: memberships.map((proof) => proof.index),
        inputSiblings: memberships.map((proof) => proof.siblings),
        outputOwnerCommitments: recipients.map(({ ownerCommitment }) => String(ownerCommitment)),
        outputAmounts: recipients.map(({ amount }) => String(amount)),
        outputNonces: recipients.map(({ nonce }) => String(nonce)),
      },
      transferSignals,
    );
    expect(await transferAdapter.verifyProof(transferProof, transferSignals)).to.equal(true);
    const tampered = {
      ...transferData,
      outputCiphertexts: [
        `${transferData.outputCiphertexts[0].slice(0, -2)}${(
          Number.parseInt(transferData.outputCiphertexts[0].slice(-2), 16) ^ 1
        )
          .toString(16)
          .padStart(2, "0")}`,
        transferData.outputCiphertexts[1],
      ],
    };
    await expect(pool.privateTransfer(tampered, transferProof)).to.be.revertedWithCustomError(
      pool,
      "InvalidZKProof",
    );
    const receipt = await (await pool.privateTransfer(transferData, transferProof)).wait();
    for (const nullifier of inputNullifiers) {
      expect(await pool.nullifierSpent(nullifier)).to.equal(true);
    }
    for (const recipient of recipients) {
      expect(await pool.commitmentExists(recipient.note.commitment)).to.equal(true);
      const payload = await decryptShieldedNote({
        ciphertext: recipient.note.ciphertext,
        hpkeIkm: recipient.hpkeIkm,
        chainId,
        poolAddress,
      });
      const recovered = verifyShieldedNotePayload({
        payload,
        ciphertext: recipient.note.ciphertext,
        noteCommitment: recipient.note.commitment,
      });
      expect(recovered.note.amount).to.equal(recipient.amount);
      expect(recovered.note.ownerCommitment).to.equal(recipient.ownerCommitment);
    }
    expect(await pool.totalShielded()).to.equal(100n);
    expect(await token.balanceOf(poolAddress)).to.equal(100n);
    await expect(pool.privateTransfer(transferData, transferProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );
    console.log(`development-only Hardhat gas: privateTransfer=${receipt.gasUsed}`);
  });
});
