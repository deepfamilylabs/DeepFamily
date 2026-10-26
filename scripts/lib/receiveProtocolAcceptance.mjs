import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  computeIdentityFromDerivedSecret,
  createSourceFact,
  createSourceTrust,
  prepareEligibilityIssue,
  generateShieldedRandomField,
  computeShieldedOwnerCommitment,
  computeShieldedValueNoteCommitment,
  computeShieldedCiphertextHashField,
  deriveShieldedViewPublicKey,
  encryptShieldedNote,
  encodeShieldedValueNotePayload,
  decryptShieldedNote,
  verifyShieldedNotePayload,
  createShieldedLetterEnvelope,
  encryptShieldedLetter,
  decryptShieldedLetter,
} from "@deepfamily/protocol-core";
import {
  computeReceiveAuthorization,
  deriveReceiveKeyMaterial,
  encodeReceiveCode,
  decodeReceiveCode,
  buildCapabilityPublicSignals,
  computeCapabilityBinding,
  computeFamilyTag,
  computeRoleStatusIndex,
} from "../../packages/protocol-core/receive-code.js";
import {
  computeBudgetKey,
  computePolicyCommitment,
  prepareBudgetClaim,
  decryptBudgetNote,
} from "../../packages/protocol-core/budget.js";
import { prepareUnshield } from "../../packages/protocol-core/value.js";
import {
  inspectProtocolArtifacts,
  protocolArtifactPaths,
} from "../protocol-zk-development.mjs";
import { inspectCanonicalBoundaryArtifacts } from "./canonicalBoundaryArtifacts.mjs";
import { createReceiveAcceptanceProver } from "./receiveAcceptanceProver.mjs";
import {
  verifyReceiveProtocolReceipts,
  verifyReceiveProtocolRejections,
} from "./receiveProtocolEvidence.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const roleFields = ["childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex"];
const roleNames = ["child", "endorsement", "trusted"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const strings = (value) =>
  JSON.parse(JSON.stringify(value, (_, item) => (typeof item === "bigint" ? String(item) : item)));
const padded = (siblings, size) => [
  ...Array.from(siblings, BigInt),
  ...Array(size - siblings.length).fill(0n),
];

/** Local tests and public acceptance use the same prover, with explicit pinned artifacts. */
export function localReceiveAcceptanceArtifacts({ root = ROOT } = {}) {
  const protocol = inspectProtocolArtifacts({ root });
  const boundary = inspectCanonicalBoundaryArtifacts({ root });
  const relative = (file) => path.relative(root, file).split(path.sep).join("/");
  return {
    ...boundary.circuits,
    ...Object.fromEntries(
      Object.entries(protocol.circuits).map(([action, entry]) => {
        const files = protocolArtifactPaths(action, { root });
        return [
          action,
          {
            source: entry.source,
            sourceSha256: entry.sources[`circuits/${entry.source}.circom`],
            wasmSha256: entry.compiled[relative(files.wasm)],
            zkeySha256: entry.setup.artifacts[relative(files.zkey)],
            verificationKeySha256: entry.setup.artifacts[relative(files.vkey)],
            wasmPath: files.wasm,
            zkeyPath: files.zkey,
            verificationKeyPath: files.vkey,
          },
        ];
      }),
    ),
  };
}

/**
 * Actual Source/Q, receiving and money acceptance. No fixtures, mock verifiers,
 * storage injection, snapshots or synthetic clock are installed by this runner.
 * The caller supplies authenticated subjects and an honest chain-time adapter.
 */
export async function runReceiveProtocolAcceptance({
  root = ROOT,
  ethers,
  deployed,
  actors,
  subjects,
  artifacts = localReceiveAcceptanceArtifacts({ root }),
  prove,
  recordTx = async (_label, tx) => tx.wait(),
  waitUntil,
} = {}) {
  assert.equal(typeof waitUntil, "function", "Acceptance requires a chain-time adapter");
  const provider = ethers.provider;
  const chainId = (await provider.getNetwork()).chainId;
  const {
    deepFamily,
    lineageIndex,
    token,
    eligibilitySource: source,
    receiveRegistry: registry,
    letterArchive: letters,
    shieldedNativePool: native,
    shieldedErc20Pool: erc20,
  } = deployed;
  const { manager, endorser, payer } = actors;
  const managerAddress = await manager.getAddress();
  const endorserAddress = await endorser.getAddress();
  const payerAddress = await payer.getAddress();
  const recipientAddress = ethers.getAddress(
    typeof actors.recipient === "string" ? actors.recipient : await actors.recipient.getAddress(),
  );
  assert.notEqual(recipientAddress, payerAddress, "Withdrawal observer must not pay transaction gas");
  const registryAddress = await registry.getAddress();
  const sourceAddress = await source.getAddress();
  const prover = createReceiveAcceptanceProver({ root, artifacts });
  const generateProof = prove ?? prover.prove;
  const proofs = Object.fromEntries(Object.keys(artifacts).map((action) => [action, []]));
  const transactions = [];
  const roleRevocations = [];
  const reissues = [];
  const addresses = {
    deepFamily: await deepFamily.getAddress(),
    eligibilitySource: sourceAddress,
    receiveRegistry: registryAddress,
    letterArchive: await letters.getAddress(),
    shieldedNativePool: await native.getAddress(),
    shieldedErc20Pool: await erc20.getAddress(),
    token: await token.getAddress(),
  };
  const encodeProof = (proof) =>
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [
        proof.pi_a.slice(0, 2),
        proof.pi_b.slice(0, 2).map((row) => row.slice(0, 2).reverse()),
        proof.pi_c.slice(0, 2),
      ],
    );
  const now = async () => BigInt((await provider.getBlock("latest")).timestamp);
  const blankData = (overrides = {}) => ({
    inputShardIds: [0n],
    inputRoots: [0n],
    inputNullifiers: [0n],
    outputCommitments: [0n, 0n],
    outputCiphertexts: ["0x", "0x"],
    ...overrides,
  });
  const dataOf = (result) =>
    blankData({
      inputShardIds: result.publicInput.inputShardIds ?? [0n],
      inputRoots: result.publicInput.inputRoots ?? [result.publicInput.inputRoot],
      inputNullifiers: result.publicInput.inputNullifiers ?? [result.publicInput.inputNullifier],
      outputCommitments: result.outputCommitments,
      outputCiphertexts: result.outputCiphertexts,
    });
  const send = async (label, action, promise, asset) => {
    const tx = await promise;
    const receipt = await recordTx(label, tx);
    assert.equal(receipt.status, 1, `${label} must have a successful actual receipt`);
    transactions.push({ label, action, ...(asset ? { asset } : {}), hash: receipt.hash });
    return receipt;
  };
  async function verifyProofSample(action, result, asset) {
    const publicSignals = result.publicSignals.map(String);
    assert.equal(await prover.verify({ circuit: action, proof: result.proof, publicSignals }), true);
    const proofBytes = result.solidityProof ?? encodeProof(result.proof);
    let verifier;
    if (["shield", "unshield", "unshield4"].includes(action)) {
      verifier = deployed.shieldedVerifiers[action];
      assert.equal(
        await verifier.verifyProof(
          result.proof.pi_a.slice(0, 2),
          result.proof.pi_b.slice(0, 2).map((row) => row.slice(0, 2).reverse()),
          result.proof.pi_c.slice(0, 2),
          publicSignals,
        ),
        true,
      );
    } else {
      verifier = deployed.protocolVerifiers[action];
      assert.equal(await verifier.verifyProof(proofBytes, publicSignals), true);
    }
    const entry = artifacts[action];
    proofs[action].push({
      source: entry.source,
      verified: true,
      verifierAddress: await verifier.getAddress(),
      wasmSha256: entry.wasmSha256,
      zkeySha256: entry.zkeySha256,
      verificationKeySha256: entry.verificationKeySha256,
      proofSha256: sha256(ethers.getBytes(proofBytes)),
      publicSignals,
      publicSignalsSha256: sha256(JSON.stringify(publicSignals)),
      execution: "verifier-call",
      ...(asset ? { asset, poolAddress: addresses[asset === "native" ? "shieldedNativePool" : "shieldedErc20Pool"] } : {}),
    });
    return { ...result, publicSignals, solidityProof: proofBytes };
  }
  const proof = async (action, witness, expectedPublicSignals, asset) =>
    verifyProofSample(
      action,
      await generateProof({ circuit: action, witness: strings(witness), expectedPublicSignals }),
      asset,
    );
  async function membership(pool, index) {
    const value = await pool.getNoteMerkleProof(0, index);
    return {
      root: value.proofRoot,
      depth: value.proofDepth,
      index: value.proofIndex,
      siblings: padded(value.siblings, 32),
    };
  }
  async function rejectCall(contract, method, args, expectedName, expectedArgs = []) {
    const populated = await contract[method].populateTransaction(...args);
    const call = { to: populated.to, from: payerAddress, data: populated.data };
    const block = await provider.getBlock("latest");
    let failure;
    try {
      await provider.send("eth_call", [call, ethers.toQuantity(block.number)]);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `${method} must reject ${expectedName}`);
    let decoded;
    for (const data of [failure.data, failure.error?.data, failure.info?.error?.data]) {
      const bytes = typeof data === "string" ? data : data?.data;
      if (!bytes) continue;
      for (const candidate of [registry, source, native, erc20, deepFamily]) {
        try {
          decoded = candidate.interface.parseError(bytes);
        } catch {}
        if (decoded) break;
      }
      if (decoded) break;
    }
    assert.equal(decoded?.name, expectedName, `${method} rejected for the expected reason`);
    assert.deepEqual(Array.from(decoded.args, String), expectedArgs.map(String));
    return {
      errorName: decoded.name,
      errorArgs: Array.from(decoded.args, String),
      blockNumber: block.number,
      blockHash: block.hash,
      ...call,
    };
  }
  const familySalt = generateShieldedRandomField();
  async function issue(subject, label, round) {
    const identity = computeIdentityFromDerivedSecret({ ...subject.identityInput, identity: subject.identityInput.identity ?? subject.identityInput });
    const common = {
      chainId,
      sourceAddress: BigInt(sourceAddress),
      childIdentity: identity.identityCommitment,
      parentIdentity: BigInt(subject.parentIdentity),
      parentVersion: BigInt(subject.parentVersion),
      endorser: BigInt(endorserAddress),
    };
    const fact = createSourceFact(common);
    const trust = createSourceTrust(common);
    const [, factIndex] = await lineageIndex.endorsementLeafIndex(subject.personHash, endorserAddress);
    const factPath = await lineageIndex.getMerkleProof(0, factIndex);
    const [, writtenAt] = await lineageIndex.getEndorsementMetadata(subject.personHash, endorserAddress);
    const factWitness = {
      ...common,
      endorsementRoot: factPath.proofRoot,
      childVersion: BigInt(subject.childVersion),
      fatherIdentity: BigInt(subject.fatherIdentity),
      motherIdentity: BigInt(subject.motherIdentity),
      rootIsMother: BigInt(subject.parentIdentity) === BigInt(subject.motherIdentity) ? 1n : 0n,
      writtenAt,
      endorsementDepth: factPath.proofDepth,
      endorsementIndex: factPath.proofIndex,
      endorsementSiblings: padded(factPath.siblings, 64),
      xChild: fact.xChild,
      xEndorse: fact.xEndorse,
      sourceFactSalt: fact.sourceFactSalt,
    };
    const factProof = await proof("sourceFact", factWitness, [
      fact.factLeaf, fact.childRoleCommitment, fact.endorsementRoleCommitment,
      chainId, BigInt(sourceAddress), common.childIdentity, common.parentIdentity,
      common.endorser, common.parentVersion, factPath.proofRoot,
    ]);
    const sourceIndex = await source.sourceSize(0);
    await send(`receive-${label}-source-fact-${round}`, "sourceFact", source.connect(endorser).publishFact(
      common.childIdentity, common.parentIdentity, endorserAddress, common.parentVersion,
      fact.factLeaf, fact.childRoleCommitment, fact.endorsementRoleCommitment, factProof.solidityProof,
    ));
    const [, trustedIndex] = await lineageIndex.trustedLeafIndex(subject.parentHash, subject.parentVersion, endorserAddress);
    const trustedPath = await lineageIndex.getMerkleProof(1, trustedIndex);
    const trustProof = await proof("sourceTrust", {
      chainId, sourceAddress: BigInt(sourceAddress), parentIdentity: common.parentIdentity,
      endorser: common.endorser, parentVersion: common.parentVersion,
      trustedRoot: trustedPath.proofRoot,
      trustedDepth: trustedPath.proofDepth,
      trustedIndex: trustedPath.proofIndex,
      trustedSiblings: padded(trustedPath.siblings, 64),
      xTrust: trust.xTrust, sourceTrustSalt: trust.sourceTrustSalt,
    }, [trust.trustLeaf, trust.trustRoleCommitment, chainId, BigInt(sourceAddress), common.parentIdentity, common.endorser, common.parentVersion, trustedPath.proofRoot]);
    const trustIndex = await source.sourceSize(1);
    await send(`receive-${label}-source-trust-${round}`, "sourceTrust", source.connect(manager).publishTrust(
      common.parentIdentity, endorserAddress, common.parentVersion, trust.trustLeaf,
      trust.trustRoleCommitment, trustProof.solidityProof,
    ));
    const sourcePath = await source.getSourceProof(0, sourceIndex);
    const sourceTrustPath = await source.getSourceProof(1, trustIndex);
    const qualified = prepareEligibilityIssue({
      ...subject.identityInput,
      identity: subject.identityInput.identity ?? subject.identityInput,
      chainId, authorizerScope: BigInt(registryAddress),
      parentIdentity: common.parentIdentity, parentVersion: common.parentVersion,
      endorser: common.endorser, familySalt,
      xChild: fact.xChild, xEndorse: fact.xEndorse, xTrust: trust.xTrust,
      sourceFactSalt: fact.sourceFactSalt, sourceTrustSalt: trust.sourceTrustSalt,
      issueNonce: generateShieldedRandomField(), credentialSalt: generateShieldedRandomField(),
      sourcePath: { leaf: fact.factLeaf, root: sourcePath.root, depth: sourcePath.depth, index: sourcePath.index, siblings: Array.from(sourcePath.siblings) },
      trustedPath: { leaf: trust.trustLeaf, root: sourceTrustPath.root, depth: sourceTrustPath.depth, index: sourceTrustPath.index, siblings: Array.from(sourceTrustPath.siblings) },
    });
    const issuedProof = await proof("issue", qualified.witness, qualified.publicSignals);
    const credentialIndex = await registry.credentialCount();
    await send(`receive-${label}-issue-${round}`, "issue", registry.connect(manager).registerCredential(
      qualified.credentialCommitment, qualified.witness.sourceRoot, qualified.witness.trustedRoot, issuedProof.solidityProof,
    ));
    const credentialPath = await registry.getCredentialProof(credentialIndex);
    return {
      ...qualified,
      identity: identity.identityCommitment,
      opening: {
        ...qualified.witness,
        familyRoot: qualified.familyRoot,
        issuanceRoot: credentialPath.root,
        credentialDepth: credentialPath.depth,
        credentialIndex: credentialPath.index,
        credentialSiblings: padded(credentialPath.siblings, 32),
      },
    };
  }
  let primary = await issue(subjects.primary, "primary", 0);
  const other = await issue(subjects.other, "other", 0);
  assert.notEqual(primary.identity, other.identity);
  assert.equal(primary.familyRoot, other.familyRoot);
  const masterKey = ethers.randomBytes(32);
  const expiresAt = (await now()) + 30n * 86400n;
  async function code(subject, qualification, codeIndex) {
    const key = await deriveReceiveKeyMaterial({ masterKey, chainId, authorizerScope: registryAddress, codeIndex, codeRootSecret: subject.identityInput.derivedSecretField });
    const common = computeReceiveAuthorization({ ...key, expiresAt });
    const commonWitness = {
      chainId, authorizerScope: BigInt(registryAddress), nonce: key.nonce,
      ownerCommitment: common.ownerCommitment, viewKeyLo: key.viewKeyLo, viewKeyHi: key.viewKeyHi,
      expiresAt, codeSecret: key.codeSecret, ownerSecret: key.ownerSecret,
    };
    const authorization = await proof("code", { ...commonWitness, codeRootSecret: key.codeRootSecret }, common.publicSignals);
    const capability = {
      issuanceRoot: qualification.opening.issuanceRoot,
      parentVersion: qualification.opening.parentVersion,
      familyTag: computeFamilyTag({ familyCommitment: qualification.familyRoot, nonce: key.nonce }),
      ...Object.fromEntries(roleFields.map((field, role) => [field, computeRoleStatusIndex({ role: roleNames[role], roleSecret: qualification.witness[["xChild", "xEndorse", "xTrust"][role]] })])),
    };
    capability.capabilityBinding = computeCapabilityBinding(common, capability);
    const names = ["issuanceRoot", "parentVersion", "issueNonce", "familyRoot", "endorser", "xChild", "xEndorse", "xTrust", "credentialSalt", "credentialDepth", "credentialIndex", "credentialSiblings"];
    const witness = Object.fromEntries(names.map((name) => [name, qualification.opening[name]]));
    const capProof = await proof("capability", { ...witness, ...commonWitness, commonBinding: common.commonBinding, derivedSecretField: key.codeRootSecret }, buildCapabilityPublicSignals(common, capability));
    const encodedCode = encodeReceiveCode({ ...common, proof: authorization.proof, capabilities: [{ ...capability, proof: capProof.proof }] });
    const decoded = decodeReceiveCode(encodedCode);
    const tuple = Object.fromEntries([["codeAlias", 0], ["commonBinding", 1], ["revocationTag", 2], ["nonce", 5], ["ownerCommitment", 6], ["viewKeyLo", 7], ["viewKeyHi", 8], ["expiresAt", 9]].map(([name, index]) => [name, common.publicSignals[index]]));
    assert.equal(await registry.verifyBudgetCapability(tuple, capability, authorization.solidityProof, capProof.solidityProof), true);
    return { key, decoded, tuple, encodedCode, capability, codeProof: authorization.solidityProof, capabilityProof: capProof.solidityProof };
  }
  let first = await code(subjects.primary, primary, 1n);
  let second = await code(subjects.primary, primary, 2n);
  const otherCode = await code(subjects.other, other, 3n);
  assert.notEqual(first.tuple.commonBinding, second.tuple.commonBinding);
  assert.notEqual(first.tuple.ownerCommitment, second.tuple.ownerCommitment);
  assert.notDeepEqual(first.decoded.viewingKey, second.decoded.viewingKey);
  for (const field of roleFields) {
    assert.equal(first.capability[field], second.capability[field]);
    assert.notEqual(first.capability[field], otherCode.capability[field]);
  }
  const originalBindings = [first.tuple.commonBinding, second.tuple.commonBinding];
  const donorSecret = generateShieldedRandomField();
  const donorOwner = computeShieldedOwnerCommitment(donorSecret);
  const donorIkm = ethers.randomBytes(32);
  const donorViewingKey = await deriveShieldedViewPublicKey(donorIkm);
  const pools = { native, erc20 };
  const scopes = Object.fromEntries(await Promise.all(Object.entries(pools).map(async ([asset, pool]) => [asset, { chainId, poolAddress: await pool.getAddress() }])));
  async function valueNote(amount, scope) {
    const note = { ownerCommitment: donorOwner, amount, nonce: generateShieldedRandomField() };
    const ciphertext = await encryptShieldedNote({ ...scope, recipientPublicKey: donorViewingKey, payload: encodeShieldedValueNotePayload(note, scope) });
    return { ...note, ciphertext, commitment: computeShieldedValueNoteCommitment({ ...note, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) }, scope) };
  }
  const totalBefore = { native: await native.totalShielded(), erc20: await erc20.totalShielded() };
  const donors = {};
  for (const [asset, pool] of Object.entries(pools)) {
    const note = await valueNote(1000n, scopes[asset]);
    const zero = await valueNote(0n, scopes[asset]);
    const data = blankData({ inputShardIds: [], inputRoots: [], inputNullifiers: [], outputCommitments: [note.commitment, zero.commitment], outputCiphertexts: [note.ciphertext, zero.ciphertext] });
    const ciphertextHashes = data.outputCiphertexts.map(computeShieldedCiphertextHashField);
    const shieldProof = await proof("shield", { chainId, pool: BigInt(scopes[asset].poolAddress), outputCommitments: data.outputCommitments, ciphertextHashes, amount: 1000n, ownerSecret: donorSecret, outputAmounts: [1000n, 0n], outputNonces: [note.nonce, zero.nonce] }, [chainId, BigInt(scopes[asset].poolAddress), ...data.outputCommitments, ...ciphertextHashes, 1000n], asset);
    const index = (await pool.noteShard(0)).size;
    if (asset === "erc20") {
      assert.ok(await token.balanceOf(payerAddress) >= 1000n);
      await recordTx("receive-erc20-approve", await token.connect(payer).approve(scopes.erc20.poolAddress, 1000n));
    }
    await send(`receive-${asset}-shield`, "shield", pool.connect(payer).shield(1000n, data, shieldProof.solidityProof, asset === "native" ? { value: 1000n } : {}), asset);
    donors[asset] = { ...note, index };
  }
  const policy = { familyCommitment: primary.familyRoot, parentVersion: BigInt(subjects.primary.parentVersion), rate: 10n, periodDays: 1n, policySalt: generateShieldedRandomField(), allocationKeyCommitment: generateShieldedRandomField() };
  const payerArtifactSubset = Object.fromEntries(["code", "capability", "fund", "transfer"].map((action) => [action, artifacts[action]]));
  async function prepare(asset, receiver, operation = "deposit", selectedPolicy = policy) {
    const pool = pools[asset], donor = donors[asset], scope = scopes[asset];
    const policyCommitment = computePolicyCommitment(selectedPolicy, scope);
    const budgetKey = computeBudgetKey({ codeAlias: receiver.decoded.codeAlias, policyCommitment }, scope);
    const stored = await pool.budgetRecords(budgetKey);
    const input = {
      artifacts: payerArtifactSubset, operation, code: receiver.encodedCode, authorizerScope: registryAddress,
      policy: selectedPolicy, asOf: await now(), budgetPeriods: 3n, amount: 7n, scope,
      record: { exists: stored.exists, commonBinding: stored.commonBinding, policyCommitment: stored.policyCommitment, eligibleFrom: stored.eligibleFrom },
      donor: { ownerSecret: donorSecret, amount: donor.amount, nonce: donor.nonce, ciphertext: donor.ciphertext, viewingKey: donorViewingKey, membership: await membership(pool, donor.index) },
    };
    const output = execFileSync(process.execPath, [path.join(root, "scripts/lib/receiveOfflinePayer.mjs")], { cwd: root, input: JSON.stringify(input, (_, value) => typeof value === "bigint" ? String(value) : value instanceof Uint8Array ? ethers.hexlify(value) : value), encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    const result = JSON.parse(output);
    await verifyProofSample(operation === "transfer" ? "transfer" : "fund", result, asset);
    return result;
  }
  const depositArgs = (receiver, result) => [receiver.tuple, receiver.capability, receiver.codeProof, receiver.capabilityProof, { policyCommitment: result.policyCommitment, budgetKey: result.budgetKey, eligibleFrom: result.eligibleFrom }, dataOf(result), result.proofBytes];
  async function deposit(asset, receiver, label, action = "fund", prepared) {
    const pool = pools[asset];
    const result = prepared ?? await prepare(asset, receiver);
    const index = (await pool.noteShard(0)).size;
    await send(label, action, pool.connect(payer).depositBudget(...depositArgs(receiver, result)), asset);
    donors[asset] = { ...result.changeNote, ciphertext: result.outputCiphertexts[1], index: index + 1n };
    const recovered = await decryptBudgetNote({ hpkeIkm: receiver.key.hpkeIkm, ciphertext: result.outputCiphertexts[0], noteCommitment: result.outputCommitments[0] }, scopes[asset]);
    assert.equal(recovered.note.remaining, 30n);
    return { ...result, index, transactionLabel: label };
  }
  const firstDeposit = await deposit("native", first, "receive-native-first");
  const appended = await deposit("native", first, "receive-native-append", "append");
  assert.equal(appended.eligibleFrom, firstDeposit.eligibleFrom);
  assert.equal(appended.budgetKey, firstDeposit.budgetKey);
  const secondDeposit = await deposit("native", second, "receive-native-second-first");
  assert.notEqual(firstDeposit.budgetKey, secondDeposit.budgetKey);
  const tokenDeposit = await deposit("erc20", first, "receive-erc20-first");
  const tokenAppend = await deposit("erc20", first, "receive-erc20-append", "append");
  assert.equal(tokenAppend.eligibleFrom, tokenDeposit.eligibleFrom);
  assert.equal(tokenAppend.budgetKey, tokenDeposit.budgetKey);
  const otherDeposit = await deposit("native", otherCode, "receive-native-other-first");
  const eligible = [firstDeposit, secondDeposit, tokenDeposit, otherDeposit].map((entry) => BigInt(entry.eligibleFrom));
  await waitUntil(eligible.reduce((a, b) => a > b ? a : b) + 86400n);
  assert.ok(await now() >= eligible.reduce((a, b) => a > b ? a : b) + 86400n, "Claim clock must actually mature on chain");
  async function prepareClaim(asset, receiver, depositRecord, qualification) {
    const result = await prepareBudgetClaim({
      note: depositRecord.note, ciphertext: depositRecord.outputCiphertexts[0], noteCommitment: depositRecord.outputCommitments[0],
      authorizerScope: registryAddress, qualification: qualification.opening, keyMaterial: receiver.key,
      membership: await membership(pools[asset], depositRecord.index), periodIndex: 0n, asOf: await now(),
      proveClaim: (witness) => proof("claim", witness, undefined, asset),
    }, scopes[asset]);
    return result;
  }
  const claimData = (claim) => Object.fromEntries(["budgetKey", "asOf", "issuanceRoot", ...roleFields].map((field) => [field, claim.publicInput[field]]).concat([["periodNullifier", claim.periodNullifier]]));
  const claimArgs = (claim) => [claimData(claim), dataOf(claim), encodeProof(claim.proof)];
  for (let role = 0; role < 3; ++role) {
    const attempts = [];
    for (const [codeIndex, receiver, depositRecord] of [[0, first, firstDeposit], [1, second, secondDeposit]]) {
      attempts.push({ codeIndex, receiver, first: await prepare("native", receiver, "deposit", { ...policy, policySalt: policy.policySalt + 7n }), append: await prepare("native", receiver), claim: await prepareClaim("native", receiver, depositRecord, primary) });
    }
    assert.equal(attempts[0].claim.periodNullifier, attempts[1].claim.periodNullifier);
    const roleIndex = first.capability[roleFields[role]];
    const otherRoleIndex = otherCode.capability[roleFields[role]];
    const secret = primary.witness[["xChild", "xEndorse", "xTrust"][role]];
    const transactionLabel = `receive-revoke-role-${role}`;
    await send(transactionLabel, "revokeRole", deepFamily.connect(role === 2 ? manager : endorser).revokeEligibilityRoles([role], [secret]));
    assert.equal(await source.isRoleRevoked(role, roleIndex), true);
    assert.equal(await source.isRoleRevoked(role, otherRoleIndex), false);
    const rejections = [];
    for (const attempt of attempts) {
      const { receiver, claim, codeIndex } = attempt;
      for (const operation of ["first", "append", "claim"]) {
        for (const kind of ["revoked", "index-substitution", "credential-substitution"]) {
          const altered = kind === "revoked" ? {} : kind === "index-substitution" ? { [roleFields[role]]: otherRoleIndex } : Object.fromEntries(["issuanceRoot", ...roleFields].map((field) => [field, otherCode.capability[field]]));
          let args;
          if (operation === "claim") args = [{ ...claimData(claim), ...altered }, dataOf(claim), encodeProof(claim.proof)];
          else args = depositArgs({ ...receiver, capability: { ...receiver.capability, ...(kind === "credential-substitution" ? otherCode.capability : altered) }, ...(kind === "credential-substitution" ? { capabilityProof: otherCode.capabilityProof } : {}) }, attempt[operation]);
          const errorName = kind === "revoked" ? "QualificationRevoked" : operation === "claim" ? "InvalidZKProof" : "InvalidProof";
          rejections.push({ codeIndex, operation, kind, ...await rejectCall(native, operation === "claim" ? "claimBudget" : "depositBudget", args, errorName, kind === "revoked" ? [role] : []) });
        }
      }
      assert.equal(await native.nullifierSpent(claim.inputNullifier), false);
      assert.equal(await native.nullifierSpent(claim.periodNullifier), false);
      assert.equal(await native.commitmentExists(claim.outputCommitments[0]), false);
      assert.equal(await registry.verifyReceive(receiver.tuple, receiver.codeProof), true);
    }
    roleRevocations.push({ role, roleIndex: String(roleIndex), otherRoleIndex: String(otherRoleIndex), transactionLabel, otherAppendTransactionLabel: `receive-native-other-append-${role}`, rejections });
    await deposit("native", otherCode, `receive-native-other-append-${role}`, "append");
    const oldCredential = primary.credentialCommitment;
    const oldRoleIndices = roleFields.map((field) => String(first.capability[field]));
    primary = await issue(subjects.primary, "primary", role + 1);
    first = await code(subjects.primary, primary, 1n);
    second = await code(subjects.primary, primary, 2n);
    assert.deepEqual([first.tuple.commonBinding, second.tuple.commonBinding], originalBindings);
    assert.equal(primary.familyRoot, other.familyRoot);
    for (const [currentRole, field] of roleFields.entries()) assert.equal(await source.isRoleRevoked(currentRole, first.capability[field]), false);
    reissues.push({ role, oldCredential: String(oldCredential), newCredential: String(primary.credentialCommitment), oldRoleIndices, newRoleIndices: roleFields.map((field) => String(first.capability[field])), originalBudgetKey: String(firstDeposit.budgetKey), depositTransactionLabel: firstDeposit.transactionLabel, claimTransactionLabel: "receive-native-claim-original" });
  }
  const recipientBalanceBefore = await provider.getBalance(recipientAddress);
  const finalClaims = {};
  for (const [asset, receiver, record, qualification, label] of [["native", first, firstDeposit, primary, "receive-native-claim-original"], ["erc20", first, tokenDeposit, primary, "receive-erc20-claim-original"], ["native", otherCode, otherDeposit, other, "receive-native-other-claim"]]) {
    const claim = await prepareClaim(asset, receiver, record, qualification);
    const index = (await pools[asset].noteShard(0)).size;
    await send(label, "claim", pools[asset].connect(payer).claimBudget(...claimArgs(claim)), asset);
    assert.equal(await pools[asset].nullifierSpent(claim.inputNullifier), true);
    assert.equal(await pools[asset].nullifierSpent(claim.periodNullifier), true);
    const recovered = verifyShieldedNotePayload({ payload: await decryptShieldedNote({ ...scopes[asset], hpkeIkm: receiver.key.hpkeIkm, ciphertext: claim.outputCiphertexts[1] }), ciphertext: claim.outputCiphertexts[1], noteCommitment: claim.outputCommitments[1] }, scopes[asset]);
    assert.equal(recovered.note.amount, 10n);
    if (receiver === first) finalClaims[asset] = { claim, index: index + 1n };
  }
  const duplicatePeriod = await prepareClaim("native", second, secondDeposit, primary);
  assert.equal(duplicatePeriod.periodNullifier, finalClaims.native.claim.periodNullifier);
  await rejectCall(native, "claimBudget", claimArgs(duplicatePeriod), "NullifierAlreadySpent");
  // A fresh actual revocation leaves generic receiving intact and VALUE spendable.
  await send("receive-final-role-revocation", "revokeRole", deepFamily.connect(endorser).revokeEligibilityRoles([0], [primary.witness.xChild]));
  const transfer = await prepare("native", first, "transfer");
  const transferIndex = (await native.noteShard(0)).size;
  await send("receive-native-transfer-after-revocation", "transfer", native.connect(payer).transfer(first.tuple, first.codeProof, dataOf(transfer), transfer.proofBytes), "native");
  const transferRecovered = verifyShieldedNotePayload({ payload: await decryptShieldedNote({ ...scopes.native, hpkeIkm: first.key.hpkeIkm, ciphertext: transfer.outputCiphertexts[0] }), ciphertext: transfer.outputCiphertexts[0], noteCommitment: transfer.outputCommitments[0] }, scopes.native);
  assert.equal(transferRecovered.note.amount, 7n);
  const messageId = BigInt(ethers.hexlify(ethers.randomBytes(16))) || 1n;
  const letterScope = { chainId, lettersAddress: addresses.letterArchive, messageId };
  const ciphertext = await encryptShieldedLetter({ ...letterScope, recipientPublicKey: first.decoded.viewingKey, envelope: createShieldedLetterEnvelope({ body: "Actual receive acceptance after qualification revocation" }) });
  const letterReceipt = await send("receive-letter-after-revocation", "letter", letters.connect(payer).registerLetter(messageId, first.tuple, first.codeProof, ciphertext));
  const event = letterReceipt.logs.map((log) => { try { return letters.interface.parseLog(log); } catch { return null; } }).find((entry) => entry?.name === "LetterRegistered");
  assert.ok(event);
  const archived = ethers.getBytes(await provider.getCode(event.args.blob.pointer)).slice(1);
  assert.equal(ethers.hexlify(archived), ethers.hexlify(ciphertext));
  const opened = await decryptShieldedLetter({ ...letterScope, hpkeIkm: first.key.hpkeIkm, ciphertext: archived, relationCommitment: 0n, expectedBinding: first.decoded.commonBinding });
  assert.equal(opened.body, "Actual receive acceptance after qualification revocation");
  const boundaryProve = (witness, capacity) => proof(capacity === 1 ? "unshield" : "unshield4", witness, undefined, "native");
  const withdrawal = await prepareUnshield({ donor: { ...finalClaims.native.claim.valueNote, ownerSecret: first.key.ownerSecret, viewingKey: first.decoded.viewingKey, ciphertext: finalClaims.native.claim.outputCiphertexts[1], membership: await membership(native, finalClaims.native.index) }, amount: 2n, recipient: recipientAddress, proveUnshield: boundaryProve }, scopes.native);
  const withdrawalIndex = (await native.noteShard(0)).size;
  await send("receive-native-unshield", "unshield", native.connect(payer).unshield(recipientAddress, 2n, dataOf(withdrawal), encodeProof(withdrawal.proof)), "native");
  const fourWithdrawal = await prepareUnshield({ donors: [
    { ...withdrawal.notes[0], ownerSecret: first.key.ownerSecret, viewingKey: first.decoded.viewingKey, ciphertext: withdrawal.outputCiphertexts[0], membership: await membership(native, withdrawalIndex) },
    { ...transfer.note, ownerSecret: first.key.ownerSecret, viewingKey: first.decoded.viewingKey, ciphertext: transfer.outputCiphertexts[0], membership: await membership(native, transferIndex) },
  ], amount: 15n, recipient: recipientAddress, proveUnshield: boundaryProve }, scopes.native);
  assert.equal(fourWithdrawal.capacity, 4);
  await send("receive-native-unshield4", "unshield4", native.connect(payer).unshield(recipientAddress, 15n, dataOf(fourWithdrawal), encodeProof(fourWithdrawal.proof)), "native");
  assert.equal(await provider.getBalance(recipientAddress), recipientBalanceBefore + 17n);
  assert.equal(await native.totalShielded(), totalBefore.native + 983n);
  assert.equal(await erc20.totalShielded(), totalBefore.erc20 + 1000n);
  for (const [action, samples] of Object.entries(proofs)) assert.ok(samples.length, `${action} must have an actual verified proof`);
  const verifiedRoles = await verifyReceiveProtocolRejections({ provider, expectedChainId: chainId, addresses, roleRevocations });
  const receipts = await verifyReceiveProtocolReceipts({ provider, expectedChainId: chainId, addresses, transactions });
  return {
    schemaVersion: 1,
    status: "passed",
    chainId: Number(chainId),
    addresses,
    proofs,
    transactions,
    roleRevocations: verifiedRoles,
    reissues,
    receipts,
    checks: { offlinePayer: true, notesRecovered: true, sameCodeAppends: true, crossCodeIndependent: true, nativeAndToken: true, ordinaryReceivingAfterRevocation: true },
  };
}
