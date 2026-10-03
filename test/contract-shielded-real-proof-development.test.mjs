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
import { deployUnifiedVerifierAdapter } from "./helpers/unifiedVerifierAdapter.mjs";
import { poseidon2, poseidon8 } from "poseidon-lite";
import {
  SHIELDED_POOL_ACTION,
  SHIELDED_POOL_PUBLIC_INPUTS,
  buildShieldedPoolPublicInputs,
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedIdentityBudgetNoteCommitment,
  getShieldedBudgetCommitments,
  encodePublicShieldedBudgetEnvelope,
  computeShieldedDummyInputNullifier,
  computeShieldedDummyPeriodNullifier,
  computeShieldedEnrollmentCommitment,
  computeShieldedEnrollmentNullifier,
  computeShieldedOwnerCommitment,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedBudgetUseNullifier,
  computeShieldedValueNoteCommitment,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  verifyShieldedNotePayload,
} from "@deepfamily/protocol-core";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { buildShieldedClaimFixture } from "../circuits/test/generate_shielded_claim_input.mjs";
import { buildShieldedFundingFixtures } from "../circuits/test/generate_shielded_funding_input.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/lib/zkCircuitSelection.mjs";
import { currentShieldedCandidateManifest } from "../scripts/lib/shieldedArtifacts.mjs";
import { SHIELDED_SETUP_CIRCUITS } from "../scripts/lib/shieldedProductionSetup.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUBLIC_ARTIFACTS = path.join(ROOT, "frontend", "public", "zk", "shielded");
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const PERIOD = 2_592_000n;
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
  fundMode: 0n,
  budgetKind: 0n,
});

/** Ordered verifier inputs of a witness that uses the circuit's named public inputs. */
const claimSignalsOf = (witness) =>
  SHIELDED_POOL_PUBLIC_INPUTS[SHIELDED_POOL_ACTION.Claim].flatMap((name) =>
    [witness[name]].flat().map(BigInt),
  );

function circuitFiles(action, manifest) {
  manifest ??= JSON.parse(
    fs.readFileSync(path.join(ROOT, currentShieldedCandidateManifest({ root: ROOT })), "utf8"),
  );
  const source = SHIELDED_CIRCUITS[action];
  assert.ok(source, `Unknown shielded circuit action: ${action}`);
  return {
    source,
    contractName: manifest.circuits[action].verifierContractName,
    circuit: path.join(ROOT, "circuits", `${source}.circom`),
    wasm: path.join(PUBLIC_ARTIFACTS, `${source}.wasm`),
    zkey: path.join(PUBLIC_ARTIFACTS, `${source}_final.zkey`),
    vkey: path.join(PUBLIC_ARTIFACTS, `${source}.vkey.json`),
    verifier: path.join(ROOT, manifest.circuits[action].verifierPath),
  };
}

function checkedCurrentArtifacts(actions) {
  const manifestFile = path.join(ROOT, currentShieldedCandidateManifest({ root: ROOT }));
  if (!fs.existsSync(manifestFile)) return { missing: [manifestFile] };
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const development = manifest.schema === "deepfamily/shielded-development-keys@1";
  const production = manifest.schema === "deepfamily/shielded-production-artifacts@1";
  assert.ok(development || production, "Unknown current shielded artifact manifest schema");
  assert.equal(manifest.developmentOnly, development);
  assert.equal(manifest.productionReady, production);
  if (production) assert.equal(manifest.status, "production");
  assert.deepEqual(Object.keys(manifest.circuits).sort(), Object.keys(SHIELDED_CIRCUITS).sort());
  for (const action of actions) {
    const item = manifest.circuits[action];
    const contractName = `Shielded${action[0].toUpperCase()}${action.slice(1)}Verifier`;
    assert.equal(item.source, SHIELDED_CIRCUITS[action]);
    assert.equal(item.verifierContractName, contractName);
    assert.equal(item.verifierPath, `contracts/${contractName}.sol`);
  }
  const paths = [
    manifestFile,
    ...actions.flatMap((action) =>
      Object.entries(circuitFiles(action, manifest))
        .filter(([kind]) => kind !== "source" && kind !== "contractName")
        .map(([, file]) => file),
    ),
  ];
  const missing = paths.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    assert.equal(
      production,
      false,
      `Current production proof artifacts are missing: ${missing.join(", ")}`,
    );
    return { missing };
  }

  for (const action of actions) {
    const files = circuitFiles(action, manifest);
    const item = manifest.circuits?.[action];
    assert.equal(item?.source, files.source, `Missing current manifest entry for ${action}`);
    for (const [kind, digest] of [
      ["circuit", item.sourceSha256],
      ["wasm", item.wasmSha256],
      ["zkey", item.zkeySha256],
      ["vkey", item.verificationKeySha256],
      ["verifier", development ? item.solidityVerifierSha256 : item.verifierSha256],
    ]) {
      assert.equal(
        sha256(files[kind]),
        digest,
        `${action} ${kind} differs from the current public artifact manifest`,
      );
    }
    assert.equal(
      JSON.parse(fs.readFileSync(files.vkey, "utf8")).nPublic,
      SHIELDED_SETUP_CIRCUITS[action].publicSignals,
    );
  }
  return { manifest };
}

async function deployCurrentGeneratedVerifiers(actions, signer) {
  // Compile the named contracts matching the current public proving keys and deploy only to
  // Hardhat's in-process test chain. These measurements are never release evidence.
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
    `Current public verifier compilation failed: ${JSON.stringify(errors)}`,
  );
  const deployed = {};
  for (const action of actions) {
    const artifact = compiled.contracts[`${action}.sol`][circuitFiles(action).contractName];
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
      `${action} proof did not verify with its current public verification key`,
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

describe("Shielded pool real Groth16 current public artifact integration", function () {
  this.timeout(1_200_000);

  it("funds identity budgets through VALUE, claims them privately and shares quotas with owner budgets", async function () {
    const actions = ["shield", "fund", "claim", "unshield"];
    const artifacts = checkedCurrentArtifacts(actions);
    if (artifacts.missing) this.skip();
    const [depositor, recipient] = await hre.ethers.getSigners();
    const generated = await deployCurrentGeneratedVerifiers(actions, depositor);
    const adapter = await deployUnifiedVerifierAdapter(hre, generated);
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all([token, lineage, poseidon].map((c) => c.waitForDeployment()));
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await adapter.getAddress(),
    );
    await pool.waitForDeployment();
    const poolAddress = await pool.getAddress();
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    const fixture = buildShieldedFundingFixtures({ budgetKind: 1 });
    const claimant = buildShieldedClaimFixture({ budgetKind: 1, claimCount: 1 });
    const donorSecret = BigInt(fixture.initial.donorOwnerSecret);
    const donorOwner = computeShieldedOwnerCommitment(donorSecret);
    const donorIkm = hre.ethers.getBytes(hre.ethers.zeroPadValue("0x9876", 32));
    const donorView = await deriveShieldedViewPublicKey(donorIkm);
    const keys = deriveShieldedHeirKeyMaterial(claimant.witness.derivedSecretField);
    const heirView = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    const donorContext = {
      ownerCommitment: donorOwner,
      viewingKey: donorView,
      chainId,
      poolAddress,
    };
    const heirContext = {
      ownerCommitment: keys.ownerCommitment,
      viewingKey: heirView,
      chainId,
      poolAddress,
    };
    let donor = await encryptValueNote({ ...donorContext, amount: 1000n, nonce: 101n });
    const dummy = await encryptValueNote({ ...donorContext, amount: 0n, nonce: 102n });
    const shieldData = {
      ...zeroData(),
      outputCommitments: [donor.commitment, dummy.commitment],
      outputCiphertexts: [donor.ciphertextHex, dummy.ciphertextHex],
    };
    const shieldInputs = buildShieldedPoolPublicInputs({
      action: 0,
      chainId,
      poolAddress,
      ...shieldData,
      amount: 1000n,
    });
    const shieldProof = await prove(
      "shield",
      {
        ...shieldInputs.witness,
        ownerSecret: String(donorSecret),
        outputAmounts: ["1000", "0"],
        outputNonces: ["101", "102"],
      },
      shieldInputs.signals,
    );
    await token.mint(depositor.address, 1000n);
    await token.approve(poolAddress, 1000n);
    await pool.shield(1000n, shieldData, shieldProof);
    await lineage.setRoot(0, claimant.witness.endorsementRoot);
    await lineage.setRoot(1, claimant.witness.trustedRoot);
    const asOf = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
    const eligibleFrom = asOf + 7200n;
    const common = {
      rootIdentityCommitment: BigInt(fixture.initial.rootIdentityCommitment),
      rootVersionIndex: BigInt(fixture.initial.rootVersionIndex),
      heirIdentityCommitment: claimant.heirIdentityCommitment,
      amountPerPeriod: 100n,
      eligibleFrom,
    };
    const opening = {
      policySalt: BigInt(fixture.initial.policySalt),
      allocationKeyCommitment: BigInt(fixture.initial.allocationKeyCommitment),
      enrollmentSalt: BigInt(fixture.initial.enrollmentSalt),
    };
    const policyCommitment = fixture.policy;
    const enrollmentCommitment = computeShieldedEnrollmentCommitment({
      ...common,
      ...opening,
      policyCommitment,
    });
    const spend = (secret, note) =>
      computeShieldedSpendNullifier({ ownerSecret: secret, noteCommitment: note.commitment });
    const makeBudget = async (kind, remaining, nonce, clear = false) => {
      const note =
        kind === 1
          ? {
              ...common,
              binding: "identity",
              policyCommitment,
              enrollmentCommitment,
              remaining,
              nonce,
            }
          : { ...common, ...opening, heirOwnerCommitment: keys.ownerCommitment, remaining, nonce };
      const encoded = clear
        ? (() => {
            const ciphertext = encodePublicShieldedBudgetEnvelope(note);
            const ciphertextHex = hre.ethers.hexlify(ciphertext);
            return {
              ciphertext,
              ciphertextHex,
              ciphertextHashField: BigInt(hre.ethers.keccak256(ciphertextHex)) % FIELD,
            };
          })()
        : await encryptPayloadNote(heirContext, encodeShieldedBudgetNotePayload(note));
      const commitments = getShieldedBudgetCommitments(note);
      const hash =
        kind === 1
          ? computeShieldedIdentityBudgetNoteCommitment
          : computeShieldedBudgetNoteCommitment;
      const commitment = hash({
        ...note,
        ...commitments,
        ciphertextHashField: encoded.ciphertextHashField,
      });
      return { kind, note, ...encoded, commitment };
    };
    let donorLeaf = 0;
    const fund = async (kind, periods, nonce, template) => {
      const budget = await makeBudget(kind, BigInt(periods) * 100n, nonce, kind === 1);
      const change = await encryptValueNote({
        ...donorContext,
        amount: donor.amount - BigInt(periods) * 100n,
        nonce: nonce + 1n,
      });
      const root = (await pool.noteShard(0)).root;
      const membership = compactMembership(await pool.getNoteMerkleProof(0, donorLeaf));
      const templatePath = template
        ? compactMembership(await pool.getNoteMerkleProof(0, template.leaf))
        : null;
      const data = {
        ...zeroData(),
        fundMode: template ? 1n : 0n,
        budgetKind: BigInt(kind),
        inputRoots: [root, root],
        inputNullifiers: [
          spend(donorSecret, donor),
          template
            ? computeShieldedBudgetUseNullifier({
                policySalt: opening.policySalt,
                budgetNoteCommitment: template.commitment,
                useNonce: nonce + 2n,
              })
            : BigInt(fixture.initial.inputNullifiers[1]),
        ],
        outputCommitments: [budget.commitment, change.commitment],
        outputCiphertexts: [budget.ciphertextHex, change.ciphertextHex],
        ...(template
          ? {}
          : {
              relation0: BigInt(claimant.witness.endorsementRoot),
              relation1: BigInt(claimant.witness.trustedRoot),
              asOf,
            }),
      };
      const inputs = buildShieldedPoolPublicInputs({ action: 1, chainId, poolAddress, ...data });
      assert.equal(inputs.signals.length, 26);
      const base = buildShieldedFundingFixtures({
        budgetKind: kind,
        oldBudgetKind: template?.kind ?? kind,
      });
      const witness = {
        ...(template ? base.continuation : base.initial),
        ...inputs.witness,
        donorAmount: String(donor.amount),
        donorNonce: String(donor.nonce),
        donorCiphertextHash: String(donor.ciphertextHashField),
        donorDepth: membership.depth,
        donorIndex: membership.index,
        donorSiblings: membership.siblings,
        eligibleFrom: String(eligibleFrom),
        budgetPeriods: String(periods),
        budgetNonce: String(nonce),
        changeNonce: String(nonce + 1n),
        ...(template
          ? {
              oldBudgetRemaining: String(template.note.remaining),
              oldBudgetRemainingPeriods: String(template.note.remaining / 100n),
              oldBudgetNonce: String(template.note.nonce),
              oldBudgetCiphertextHash: String(template.ciphertextHashField),
              oldBudgetDepth: templatePath.depth,
              oldBudgetIndex: templatePath.index,
              oldBudgetSiblings: templatePath.siblings,
              budgetUseNonce: String(nonce + 2n),
            }
          : {}),
      };
      const proof = await prove("fund", witness, inputs.signals);
      const leaf = Number((await pool.noteShard(0)).size);
      await pool.fund(data, proof);
      donor = change;
      donorLeaf = leaf + 1;
      expect(await pool.totalShielded()).to.equal(1000n);
      expect(await token.balanceOf(poolAddress)).to.equal(1000n);
      return { ...budget, leaf };
    };
    const initial = await fund(1, 4, 107n);
    const secondPublic = await fund(1, 1, 117n, initial);
    const privateBudget = await fund(0, 2, 127n, initial);
    const makeClaim = async (first, second, nonce) => {
      const remainderKind = first.kind === 0 || second?.kind === 0 ? 0 : 1;
      const remainder = await makeBudget(
        remainderKind,
        first.note.remaining + (second?.note.remaining ?? 0n) - 100n,
        nonce,
      );
      const payout = await encryptValueNote({ ...heirContext, amount: 100n, nonce: nonce + 1n });
      const root = (await pool.noteShard(0)).root;
      const firstPath = compactMembership(await pool.getNoteMerkleProof(0, first.leaf));
      const secondPath = second
        ? compactMembership(await pool.getNoteMerkleProof(0, second.leaf))
        : null;
      const data = {
        ...zeroData(),
        inputRoots: [root, root],
        inputNullifiers: [
          spend(keys.ownerSecret, first),
          second
            ? spend(keys.ownerSecret, second)
            : computeShieldedDummyInputNullifier({
                ownerSecret: keys.ownerSecret,
                noteCommitment: first.commitment,
              }),
        ],
        periodNullifiers: Array.from({ length: 12 }, (_, slot) =>
          slot === 0
            ? computeShieldedPeriodNullifier({
                derivedSecretField: claimant.witness.derivedSecretField,
                policyCommitment,
                periodIndex: 0,
              })
            : computeShieldedDummyPeriodNullifier({
                ownerSecret: keys.ownerSecret,
                budgetNoteCommitment: first.commitment,
                slotIndex: slot,
              }),
        ),
        outputCommitments: [remainder.commitment, payout.commitment],
        outputCiphertexts: [remainder.ciphertextHex, payout.ciphertextHex],
        relation0: BigInt(claimant.witness.endorsementRoot),
        relation1: BigInt(claimant.witness.trustedRoot),
        asOf: eligibleFrom + PERIOD,
      };
      const inputs = buildShieldedPoolPublicInputs({ action: 2, chainId, poolAddress, ...data });
      assert.equal(inputs.signals.length, 27);
      const base = buildShieldedClaimFixture({
        budgetKind: first.kind,
        secondBudgetKind: second?.kind ?? 0,
        claimCount: 1,
        remainingPeriods: Number(first.note.remaining / 100n),
        secondRemainingPeriods: Number((second?.note.remaining ?? 0n) / 100n),
      });
      const witness = {
        ...base.witness,
        ...inputs.witness,
        policyCommitmentInput: String(policyCommitment),
        enrollmentCommitmentInput: String(enrollmentCommitment),
        eligibleFrom: String(eligibleFrom),
        budgetNonce: String(first.note.nonce),
        budgetCiphertextHash: String(first.ciphertextHashField),
        noteDepth: firstPath.depth,
        noteIndex: firstPath.index,
        noteSiblings: firstPath.siblings,
        newBudgetNonce: String(nonce),
        payoutNonce: String(nonce + 1n),
        ...(second
          ? {
              secondBudgetNonce: String(second.note.nonce),
              secondBudgetCiphertextHash: String(second.ciphertextHashField),
              secondNoteDepth: secondPath.depth,
              secondNoteIndex: secondPath.index,
              secondNoteSiblings: secondPath.siblings,
            }
          : {}),
      };
      return { data, inputs, witness, remainder, payout };
    };
    const snapshot = await hre.networkHelpers.takeSnapshot();
    const pure = await makeClaim(initial, null, 207n);
    const pureProof = await prove("claim", pure.witness, pure.inputs.signals);
    assert.equal(pure.witness.policySalt, "0");
    assertInvalidCircuitWitness(
      "claim",
      { ...pure.witness, derivedSecretField: String(BigInt(pure.witness.derivedSecretField) + 1n) },
      /Assert Failed/u,
    );
    assertInvalidCircuitWitness("claim", { ...pure.witness, budgetKind: "0" }, /Assert Failed/u);
    await hre.networkHelpers.time.increaseTo(Number(pure.data.asOf));
    await pool.claim(pure.data, pureProof);
    const recovered = await decryptShieldedNote({
      ciphertext: pure.remainder.ciphertext,
      hpkeIkm: keys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: recovered,
        ciphertext: pure.remainder.ciphertext,
        noteCommitment: pure.remainder.commitment,
      }).note.binding,
    ).to.equal("identity");
    const repeated = await makeClaim(secondPublic, null, 217n);
    const repeatedProof = await prove("claim", repeated.witness, repeated.inputs.signals);
    await expect(pool.claim(repeated.data, repeatedProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );
    const crossMode = await makeClaim(privateBudget, null, 227n);
    const crossModeProof = await prove("claim", crossMode.witness, crossMode.inputs.signals);
    await expect(pool.claim(crossMode.data, crossModeProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );
    // A publicly funded budget's payout has the same secret-owner authorization as every VALUE.
    const payoutLeaf = Number((await pool.noteShard(0)).size) - 1;
    const payoutPath = compactMembership(await pool.getNoteMerkleProof(0, payoutLeaf));
    const root = (await pool.noteShard(0)).root;
    const exitChange = await encryptValueNote({ ...heirContext, amount: 0n, nonce: 307n });
    const exitDummy = await encryptValueNote({ ...heirContext, amount: 0n, nonce: 308n });
    const exitData = {
      ...zeroData(),
      inputRoots: [root, root],
      inputNullifiers: [
        spend(keys.ownerSecret, pure.payout),
        computeShieldedDummyInputNullifier({
          ownerSecret: keys.ownerSecret,
          noteCommitment: pure.payout.commitment,
        }),
      ],
      outputCommitments: [exitChange.commitment, exitDummy.commitment],
      outputCiphertexts: [exitChange.ciphertextHex, exitDummy.ciphertextHex],
    };
    const exitInputs = buildShieldedPoolPublicInputs({
      action: 4,
      chainId,
      poolAddress,
      ...exitData,
      amount: 100n,
      recipient: recipient.address,
    });
    const exitProof = await prove(
      "unshield",
      {
        ...exitInputs.witness,
        ownerSecret: String(keys.ownerSecret),
        inputAmount: "100",
        inputNonce: String(pure.payout.nonce),
        inputCiphertextHash: String(pure.payout.ciphertextHashField),
        noteDepth: payoutPath.depth,
        noteIndex: payoutPath.index,
        noteSiblings: payoutPath.siblings,
        changeAmount: "0",
        changeNonce: "307",
        dummyNonce: "308",
      },
      exitInputs.signals,
    );
    await pool.unshield(recipient.address, 100n, exitData, exitProof);
    expect(await token.balanceOf(recipient.address)).to.equal(100n);
    expect(await pool.totalShielded()).to.equal(900n);
    await snapshot.restore();
    const mixed = await makeClaim(initial, privateBudget, 407n);
    const mixedProof = await prove("claim", mixed.witness, mixed.inputs.signals);
    assertInvalidCircuitWitness(
      "claim",
      { ...mixed.witness, policySalt: "0", enrollmentSalt: "0", allocationKeyCommitment: "0" },
      /Assert Failed/u,
    );
    await hre.networkHelpers.time.increaseTo(Number(mixed.data.asOf));
    await pool.claim(mixed.data, mixedProof);
    const privateRemainder = await decryptShieldedNote({
      ciphertext: mixed.remainder.ciphertext,
      hpkeIkm: keys.hpkeIkm,
      chainId,
      poolAddress,
    });
    const recoveredPrivate = verifyShieldedNotePayload({
      payload: privateRemainder,
      ciphertext: mixed.remainder.ciphertext,
      noteCommitment: mixed.remainder.commitment,
    }).note;
    expect(recoveredPrivate.binding).not.to.equal("identity");
    expect(recoveredPrivate.heirOwnerCommitment).to.equal(keys.ownerCommitment);
    expect(recoveredPrivate.remaining).to.equal(500n);
    expect(await pool.nullifierSpent(mixed.data.inputNullifiers[0])).to.equal(true);
    expect(await pool.nullifierSpent(mixed.data.inputNullifiers[1])).to.equal(true);
    expect(await pool.totalShielded()).to.equal(1000n);
  });

  it("proves one synthetic full 64/32 path and twelve periods with current public keys", async function () {
    const artifacts = checkedCurrentArtifacts(["claim"]);
    if (artifacts.missing) {
      console.log(
        `Skipping local full-path proof; run npm run zk:development:setup (${artifacts.missing.length} public artifacts absent)`,
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
    witness.inputRoots = [note.root.toString(), note.root.toString()];

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
    witness.endorsementRoot = endorsement.root.toString();
    witness.trustedDepth = trusted.depth;
    witness.trustedIndex = trusted.index;
    witness.trustedSiblings = trusted.siblings;
    witness.trustedRoot = trusted.root.toString();

    const start = performance.now();
    const proof = await prove("claim", witness, claimSignalsOf(witness));
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
    const artifacts = checkedCurrentArtifacts(["shield", "unshield", "privateTransfer"]);
    if (artifacts.missing) {
      console.log(
        `Skipping local real proof test; run npm run zk:development:setup (${artifacts.missing.length} public artifacts absent)`,
      );
      this.skip();
    }

    const [depositor, recipient] = await hre.ethers.getSigners();
    const generated = await deployCurrentGeneratedVerifiers(
      ["shield", "unshield", "privateTransfer"],
      depositor,
    );
    const adapter = await deployUnifiedVerifierAdapter(hre, generated);
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all(
      [adapter, token, lineage, poseidon].map((contract) => contract.waitForDeployment()),
    );
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await adapter.getAddress(),
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
    const { signals: shieldSignals, witness: shieldPublicInputs } = buildShieldedPoolPublicInputs({
      action: 0,
      chainId,
      poolAddress,
      ...shieldData,
      amount: 100n,
    });
    const shieldProof = await prove(
      "shield",
      {
        ...shieldPublicInputs,
        ownerSecret: String(ownerSecret),
        outputAmounts: ["100", "0"],
        outputNonces: ["11", "12"],
      },
      shieldSignals,
    );
    expect(await adapter.verifyProof(2, 1, shieldProof, shieldSignals)).to.equal(true);
    // A proof can only reach the verifier route with its own public-signal count.
    await expect(
      adapter.verifyProof(6, 1, shieldProof, shieldSignals),
    ).to.be.revertedWithCustomError(adapter, "MalformedProofData");
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
    const { signals: unshieldSignals, witness: unshieldPublicInputs } =
      buildShieldedPoolPublicInputs({
        action: 4,
        chainId,
        poolAddress,
        ...unshieldData,
        amount: 30n,
        recipient: recipient.address,
      });
    const unshieldProof = await prove(
      "unshield",
      {
        ...unshieldPublicInputs,
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
    expect(await adapter.verifyProof(6, 1, unshieldProof, unshieldSignals)).to.equal(true);
    // Equal public-signal lengths do not allow a proof from one circuit to verify in another.
    expect(await adapter.verifyProof(5, 1, unshieldProof, unshieldSignals)).to.equal(false);
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
      `local Hardhat gas (not release evidence): shield=${shieldReceipt.gasUsed} unshield=${unshieldReceipt.gasUsed}`,
    );
  });

  it("funds initial and historical enrollments and claims one or two budgets with real proofs", async function () {
    const actions = ["shield", "fund", "claim"];
    const artifacts = checkedCurrentArtifacts(actions);
    if (artifacts.missing) {
      console.log(
        `Skipping local fund/claim proof test; run npm run zk:development:setup (${artifacts.missing.length} public artifacts absent)`,
      );
      this.skip();
    }

    const [depositor] = await hre.ethers.getSigners();
    const generated = await deployCurrentGeneratedVerifiers(actions, depositor);
    const adapter = await deployUnifiedVerifierAdapter(hre, generated);
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all(
      [adapter, token, lineage, poseidon].map((contract) => contract.waitForDeployment()),
    );
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await adapter.getAddress(),
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
    const { signals: shieldSignals, witness: shieldPublicInputs } = buildShieldedPoolPublicInputs({
      action: 0,
      chainId,
      poolAddress,
      ...shieldData,
      amount: 2000n,
    });
    const shieldProof = await prove(
      "shield",
      {
        ...shieldPublicInputs,
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
    const allocationWitness = fundingFixture.initial;
    const claimFixture = buildShieldedClaimFixture({ claimCount: 12, remainingPeriods: 12 });
    const heirKeys = deriveShieldedHeirKeyMaterial(claimFixture.witness.derivedSecretField);
    assert.equal(heirKeys.ownerCommitment, BigInt(allocationWitness.heirOwnerCommitment));
    const heirViewingKey = await deriveShieldedViewPublicKey(heirKeys.hpkeIkm);
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
    const heirIdentityCommitment = BigInt(allocationWitness.heirIdentityCommitment);
    const heirOwnerCommitment = BigInt(allocationWitness.heirOwnerCommitment);
    const endorsementRoot = BigInt(claimFixture.witness.endorsementRoot);
    const trustedRoot = BigInt(claimFixture.witness.trustedRoot);
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
    const donorMembership = compactMembership(await pool.getNoteMerkleProof(0, 0));
    assert.equal(donorMembership.depth, "1");
    const allocationData = {
      ...zeroData(),
      inputRoots: [preAllocationRoot, preAllocationRoot],
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: firstDonorNote.commitment,
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
    };
    const { signals: allocationSignals, witness: allocationPublicInputs } =
      buildShieldedPoolPublicInputs({
        action: 1,
        chainId,
        poolAddress,
        ...allocationData,
      });
    const realAllocationWitness = {
      ...allocationWitness,
      ...allocationPublicInputs,
      donorNonce: "101",
      donorCiphertextHash: String(firstDonorNote.ciphertextHashField),
      donorDepth: donorMembership.depth,
      donorIndex: donorMembership.index,
      donorSiblings: donorMembership.siblings,
      eligibleFrom: String(eligibleFrom),
      budgetPeriods: "12",
      budgetNonce: String(budgetNonce),
      changeNonce: "109",
    };
    const fundProof = await prove("fund", realAllocationWitness, allocationSignals);
    await lineage.setRoot(0, endorsementRoot + 1n);
    await expect(pool.fund(allocationData, fundProof)).to.be.revertedWithCustomError(
      pool,
      "UnknownLineageRoot",
    );
    await lineage.setRoot(0, endorsementRoot);
    const fundReceipt = await (await pool.fund(allocationData, fundProof)).wait();
    expect(await pool.nullifierSpent(allocationData.inputNullifiers[1])).to.equal(true);
    expect(await pool.totalShielded()).to.equal(2000n);
    expect(await token.balanceOf(poolAddress)).to.equal(2000n);

    // The old child budget is a read-only template: this action spends only
    // the donor's 800-value change note and creates a separate 300-value budget.
    const additionalFundingUseNonce = 114n;
    const additionalFundingBudgetNonce = 111n;
    const additionalFundingChangeNonce = 113n;
    const additionalFundingBudgetPayload = encodeShieldedBudgetNotePayload({
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
      nonce: additionalFundingBudgetNonce,
    });
    const encryptedAdditionalFundingBudget = await encryptPayloadNote(
      { viewingKey: heirViewingKey, chainId, poolAddress },
      additionalFundingBudgetPayload,
    );
    const additionalFundingBudgetCommitment = computeShieldedBudgetNoteCommitment({
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 300n,
      nonce: additionalFundingBudgetNonce,
      ciphertextHashField: encryptedAdditionalFundingBudget.ciphertextHashField,
    });
    const additionalFundingDonorChange = await encryptValueNote({
      ...donorNoteInput,
      amount: 500n,
      nonce: additionalFundingChangeNonce,
    });
    const preAdditionalFundingRoot = (await pool.noteShard(0)).root;
    const additionalFundingDonorMembership = compactMembership(await pool.getNoteMerkleProof(0, 3));
    const additionalFundingBudgetMembership = compactMembership(
      await pool.getNoteMerkleProof(0, 2),
    );
    const additionalFundingData = {
      ...zeroData(),
      fundMode: 1n,
      inputRoots: [preAdditionalFundingRoot, preAdditionalFundingRoot],
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: donorChange.commitment,
        }),
        computeShieldedBudgetUseNullifier({
          policySalt,
          budgetNoteCommitment: budgetCommitment,
          useNonce: additionalFundingUseNonce,
        }),
      ],
      outputCommitments: [
        additionalFundingBudgetCommitment,
        additionalFundingDonorChange.commitment,
      ],
      outputCiphertexts: [
        encryptedAdditionalFundingBudget.ciphertextHex,
        additionalFundingDonorChange.ciphertextHex,
      ],
    };
    const { signals: additionalFundingSignals, witness: additionalFundingPublicInputs } =
      buildShieldedPoolPublicInputs({
        action: 1,
        chainId,
        poolAddress,
        ...additionalFundingData,
      });
    const additionalFundingWitness = {
      ...fundingFixture.continuation,
      ...additionalFundingPublicInputs,
      donorAmount: "800",
      donorNonce: "109",
      donorCiphertextHash: String(donorChange.ciphertextHashField),
      donorDepth: additionalFundingDonorMembership.depth,
      donorIndex: additionalFundingDonorMembership.index,
      donorSiblings: additionalFundingDonorMembership.siblings,
      eligibleFrom: String(eligibleFrom),
      oldBudgetRemaining: "1200",
      oldBudgetRemainingPeriods: "12",
      oldBudgetNonce: String(budgetNonce),
      oldBudgetCiphertextHash: String(encryptedBudget.ciphertextHashField),
      oldBudgetDepth: additionalFundingBudgetMembership.depth,
      oldBudgetIndex: additionalFundingBudgetMembership.index,
      oldBudgetSiblings: additionalFundingBudgetMembership.siblings,
      budgetUseNonce: String(additionalFundingUseNonce),
      budgetPeriods: "3",
      budgetNonce: String(additionalFundingBudgetNonce),
      changeNonce: String(additionalFundingChangeNonce),
    };
    const additionalFundingProof = await prove(
      "fund",
      additionalFundingWitness,
      additionalFundingSignals,
    );
    const tamperedAdditionalFunding = {
      ...additionalFundingData,
      outputCommitments: [
        additionalFundingBudgetCommitment + 1n,
        additionalFundingDonorChange.commitment,
      ],
    };
    await expect(
      pool.fund(tamperedAdditionalFunding, additionalFundingProof),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    const additionalFundingReceipt = await (
      await pool.fund(additionalFundingData, additionalFundingProof)
    ).wait();
    expect(await pool.nullifierSpent(additionalFundingData.inputNullifiers[0])).to.equal(true);
    expect(await pool.nullifierSpent(additionalFundingData.inputNullifiers[1])).to.equal(true);
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
    const recoveredAdditionalFundingPayload = await decryptShieldedNote({
      ciphertext: encryptedAdditionalFundingBudget.ciphertext,
      hpkeIkm: heirKeys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: recoveredAdditionalFundingPayload,
        ciphertext: encryptedAdditionalFundingBudget.ciphertext,
        noteCommitment: additionalFundingBudgetCommitment,
      }).note.remaining,
    ).to.equal(300n);
    await expect(
      pool.fund(additionalFundingData, additionalFundingProof),
    ).to.be.revertedWithCustomError(pool, "NullifierAlreadySpent");

    const preClaimRoot = (await pool.noteShard(0)).root;
    const budgetMembership = compactMembership(await pool.getNoteMerkleProof(0, 2));
    assert.equal(budgetMembership.depth, "3");
    const spendBudgetTag = computeShieldedSpendNullifier({
      ownerSecret: heirKeys.ownerSecret,
      noteCommitment: budgetCommitment,
    });
    const dummyBudgetTag = computeShieldedDummyInputNullifier({
      ownerSecret: heirKeys.ownerSecret,
      noteCommitment: budgetCommitment,
    });
    const secondBudgetMembership = compactMembership(await pool.getNoteMerkleProof(0, 4));
    const makeClaim = async (count, useSecond = false) => {
      const claimAsOf = eligibleFrom + BigInt(count) * PERIOD;
      const remaining = 1200n + (useSecond ? 300n : 0n) - BigInt(count) * rate;
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
        inputNullifiers: [
          spendBudgetTag,
          useSecond
            ? computeShieldedSpendNullifier({
                ownerSecret: heirKeys.ownerSecret,
                noteCommitment: additionalFundingBudgetCommitment,
              })
            : dummyBudgetTag,
        ],
        periodNullifiers,
        outputCommitments: [nextBudgetCommitment, payoutNote.commitment],
        outputCiphertexts: [nextBudgetCiphertext.ciphertextHex, payoutNote.ciphertextHex],
        relation0: endorsementRoot,
        relation1: trustedRoot,
        asOf: claimAsOf,
      };
      const { signals: claimSignals, witness: claimPublicInputs } = buildShieldedPoolPublicInputs({
        action: 2,
        chainId,
        poolAddress,
        ...claimData,
      });
      const baseWitness = buildShieldedClaimFixture({
        claimCount: count,
        remainingPeriods: 12,
        secondRemainingPeriods: useSecond ? 3 : 0,
      }).witness;
      const witness = {
        ...baseWitness,
        ...claimPublicInputs,
        policyCommitmentInput: String(policyCommitment),
        enrollmentCommitmentInput: String(enrollmentCommitment),
        eligibleFrom: String(eligibleFrom),
        remaining: "1200",
        remainingPeriods: "12",
        budgetNonce: String(budgetNonce),
        budgetCiphertextHash: String(encryptedBudget.ciphertextHashField),
        noteDepth: budgetMembership.depth,
        noteIndex: budgetMembership.index,
        noteSiblings: budgetMembership.siblings,
        ...(useSecond
          ? {
              secondRemaining: "300",
              secondRemainingPeriods: "3",
              secondBudgetNonce: String(additionalFundingBudgetNonce),
              secondBudgetCiphertextHash: String(
                encryptedAdditionalFundingBudget.ciphertextHashField,
              ),
              secondNoteDepth: secondBudgetMembership.depth,
              secondNoteIndex: secondBudgetMembership.index,
              secondNoteSiblings: secondBudgetMembership.siblings,
            }
          : {}),
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

    const mergedBranch = await hre.networkHelpers.takeSnapshot();
    const mergedClaim = await makeClaim(12, true);
    const mergedProof = await prove("claim", mergedClaim.witness, mergedClaim.claimSignals);
    await hre.networkHelpers.time.increaseTo(Number(mergedClaim.claimAsOf));
    await pool.claim(mergedClaim.claimData, mergedProof);
    expect(await pool.nullifierSpent(mergedClaim.claimData.inputNullifiers[0])).to.equal(true);
    expect(await pool.nullifierSpent(mergedClaim.claimData.inputNullifiers[1])).to.equal(true);
    const mergedRemainder = await decryptShieldedNote({
      ciphertext: mergedClaim.nextBudgetCiphertext.ciphertext,
      hpkeIkm: heirKeys.hpkeIkm,
      chainId,
      poolAddress,
    });
    expect(
      verifyShieldedNotePayload({
        payload: mergedRemainder,
        ciphertext: mergedClaim.nextBudgetCiphertext.ciphertext,
        noteCommitment: mergedClaim.nextBudgetCommitment,
      }).note.remaining,
    ).to.equal(300n);
    await expect(pool.claim(mergedClaim.claimData, mergedProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );

    // A spent budget still authenticates its historical enrollment. Continuing
    // funding reads that budget, spends fresh donor value, and preserves its start.
    const historicalBudget = compactMembership(await pool.getNoteMerkleProof(0, 2));
    const continuingDonor = compactMembership(await pool.getNoteMerkleProof(0, 5));
    const continuingRoot = (await pool.noteShard(0)).root;
    const continuedPayload = encodeShieldedBudgetNotePayload({
      rootIdentityCommitment,
      rootVersionIndex,
      policySalt,
      allocationKeyCommitment,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 100n,
      nonce: 221n,
    });
    const continuedBudget = await encryptPayloadNote(
      { viewingKey: heirViewingKey, chainId, poolAddress },
      continuedPayload,
    );
    const continuedBudgetCommitment = computeShieldedBudgetNoteCommitment({
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment,
      amountPerPeriod: rate,
      remaining: 100n,
      nonce: 221n,
      ciphertextHashField: continuedBudget.ciphertextHashField,
    });
    const continuedChange = await encryptValueNote({
      ...donorNoteInput,
      amount: 400n,
      nonce: 223n,
    });
    const continuedData = {
      ...zeroData(),
      fundMode: 1n,
      inputRoots: [continuingRoot, continuingRoot],
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: donorOwnerSecret,
          noteCommitment: additionalFundingDonorChange.commitment,
        }),
        computeShieldedBudgetUseNullifier({
          policySalt,
          budgetNoteCommitment: budgetCommitment,
          useNonce: 224n,
        }),
      ],
      outputCommitments: [continuedBudgetCommitment, continuedChange.commitment],
      outputCiphertexts: [continuedBudget.ciphertextHex, continuedChange.ciphertextHex],
    };
    const continuedInputs = buildShieldedPoolPublicInputs({
      action: 1,
      chainId,
      poolAddress,
      ...continuedData,
    });
    const continuedProof = await prove(
      "fund",
      {
        ...additionalFundingWitness,
        ...continuedInputs.witness,
        donorAmount: "500",
        donorNonce: String(additionalFundingChangeNonce),
        donorCiphertextHash: String(additionalFundingDonorChange.ciphertextHashField),
        donorDepth: continuingDonor.depth,
        donorIndex: continuingDonor.index,
        donorSiblings: continuingDonor.siblings,
        oldBudgetDepth: historicalBudget.depth,
        oldBudgetIndex: historicalBudget.index,
        oldBudgetSiblings: historicalBudget.siblings,
        budgetUseNonce: "224",
        budgetPeriods: "1",
        budgetNonce: "221",
        changeNonce: "223",
      },
      continuedInputs.signals,
    );
    await pool.fund(continuedData, continuedProof);
    expect(await pool.nullifierSpent(spendBudgetTag)).to.equal(true);
    expect(await pool.nullifierSpent(continuedData.inputNullifiers[0])).to.equal(true);
    expect(await pool.nullifierSpent(continuedData.inputNullifiers[1])).to.equal(true);
    expect(await pool.totalShielded()).to.equal(2000n);
    await mergedBranch.restore();

    const branch = await hre.networkHelpers.takeSnapshot();
    const onePeriod = await makeClaim(1);
    const oneProof = await prove("claim", onePeriod.witness, onePeriod.claimSignals);
    // Identity knowledge must match the endorsed child and the budget owner.
    // Merely changing the secret cannot authorize this payout.
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
    assertInvalidCircuitWitness(
      "claim",
      { ...onePeriod.witness, asOf: String(eligibleFrom + PERIOD - 1n) },
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
    const { signals: renewedClaimSignals, witness: renewedClaimPublicInputs } =
      buildShieldedPoolPublicInputs({
        action: 2,
        chainId,
        poolAddress,
        ...renewedClaimData,
      });
    const renewedWitness = {
      ...onePeriod.witness,
      ...renewedClaimPublicInputs,
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

    // This additional budget contains only three whole periods. A four
    // period claim is invalid even though all four periods are already due.
    const fourPeriods = await makeClaim(4);
    const additionalFundingClaimMembership = compactMembership(await pool.getNoteMerkleProof(0, 4));
    const underfundedClaimData = {
      ...fourPeriods.claimData,
      inputNullifiers: [
        computeShieldedSpendNullifier({
          ownerSecret: heirKeys.ownerSecret,
          noteCommitment: additionalFundingBudgetCommitment,
        }),
        computeShieldedDummyInputNullifier({
          ownerSecret: heirKeys.ownerSecret,
          noteCommitment: additionalFundingBudgetCommitment,
        }),
      ],
      periodNullifiers: Array.from({ length: 12 }, (_, slot) =>
        slot < 4
          ? fourPeriods.claimData.periodNullifiers[slot]
          : computeShieldedDummyPeriodNullifier({
              ownerSecret: heirKeys.ownerSecret,
              budgetNoteCommitment: additionalFundingBudgetCommitment,
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
    const { signals: underfundedClaimSignals, witness: underfundedClaimPublicInputs } =
      buildShieldedPoolPublicInputs({
        action: 2,
        chainId,
        poolAddress,
        ...underfundedClaimData,
      });
    assertInvalidCircuitWitness(
      "claim",
      {
        ...fourPeriods.witness,
        ...underfundedClaimPublicInputs,
        remaining: "300",
        remainingPeriods: "3",
        budgetNonce: String(additionalFundingBudgetNonce),
        budgetCiphertextHash: String(encryptedAdditionalFundingBudget.ciphertextHashField),
        noteDepth: additionalFundingClaimMembership.depth,
        noteIndex: additionalFundingClaimMembership.index,
        noteSiblings: additionalFundingClaimMembership.siblings,
      },
      /ShieldedClaim/u,
    );

    const twelvePeriods = await makeClaim(12);
    const twelveProof = await prove("claim", twelvePeriods.witness, twelvePeriods.claimSignals);
    // The circuit's private count is range constrained even though all public
    // period slots have the same fixed shape.
    assertInvalidCircuitWitness(
      "claim",
      { ...twelvePeriods.witness, claimCount: "13" },
      /ShieldedClaim/u,
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
      `local Hardhat gas (not release evidence): fundInitial=${fundReceipt.gasUsed} fundContinuation=${additionalFundingReceipt.gasUsed} claim1=${oneReceipt.gasUsed} claim12=${twelveReceipt.gasUsed}`,
    );
  });

  it("privately transfers two owners' notes through a real proof without changing pool assets", async function () {
    const artifacts = checkedCurrentArtifacts(["shield", "privateTransfer"]);
    if (artifacts.missing) {
      console.log(
        `Skipping local private transfer proof test; run npm run zk:development:setup (${artifacts.missing.length} public artifacts absent)`,
      );
      this.skip();
    }

    const [depositor] = await hre.ethers.getSigners();
    const generated = await deployCurrentGeneratedVerifiers(
      ["shield", "privateTransfer"],
      depositor,
    );
    const adapter = await deployUnifiedVerifierAdapter(hre, generated);
    const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
    const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
    const poseidon = await hre.ethers.deployContract("PoseidonT3");
    await Promise.all(
      [adapter, token, lineage, poseidon].map((contract) => contract.waitForDeployment()),
    );
    const Pool = await hre.ethers.getContractFactory("ShieldedDeepPool", {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    });
    const pool = await Pool.deploy(
      await token.getAddress(),
      await lineage.getAddress(),
      await adapter.getAddress(),
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
      const { signals: shieldSignals, witness: shieldPublicInputs } = buildShieldedPoolPublicInputs(
        {
          action: 0,
          chainId,
          poolAddress,
          ...shieldData,
          amount: sourceAmounts[index],
        },
      );
      const shieldProof = await prove(
        "shield",
        {
          ...shieldPublicInputs,
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
    const { signals: transferSignals, witness: transferPublicInputs } =
      buildShieldedPoolPublicInputs({
        action: 3,
        chainId,
        poolAddress,
        ...transferData,
      });
    const transferProof = await prove(
      "privateTransfer",
      {
        ...transferPublicInputs,
        hasSecondInput: "1",
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
    expect(await adapter.verifyProof(5, 1, transferProof, transferSignals)).to.equal(true);
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

    // The first recipient owns only this payout note. It can immediately make
    // a private transfer without waiting for another claim or a zero-value note.
    const singleSource = recipients[0];
    const singleRoot = (await pool.noteShard(0)).root;
    const singlePath = compactMembership(await pool.getNoteMerkleProof(0, 4));
    const singleDestinations = await Promise.all(
      [
        { ownerSecret: 5505n, amount: 25n, nonce: 41n, hpkeIkm: "0x5555" },
        { ownerSecret: 3303n, amount: 15n, nonce: 42n, hpkeIkm: "0x3333" },
      ].map(async (destination) => {
        const hpkeIkm = hre.ethers.getBytes(hre.ethers.zeroPadValue(destination.hpkeIkm, 32));
        const ownerCommitment = computeShieldedOwnerCommitment(destination.ownerSecret);
        const viewingKey = await deriveShieldedViewPublicKey(hpkeIkm);
        const note = await encryptValueNote({
          ownerCommitment,
          viewingKey,
          chainId,
          poolAddress,
          amount: destination.amount,
          nonce: destination.nonce,
        });
        return { ...destination, hpkeIkm, ownerCommitment, note };
      }),
    );
    const singleNullifiers = [
      computeShieldedSpendNullifier({
        ownerSecret: singleSource.ownerSecret,
        noteCommitment: singleSource.note.commitment,
      }),
      computeShieldedDummyInputNullifier({
        ownerSecret: singleSource.ownerSecret,
        noteCommitment: singleSource.note.commitment,
      }),
    ];
    const singleData = {
      ...zeroData(),
      inputRoots: [singleRoot, singleRoot],
      inputNullifiers: singleNullifiers,
      outputCommitments: singleDestinations.map(({ note }) => note.commitment),
      outputCiphertexts: singleDestinations.map(({ note }) => note.ciphertextHex),
    };
    const { signals: singleSignals, witness: singlePublicInputs } = buildShieldedPoolPublicInputs({
      action: 3,
      chainId,
      poolAddress,
      ...singleData,
    });
    const singleProof = await prove(
      "privateTransfer",
      {
        ...singlePublicInputs,
        hasSecondInput: "0",
        inputOwnerSecrets: [String(singleSource.ownerSecret), "0"],
        inputAmounts: [String(singleSource.amount), "0"],
        inputNonces: [String(singleSource.nonce), "0"],
        inputCiphertextHashes: [String(singleSource.note.ciphertextHashField), "0"],
        inputDepths: [singlePath.depth, "0"],
        inputIndices: [singlePath.index, "0"],
        inputSiblings: [singlePath.siblings, Array(32).fill("0")],
        outputOwnerCommitments: singleDestinations.map(({ ownerCommitment }) =>
          String(ownerCommitment),
        ),
        outputAmounts: singleDestinations.map(({ amount }) => String(amount)),
        outputNonces: singleDestinations.map(({ nonce }) => String(nonce)),
      },
      singleSignals,
    );
    expect(await adapter.verifyProof(5, 1, singleProof, singleSignals)).to.equal(true);
    await expect(
      pool.privateTransfer({ ...singleData, inputRoots: [singleRoot, sourceRoot] }, singleProof),
    ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
    const singleReceipt = await (await pool.privateTransfer(singleData, singleProof)).wait();
    for (const nullifier of singleNullifiers) {
      expect(await pool.nullifierSpent(nullifier)).to.equal(true);
    }
    for (const destination of singleDestinations) {
      const payload = await decryptShieldedNote({
        ciphertext: destination.note.ciphertext,
        hpkeIkm: destination.hpkeIkm,
        chainId,
        poolAddress,
      });
      const recovered = verifyShieldedNotePayload({
        payload,
        ciphertext: destination.note.ciphertext,
        noteCommitment: destination.note.commitment,
      });
      expect(recovered.note.amount).to.equal(destination.amount);
    }
    expect(await pool.totalShielded()).to.equal(100n);
    expect(await token.balanceOf(poolAddress)).to.equal(100n);
    await expect(pool.privateTransfer(singleData, singleProof)).to.be.revertedWithCustomError(
      pool,
      "NullifierAlreadySpent",
    );
    console.log(
      `local Hardhat gas (not release evidence): privateTransfer2=${receipt.gasUsed} privateTransfer1=${singleReceipt.gasUsed}`,
    );
  });
});
