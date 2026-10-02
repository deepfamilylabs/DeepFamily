import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, getBytes, hexlify } from "ethers";
import {
  buildShieldedPoolPublicInputs,
  buildShieldedPublicClaimPublicInputs,
  buildShieldedReceiveCodePublicSignals,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifier,
  computeShieldedEnrollmentCommitment,
  computeShieldedEnrollmentNullifier,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedTopUpUseNullifier,
  computeShieldedValueNoteCommitment,
  decodeShieldedReceiveCode,
  decryptShieldedNote,
  deriveIdentityMaterial,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedReceiveCode,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  wipeBytes,
} from "@deepfamily/protocol-core";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { addPersonVersion } from "../../lib/seedHelpers.js";
import { loadCandidateArtifacts } from "./shieldedArtifacts.mjs";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "./zkDeploymentCatalog.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PERIOD = 2_592_000n;
const ACTION_IDS = Object.fromEntries(
  Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [action, spec.actionId]),
);
const jsonHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decimals = (values) => values.map(String);
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
});

function compactPath(proof, capacity) {
  assert.ok(proof.proofDepth <= BigInt(capacity), "Merkle proof exceeds its circuit capacity");
  return {
    root: proof.proofRoot,
    depth: String(proof.proofDepth),
    index: String(proof.proofIndex),
    siblings: [...proof.siblings.map(String), ...Array(capacity - proof.siblings.length).fill("0")],
  };
}

const snarkjs = (root, args) =>
  execFileSync(process.execPath, [path.join(root, "node_modules/snarkjs/build/cli.cjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });

/** Witnesses stay in a private temporary directory and are removed after each proof. */
function generateProof(root, files, witness, expectedSignals) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-acceptance-"));
  const input = path.join(temporary, "input.json");
  const proofFile = path.join(temporary, "proof.json");
  const publicFile = path.join(temporary, "public.json");
  try {
    fs.writeFileSync(input, JSON.stringify(witness), { mode: 0o600 });
    snarkjs(root, ["groth16", "fullprove", input, files.wasm, files.zkey, proofFile, publicFile]);
    const publicSignals = JSON.parse(fs.readFileSync(publicFile, "utf8"));
    assert.deepEqual(
      publicSignals.map(BigInt),
      expectedSignals,
      `${files.source} public signals differ from the action`,
    );
    assert.match(snarkjs(root, ["groth16", "verify", files.vkey, publicFile, proofFile]), /OK!/u);
    const raw = JSON.parse(fs.readFileSync(proofFile, "utf8"));
    const normalized = normalizeGroth16Proof(raw);
    return { raw, normalized, publicSignals, encoded: encodeGroth16AbcProofData(normalized) };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/** Check a proof taken from a receive code against the candidate verification key. */
function verifyProof(root, files, proof, publicSignals) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-acceptance-"));
  const proofFile = path.join(temporary, "proof.json");
  const publicFile = path.join(temporary, "public.json");
  try {
    fs.writeFileSync(proofFile, JSON.stringify(proof));
    fs.writeFileSync(publicFile, JSON.stringify(publicSignals.map(String)));
    return /OK!/u.test(snarkjs(root, ["groth16", "verify", files.vkey, publicFile, proofFile]));
  } catch {
    return false;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

/**
 * Exercises current public keys with the integrated DEEP, lineage and pool. The donor
 * pays the heir from the heir's receive code alone. A new allocation cannot mature in
 * this run: Claim is verified at its future asOf against the current real roots,
 * without submitting a premature claim transaction.
 */
export async function runShieldedAcceptanceSmoke({
  root = DEFAULT_ROOT,
  connection,
  deployed,
  signer,
  person,
  father,
  mother,
  personResult,
  recordTx,
  proofArtifacts,
}) {
  root = path.resolve(root);
  const candidate = loadCandidateArtifacts({ root });
  const provider = connection.ethers.provider;
  const chainId = (await provider.getNetwork()).chainId;
  const signerAddress = getAddress(await signer.getAddress());
  const family = deployed.deepFamily.connect(signer);
  const lineage = deployed.lineageIndex;
  const token = deployed.token.connect(signer);
  const pool = deployed.shieldedDeepPool.connect(signer);
  const poolAddress = await pool.getAddress();
  const proofs = {};
  let receiveCode;
  const materials = [];
  const keyMaterials = [];
  const recorded = [];
  const journal = new Map();
  let firstShieldBlock;

  const record = async (label, tx) => {
    const receipt = await recordTx(label, tx);
    assert.equal(receipt?.status, 1, `${label} did not succeed`);
    recorded.push(label);
    return receipt;
  };
  const prove = async (
    action,
    witness,
    publicSignals,
    { execution = "transaction", label = `shielded-action-${action}`, ...extra } = {},
  ) => {
    const generated = generateProof(root, candidate.circuits[action], witness, publicSignals);
    const verifier = deployed.shieldedVerifiers[action];
    const { a, b, c } = generated.normalized;
    assert.equal(
      await verifier.verifyProof.staticCall(a, b, c, publicSignals),
      true,
      `${action} deployed verifier rejected its proof`,
    );
    assert.equal(
      await deployed.groth16VerifierAdapter.verifyProof.staticCall(
        SHIELDED_DEPLOYMENT_CIRCUITS[action].proofPurpose,
        1,
        encodeGroth16AbcProofData(generated.normalized),
        publicSignals,
      ),
      true,
      `${action} shared Groth16 adapter rejected its proof`,
    );
    const item = candidate.manifest.circuits[action];
    const metadata = {
      source: candidate.circuits[action].source,
      publicSignals: generated.publicSignals,
      publicSignalsSha256: jsonHash(generated.publicSignals),
      proofSha256: jsonHash(generated.raw),
      wasmSha256: item.wasmSha256,
      zkeySha256: item.zkeySha256,
      verificationKeySha256: item.verificationKeySha256,
      verifierAddress: await verifier.getAddress(),
      verified: true,
      execution,
      ...(execution === "transaction" ? { transactionLabel: label } : {}),
      ...extra,
    };
    if (!proofs[action]) proofs[action] = metadata;
    return generated;
  };
  const keysFor = async (material) => {
    const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
    keyMaterials.push(keys);
    return { ...keys, viewingKey: await deriveShieldedViewPublicKey(keys.hpkeIkm) };
  };
  const receiveCodeFor = (material, keys) => {
    const files = candidate.circuits.receiveCode;
    const signals = buildShieldedReceiveCodePublicSignals({
      identityCommitment: material.identityCommitment,
      ownerCommitment: keys.ownerCommitment,
      viewingKey: keys.viewingKey,
    });
    const generated = generateProof(
      root,
      files,
      {
        identityCommitment: String(signals[0]),
        ownerCommitment: String(signals[1]),
        viewKeyLo: String(signals[2]),
        viewKeyHi: String(signals[3]),
        nameField: String(material.nameField),
        derivedSecretField: String(material.derivedSecretField),
        isBirthBC: Number(material.identity.isBirthBC),
        birthYear: material.identity.birthYear,
        birthMonth: material.identity.birthMonth,
        birthDay: material.identity.birthDay,
        gender: material.identity.gender,
        suiteId: 1,
      },
      signals,
    );
    const code = encodeShieldedReceiveCode({
      identityCommitment: material.identityCommitment,
      ownerCommitment: keys.ownerCommitment,
      viewingKey: keys.viewingKey,
      proof: generated.raw,
    });
    // The payer holds only the code and checks its proof as the browser does.
    const decoded = decodeShieldedReceiveCode(code);
    assert.ok(
      verifyProof(root, files, decoded.proof, decoded.publicSignals),
      "Receive code proof did not verify",
    );
    receiveCode = {
      verificationKeySha256: candidate.manifest.circuits.receiveCode.verificationKeySha256,
      proofSha256: jsonHash(generated.raw),
      verified: true,
    };
    return decoded;
  };
  const encrypt = async (keys, note, encode, commitment) => {
    const payload = encode(note);
    let opened;
    try {
      const ciphertext = await encryptShieldedNote({
        recipientPublicKey: keys.viewingKey,
        payload,
        chainId,
        poolAddress,
      });
      const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
      const noteCommitment = commitment(ciphertextHashField);
      opened = await decryptShieldedNote({
        ciphertext,
        hpkeIkm: keys.hpkeIkm,
        chainId,
        poolAddress,
      });
      assert.deepEqual(opened, payload, "Encrypted note did not round trip");
      verifyShieldedNotePayload({ payload: opened, ciphertext, noteCommitment });
      return {
        ...note,
        ciphertext,
        ciphertextHex: hexlify(ciphertext),
        ciphertextHashField,
        commitment: noteCommitment,
        keys,
      };
    } finally {
      wipeBytes(payload);
      wipeBytes(opened);
    }
  };
  const valueNote = (keys, amount) => {
    const note = {
      ownerCommitment: keys.ownerCommitment,
      amount,
      nonce: generateShieldedRandomField(),
    };
    return encrypt(keys, note, encodeShieldedValueNotePayload, (ciphertextHashField) =>
      computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }),
    );
  };
  const outputs = (notes) => ({
    outputCommitments: notes.map((note) => note.commitment),
    outputCiphertexts: notes.map((note) => note.ciphertextHex),
  });
  const spend = (note) =>
    computeShieldedSpendNullifier({
      ownerSecret: note.keys.ownerSecret,
      noteCommitment: note.commitment,
    });
  const dummySpend = (note) =>
    computeShieldedDummyInputNullifier({
      ownerSecret: note.keys.ownerSecret,
      noteCommitment: note.commitment,
    });
  const submit = async (
    action,
    data,
    generated,
    notes,
    external = {},
    label = `shielded-action-${action}`,
  ) => {
    const args =
      action === "shield"
        ? [external.amount, data, generated.encoded]
        : action === "unshield"
          ? [external.recipient, external.amount, data, generated.encoded]
          : [data, generated.encoded];
    const receipt = await record(label, await pool[action](...args));
    if (action === "shield") firstShieldBlock = receipt.blockNumber;
    const events = receipt.logs
      .filter((log) => getAddress(log.address) === getAddress(poolAddress))
      .map((log) => {
        try {
          return pool.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter((event) => event?.name === "NoteAppended");
    assert.equal(events.length, 2, `${action} did not append two notes`);
    for (const [index, note] of notes.entries()) {
      assert.equal(
        events[index].args.commitment,
        note.commitment,
        `${action} output commitment differs`,
      );
      assert.equal(
        events[index].args.ciphertext.toLowerCase(),
        note.ciphertextHex.toLowerCase(),
        `${action} output ciphertext differs`,
      );
      note.shardId = events[index].args.shardId;
      note.leafIndex = events[index].args.leafIndex;
      journal.set(note.commitment, note);
      assert.equal(await pool.commitmentExists(note.commitment), true);
    }
    for (const nullifier of data.inputNullifiers) {
      if (nullifier !== 0n) assert.equal(await pool.nullifierSpent(nullifier), true);
    }
    return receipt;
  };
  const notePath = async (note) => {
    const proof = await pool.getNoteMerkleProof(note.shardId, note.leafIndex);
    assert.equal(proof.leaf, note.commitment, "Pool note path points to another commitment");
    return { ...compactPath(proof, 32), shardId: note.shardId };
  };
  const inputs = (paths, nullifiers) => ({
    inputShardIds: paths.map((item) => item.shardId),
    inputRoots: paths.map((item) => item.root),
    inputNullifiers: nullifiers,
  });
  const publicInputsFor = (action, data, external = {}) =>
    buildShieldedPoolPublicInputs({
      action: ACTION_IDS[action],
      chainId,
      poolAddress,
      ...data,
      ...external,
    });
  const donorWitness = (note, membership) => ({
    donorOwnerSecret: String(note.keys.ownerSecret),
    donorAmount: String(note.amount),
    donorNonce: String(note.nonce),
    donorCiphertextHash: String(note.ciphertextHashField),
    donorDepth: membership.depth,
    donorIndex: membership.index,
    donorSiblings: membership.siblings,
  });

  try {
    for (const identity of [person, father, mother]) {
      materials.push(
        await deriveIdentityMaterial({
          identity,
          rawPassphrase: identity.passphrase,
          identitySuiteId: 1,
        }),
      );
    }
    const [childMaterial, fatherMaterial, motherMaterial] = materials;
    assert.equal(
      childMaterial.personHash.toLowerCase(),
      personResult.personHash.toLowerCase(),
      "Acceptance person differs from the shielded heir",
    );
    assert.equal(childMaterial.identityCommitment, BigInt(personResult.identityCommitment));
    assert.equal(
      BigInt(await family.endorsedVersionIndex(childMaterial.personHash, signerAddress)),
      1n,
      "Shielded smoke requires the current child endorsement",
    );
    assert.equal(
      personResult.metadata.parents.father.personHash.toLowerCase(),
      fatherMaterial.personHash.toLowerCase(),
    );
    assert.equal(
      personResult.metadata.parents.mother.personHash.toLowerCase(),
      motherMaterial.personHash.toLowerCase(),
    );
    if ((await family.personVersionsCount(fatherMaterial.personHash)) === 0n) {
      const result = await addPersonVersion({
        deepFamily: family,
        signer,
        personData: father,
        versionContent: { tag: "shielded-acceptance-root", biography: "Acceptance policy root" },
        proofArtifacts,
      });
      await record("shielded-add-father-person", result.tx);
      assert.equal(result.identityCommitment, fatherMaterial.identityCommitment);
    }
    const [trustedExists, trustedLeafIndex] = await lineage.trustedLeafIndex(
      fatherMaterial.personHash,
      1,
      signerAddress,
    );
    assert.equal(trustedExists, true, "Policy root does not trust the acceptance endorser");
    const [endorsementExists, endorsementLeafIndex] = await lineage.endorsementLeafIndex(
      childMaterial.personHash,
      signerAddress,
    );
    assert.equal(endorsementExists, true, "Child endorsement is absent from lineage");
    const endorsements = await family.queryFilter(
      family.filters.PersonVersionEndorsed(childMaterial.personHash, signerAddress),
      personResult.receipt.blockNumber,
      "latest",
    );
    const endorsed = endorsements.filter((event) => event.args.versionIndex === 1n).at(-1);
    assert.ok(endorsed, "Child endorsement timestamp is unavailable");
    const writtenAt = endorsed.args.timestamp;
    const endorsementProof = await lineage.getMerkleProof(0, endorsementLeafIndex);
    const trustedProof = await lineage.getMerkleProof(1, trustedLeafIndex);
    const parentsDigest = computeLineageParentsDigest({
      fatherIdentityCommitment: fatherMaterial.identityCommitment,
      motherIdentityCommitment: motherMaterial.identityCommitment,
    });
    assert.equal(
      endorsementProof.leaf,
      computeLineageEndorsementLeaf({
        identityCommitment: childMaterial.identityCommitment,
        parentsDigest,
        versionIndex: 1n,
        endorser: signerAddress,
        writtenAt,
      }),
    );
    assert.equal(
      trustedProof.leaf,
      computeLineageTrustedLeaf({
        rootIdentityCommitment: fatherMaterial.identityCommitment,
        rootVersionIndex: 1n,
        account: signerAddress,
      }),
    );
    const endorsement = compactPath(endorsementProof, 64);
    const trusted = compactPath(trustedProof, 64);
    const lineageWitness = {
      fatherIdentityCommitment: String(fatherMaterial.identityCommitment),
      motherIdentityCommitment: String(motherMaterial.identityCommitment),
      rootVersionIndex: "1",
      rootIsMother: "0",
      endorser: String(BigInt(signerAddress)),
      writtenAt: String(writtenAt),
      endorsementDepth: endorsement.depth,
      endorsementIndex: endorsement.index,
      endorsementSiblings: endorsement.siblings,
      trustedDepth: trusted.depth,
      trustedIndex: trusted.index,
      trustedSiblings: trusted.siblings,
    };
    const childKeys = await keysFor(childMaterial);
    const donorKeys = await keysFor(fatherMaterial);
    const recipient = receiveCodeFor(childMaterial, childKeys);
    // Notes for the heir use the code's keys; the heir still spends with its own secret.
    const heirKeys = {
      ...childKeys,
      ownerCommitment: recipient.ownerCommitment,
      viewingKey: recipient.viewingKey,
    };
    const rate = 100n;
    const shieldedAmount = 2000n;
    const unshieldedAmount = 100n;
    const totalShieldedBefore = await pool.totalShielded();
    const totalPublicBefore = await pool.totalPublicBudget();
    const publicFundedAmount = 1500n;
    const poolTokenBefore = await token.balanceOf(poolAddress);
    const signerTokenBefore = await token.balanceOf(signerAddress);
    assert.ok(
      signerTokenBefore >= shieldedAmount + publicFundedAmount,
      "Acceptance signer has insufficient DEEP to fund both budget paths",
    );
    await record(
      "shielded-token-approve",
      await token.approve(poolAddress, shieldedAmount + publicFundedAmount),
    );
    // Public funding needs the child's identity hash and existing public family facts only.
    const publicFunding = {
      budgetId: 0n,
      rootPersonHash: fatherMaterial.personHash,
      rootVersionIndex: 1n,
      heirPersonHash: childMaterial.personHash,
      amountPerPeriod: rate,
      budgetPeriods: 12n,
      heirVersionIndex: 1n,
      endorser: signerAddress,
    };
    const publicReceipt = await record("public-budget-fund", await pool.fundPublic(publicFunding));
    const publicBudgetId = await pool.publicBudgetCount();
    const publicRowBefore = await pool.publicBudgets(publicBudgetId);
    const publicBlock = await provider.getBlock(publicReceipt.blockNumber);
    assert.equal(publicRowBefore.eligibleFrom, BigInt(publicBlock.timestamp) + 7200n);
    await record(
      "public-budget-top-up",
      await pool.fundPublic({
        ...publicFunding,
        budgetId: publicBudgetId,
        budgetPeriods: 3n,
        heirVersionIndex: 0n,
        endorser: "0x0000000000000000000000000000000000000000",
      }),
    );
    const publicRow = await pool.publicBudgets(publicBudgetId);
    assert.equal(
      publicRow.eligibleFrom,
      publicRowBefore.eligibleFrom,
      "Public top-up reset maturity",
    );
    assert.equal(publicRow.remaining, publicFundedAmount);
    assert.equal(publicRow.nextPeriod, 0n);
    const publicOutputs = await Promise.all([
      valueNote(childKeys, 1200n),
      valueNote(childKeys, 0n),
    ]);
    const publicInputs = buildShieldedPublicClaimPublicInputs({
      chainId,
      poolAddress,
      budgetId: publicBudgetId,
      heirIdentityCommitment: childMaterial.identityCommitment,
      firstPeriod: 0n,
      claimCount: 12n,
      amount: 1200n,
      ...outputs(publicOutputs),
    });
    await prove(
      "claimPublic",
      {
        ...publicInputs.witness,
        nameField: String(childMaterial.nameField),
        derivedSecretField: String(childMaterial.derivedSecretField),
        isBirthBC: Number(childMaterial.identity.isBirthBC),
        birthYear: childMaterial.identity.birthYear,
        birthMonth: childMaterial.identity.birthMonth,
        birthDay: childMaterial.identity.birthDay,
        gender: childMaterial.identity.gender,
        suiteId: 1,
        outputNonces: decimals(publicOutputs.map((note) => note.nonce)),
      },
      publicInputs.signals,
      { execution: "verifier-call", claimCount: 12 },
    );
    assert.equal(await pool.commitmentExists(publicOutputs[0].commitment), false);
    const initial = await Promise.all([
      valueNote(donorKeys, shieldedAmount),
      valueNote(donorKeys, 0n),
    ]);
    const shieldData = { ...zeroData(), ...outputs(initial) };
    const shieldInputs = publicInputsFor("shield", shieldData, { amount: shieldedAmount });
    const shieldProof = await prove(
      "shield",
      {
        ...shieldInputs.witness,
        ownerSecret: String(donorKeys.ownerSecret),
        outputAmounts: decimals(initial.map((note) => note.amount)),
        outputNonces: decimals(initial.map((note) => note.nonce)),
      },
      shieldInputs.signals,
    );
    await submit("shield", shieldData, shieldProof, initial, { amount: shieldedAmount });

    const rootIdentityCommitment = fatherMaterial.identityCommitment;
    const policySalt = generateShieldedRandomField();
    const allocationKey = generateShieldedRandomField();
    const allocationKeyCommitment = computeShieldedAllocationKeyCommitment(allocationKey);
    const policyFields = {
      rootIdentityCommitment,
      rootVersionIndex: 1n,
      amountPerPeriod: rate,
      policySalt,
      allocationKeyCommitment,
    };
    const policyCommitment = computeShieldedPolicyCommitment(policyFields);
    const asOf = BigInt((await provider.getBlock("latest")).timestamp);
    const eligibleFrom = asOf + 7200n;
    const enrollmentSalt = generateShieldedRandomField();
    const heirIdentityCommitment = recipient.identityCommitment;
    const heirOwnerCommitment = recipient.ownerCommitment;
    const enrollmentCommitment = computeShieldedEnrollmentCommitment({
      policyCommitment,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
    });
    const budgetFields = {
      ...policyFields,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
      heirOwnerCommitment,
    };
    const budgetNote = (remaining) => {
      const note = { ...budgetFields, remaining, nonce: generateShieldedRandomField() };
      return encrypt(heirKeys, note, encodeShieldedBudgetNotePayload, (ciphertextHashField) =>
        computeShieldedBudgetNoteCommitment({
          policyCommitment,
          enrollmentCommitment,
          ...note,
          ciphertextHashField,
        }),
      );
    };
    const budget = await budgetNote(1200n);
    const allocationChange = await valueNote(donorKeys, 800n);
    const initialPath = await notePath(initial[0]);
    const allocationData = {
      ...zeroData(),
      ...inputs(
        [initialPath, initialPath],
        [
          spend(initial[0]),
          computeShieldedEnrollmentNullifier({
            allocationKey,
            policyCommitment,
            heirIdentityCommitment,
          }),
        ],
      ),
      ...outputs([budget, allocationChange]),
      relation0: endorsement.root,
      relation1: trusted.root,
      asOf,
    };
    const allocationInputs = publicInputsFor("fund", allocationData);
    const commonFunding = {
      rootIdentityCommitment: String(rootIdentityCommitment),
      rootVersionIndex: "1",
      rate: String(rate),
      policySalt: String(policySalt),
      heirIdentityCommitment: String(heirIdentityCommitment),
      heirOwnerCommitment: String(heirOwnerCommitment),
      eligibleFrom: String(eligibleFrom),
      enrollmentSalt: String(enrollmentSalt),
    };
    const allocationProof = await prove(
      "fund",
      {
        ...commonFunding,
        ...lineageWitness,
        ...donorWitness(initial[0], initialPath),
        ...allocationInputs.witness,
        allocationKeyCommitment: String(allocationKeyCommitment),
        oldBudgetRemaining: "0",
        oldBudgetRemainingPeriods: "0",
        oldBudgetNonce: "0",
        oldBudgetCiphertextHash: "0",
        oldBudgetDepth: "0",
        oldBudgetIndex: "0",
        oldBudgetSiblings: Array(32).fill("0"),
        budgetUseNonce: "0",
        allocationKey: String(allocationKey),
        heirVersionIndex: "1",
        budgetPeriods: "12",
        budgetNonce: String(budget.nonce),
        changeNonce: String(allocationChange.nonce),
      },
      allocationInputs.signals,
      { asOf: String(asOf) },
    );
    await submit("fund", allocationData, allocationProof, [budget, allocationChange]);

    const topUpBudget = await budgetNote(300n);
    const topUpChange = await valueNote(donorKeys, 500n);
    const changePath = await notePath(allocationChange);
    const budgetPath = await notePath(budget);
    const useNonce = generateShieldedRandomField();
    const topUpData = {
      ...zeroData(),
      fundMode: 1n,
      ...inputs(
        [changePath, budgetPath],
        [
          spend(allocationChange),
          computeShieldedTopUpUseNullifier({
            policySalt,
            budgetNoteCommitment: budget.commitment,
            useNonce,
          }),
        ],
      ),
      ...outputs([topUpBudget, topUpChange]),
    };
    const topUpInputs = publicInputsFor("fund", topUpData);
    const topUpProof = await prove(
      "fund",
      {
        ...commonFunding,
        ...donorWitness(allocationChange, changePath),
        ...topUpInputs.witness,
        allocationKeyCommitment: String(allocationKeyCommitment),
        oldBudgetRemaining: "1200",
        oldBudgetRemainingPeriods: "12",
        oldBudgetNonce: String(budget.nonce),
        oldBudgetCiphertextHash: String(budget.ciphertextHashField),
        oldBudgetDepth: budgetPath.depth,
        oldBudgetIndex: budgetPath.index,
        oldBudgetSiblings: budgetPath.siblings,
        budgetUseNonce: String(useNonce),
        allocationKey: "0",
        heirVersionIndex: "0",
        fatherIdentityCommitment: "0",
        motherIdentityCommitment: "0",
        rootIsMother: "0",
        endorser: "0",
        writtenAt: "0",
        endorsementDepth: "0",
        endorsementIndex: "0",
        endorsementSiblings: Array(64).fill("0"),
        trustedDepth: "0",
        trustedIndex: "0",
        trustedSiblings: Array(64).fill("0"),
        budgetPeriods: "3",
        budgetNonce: String(topUpBudget.nonce),
        changeNonce: String(topUpChange.nonce),
      },
      topUpInputs.signals,
      { label: "shielded-action-fund-additional" },
    );
    await submit(
      "fund",
      topUpData,
      topUpProof,
      [topUpBudget, topUpChange],
      {},
      "shielded-action-fund-additional",
    );
    assert.equal(
      await pool.nullifierSpent(spend(budget)),
      false,
      "Top-up spent its read-only template",
    );

    const claimAsOf = eligibleFrom + 12n * PERIOD;
    const remainingBudget = await budgetNote(300n);
    const payout = await valueNote(childKeys, 1200n);
    const claimPaths = await Promise.all([notePath(budget), notePath(topUpBudget)]);
    const [budgetClaimPath, secondClaimPath] = claimPaths;
    const claimData = {
      ...zeroData(),
      ...inputs(claimPaths, [spend(budget), spend(topUpBudget)]),
      periodNullifiers: Array.from({ length: 12 }, (_, periodIndex) =>
        computeShieldedPeriodNullifier({
          derivedSecretField: childMaterial.derivedSecretField,
          policyCommitment,
          periodIndex,
        }),
      ),
      ...outputs([remainingBudget, payout]),
      relation0: endorsement.root,
      relation1: trusted.root,
      asOf: claimAsOf,
    };
    const claimInputs = publicInputsFor("claim", claimData);
    await prove(
      "claim",
      {
        ...claimInputs.witness,
        ...lineageWitness,
        nameField: String(childMaterial.nameField),
        derivedSecretField: String(childMaterial.derivedSecretField),
        isBirthBC: Number(childMaterial.identity.isBirthBC),
        birthYear: childMaterial.identity.birthYear,
        birthMonth: childMaterial.identity.birthMonth,
        birthDay: childMaterial.identity.birthDay,
        gender: childMaterial.identity.gender,
        suiteId: 1,
        versionIndex: "1",
        policySalt: String(policySalt),
        allocationKeyCommitment: String(allocationKeyCommitment),
        enrollmentSalt: String(enrollmentSalt),
        eligibleFrom: String(eligibleFrom),
        rate: String(rate),
        hasSecondInput: "1",
        remaining: "1200",
        remainingPeriods: "12",
        budgetNonce: String(budget.nonce),
        budgetCiphertextHash: String(budget.ciphertextHashField),
        noteDepth: budgetClaimPath.depth,
        noteIndex: budgetClaimPath.index,
        noteSiblings: budgetClaimPath.siblings,
        secondRemaining: "300",
        secondRemainingPeriods: "3",
        secondBudgetNonce: String(topUpBudget.nonce),
        secondBudgetCiphertextHash: String(topUpBudget.ciphertextHashField),
        secondNoteDepth: secondClaimPath.depth,
        secondNoteIndex: secondClaimPath.index,
        secondNoteSiblings: secondClaimPath.siblings,
        claimCount: "12",
        periodIndices: Array.from({ length: 12 }, (_, index) => String(index)),
        newBudgetNonce: String(remainingBudget.nonce),
        payoutNonce: String(payout.nonce),
      },
      claimInputs.signals,
      { execution: "verifier-call", claimCount: 12, asOf: String(claimAsOf) },
    );
    assert.equal(
      await pool.nullifierSpent(spend(budget)),
      false,
      "Verifier-only claim changed pool state",
    );
    assert.equal(
      await pool.commitmentExists(payout.commitment),
      false,
      "Verifier-only claim emitted a payout",
    );

    const transferOutputs = await Promise.all([
      valueNote(heirKeys, 400n),
      valueNote(donorKeys, 100n),
    ]);
    const transferPath = await notePath(topUpChange);
    const transferData = {
      ...zeroData(),
      ...inputs([transferPath, transferPath], [spend(topUpChange), dummySpend(topUpChange)]),
      ...outputs(transferOutputs),
    };
    const transferInputs = publicInputsFor("privateTransfer", transferData);
    const transferProof = await prove(
      "privateTransfer",
      {
        ...transferInputs.witness,
        hasSecondInput: "0",
        inputOwnerSecrets: [String(donorKeys.ownerSecret), "0"],
        inputAmounts: ["500", "0"],
        inputNonces: [String(topUpChange.nonce), "0"],
        inputCiphertextHashes: [String(topUpChange.ciphertextHashField), "0"],
        inputDepths: [transferPath.depth, "0"],
        inputIndices: [transferPath.index, "0"],
        inputSiblings: [transferPath.siblings, Array(32).fill("0")],
        outputOwnerCommitments: decimals(transferOutputs.map((note) => note.ownerCommitment)),
        outputAmounts: decimals(transferOutputs.map((note) => note.amount)),
        outputNonces: decimals(transferOutputs.map((note) => note.nonce)),
      },
      transferInputs.signals,
    );
    await submit("privateTransfer", transferData, transferProof, transferOutputs);

    const unshieldSource = transferOutputs[0];
    const unshieldOutputs = await Promise.all([
      valueNote(childKeys, 300n),
      valueNote(childKeys, 0n),
    ]);
    const unshieldPath = await notePath(unshieldSource);
    const unshieldData = {
      ...zeroData(),
      ...inputs([unshieldPath, unshieldPath], [spend(unshieldSource), dummySpend(unshieldSource)]),
      ...outputs(unshieldOutputs),
    };
    const unshieldInputs = publicInputsFor("unshield", unshieldData, {
      amount: unshieldedAmount,
      recipient: signerAddress,
    });
    const unshieldProof = await prove(
      "unshield",
      {
        ...unshieldInputs.witness,
        ownerSecret: String(childKeys.ownerSecret),
        inputAmount: "400",
        inputNonce: String(unshieldSource.nonce),
        inputCiphertextHash: String(unshieldSource.ciphertextHashField),
        noteDepth: unshieldPath.depth,
        noteIndex: unshieldPath.index,
        noteSiblings: unshieldPath.siblings,
        changeAmount: "300",
        changeNonce: String(unshieldOutputs[0].nonce),
        dummyNonce: String(unshieldOutputs[1].nonce),
      },
      unshieldInputs.signals,
    );
    await submit("unshield", unshieldData, unshieldProof, unshieldOutputs, {
      amount: unshieldedAmount,
      recipient: signerAddress,
    });

    const totalShieldedAfter = await pool.totalShielded();
    const totalPublicAfter = await pool.totalPublicBudget();
    const poolTokenAfter = await token.balanceOf(poolAddress);
    const signerTokenAfter = await token.balanceOf(signerAddress);
    assert.equal(totalShieldedAfter - totalShieldedBefore, shieldedAmount - unshieldedAmount);
    assert.equal(totalPublicAfter - totalPublicBefore, publicFundedAmount);
    assert.equal(
      poolTokenAfter - poolTokenBefore,
      shieldedAmount - unshieldedAmount + publicFundedAmount,
    );
    assert.equal(
      signerTokenBefore - signerTokenAfter,
      shieldedAmount - unshieldedAmount + publicFundedAmount,
    );
    assert.ok(
      poolTokenAfter >= totalShieldedAfter + totalPublicAfter,
      "Pool custody does not cover both liabilities",
    );
    const noteEvents = await pool.queryFilter(
      pool.filters.NoteAppended(),
      firstShieldBlock,
      "latest",
    );
    let recoveredNotes = 0;
    for (const event of noteEvents) {
      const local = journal.get(event.args.commitment);
      if (!local) continue;
      let recovered;
      try {
        recovered = await decryptShieldedNote({
          ciphertext: getBytes(event.args.ciphertext),
          hpkeIkm: local.keys.hpkeIkm,
          chainId,
          poolAddress,
        });
        verifyShieldedNotePayload({
          payload: recovered,
          ciphertext: event.args.ciphertext,
          noteCommitment: event.args.commitment,
        });
        recoveredNotes += 1;
      } finally {
        wipeBytes(recovered);
      }
    }
    assert.equal(recoveredNotes, journal.size, "Public event recovery lost an appended note");
    assert.equal(Object.keys(proofs).length, Object.keys(SHIELDED_DEPLOYMENT_CIRCUITS).length);
    const finalCandidate = loadCandidateArtifacts({ root });
    assert.equal(
      finalCandidate.candidateManifestSha256,
      candidate.candidateManifestSha256,
      "Shielded public artifact manifest changed during acceptance",
    );
    return {
      status: "passed",
      manifestSha256: candidate.candidateManifestSha256,
      proofs,
      scenario: {
        allocationLabel: "shielded-action-fund",
        claimExecution: "verifier-call",
        claimCount: 12,
        claimAsOf: String(claimAsOf),
        eligibleFrom: String(eligibleFrom),
        lineageDepth: Math.max(Number(endorsement.depth), Number(trusted.depth)),
        endorsementDepth: Number(endorsement.depth),
        trustedDepth: Number(trusted.depth),
        noteDepth: Math.max(Number(budgetClaimPath.depth), Number(secondClaimPath.depth)),
        receiveCode,
        publicBudget: {
          fundingLabel: "public-budget-fund",
          topUpLabel: "public-budget-top-up",
          budgetId: String(publicBudgetId),
          heirPersonHash: childMaterial.personHash,
          amountPerPeriod: String(rate),
          eligibleFrom: String(publicRow.eligibleFrom),
          remaining: String(publicRow.remaining),
          nextPeriod: String(publicRow.nextPeriod),
          fundingTimestamp: String(publicBlock.timestamp),
          claimExecution: "verifier-call",
          claimCount: 12,
        },
        shieldedAmount: String(shieldedAmount),
        unshieldedAmount: String(unshieldedAmount),
        totalShieldedBefore: String(totalShieldedBefore),
        totalShieldedAfter: String(totalShieldedAfter),
        totalPublicBefore: String(totalPublicBefore),
        totalPublicAfter: String(totalPublicAfter),
        poolTokenBefore: String(poolTokenBefore),
        poolTokenAfter: String(poolTokenAfter),
        recoveredNotes,
        recoveryEventCount: noteEvents.length,
        transactionLabels: recorded,
      },
    };
  } finally {
    for (const material of materials) {
      wipeBytes(material.identitySalt);
      wipeBytes(material.derivedSecretBytes);
    }
    for (const keys of keyMaterials) wipeBytes(keys.hpkeIkm);
    journal.clear();
  }
}
