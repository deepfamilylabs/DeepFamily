import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, getBytes, hexlify } from "ethers";
import {
  SECONDS_PER_DAY,
  SHIELDED_RECEIVE_CREDENTIAL_VERSION,
  buildShieldedPoolPublicInputs,
  buildShieldedReceiveCredentialPublicSignals,
  computeShieldedAuthorizationAlias,
  computeShieldedReceiveActionHash,
  emptyShieldedReceiveAuthorizations,
  verifyShieldedIdentityAuthorizationWitness,
  prepareShieldedReceivePresentation,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedAllocationKeyCommitment,
  computeShieldedBudgetNoteCommitment,
  computeShieldedIdentityBudgetNoteCommitment,
  computeShieldedIdentityBudgetTermsCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifierForSlot,
  computeShieldedEnrollmentCommitment,
  computeShieldedEnrollmentNullifier,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  computeShieldedBudgetUseNullifier,
  computeShieldedValueNoteCommitment,
  decodeShieldedReceiveCredential,
  decodePublicShieldedBudgetEnvelope,
  encodePublicShieldedBudgetEnvelope,
  decryptShieldedNote,
  deriveIdentityMaterial,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  splitShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encodeShieldedReceiveCredential,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  wipeBytes,
  encodeGroth16AbcProofData,
  normalizeGroth16Proof,
} from "@deepfamily/protocol-core";
import { addPersonVersion } from "../../lib/seedHelpers.js";
import { loadCandidateArtifacts } from "./shieldedArtifacts.mjs";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "./zkDeploymentCatalog.mjs";

const DEFAULT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const PERIOD_DAYS = 7n;
const PERIOD = PERIOD_DAYS * SECONDS_PER_DAY;
const ACTION_IDS = Object.fromEntries(
  Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [action, spec.actionId]),
);
const jsonHash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const decimals = (values) => values.map(String);
const zeroData = () => ({
  inputShardIds: [0n, 0n],
  inputRoots: [0n, 0n],
  inputNullifiers: [0n, 0n],
  periodNullifiers: Array(3).fill(0n),
  outputCommitments: [0n, 0n],
  outputCiphertexts: ["0x", "0x"],
  relation0: 0n,
  relation1: 0n,
  asOf: 0n,
  lineageCheckpointId: 0n,
  fundMode: 0n,
  budgetKind: 0n,
  receiveAuthorizations: emptyShieldedReceiveAuthorizations(),
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
 * pays the heir from the heir's receive code alone. A new fund cannot mature in
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
  const pool = deployed.shieldedErc20Pool.connect(signer);
  const poolAddress = await pool.getAddress();
  const scope = { chainId, poolAddress };
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
    if (action === "fund" && BigInt(witness.fundMode) === 1n) action = "fundContinuation";
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
    if (action === "claim" && !proofs.claim32 && Number(witness.endorsementDepth) <= 32 && Number(witness.trustedDepth) <= 32) {
      await prove("claim32", { ...witness, endorsementSiblings: witness.endorsementSiblings.slice(0, 32), trustedSiblings: witness.trustedSiblings.slice(0, 32) }, publicSignals, { execution, ...extra });
    }
    return { ...generated, evidence: metadata };
  };
  const keysFor = async (material) => {
    const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
    keyMaterials.push(keys);
    return { ...keys, viewingKey: await deriveShieldedViewPublicKey(keys.hpkeIkm) };
  };
  const loadAuthorizationWitness = async (alias) => {
    const contract = deployed.identityAuthorizationState;
    assert.ok(contract, "Integrated deployment has no shared authorization state");
    const block = await provider.getBlock("latest");
    assert.ok(block?.hash, "Authorization checkpoint block is unavailable");
    const overrides = { blockTag: block.number };
    const [stateRoot, checkpointId, proof] = await Promise.all([
      contract.currentRoot(overrides), contract.currentCheckpointId(overrides),
      contract.getCounterProof(alias, overrides),
    ]);
    assert.equal(typeof proof.isOld0, "boolean", "Authorization empty flag is not canonical");
    assert.equal(typeof proof.absent, "boolean", "Authorization absent flag is not canonical");
    const authorizationWitness = verifyShieldedIdentityAuthorizationWitness({
      authorizationAlias: alias, authorizationCounter: proof.authorizationCounter,
      stateRoot: proof.stateRoot, depth: proof.depth, siblings: Array.from(proof.siblings),
      oldKey: proof.oldKey, oldValue: proof.oldValue,
      isOld0: proof.isOld0 ? 1n : 0n, absent: proof.absent ? 1n : 0n,
    }, stateRoot, alias);
    const checkpoint = await contract.getCheckpoint(checkpointId, overrides);
    assert.equal(BigInt(checkpoint.root), BigInt(stateRoot), "Authorization checkpoint root differs");
    assert.ok(BigInt(checkpoint.createdAt) <= BigInt(block.timestamp), "Authorization checkpoint is future-dated");
    assert.equal(BigInt(checkpoint.retiredAt), 0n, "Current authorization checkpoint is retired");
    assert.equal((await provider.getBlock(block.number))?.hash, block.hash, "Authorization checkpoint reorganized");
    return {
      authorizationWitness,
      authorizationStateRoot: stateRoot,
      checkpointId,
      asOf: BigInt(block.timestamp),
    };
  };
  const receiveCodeFor = async (material, keys, disclosure = "fund") => {
    const action = disclosure === "fund" ? "fundReceiveCredential" : "anonymousReceiveCredential";
    const files = candidate.circuits[action];
    const alias = computeShieldedAuthorizationAlias(material);
    const checkpoint = await loadAuthorizationWitness(alias);
    const statement = {
      disclosure,
      ...(disclosure === "fund" ? { identityCommitment: material.identityCommitment } : {}),
      authorizationAlias: alias,
      authorizationCounter: checkpoint.authorizationWitness.authorizationCounter,
      expiresAt: checkpoint.asOf + 86400n,
      ownerCommitment: keys.ownerCommitment,
      viewingKey: keys.viewingKey,
    };
    const signals = buildShieldedReceiveCredentialPublicSignals(statement);
    const view = splitShieldedViewPublicKey(keys.viewingKey);
    const generated = generateProof(
      root,
      files,
      {
        identityCommitment: String(material.identityCommitment),
        authorizationCounter: String(statement.authorizationCounter),
        expiresAt: String(statement.expiresAt),
        ownerCommitment: String(keys.ownerCommitment),
        viewKeyLo: String(view.viewKeyLo),
        viewKeyHi: String(view.viewKeyHi),
        keyMode: "0",
        identitySuiteId: "1",
        independentKeySuiteId: "1",
        independentKeyDerivationVersion: "1",
        receiveCodeVersion: String(SHIELDED_RECEIVE_CREDENTIAL_VERSION),
        spendingSecret: String(keys.ownerSecret),
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
    const code = encodeShieldedReceiveCredential({
      ...statement,
      proof: generated.raw,
    });
    // The payer holds only the code and checks its proof as the browser does.
    const decoded = decodeShieldedReceiveCredential(code);
    assert.ok(
      verifyProof(root, files, decoded.proof, decoded.publicSignals),
      "Receive code proof did not verify",
    );
    receiveCode = {
      verificationKeySha256: candidate.manifest.circuits[action].verificationKeySha256,
      proofSha256: jsonHash(generated.raw),
      verified: true,
    };
    return decoded;
  };
  const authorizeReceivers = async (action, data, credentials) => {
    const hash = computeShieldedReceiveActionHash(data);
    const fields =
      action === "fund"
        ? { receiveAuthorizationAlias: "0", receiveSalt: "0" }
        : {
            receiveAuthorizationAliases: ["0", "0"],
            receiveSalts: ["0", "0"],
            receiveKeyModes: ["0", "0"],
            receiveViewKeyLo: ["0", "0"],
            receiveViewKeyHi: ["0", "0"],
          };
    for (const [slot, credential] of credentials.entries()) {
      if (!credential) continue;
      const checkpoint = await loadAuthorizationWitness(credential.authorizationAlias);
      const salt = generateShieldedRandomField();
      const prepared = prepareShieldedReceivePresentation({
        credential,
        salt,
        ...checkpoint,
        chainId,
        consumer: poolAddress,
        action: action === "fund" ? 3 : 4,
        messageId: slot,
        payloadHash: hash,
      });
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-acceptance-"));
      let result;
      try {
        const input = path.join(temporary, "input.json"),
          output = path.join(temporary, "proof.json");
        fs.writeFileSync(input, JSON.stringify(prepared.request), { mode: 0o600 });
        execFileSync(
          process.execPath,
          [path.join(root, "scripts/lib/receiveProofs.mjs"), "--input", input, "--output", output],
          { cwd: root, stdio: "pipe", timeout: 600000, maxBuffer: 1024 * 1024 },
        );
        result = JSON.parse(fs.readFileSync(output, "utf8"));
        assert.equal(result.verified, true);
        assert.deepEqual(result.publicSignals, prepared.publicSignals.map(String));
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
      data.receiveAuthorizations[slot] = {
        checkpointId: checkpoint.checkpointId,
        asOf: checkpoint.asOf,
        expiresAt: credential.expiresAt,
        recipientBinding: prepared.recipientBinding,
        proof: result.solidityProof,
      };
      if (action === "fund")
        Object.assign(fields, {
          receiveAuthorizationAlias: String(credential.authorizationAlias),
          receiveSalt: String(salt),
        });
      else {
        const view = splitShieldedViewPublicKey(credential.viewingKey);
        fields.receiveAuthorizationAliases[slot] = String(credential.authorizationAlias);
        fields.receiveSalts[slot] = String(salt);
        fields.receiveKeyModes[slot] = String(credential.keyMode);
        fields.receiveViewKeyLo[slot] = String(view.viewKeyLo);
        fields.receiveViewKeyHi[slot] = String(view.viewKeyHi);
      }
    }
    return fields;
  };
  const encrypt = async (keys, note, encode, commitment) => {
    const noteScope = { ...scope, viewingKey: keys.viewingKey };
    const payload = encode(note, noteScope);
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
      verifyShieldedNotePayload({ payload: opened, ciphertext, noteCommitment }, noteScope);
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
      computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }, scope),
    );
  };
  const outputs = (notes) => ({
    outputCommitments: notes.map((note) => note.commitment),
    outputCiphertexts: notes.map((note) => note.ciphertextHex),
  });
  const spend = (note) =>
    computeShieldedSpendNullifier(
      {
        ownerSecret: note.keys.ownerSecret,
        noteCommitment: note.commitment,
      },
      scope,
    );
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
    const lineageBlock = await provider.getBlock("latest");
    const lineageOverrides = { blockTag: lineageBlock.number };
    const [endorsementProof, trustedProof, lineageCheckpointId] = await Promise.all([
      lineage.getMerkleProof(0, endorsementLeafIndex, lineageOverrides),
      lineage.getMerkleProof(1, trustedLeafIndex, lineageOverrides),
      lineage.currentCheckpointId(lineageOverrides),
    ]);
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
    const recipient = await receiveCodeFor(childMaterial, childKeys);
    // Notes for the heir use the code's keys; the heir still spends with its own secret.
    const heirKeys = {
      ...childKeys,
      ownerCommitment: recipient.ownerCommitment,
      viewingKey: recipient.viewingKey,
    };
    const rate = 100n;
    const shieldedAmount = 3500n;
    const unshieldedAmount = 100n;
    const totalShieldedBefore = await pool.totalShielded();
    const poolTokenBefore = await token.balanceOf(poolAddress);
    const signerTokenBefore = await token.balanceOf(signerAddress);
    assert.ok(signerTokenBefore >= shieldedAmount, "Acceptance signer has insufficient DEEP");
    await record("shielded-token-approve", await token.approve(poolAddress, shieldedAmount));
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
    const allocationKeyCommitment = computeShieldedAllocationKeyCommitment(allocationKey, scope);
    const policyFields = {
      rootIdentityCommitment,
      rootVersionIndex: 1n,
      amountPerPeriod: rate,
      periodDays: PERIOD_DAYS,
      policySalt,
      allocationKeyCommitment,
    };
    const policyCommitment = computeShieldedPolicyCommitment(policyFields, scope);
    const asOf = BigInt(lineageBlock.timestamp);
    const eligibleFrom = asOf + 7200n;
    const enrollmentSalt = generateShieldedRandomField();
    const heirIdentityCommitment = recipient.identityCommitment;
    const heirOwnerCommitment = recipient.ownerCommitment;
    const enrollmentCommitment = computeShieldedEnrollmentCommitment(
      {
        policyCommitment,
        heirIdentityCommitment,
        eligibleFrom,
        enrollmentSalt,
      },
      scope,
    );
    const heirViewLimbs = splitShieldedViewPublicKey(heirKeys.viewingKey);
    const budgetFields = {
      viewingKey: heirKeys.viewingKey,
      keyMode: 0n,
      ...policyFields,
      heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt,
      heirOwnerCommitment,
    };
    const budgetNote = (remaining, budgetOrigin = "fund") => {
      const note = {
        ...budgetFields,
        budgetOrigin,
        remaining,
        nonce: generateShieldedRandomField(),
      };
      return encrypt(heirKeys, note, encodeShieldedBudgetNotePayload, (ciphertextHashField) =>
        computeShieldedBudgetNoteCommitment(
          {
            policyCommitment,
            enrollmentCommitment,
            ...note,
            ciphertextHashField,
          },
          scope,
        ),
      );
    };
    const budget = await budgetNote(1200n);
    const fundChange = await valueNote(donorKeys, 2300n);
    const initialPath = await notePath(initial[0]);
    const fundData = {
      ...zeroData(),
      ...inputs(
        [initialPath, initialPath],
        [
          spend(initial[0]),
          computeShieldedEnrollmentNullifier(
            {
              allocationKey,
              policyCommitment,
              heirIdentityCommitment,
            },
            scope,
          ),
        ],
      ),
      ...outputs([budget, fundChange]),
      relation0: endorsement.root,
      relation1: trusted.root,
      asOf,
      lineageCheckpointId,
    };
    const fundReceiverWitness = await authorizeReceivers("fund", fundData, [recipient]);
    const fundInputs = publicInputsFor("fund", fundData);
    const commonFunding = {
      receiveAuthorizationAlias: "0",
      receiveSalt: "0",
      heirViewKeyLo: String(heirViewLimbs.viewKeyLo),
      heirViewKeyHi: String(heirViewLimbs.viewKeyHi),
      oldBudgetIsClaim: "0",
      keyMode: "0",
      rootIdentityCommitment: String(rootIdentityCommitment),
      rootVersionIndex: "1",
      rate: String(rate),
      periodDays: String(PERIOD_DAYS),
      policySalt: String(policySalt),
      heirIdentityCommitment: String(heirIdentityCommitment),
      heirOwnerCommitment: String(heirOwnerCommitment),
      eligibleFrom: String(eligibleFrom),
      enrollmentSalt: String(enrollmentSalt),
    };
    const fundProof = await prove(
      "fund",
      {
        ...commonFunding,
        ...fundReceiverWitness,
        ...lineageWitness,
        ...donorWitness(initial[0], initialPath),
        ...fundInputs.witness,
        allocationKeyCommitment: String(allocationKeyCommitment),
        oldBudgetKind: "0",
        oldKeyMode: "0",
        oldHeirOwnerCommitment: "0",
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
        changeNonce: String(fundChange.nonce),
      },
      fundInputs.signals,
      { asOf: String(asOf) },
    );
    await submit("fund", fundData, fundProof, [budget, fundChange]);

    const additionalFundingBudget = await budgetNote(300n);
    const additionalFundingChange = await valueNote(donorKeys, 2000n);
    const changePath = await notePath(fundChange);
    const budgetPath = await notePath(budget);
    const useNonce = generateShieldedRandomField();
    const additionalFundingData = {
      ...zeroData(),
      fundMode: 1n,
      ...inputs(
        [changePath, budgetPath],
        [
          spend(fundChange),
          computeShieldedBudgetUseNullifier(
            {
              policySalt,
              budgetNoteCommitment: budget.commitment,
              useNonce,
            },
            scope,
          ),
        ],
      ),
      ...outputs([additionalFundingBudget, additionalFundingChange]),
    };
    const additionalReceiverWitness = await authorizeReceivers("fund", additionalFundingData, [
      recipient,
    ]);
    const additionalFundingInputs = publicInputsFor("fund", additionalFundingData);
    const additionalFundingProof = await prove(
      "fund",
      {
        ...commonFunding,
        ...additionalReceiverWitness,
        ...donorWitness(fundChange, changePath),
        ...additionalFundingInputs.witness,
        allocationKeyCommitment: String(allocationKeyCommitment),
        oldBudgetKind: "0",
        oldKeyMode: "0",
        oldHeirOwnerCommitment: String(heirOwnerCommitment),
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
        budgetNonce: String(additionalFundingBudget.nonce),
        changeNonce: String(additionalFundingChange.nonce),
      },
      additionalFundingInputs.signals,
      { label: "shielded-action-fund-additional" },
    );
    await submit(
      "fund",
      additionalFundingData,
      additionalFundingProof,
      [additionalFundingBudget, additionalFundingChange],
      {},
      "shielded-action-fund-additional",
    );
    assert.equal(
      await pool.nullifierSpent(spend(budget)),
      false,
      "Additional funding spent its read-only template",
    );

    // Public addressing creates a note in the same tree, spending donor VALUE.
    // Only this identity note's fields are public; private rule openings stay local.
    const publicPolicySalt = generateShieldedRandomField();
    const publicAllocationKey = generateShieldedRandomField();
    const publicAllocationKeyCommitment = computeShieldedAllocationKeyCommitment(
      publicAllocationKey,
      scope,
    );
    const publicPolicyCommitment = computeShieldedPolicyCommitment(
      {
        ...policyFields,
        policySalt: publicPolicySalt,
        allocationKeyCommitment: publicAllocationKeyCommitment,
      },
      scope,
    );
    const publicEnrollmentCommitment = computeShieldedEnrollmentCommitment(
      {
        policyCommitment: publicPolicyCommitment,
        heirIdentityCommitment,
        eligibleFrom,
        enrollmentSalt,
      },
      scope,
    );
    const identityBudgetFields = {
      binding: "identity",
      keyMode: 0n,
      rootIdentityCommitment,
      rootVersionIndex: 1n,
      heirIdentityCommitment,
      amountPerPeriod: rate,
      periodDays: PERIOD_DAYS,
      eligibleFrom,
      policyCommitment: publicPolicyCommitment,
      enrollmentCommitment: publicEnrollmentCommitment,
    };
    const identityBudgetNote = async (remaining, clear = false) => {
      const note = { ...identityBudgetFields, remaining, nonce: generateShieldedRandomField() };
      const termsCommitment = computeShieldedIdentityBudgetTermsCommitment(note, scope);
      if (!clear) {
        return encrypt(heirKeys, note, encodeShieldedBudgetNotePayload, (ciphertextHashField) =>
          computeShieldedIdentityBudgetNoteCommitment(
            {
              ...note,
              termsCommitment,
              ciphertextHashField,
            },
            scope,
          ),
        );
      }
      const ciphertext = encodePublicShieldedBudgetEnvelope(note, scope);
      const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
      const commitment = computeShieldedIdentityBudgetNoteCommitment(
        {
          ...note,
          termsCommitment,
          ciphertextHashField,
        },
        scope,
      );
      return {
        ...note,
        ciphertext,
        ciphertextHex: hexlify(ciphertext),
        ciphertextHashField,
        commitment,
        keys: childKeys,
      };
    };
    const publicBudget = await identityBudgetNote(1500n, true);
    const publicFundChange = await valueNote(donorKeys, 500n);
    const publicDonorPath = await notePath(additionalFundingChange);
    const publicFundData = {
      ...zeroData(),
      fundMode: 0n,
      budgetKind: 1n,
      ...inputs(
        [publicDonorPath, publicDonorPath],
        [
          spend(additionalFundingChange),
          computeShieldedEnrollmentNullifier(
            {
              allocationKey: publicAllocationKey,
              policyCommitment: publicPolicyCommitment,
              heirIdentityCommitment,
            },
            scope,
          ),
        ],
      ),
      ...outputs([publicBudget, publicFundChange]),
      relation0: endorsement.root,
      relation1: trusted.root,
      asOf,
      lineageCheckpointId,
    };
    const publicFundInputs = publicInputsFor("fund", publicFundData);
    const publicFundProof = await prove(
      "fund",
      {
        ...commonFunding,
        ...lineageWitness,
        ...donorWitness(additionalFundingChange, publicDonorPath),
        ...publicFundInputs.witness,
        heirOwnerCommitment: "0",
        heirViewKeyLo: "0",
        heirViewKeyHi: "0",
        keyMode: "0",
        policySalt: String(publicPolicySalt),
        allocationKeyCommitment: String(publicAllocationKeyCommitment),
        allocationKey: String(publicAllocationKey),
        oldBudgetKind: "0",
        oldKeyMode: "0",
        oldHeirOwnerCommitment: "0",
        oldBudgetRemaining: "0",
        oldBudgetRemainingPeriods: "0",
        oldBudgetNonce: "0",
        oldBudgetCiphertextHash: "0",
        oldBudgetDepth: "0",
        oldBudgetIndex: "0",
        oldBudgetSiblings: Array(32).fill("0"),
        budgetUseNonce: "0",
        heirVersionIndex: "1",
        budgetPeriods: "15",
        budgetNonce: String(publicBudget.nonce),
        changeNonce: String(publicFundChange.nonce),
      },
      publicFundInputs.signals,
      { label: "shielded-action-fund-identity" },
    );
    await submit(
      "fund",
      publicFundData,
      publicFundProof,
      [publicBudget, publicFundChange],
      {},
      "shielded-action-fund-identity",
    );
    assert.equal(
      await pool.nullifierSpent(spend(budget)),
      false,
      "Public funding spent its private read-only template",
    );

    const claimAsOf = eligibleFrom + 3n * PERIOD;
    const remainingBudget = await budgetNote(900n, "claim");
    const payout = await valueNote(childKeys, 300n);
    const budgetClaimPath = await notePath(budget);
    const claimData = {
      ...zeroData(),
      ...inputs([budgetClaimPath], [spend(budget)]),
      periodNullifiers: Array.from({ length: 3 }, (_, periodIndex) =>
        computeShieldedPeriodNullifier(
          {
            derivedSecretField: childMaterial.derivedSecretField,
            policyCommitment,
            periodIndex,
          },
          scope,
        ),
      ),
      ...outputs([remainingBudget, payout]),
      relation0: endorsement.root,
      relation1: trusted.root,
      asOf: claimAsOf,
      lineageCheckpointId,
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
        budgetKind: "0",
        heirViewKeyLo: String(heirViewLimbs.viewKeyLo),
        heirViewKeyHi: String(heirViewLimbs.viewKeyHi),
        inputBudgetIsClaim: ["0"],
        keyMode: "0",
        ownerSecret: String(childKeys.ownerSecret),
        policyCommitmentInput: String(policyCommitment),
        enrollmentCommitmentInput: String(enrollmentCommitment),
        policySalt: String(policySalt),
        allocationKeyCommitment: String(allocationKeyCommitment),
        enrollmentSalt: String(enrollmentSalt),
        eligibleFrom: String(eligibleFrom),
        rate: String(rate),
        periodDays: String(PERIOD_DAYS),
        remaining: "1200",
        remainingPeriods: "12",
        budgetNonce: String(budget.nonce),
        budgetCiphertextHash: String(budget.ciphertextHashField),
        noteDepth: budgetClaimPath.depth,
        noteIndex: budgetClaimPath.index,
        noteSiblings: budgetClaimPath.siblings,
        claimCount: "3",
        periodIndices: Array.from({ length: 3 }, (_, index) => String(index)),
        newBudgetNonce: String(remainingBudget.nonce),
        payoutNonce: String(payout.nonce),
      },
      claimInputs.signals,
      { execution: "verifier-call", claimCount: 3, asOf: String(claimAsOf) },
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

    const identityRemainder = await identityBudgetNote(1200n);
    const identityPayout = await valueNote(childKeys, 300n);
    const publicClaimPath = await notePath(publicBudget);
    const identityClaimData = {
      ...zeroData(),
      ...inputs([publicClaimPath], [spend(publicBudget)]),
      periodNullifiers: Array.from({ length: 3 }, (_, index) =>
        computeShieldedPeriodNullifier(
          {
            derivedSecretField: childMaterial.derivedSecretField,
            policyCommitment: publicPolicyCommitment,
            periodIndex: BigInt(index),
          },
          scope,
        ),
      ),
      ...outputs([identityRemainder, identityPayout]),
      relation0: endorsement.root,
      relation1: trusted.root,
      asOf: claimAsOf,
      lineageCheckpointId,
    };
    const identityClaimInputs = publicInputsFor("claim", identityClaimData);
    const identityClaimProof = await prove(
      "claim",
      {
        ...identityClaimInputs.witness,
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
        budgetKind: "1",
        heirViewKeyLo: "0",
        heirViewKeyHi: "0",
        inputBudgetIsClaim: ["0"],
        keyMode: "0",
        ownerSecret: String(childKeys.ownerSecret),
        policyCommitmentInput: String(publicPolicyCommitment),
        enrollmentCommitmentInput: String(publicEnrollmentCommitment),
        policySalt: "0",
        allocationKeyCommitment: "0",
        enrollmentSalt: "0",
        eligibleFrom: String(eligibleFrom),
        rate: String(rate),
        periodDays: String(PERIOD_DAYS),
        remaining: "1500",
        remainingPeriods: "15",
        budgetNonce: String(publicBudget.nonce),
        budgetCiphertextHash: String(publicBudget.ciphertextHashField),
        noteDepth: publicClaimPath.depth,
        noteIndex: publicClaimPath.index,
        noteSiblings: publicClaimPath.siblings,
        claimCount: "3",
        periodIndices: Array.from({ length: 3 }, (_, index) => String(index)),
        newBudgetNonce: String(identityRemainder.nonce),
        payoutNonce: String(identityPayout.nonce),
      },
      identityClaimInputs.signals,
      { execution: "verifier-call", claimCount: 3, asOf: String(claimAsOf) },
    );
    assert.equal(
      await pool.nullifierSpent(spend(publicBudget)),
      false,
      "Verifier-only identity claim changed pool state",
    );

    const valuePrivateInputs = (source, membership, capacity = 1) => ({
      inputEnabled: ["1", ...Array(capacity - 1).fill("0")],
      inputOwnerSecrets: [String(source.keys.ownerSecret), ...Array(capacity - 1).fill("0")],
      inputAmounts: [String(source.amount), ...Array(capacity - 1).fill("0")],
      inputNonces: [String(source.nonce), ...Array(capacity - 1).fill("0")],
      inputCiphertextHashes: [String(source.ciphertextHashField), ...Array(capacity - 1).fill("0")],
      inputDepths: [membership.depth, ...Array(capacity - 1).fill("0")],
      inputIndices: [membership.index, ...Array(capacity - 1).fill("0")],
      inputSiblings: [membership.siblings, ...Array.from({ length: capacity - 1 }, () => Array(32).fill("0"))],
    });
    const valueData = (source, membership, outputNotes, capacity = 1) => ({
      ...zeroData(),
      inputShardIds: Array(capacity).fill(membership.shardId),
      inputRoots: Array(capacity).fill(membership.root),
      inputNullifiers: Array.from({ length: capacity }, (_, index) =>
        index === 0
          ? spend(source)
          : computeShieldedDummyInputNullifierForSlot(
              source.keys.ownerSecret,
              source.commitment,
              index,
              scope,
            ),
      ),
      ...outputs(outputNotes),
    });

    const proveFourInputValue = async (action, source, membership, outputNotes, openings, external = {}, credentials) => {
      const data = valueData(source, membership, outputNotes, 4);
      const receiverWitness = credentials ? await authorizeReceivers(action, data, credentials) : {};
      const inputs = publicInputsFor(action, data, external);
      return prove(`${action}4`, {
        ...inputs.witness,
        ...receiverWitness,
        ...valuePrivateInputs(source, membership, 4),
        ...openings,
      }, inputs.signals, { execution: "verifier-call" });
    };

    const transferOutputs = await Promise.all([
      valueNote(heirKeys, 400n),
      valueNote(donorKeys, 100n),
    ]);
    const transferPath = await notePath(publicFundChange);
    const transferData = valueData(publicFundChange, transferPath, transferOutputs);
    const transferCredentials = [await receiveCodeFor(childMaterial, childKeys, "anonymous"), null];
    const transferReceiverWitness = await authorizeReceivers("privateTransfer", transferData, transferCredentials);
    const transferInputs = publicInputsFor("privateTransfer", transferData);
    const transferProof = await prove(
      "privateTransfer",
      {
        ...transferInputs.witness,
        ...transferReceiverWitness,
        ...valuePrivateInputs(publicFundChange, transferPath),
        outputOwnerCommitments: decimals(transferOutputs.map((note) => note.ownerCommitment)),
        outputAmounts: decimals(transferOutputs.map((note) => note.amount)),
        outputNonces: decimals(transferOutputs.map((note) => note.nonce)),
      },
      transferInputs.signals,
    );
    await proveFourInputValue("privateTransfer", publicFundChange, transferPath, transferOutputs, {
      outputOwnerCommitments: decimals(transferOutputs.map((note) => note.ownerCommitment)),
      outputAmounts: decimals(transferOutputs.map((note) => note.amount)),
      outputNonces: decimals(transferOutputs.map((note) => note.nonce)),
    }, {}, transferCredentials);
    await submit("privateTransfer", transferData, transferProof, transferOutputs);

    const unshieldSource = transferOutputs[0];
    const unshieldOutputs = await Promise.all([
      valueNote(childKeys, 300n),
      valueNote(childKeys, 0n),
    ]);
    const unshieldPath = await notePath(unshieldSource);
    const unshieldData = valueData(unshieldSource, unshieldPath, unshieldOutputs);
    const unshieldInputs = publicInputsFor("unshield", unshieldData, {
      amount: unshieldedAmount,
      recipient: signerAddress,
    });
    const unshieldProof = await prove(
      "unshield",
      {
        ...unshieldInputs.witness,
        ...valuePrivateInputs(unshieldSource, unshieldPath),
        changeAmount: "300",
        changeNonce: String(unshieldOutputs[0].nonce),
        dummyNonce: String(unshieldOutputs[1].nonce),
      },
      unshieldInputs.signals,
    );
    await proveFourInputValue("unshield", unshieldSource, unshieldPath, unshieldOutputs, {
      changeAmount: "300",
      changeNonce: String(unshieldOutputs[0].nonce),
      dummyNonce: String(unshieldOutputs[1].nonce),
    }, { amount: unshieldedAmount, recipient: signerAddress });
    await submit("unshield", unshieldData, unshieldProof, unshieldOutputs, {
      amount: unshieldedAmount,
      recipient: signerAddress,
    });

    const totalShieldedAfter = await pool.totalShielded();
    const poolTokenAfter = await token.balanceOf(poolAddress);
    const signerTokenAfter = await token.balanceOf(signerAddress);
    assert.equal(totalShieldedAfter - totalShieldedBefore, shieldedAmount - unshieldedAmount);
    assert.equal(poolTokenAfter - poolTokenBefore, shieldedAmount - unshieldedAmount);
    assert.equal(signerTokenBefore - signerTokenAfter, shieldedAmount - unshieldedAmount);
    assert.ok(
      poolTokenAfter >= totalShieldedAfter,
      "Pool custody does not cover shielded liabilities",
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
        const publicNote = decodePublicShieldedBudgetEnvelope(
          getBytes(event.args.ciphertext),
          scope,
        );
        recovered = publicNote
          ? encodeShieldedBudgetNotePayload(publicNote, scope)
          : await decryptShieldedNote({
              ciphertext: getBytes(event.args.ciphertext),
              hpkeIkm: local.keys.hpkeIkm,
              chainId,
              poolAddress,
            });
        verifyShieldedNotePayload(
          {
            payload: recovered,
            ciphertext: event.args.ciphertext,
            noteCommitment: event.args.commitment,
          },
          { ...scope, viewingKey: local.keys.viewingKey },
        );
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
        fundLabel: "shielded-action-fund",
        claimExecution: "verifier-call",
        claimCount: 3,
        claimAsOf: String(claimAsOf),
        periodDays: String(PERIOD_DAYS),
        eligibleFrom: String(eligibleFrom),
        lineageDepth: Math.max(Number(endorsement.depth), Number(trusted.depth)),
        endorsementDepth: Number(endorsement.depth),
        trustedDepth: Number(trusted.depth),
        noteDepth: Number(budgetClaimPath.depth),
        receiveCode,
        identityBudget: {
          fundingLabel: "shielded-action-fund-identity",
          budgetCommitment: String(publicBudget.commitment),
          heirPersonHash: childMaterial.personHash,
          amountPerPeriod: String(rate),
          periodDays: String(PERIOD_DAYS),
          eligibleFrom: String(eligibleFrom),
          remaining: String(publicBudget.remaining),
          fundProof: publicFundProof.evidence,
          claimProof: identityClaimProof.evidence,
        },
        shieldedAmount: String(shieldedAmount),
        unshieldedAmount: String(unshieldedAmount),
        totalShieldedBefore: String(totalShieldedBefore),
        totalShieldedAfter: String(totalShieldedAfter),
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
