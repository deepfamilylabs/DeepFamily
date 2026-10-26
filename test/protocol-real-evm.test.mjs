import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import {
  computeShieldedCiphertextHashField,
  computeShieldedOwnerCommitment,
  computeShieldedValueNoteCommitment,
  createShieldedLetterEnvelope,
  decryptShieldedLetter,
  decryptShieldedNote,
  deriveShieldedViewPublicKey,
  encodeShieldedValueNotePayload,
  encryptShieldedLetter,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
} from "@deepfamily/protocol-core";
import {
  computeReceiveAuthorization,
  decodeReceiveCode,
  deriveReceiveKeyMaterial,
  encodeReceiveCode,
} from "../packages/protocol-core/receive-code.js";
import {
  computeBudgetKey,
  computePolicyCommitment,
  decryptBudgetNote,
  prepareBudgetClaim,
} from "../packages/protocol-core/budget.js";
import { prepareUnshield } from "../packages/protocol-core/value.js";
import { inspectProtocolArtifacts, proveProtocol } from "../scripts/protocol-zk-development.mjs";
import { BOUNDARY_DEVELOPMENT_MANIFEST } from "../scripts/lib/canonicalBoundaryArtifacts.mjs";
import {
  capabilityFixture,
  receiveCodeFixture,
  eligibilityFixture,
  strings,
} from "../circuits/test/receive_fixture.mjs";
import {
  sourceFactFixture,
  sourceTrustFixture,
} from "../circuits/test/eligibility_source_fixture.mjs";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { runReceiveProtocolAcceptance } from "../scripts/lib/receiveProtocolAcceptance.mjs";
import { prepareReceiveAcceptanceSubjects } from "../scripts/lib/receiveAcceptanceSubjects.mjs";
import { requireReceiveProtocolExecutionEvidence } from "../scripts/lib/receiveProtocolEvidence.mjs";
import {
  addPerson,
  buildPersonCommitmentCircuitInput,
  makeTestPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const realTest = process.env.REQUIRE_PROTOCOL_REAL_PROOFS === "1" ? it : it.skip;
const serialize = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint"
      ? String(item)
      : item instanceof Uint8Array
        ? hre.ethers.hexlify(item)
        : item,
  );
const encodeProof = (proof) =>
  hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [
      proof.pi_a.slice(0, 2),
      proof.pi_b.slice(0, 2).map((row) => row.slice(0, 2).reverse()),
      proof.pi_c.slice(0, 2),
    ],
  );
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
const currentTime = async () => BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
const tupleOf = (code) => {
  const values = code.publicSignals;
  return {
    codeAlias: values[0],
    commonBinding: values[1],
    revocationTag: values[2],
    nonce: values[5],
    ownerCommitment: values[6],
    viewKeyLo: values[7],
    viewKeyHi: values[8],
    expiresAt: values[9],
  };
};
const capTuple = (cap) =>
  Object.fromEntries(
    [
      "issuanceRoot",
      "parentVersion",
      "capabilityBinding",
      "familyTag",
      "childRoleIndex",
      "endorsementRoleIndex",
      "trustedRoleIndex",
    ].map((name) => [name, cap[name]]),
  );

async function noteMembership(pool, leafIndex, depth = 32) {
  const value = await pool.getNoteMerkleProof(0, leafIndex);
  return {
    root: value.proofRoot,
    depth: value.proofDepth,
    index: value.proofIndex,
    siblings: [...value.siblings, ...Array(depth - value.siblings.length).fill(0n)],
  };
}
function offlinePayer(input) {
  return JSON.parse(
    execFileSync(process.execPath, [path.join(ROOT, "scripts/lib/receiveOfflinePayer.mjs")], {
      cwd: ROOT,
      input: serialize(input),
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }),
  );
}

describe("Receive protocol actual Groth16 / EVM / HPKE acceptance", function () {
  this.timeout(1_800_000);
  after(async () => {
    await globalThis.curve_bn128?.terminate?.();
    delete globalThis.curve_bn128;
  });

  realTest("runs the shared acceptance on real identities, current roles and canonical native/ERC20 pools", async function () {
    const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const [signer, recipient] = await hre.ethers.getSigners();
    const transactions = {};
    const recordTx = async (label, tx) => {
      const receipt = await tx.wait();
      transactions[label] = { hash: receipt.hash, status: receipt.status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, gasUsed: String(receipt.gasUsed) };
      console.log(`[receive-acceptance] ${label}`);
      return receipt;
    };
    const prepared = await prepareReceiveAcceptanceSubjects({
      deepFamily: deployed.deepFamily,
      token: deployed.token,
      signer,
      runId: "shared-real-evm-acceptance",
      recordTx,
    });
    try {
      const report = await runReceiveProtocolAcceptance({
        ethers: hre.ethers,
        deployed,
        actors: { manager: signer, endorser: signer, payer: signer, recipient },
        subjects: prepared.subjects,
        recordTx,
        waitUntil: async (timestamp) => {
          const current = BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
          if (timestamp > current) await hre.networkHelpers.time.increaseTo(timestamp);
        },
      });
      const execution = requireReceiveProtocolExecutionEvidence({
        evidence: report,
        addresses: report.addresses,
        transactions,
        expectedChainId: (await hre.ethers.provider.getNetwork()).chainId,
        fundMaxGas: 15_000_000n,
      });
      assert.equal(execution.rejectionCount, 54);
      assert.equal(report.status, "passed");
      assert.equal(Object.keys(report.proofs).length, 11);
      assert.equal(report.roleRevocations.length, 3);
      assert.ok(report.roleRevocations.every((entry) => entry.rejections.length === 18));
      assert.equal(report.reissues.length, 3);
      assert.equal(report.receipts.rpcChecks, "passed");
      fs.mkdirSync(path.join(ROOT, "tmp"), { recursive: true });
      fs.writeFileSync(path.join(ROOT, "tmp/receive-shared-acceptance.json"), JSON.stringify(report, null, 2));
    } finally {
      prepared.dispose();
    }
  });

  realTest(
    "uses one code offline for future budgets, append, ordinary transfers and letters, then claims with canonical allowance",
    async function () {
      inspectProtocolArtifacts(); // Required runs fail if keys are missing, stale or incompatible.
      const deployed = await hre.networkHelpers.loadFixture(deployIntegratedFixture);
      const {
        deepFamily,
        lineageIndex,
        token,
        shieldedNativePool: native,
        shieldedPoolFactory: factory,
        eligibilitySource: source,
        receiveRegistry: registry,
        letterArchive: letters,
      } = deployed;
      const [manager, endorser, payer] = await hre.ethers.getSigners();
      const chainId = (await hre.ethers.provider.getNetwork()).chainId;
      await setupStubVerifiers(hre.ethers, deepFamily);
      const parent = makeTestPerson("Real  Parent", { derivedSecretField: 99001n });
      const mother = makeTestPerson("Real  Mother", { derivedSecretField: 99002n, gender: 2 });
      const child = makeTestPerson("Real  Child", { derivedSecretField: 99003n });
      const parentHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
        person: parent,
      });
      const childHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
        person: child,
        fatherPerson: parent,
        motherPerson: mother,
      });
      const built = buildPersonCommitmentCircuitInput(child, parent, mother, manager.address);
      const childIdentity = built.person.identityCommitment;
      const parentIdentity = built.father.identityCommitment;
      await deepFamily.addTrustedEndorser(parentHash, 1, endorser.address);
      const fee = await token.recentReward();
      await token.transfer(endorser.address, fee);
      await token.connect(endorser).approve(await deepFamily.getAddress(), fee);
      await deepFamily.connect(endorser).endorseVersion(childHash, 1);

      const registryAddress = await registry.getAddress();
      assert.equal(await deepFamily.eligibilitySource(), await source.getAddress());
      const testToken = await hre.ethers.deployContract("PoolTokenMock");
      await factory.createPool(await testToken.getAddress());
      const erc20 = await hre.ethers.getContractAt(
        "ShieldedErc20Pool",
        await factory.poolFor(await testToken.getAddress()),
      );
      for (const method of [
        "fund",
        "claim",
        "privateTransfer",
        "AUTHORIZATION_STATE",
        "RECEIVE_VERIFIER",
        "LINEAGE_INDEX",
      ])
        assert.equal(native.interface.getFunction(method), null);
      assert.deepEqual(
        native.interface.getFunction("shield").inputs[1].components.map((field) => field.name),
        [
          "inputShardIds",
          "inputRoots",
          "inputNullifiers",
          "outputCommitments",
          "outputCiphertexts",
        ],
      );

      // Real current family paths certify the hidden source roles before issuance.
      let issuance = eligibilityFixture({
        chainId,
        authorizerScope: BigInt(registryAddress),
        nameField: BigInt(built.person.nameField),
        derivedSecretField: child.derivedSecretField,
        isBirthBC: BigInt(built.person.isBirthBC ? 1 : 0),
        birthYear: BigInt(child.birthYear),
        birthMonth: BigInt(child.birthMonth),
        birthDay: BigInt(child.birthDay),
        gender: BigInt(child.gender),
        parentIdentity,
        endorser: BigInt(endorser.address),
        familySalt: generateShieldedRandomField(),
        issueNonce: generateShieldedRandomField(),
        xChild: generateShieldedRandomField(),
        xEndorse: generateShieldedRandomField(),
        xTrust: generateShieldedRandomField(),
        sourceFactSalt: generateShieldedRandomField(),
        sourceTrustSalt: generateShieldedRandomField(),
        credentialSalt: generateShieldedRandomField(),
      });
      assert.equal(
        issuance.identity,
        childIdentity,
        "Issue must open the actual registered DeepFamily identity",
      );
      const issueOpening = issuance.witness;
      const roleSecrets = [issueOpening.xChild, issueOpening.xEndorse, issueOpening.xTrust];
      const [, factIndex] = await lineageIndex.endorsementLeafIndex(childHash, endorser.address);
      const actualFactPath = await lineageIndex.getMerkleProof(0, factIndex);
      const [, writtenAt] = await lineageIndex.getEndorsementMetadata(childHash, endorser.address);
      const sourceFact = sourceFactFixture({
        chainId,
        sourceAddress: BigInt(await source.getAddress()),
        childIdentity,
        parentIdentity,
        endorser: BigInt(endorser.address),
        parentVersion: 1n,
        childVersion: 1n,
        fatherIdentity: parentIdentity,
        motherIdentity: built.mother.identityCommitment,
        writtenAt,
        xChild: BigInt(issueOpening.xChild),
        xEndorse: BigInt(issueOpening.xEndorse),
        sourceFactSalt: BigInt(issueOpening.sourceFactSalt),
        endorsementDepth: actualFactPath.proofDepth,
        endorsementIndex: actualFactPath.proofIndex,
        endorsementSiblings: [
          ...actualFactPath.siblings,
          ...Array(64 - actualFactPath.siblings.length).fill(0n),
        ],
      });
      sourceFact.witness.endorsementRoot = String(actualFactPath.proofRoot);
      sourceFact.publicSignals[9] = actualFactPath.proofRoot;
      const sourceFactProof = await proveProtocol({
        circuit: "sourceFact",
        witness: sourceFact.witness,
        expectedPublicSignals: sourceFact.publicSignals,
      });
      await source
        .connect(endorser)
        .publishFact(
          childIdentity,
          parentIdentity,
          endorser.address,
          1,
          sourceFact.publicSignals[0],
          sourceFact.publicSignals[1],
          sourceFact.publicSignals[2],
          sourceFactProof.solidityProof,
        );
      const [, trustIndex] = await lineageIndex.trustedLeafIndex(parentHash, 1, endorser.address);
      const actualTrustPath = await lineageIndex.getMerkleProof(1, trustIndex);
      const sourceTrust = sourceTrustFixture({
        chainId,
        sourceAddress: BigInt(await source.getAddress()),
        parentIdentity,
        endorser: BigInt(endorser.address),
        parentVersion: 1n,
        xTrust: BigInt(issueOpening.xTrust),
        sourceTrustSalt: BigInt(issueOpening.sourceTrustSalt),
        trustedDepth: actualTrustPath.proofDepth,
        trustedIndex: actualTrustPath.proofIndex,
        trustedSiblings: [
          ...actualTrustPath.siblings,
          ...Array(64 - actualTrustPath.siblings.length).fill(0n),
        ],
      });
      sourceTrust.witness.trustedRoot = String(actualTrustPath.proofRoot);
      sourceTrust.publicSignals[7] = actualTrustPath.proofRoot;
      const sourceTrustProof = await proveProtocol({
        circuit: "sourceTrust",
        witness: sourceTrust.witness,
        expectedPublicSignals: sourceTrust.publicSignals,
      });
      await source.publishTrust(
        parentIdentity,
        endorser.address,
        1,
        sourceTrust.publicSignals[0],
        sourceTrust.publicSignals[1],
        sourceTrustProof.solidityProof,
      );
      assert.equal(await source.sourceRoot(), BigInt(issuance.witness.sourceRoot));
      assert.equal(await source.trustedRoot(), BigInt(issuance.witness.trustedRoot));
      const issueProof = await proveProtocol({
        circuit: "issue",
        witness: issuance.witness,
        expectedPublicSignals: issuance.publicSignals,
      });
      await registry.registerCredential(
        issuance.credentialCommitment,
        issuance.witness.sourceRoot,
        issuance.witness.trustedRoot,
        issueProof.solidityProof,
      );

      // Record unrelated history through actual source proofs and real DeepFamily
      // controller entrypoints. These different role secrets do not revoke Q.
      const numeric = (witness) =>
        Object.fromEntries(
          Object.entries(witness).map(([name, value]) => [
            name,
            Array.isArray(value) ? value.map(BigInt) : BigInt(value),
          ]),
        );
      for (let index = 0n; index < 9n; ++index) {
        const secrets = [700001n + 10n * index, 700002n + 10n * index, 700003n + 10n * index];
        const extraFact = sourceFactFixture({
          ...numeric(sourceFact.witness),
          xChild: secrets[0],
          xEndorse: secrets[1],
          sourceFactSalt: 800001n + index,
        });
        extraFact.witness.endorsementRoot = sourceFact.witness.endorsementRoot;
        extraFact.publicSignals[9] = sourceFact.publicSignals[9];
        const factProof = await proveProtocol({
          circuit: "sourceFact",
          witness: extraFact.witness,
          expectedPublicSignals: extraFact.publicSignals,
        });
        await source
          .connect(endorser)
          .publishFact(
            childIdentity,
            parentIdentity,
            endorser.address,
            1,
            extraFact.publicSignals[0],
            extraFact.publicSignals[1],
            extraFact.publicSignals[2],
            factProof.solidityProof,
          );
        const extraTrust = sourceTrustFixture({
          ...numeric(sourceTrust.witness),
          xTrust: secrets[2],
          sourceTrustSalt: 900001n + index,
        });
        extraTrust.witness.trustedRoot = sourceTrust.witness.trustedRoot;
        extraTrust.publicSignals[7] = sourceTrust.publicSignals[7];
        const trustProof = await proveProtocol({
          circuit: "sourceTrust",
          witness: extraTrust.witness,
          expectedPublicSignals: extraTrust.publicSignals,
        });
        await source.publishTrust(
          parentIdentity,
          endorser.address,
          1,
          extraTrust.publicSignals[0],
          extraTrust.publicSignals[1],
          trustProof.solidityProof,
        );
        await deepFamily.connect(endorser).revokeEligibilityRoles([0, 1], secrets.slice(0, 2));
        await deepFamily.revokeEligibilityRoles([2], secrets.slice(2));
      }
      for (const role of [0, 1, 2]) assert.equal(await source.revokedRoleCount(role), 9n);

      const masterKey = hre.ethers.getBytes(hre.ethers.zeroPadValue("0x0123456789abcdef", 32));
      const makeCode = async (
        codeIndex,
        credential = issuance,
        codeRootSecret = child.derivedSecretField,
        credentialPath = {},
      ) => {
        const keyMaterial = await deriveReceiveKeyMaterial({
          masterKey,
          chainId,
          authorizerScope: registryAddress,
          codeIndex,
          codeRootSecret,
        });
        const expiresAt = (await currentTime()) + 30n * 86400n;
        const authorization = computeReceiveAuthorization({ ...keyMaterial, expiresAt });
        const common = receiveCodeFixture({
          chainId,
          authorizerScope: BigInt(registryAddress),
          expiresAt,
          nonce: keyMaterial.nonce,
          ownerSecret: keyMaterial.ownerSecret,
          codeRootSecret: keyMaterial.codeRootSecret,
          codeSecret: keyMaterial.codeSecret,
          viewKeyLo: keyMaterial.viewKeyLo,
          viewKeyHi: keyMaterial.viewKeyHi,
        });
        const codeProof = await proveProtocol({
          circuit: "code",
          witness: common.witness,
          expectedPublicSignals: authorization.publicSignals,
        });
        const cap = capabilityFixture(credential, common, credentialPath);
        const capProof = await proveProtocol({
          circuit: "capability",
          witness: cap.witness,
          expectedPublicSignals: cap.publicSignals,
        });
        const values = cap.publicSignals;
        const capability = {
          capabilityBinding: values[0],
          familyTag: values[1],
          childRoleIndex: values[2],
          endorsementRoleIndex: values[3],
          trustedRoleIndex: values[4],
          issuanceRoot: values[7],
          parentVersion: values[9],
          proof: capProof.proof,
        };
        const encodedCode = encodeReceiveCode({
          ...authorization,
          proof: codeProof.proof,
          capabilities: [capability],
        });
        const decoded = decodeReceiveCode(encodedCode);
        return {
          encodedCode,
          keyMaterial,
          decoded,
          tuple: tupleOf(decoded),
          capability: capTuple(capability),
          codeProof: codeProof.solidityProof,
          capabilityProof: capProof.solidityProof,
          revocationSecret: authorization.revocationSecret,
        };
      };
      const first = await makeCode(1n);
      const second = await makeCode(2n);
      for (const name of [
        "codeAlias",
        "commonBinding",
        "nonce",
        "ownerCommitment",
        "revocationTag",
      ])
        assert.notEqual(first.decoded[name], second.decoded[name]);
      assert.notDeepEqual(first.decoded.viewingKey, second.decoded.viewingKey);
      for (const name of [
        "identityCommitment",
        "parentIdentity",
        "endorser",
        "credentialCommitment",
        "issueNonce",
        "codeSecret",
      ])
        assert.equal(Object.hasOwn(first.decoded, name), false);
      const familyCommitment = issuance.familyRoot;
      // Retained only by the recipient for a later online Claim, never passed to the offline payer.
      const claimQualification = {
        ...issueOpening,
        familyRoot: issuance.familyRoot,
        issuanceRoot: issuance.credentialCommitment,
        credentialDepth: 0n,
        credentialIndex: 0n,
        credentialSiblings: Array(32).fill(0n),
      };
      // The recipient's source credential opening is no longer available to the payer phase.
      issuance = undefined;

      // The unchanged real Shield circuit imports actual collateral into this ledger.
      const shieldEntry = JSON.parse(
        fs.readFileSync(path.join(ROOT, BOUNDARY_DEVELOPMENT_MANIFEST)),
      ).circuits.shield;
      const shieldDir = path.join(ROOT, "frontend/public/zk/shielded");
      const shieldFiles = {
        wasm: path.join(shieldDir, "shielded_shield.wasm"),
        zkey: path.join(shieldDir, "shielded_shield_final.zkey"),
        vkey: path.join(shieldDir, "shielded_shield.vkey.json"),
      };
      for (const [name, hashName] of [
        ["wasm", "wasmSha256"],
        ["zkey", "zkeySha256"],
        ["vkey", "verificationKeySha256"],
      ])
        assert.equal(
          createHash("sha256").update(fs.readFileSync(shieldFiles[name])).digest("hex"),
          shieldEntry[hashName],
        );
      assert.equal(
        createHash("sha256")
          .update(fs.readFileSync(path.join(ROOT, shieldEntry.verifierPath)))
          .digest("hex"),
        shieldEntry.solidityVerifierSha256 ?? shieldEntry.verifierSha256,
      );
      const snarkjs = await import("snarkjs");
      const donorOwnerSecret = 876543n;
      const donorOwnerCommitment = computeShieldedOwnerCommitment(donorOwnerSecret);
      const donorIkm = hre.ethers.getBytes(hre.ethers.zeroPadValue("0xabcd1234", 32));
      const donorViewingKey = await deriveShieldedViewPublicKey(donorIkm);
      const encryptValue = async (note, scope, viewingKey = donorViewingKey) => {
        const ciphertext = await encryptShieldedNote({
          ...scope,
          recipientPublicKey: viewingKey,
          payload: encodeShieldedValueNotePayload(note, scope),
        });
        return {
          ...note,
          ciphertext,
          commitment: computeShieldedValueNoteCommitment(
            { ...note, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
            scope,
          ),
        };
      };
      const shieldDonor = async (pool, isNative, nonce) => {
        const scope = { chainId, poolAddress: await pool.getAddress() };
        const donor = await encryptValue(
          { ownerCommitment: donorOwnerCommitment, amount: 1000n, nonce },
          scope,
        );
        const dummy = await encryptValue(
          { ownerCommitment: donorOwnerCommitment, amount: 0n, nonce: nonce + 1n },
          scope,
        );
        const data = blankData({
          inputShardIds: [],
          inputRoots: [],
          inputNullifiers: [],
          outputCommitments: [donor.commitment, dummy.commitment],
          outputCiphertexts: [donor.ciphertext, dummy.ciphertext],
        });
        const ciphertextHashes = data.outputCiphertexts.map(computeShieldedCiphertextHashField);
        const signals = [
          chainId,
          BigInt(scope.poolAddress),
          ...data.outputCommitments,
          ...ciphertextHashes,
          1000n,
        ];
        const witness = {
          chainId: String(chainId),
          pool: String(BigInt(scope.poolAddress)),
          outputCommitments: data.outputCommitments.map(String),
          ciphertextHashes: ciphertextHashes.map(String),
          amount: "1000",
        };
        const result = await snarkjs.groth16.fullProve(
          {
            ...witness,
            ownerSecret: String(donorOwnerSecret),
            outputAmounts: ["1000", "0"],
            outputNonces: [String(nonce), String(nonce + 1n)],
          },
          shieldFiles.wasm,
          shieldFiles.zkey,
          undefined,
          { singleThread: true },
          { singleThread: true },
        );
        assert.deepEqual(result.publicSignals, signals.map(String));
        if (!isNative) {
          await testToken.mint(payer.address, 1000n);
          await testToken.connect(payer).approve(scope.poolAddress, 1000n);
        }
        await pool
          .connect(payer)
          .shield(1000n, data, encodeProof(result.proof), isNative ? { value: 1000n } : {});
        return {
          scope,
          donor: { ...donor, ownerSecret: donorOwnerSecret, viewingKey: donorViewingKey },
          index: 0n,
        };
      };
      const nativeDonor = await shieldDonor(native, true, 41001n);
      const tokenDonor = await shieldDonor(erc20, false, 42001n);
      const policy = {
        familyCommitment,
        parentVersion: 1n,
        rate: 10n,
        periodDays: 1n,
        policySalt: 43001n,
        allocationKeyCommitment: 43002n,
      };
      const prepared = async (
        pool,
        recipient,
        inputNote,
        index,
        operation = "deposit",
        selectedPolicy = policy,
      ) => {
        const scope = { chainId, poolAddress: await pool.getAddress() };
        const policyCommitment = computePolicyCommitment(selectedPolicy, scope);
        const budgetKey = computeBudgetKey(
          { codeAlias: recipient.decoded.codeAlias, policyCommitment },
          scope,
        );
        const stored = await pool.budgetRecords(budgetKey);
        const record = {
          exists: stored.exists,
          commonBinding: stored.commonBinding,
          policyCommitment: stored.policyCommitment,
          eligibleFrom: stored.eligibleFrom,
        };
        return offlinePayer({
          operation,
          code: recipient.encodedCode,
          authorizerScope: registryAddress,
          policy: selectedPolicy,
          asOf: await currentTime(),
          budgetPeriods: 3n,
          amount: 7n,
          scope,
          record,
          donor: {
            ownerSecret: donorOwnerSecret,
            amount: inputNote.amount,
            nonce: inputNote.nonce,
            ciphertext: inputNote.ciphertext,
            viewingKey: donorViewingKey,
            membership: await noteMembership(pool, index),
          },
        });
      };
      const submitDeposit = (pool, recipient, result) =>
        pool.connect(payer).depositBudget(
          recipient.tuple,
          recipient.capability,
          recipient.codeProof,
          recipient.capabilityProof,
          {
            policyCommitment: result.policyCommitment,
            budgetKey: result.budgetKey,
            eligibleFrom: result.eligibleFrom,
          },
          dataOf(result),
          result.proofBytes,
        );
      await assert.rejects(
        () =>
          prepared(native, first, nativeDonor.donor, 0n, "deposit", {
            ...policy,
            familyCommitment: familyCommitment + 1n,
          }),
        /Command failed/u,
      );
      const firstDeposit = await prepared(native, first, nativeDonor.donor, 0n);
      const originalSize = (await native.noteShard(0)).size;
      // A code's authenticated public role indices support direct latest-state lookups,
      // regardless of the unrelated revocations already recorded by the Source.
      for (const role of [0, 1, 2]) {
        const field = ["childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex"][role];
        assert.equal(first.capability[field], second.capability[field]);
        assert.equal(await source.isRoleRevoked(role, first.capability[field]), false);
      }
      const altered = structuredClone(firstDeposit);
      altered.outputCiphertexts[0] = hre.ethers.hexlify(new Uint8Array(512).fill(1));
      await expect(submitDeposit(native, first, altered)).to.be.revertedWithCustomError(
        native,
        "InvalidZKProof",
      );
      assert.equal((await native.noteShard(0)).size, originalSize);
      assert.equal(await native.nullifierSpent(firstDeposit.publicInput.inputNullifier), false);
      await expect(
        submitDeposit(
          native,
          { ...first, tuple: second.tuple, codeProof: second.codeProof },
          firstDeposit,
        ),
      ).to.be.revertedWithCustomError(registry, "InvalidProof");
      await expect(
        submitDeposit(native, first, {
          ...firstDeposit,
          policyCommitment: BigInt(firstDeposit.policyCommitment) + 1n,
        }),
      ).to.be.revertedWithCustomError(native, "InvalidZKProof");
      assert.equal((await native.noteShard(0)).size, originalSize);
      assert.equal((await native.budgetRecords(firstDeposit.budgetKey)).exists, false);
      await submitDeposit(native, first, firstDeposit);
      assert.equal(
        (await native.budgetRecords(firstDeposit.budgetKey)).eligibleFrom,
        BigInt(firstDeposit.eligibleFrom),
      );
      const firstChange = {
        ...firstDeposit.changeNote,
        ciphertext: firstDeposit.outputCiphertexts[1],
      };
      const append = await prepared(native, first, firstChange, 3n);
      assert.equal(append.kind, "append");
      assert.equal(append.eligibleFrom, firstDeposit.eligibleFrom);
      await expect(
        submitDeposit(native, first, { ...append, eligibleFrom: BigInt(append.eligibleFrom) + 1n }),
      ).to.be.revertedWithCustomError(native, "InvalidBudget");
      await submitDeposit(native, first, append);
      const secondCodeDeposit = await prepared(
        native,
        second,
        { ...append.changeNote, ciphertext: append.outputCiphertexts[1] },
        5n,
      );
      await submitDeposit(native, second, secondCodeDeposit); // Relaxed cross-code first acceptance.
      assert.notEqual(firstDeposit.budgetKey, secondCodeDeposit.budgetKey);
      const tokenDeposit = await prepared(erc20, first, tokenDonor.donor, 0n);
      await submitDeposit(erc20, first, tokenDeposit); // Exactly the same code and keys, another asset pool.
      assert.equal(await testToken.balanceOf(await erc20.getAddress()), 1000n);
      await expect(submitDeposit(native, first, firstDeposit)).to.be.revertedWithCustomError(
        native,
        "NullifierAlreadySpent",
      );

      const recoveredBudget = await decryptBudgetNote(
        {
          hpkeIkm: first.keyMaterial.hpkeIkm,
          ciphertext: firstDeposit.outputCiphertexts[0],
          noteCommitment: firstDeposit.outputCommitments[0],
        },
        nativeDonor.scope,
      );
      assert.equal(recoveredBudget.note.remaining, 30n);
      await hre.networkHelpers.time.increaseTo(BigInt(secondCodeDeposit.eligibleFrom) + 86400n);
      const claimInput = async (
        recipient,
        deposit,
        index,
        periodIndex = 0n,
        qualification = claimQualification,
      ) =>
        prepareBudgetClaim(
          {
            note: deposit.note,
            ciphertext: deposit.outputCiphertexts[0],
            noteCommitment: deposit.outputCommitments[0],
            authorizerScope: registryAddress,
            qualification,
            keyMaterial: recipient.keyMaterial,
            membership: await noteMembership(native, index),
            periodIndex,
            asOf: await currentTime(),
            proveClaim: (witness) => proveProtocol({ circuit: "claim", witness }),
          },
          nativeDonor.scope,
        );
      const claimDataOf = (claim) => ({
        budgetKey: claim.publicInput.budgetKey,
        asOf: claim.publicInput.asOf,
        periodNullifier: claim.periodNullifier,
        issuanceRoot: claim.publicInput.issuanceRoot,
        childRoleIndex: claim.publicInput.childRoleIndex,
        endorsementRoleIndex: claim.publicInput.endorsementRoleIndex,
        trustedRoleIndex: claim.publicInput.trustedRoleIndex,
      });
      const claimFirst = await claimInput(first, firstDeposit, 2n);
      await native.claimBudget(
        claimDataOf(claimFirst),
        dataOf(claimFirst),
        encodeProof(claimFirst.proof),
      );
      const payout = await decryptShieldedNote({
        ...nativeDonor.scope,
        hpkeIkm: first.keyMaterial.hpkeIkm,
        ciphertext: claimFirst.outputCiphertexts[1],
      });
      const recoveredPayout = verifyShieldedNotePayload(
        {
          payload: payout,
          ciphertext: claimFirst.outputCiphertexts[1],
          noteCommitment: claimFirst.outputCommitments[1],
        },
        nativeDonor.scope,
      );
      assert.equal(recoveredPayout.note.amount, 10n);
      const claimSecond = await claimInput(second, secondCodeDeposit, 6n);
      assert.equal(claimSecond.periodNullifier, claimFirst.periodNullifier);
      const sizeBeforeClaimReject = (await native.noteShard(0)).size;
      await expect(
        native.claimBudget(
          claimDataOf(claimSecond),
          dataOf(claimSecond),
          encodeProof(claimSecond.proof),
        ),
      ).to.be.revertedWithCustomError(native, "NullifierAlreadySpent");
      assert.equal(await native.nullifierSpent(claimSecond.inputNullifier), false);
      assert.equal(await native.commitmentExists(claimSecond.outputCommitments[0]), false);
      assert.equal((await native.noteShard(0)).size, sizeBeforeClaimReject);
      // A valid Claim for the next period is also checked against the latest qualification at submission.
      await hre.networkHelpers.time.increaseTo(BigInt(firstDeposit.eligibleFrom) + 2n * 86400n);
      const pendingClaim = await claimInput(first, append, 4n, 1n);

      // A correctly proved pending append is invalidated by a later actual trust withdrawal.
      const donorAfterBudget = {
        ...secondCodeDeposit.changeNote,
        ciphertext: secondCodeDeposit.outputCiphertexts[1],
      };
      const pending = await prepared(native, first, donorAfterBudget, 7n);
      const pendingNewPolicy = await prepared(native, first, donorAfterBudget, 7n, "deposit", {
        ...policy,
        policySalt: policy.policySalt + 7n,
        rate: 13n,
        periodDays: 2n,
      });

      // Authenticate a second actual subject before borrowing its active indices.
      // The outer snapshot keeps these extra notes and lineage writes out of the
      // main money flow; inner snapshots reuse the same real proofs for each role.
      const matrixSnapshot = await hre.networkHelpers.takeSnapshot();
      let matrixPhase = "create other subject";
      try {
        const other = makeTestPerson("Other  Child", { derivedSecretField: 99004n });
        const otherHash = await addPerson(hre.ethers, deepFamily, manager, undefined, {
          person: other,
          fatherPerson: parent,
          motherPerson: mother,
        });
        const otherBuilt = buildPersonCommitmentCircuitInput(
          other,
          parent,
          mother,
          manager.address,
        );
        const otherIdentity = otherBuilt.person.identityCommitment;
        assert.notEqual(otherIdentity, childIdentity);
        const otherFee = await token.recentReward();
        await token.transfer(endorser.address, otherFee);
        await token.connect(endorser).approve(await deepFamily.getAddress(), otherFee);
        matrixPhase = "endorse other subject";
        await deepFamily.connect(endorser).endorseVersion(otherHash, 1);
        const [, otherFactIndex] = await lineageIndex.endorsementLeafIndex(
          otherHash,
          endorser.address,
        );
        const otherFactPath = await lineageIndex.getMerkleProof(0, otherFactIndex);
        const [, otherWrittenAt] = await lineageIndex.getEndorsementMetadata(
          otherHash,
          endorser.address,
        );
        const otherSecrets = [910001n, 910002n, 910003n];
        const otherFactSalt = 920001n,
          otherTrustSalt = 920002n;
        const otherFact = sourceFactFixture({
          chainId,
          sourceAddress: BigInt(await source.getAddress()),
          childIdentity: otherIdentity,
          parentIdentity,
          endorser: BigInt(endorser.address),
          parentVersion: 1n,
          childVersion: 1n,
          fatherIdentity: parentIdentity,
          motherIdentity: otherBuilt.mother.identityCommitment,
          writtenAt: otherWrittenAt,
          xChild: otherSecrets[0],
          xEndorse: otherSecrets[1],
          sourceFactSalt: otherFactSalt,
          endorsementDepth: otherFactPath.proofDepth,
          endorsementIndex: otherFactPath.proofIndex,
          endorsementSiblings: [
            ...otherFactPath.siblings,
            ...Array(64 - otherFactPath.siblings.length).fill(0n),
          ],
        });
        otherFact.witness.endorsementRoot = String(otherFactPath.proofRoot);
        otherFact.publicSignals[9] = otherFactPath.proofRoot;
        const otherFactProof = await proveProtocol({
          circuit: "sourceFact",
          witness: otherFact.witness,
          expectedPublicSignals: otherFact.publicSignals,
        });
        const otherSourceIndex = await source.sourceSize(0);
        matrixPhase = "publish other source fact";
        await source
          .connect(endorser)
          .publishFact(
            otherIdentity,
            parentIdentity,
            endorser.address,
            1,
            otherFact.publicSignals[0],
            otherFact.publicSignals[1],
            otherFact.publicSignals[2],
            otherFactProof.solidityProof,
          );
        // Adding a person also updates the trusted tree. Authenticate the original
        // parent/endorser leaf against its current path for this new publication.
        const currentTrustPath = await lineageIndex.getMerkleProof(1, trustIndex);
        const otherTrust = sourceTrustFixture({
          ...numeric(sourceTrust.witness),
          xTrust: otherSecrets[2],
          sourceTrustSalt: otherTrustSalt,
          trustedDepth: currentTrustPath.proofDepth,
          trustedIndex: currentTrustPath.proofIndex,
          trustedSiblings: [
            ...currentTrustPath.siblings,
            ...Array(64 - currentTrustPath.siblings.length).fill(0n),
          ],
        });
        otherTrust.witness.trustedRoot = String(currentTrustPath.proofRoot);
        otherTrust.publicSignals[7] = currentTrustPath.proofRoot;
        const otherTrustProof = await proveProtocol({
          circuit: "sourceTrust",
          witness: otherTrust.witness,
          expectedPublicSignals: otherTrust.publicSignals,
        });
        const otherTrustIndex = await source.sourceSize(1);
        matrixPhase = "publish other source trust";
        await source.publishTrust(
          parentIdentity,
          endorser.address,
          1,
          otherTrust.publicSignals[0],
          otherTrust.publicSignals[1],
          otherTrustProof.solidityProof,
        );
        const otherSourcePath = await source.getSourceProof(0, otherSourceIndex);
        const otherTrustedPath = await source.getSourceProof(1, otherTrustIndex);
        const otherIssuance = eligibilityFixture({
          ...numeric(issueOpening),
          nameField: BigInt(otherBuilt.person.nameField),
          derivedSecretField: other.derivedSecretField,
          isBirthBC: BigInt(otherBuilt.person.isBirthBC ? 1 : 0),
          birthYear: BigInt(other.birthYear),
          birthMonth: BigInt(other.birthMonth),
          birthDay: BigInt(other.birthDay),
          gender: BigInt(other.gender),
          issueNonce: 930001n,
          xChild: otherSecrets[0],
          xEndorse: otherSecrets[1],
          xTrust: otherSecrets[2],
          sourceFactSalt: otherFactSalt,
          sourceTrustSalt: otherTrustSalt,
          credentialSalt: 930002n,
          sourceDepth: otherSourcePath.depth,
          sourceIndex: otherSourcePath.index,
          sourceSiblings: [
            ...otherSourcePath.siblings,
            ...Array(64 - otherSourcePath.siblings.length).fill(0n),
          ],
          trustedDepth: otherTrustedPath.depth,
          trustedIndex: otherTrustedPath.index,
          trustedSiblings: [
            ...otherTrustedPath.siblings,
            ...Array(64 - otherTrustedPath.siblings.length).fill(0n),
          ],
        });
        assert.equal(otherIssuance.identity, otherIdentity);
        assert.equal(otherIssuance.familyRoot, familyCommitment);
        const otherIssueProof = await proveProtocol({
          circuit: "issue",
          witness: otherIssuance.witness,
          expectedPublicSignals: otherIssuance.publicSignals,
        });
        const otherCredentialIndex = await registry.credentialCount();
        matrixPhase = "register other qualification";
        await registry.registerCredential(
          otherIssuance.credentialCommitment,
          otherIssuance.witness.sourceRoot,
          otherIssuance.witness.trustedRoot,
          otherIssueProof.solidityProof,
        );
        const otherCredentialPath = await registry.getCredentialProof(otherCredentialIndex);
        const otherPath = {
          credentialDepth: otherCredentialPath.depth,
          credentialIndex: otherCredentialPath.index,
          credentialSiblings: [
            ...otherCredentialPath.siblings,
            ...Array(32 - otherCredentialPath.siblings.length).fill(0n),
          ],
        };
        matrixPhase = "authenticate other code capability";
        const otherCode = await makeCode(3n, otherIssuance, other.derivedSecretField, otherPath);
        assert.equal(otherCode.capability.issuanceRoot, otherCredentialPath.root);
        for (const field of ["childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex"])
          assert.notEqual(otherCode.capability[field], first.capability[field]);
        const otherQualification = {
          ...otherIssuance.witness,
          familyRoot: otherIssuance.familyRoot,
          issuanceRoot: otherCredentialPath.root,
          ...otherPath,
        };
        assert.equal(
          await registry.verifyBudgetCapability(
            otherCode.tuple,
            otherCode.capability,
            otherCode.codeProof,
            otherCode.capabilityProof,
          ),
          true,
        );
        const otherDeposit = await prepared(native, otherCode, donorAfterBudget, 7n);
        const otherNoteIndex = (await native.noteShard(0)).size;
        matrixPhase = "fund other subject";
        await submitDeposit(native, otherCode, otherDeposit);
        await hre.networkHelpers.time.increaseTo(BigInt(otherDeposit.eligibleFrom) + 86400n);
        const matrixDonor = {
          ...otherDeposit.changeNote,
          ciphertext: otherDeposit.outputCiphertexts[1],
        };
        const matrixDonorIndex = otherNoteIndex + 1n;
        const attempts = [];
        for (const [recipient, deposit, noteIndex] of [
          [first, append, 4n],
          [second, secondCodeDeposit, 6n],
        ]) {
          attempts.push({
            recipient,
            append: await prepared(native, recipient, matrixDonor, matrixDonorIndex),
            first: await prepared(native, recipient, matrixDonor, matrixDonorIndex, "deposit", {
              ...policy,
              policySalt: policy.policySalt + 7n,
              rate: 13n,
              periodDays: 2n,
            }),
            claim: await claimInput(recipient, deposit, noteIndex, 1n),
          });
        }
        assert.equal(attempts[0].claim.periodNullifier, attempts[1].claim.periodNullifier);
        const otherNew = await prepared(
          native,
          otherCode,
          matrixDonor,
          matrixDonorIndex,
          "deposit",
          { ...policy, policySalt: policy.policySalt + 99n },
        );
        const otherClaim = await claimInput(
          otherCode,
          otherDeposit,
          otherNoteIndex,
          0n,
          otherQualification,
        );
        assert.notEqual(otherClaim.periodNullifier, attempts[0].claim.periodNullifier);
        const roleSnapshot = await hre.networkHelpers.takeSnapshot();
        for (const [role, field] of [
          "childRoleIndex",
          "endorsementRoleIndex",
          "trustedRoleIndex",
        ].entries()) {
          matrixPhase = `role ${role} revocation matrix`;
          try {
            await deepFamily
              .connect(role === 2 ? manager : endorser)
              .revokeEligibilityRoles([role], [roleSecrets[role]]);
            assert.equal(await source.isRoleRevoked(role, first.capability[field]), true);
            assert.equal(await source.isRoleRevoked(role, otherCode.capability[field]), false);
            const sizeBeforeRejects = (await native.noteShard(0)).size;
            for (const attempt of attempts) {
              const { recipient, claim } = attempt;
              for (const deposit of [attempt.first, attempt.append]) {
                await expect(submitDeposit(native, recipient, deposit))
                  .to.be.revertedWithCustomError(registry, "QualificationRevoked")
                  .withArgs(role);
                // The replacement index comes from a fully authenticated, active
                // other subject. The original Capability proof cannot authorize it.
                await expect(
                  submitDeposit(
                    native,
                    {
                      ...recipient,
                      capability: { ...recipient.capability, [field]: otherCode.capability[field] },
                    },
                    deposit,
                  ),
                ).to.be.revertedWithCustomError(registry, "InvalidProof");
                assert.equal(
                  await native.nullifierSpent(deposit.publicInput.inputNullifier),
                  false,
                );
              }
              await expect(
                native.claimBudget(claimDataOf(claim), dataOf(claim), encodeProof(claim.proof)),
              )
                .to.be.revertedWithCustomError(registry, "QualificationRevoked")
                .withArgs(role);
              await expect(
                native.claimBudget(
                  { ...claimDataOf(claim), [field]: otherCode.capability[field] },
                  dataOf(claim),
                  encodeProof(claim.proof),
                ),
              ).to.be.revertedWithCustomError(native, "InvalidZKProof");
              await expect(
                submitDeposit(
                  native,
                  {
                    ...recipient,
                    capability: otherCode.capability,
                    capabilityProof: otherCode.capabilityProof,
                  },
                  attempt.append,
                ),
              ).to.be.revertedWithCustomError(registry, "InvalidProof");
              await expect(
                native.claimBudget(
                  {
                    ...claimDataOf(claim),
                    issuanceRoot: otherCode.capability.issuanceRoot,
                    childRoleIndex: otherCode.capability.childRoleIndex,
                    endorsementRoleIndex: otherCode.capability.endorsementRoleIndex,
                    trustedRoleIndex: otherCode.capability.trustedRoleIndex,
                  },
                  dataOf(claim),
                  encodeProof(claim.proof),
                ),
              ).to.be.revertedWithCustomError(native, "InvalidZKProof");
              assert.equal(await native.nullifierSpent(claim.inputNullifier), false);
              assert.equal(await native.nullifierSpent(claim.periodNullifier), false);
              assert.equal(await native.commitmentExists(claim.outputCommitments[0]), false);
              assert.equal(
                await registry.verifyReceive(recipient.tuple, recipient.codeProof),
                true,
              );
            }
            assert.equal((await native.noteShard(0)).size, sizeBeforeRejects);
            // A different subject's actual money operations remain available.
            assert.equal(
              await registry.verifyBudgetCapability(
                otherCode.tuple,
                otherCode.capability,
                otherCode.codeProof,
                otherCode.capabilityProof,
              ),
              true,
            );
            await submitDeposit(native, otherCode, otherNew);
            await native.claimBudget(
              claimDataOf(otherClaim),
              dataOf(otherClaim),
              encodeProof(otherClaim.proof),
            );
            assert.equal(await native.nullifierSpent(otherClaim.inputNullifier), true);
            assert.equal(await native.nullifierSpent(otherClaim.periodNullifier), true);
            assert.equal((await native.budgetRecords(otherNew.budgetKey)).exists, true);
          } finally {
            await roleSnapshot.restore();
          }
        }
      } catch (error) {
        throw new Error(`${matrixPhase}: ${error.message}`, { cause: error });
      } finally {
        await matrixSnapshot.restore();
      }

      await deepFamily.withEligibilityRevocations(
        [2],
        [roleSecrets[2]],
        deepFamily.interface.encodeFunctionData("removeTrustedEndorser", [
          parentHash,
          1,
          endorser.address,
        ]),
      );
      const sizeBeforeRevokeReject = (await native.noteShard(0)).size;
      await expect(submitDeposit(native, first, pending))
        .to.be.revertedWithCustomError(registry, "QualificationRevoked")
        .withArgs(2);
      await expect(submitDeposit(native, first, pendingNewPolicy))
        .to.be.revertedWithCustomError(registry, "QualificationRevoked")
        .withArgs(2);
      assert.equal((await native.noteShard(0)).size, sizeBeforeRevokeReject);
      assert.equal(await native.nullifierSpent(pending.publicInput.inputNullifier), false);
      await expect(
        native.claimBudget(
          claimDataOf(pendingClaim),
          dataOf(pendingClaim),
          encodeProof(pendingClaim.proof),
        ),
      )
        .to.be.revertedWithCustomError(registry, "QualificationRevoked")
        .withArgs(2);
      assert.equal(await native.nullifierSpent(pendingClaim.inputNullifier), false);
      assert.equal(await native.nullifierSpent(pendingClaim.periodNullifier), false);
      assert.equal(await native.commitmentExists(pendingClaim.outputCommitments[0]), false);
      assert.equal(await registry.verifyReceive(first.tuple, first.codeProof), true);

      const transfer = await prepared(native, first, donorAfterBudget, 7n, "transfer");
      await native
        .connect(payer)
        .transfer(first.tuple, first.codeProof, dataOf(transfer), transfer.proofBytes);
      const transferPayload = await decryptShieldedNote({
        ...nativeDonor.scope,
        hpkeIkm: first.keyMaterial.hpkeIkm,
        ciphertext: transfer.outputCiphertexts[0],
      });
      const recoveredTransfer = verifyShieldedNotePayload(
        {
          payload: transferPayload,
          ciphertext: transfer.outputCiphertexts[0],
          noteCommitment: transfer.outputCommitments[0],
        },
        nativeDonor.scope,
      );
      assert.equal(recoveredTransfer.note.amount, 7n);
      const letterScope = { chainId, lettersAddress: await letters.getAddress(), messageId: 7001n };
      const letterCiphertext = await encryptShieldedLetter({
        ...letterScope,
        recipientPublicKey: first.decoded.viewingKey,
        envelope: createShieldedLetterEnvelope({ body: "同一个收款码收到的家书" }),
      });
      const letterReceipt = await (
        await letters
          .connect(payer)
          .registerLetter(7001n, first.tuple, first.codeProof, letterCiphertext)
      ).wait();
      const letterEvent = letterReceipt.logs
        .map((log) => {
          try {
            return letters.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((log) => log?.name === "LetterRegistered");
      const archived = hre.ethers
        .getBytes(await hre.ethers.provider.getCode(letterEvent.args.blob.pointer))
        .slice(1);
      assert.equal(hre.ethers.hexlify(archived), hre.ethers.hexlify(letterCiphertext));
      const openedLetter = await decryptShieldedLetter({
        ...letterScope,
        hpkeIkm: first.keyMaterial.hpkeIkm,
        ciphertext: archived,
        relationCommitment: 0n,
        expectedBinding: first.decoded.commonBinding,
      });
      assert.equal(openedLetter.body, "同一个收款码收到的家书");

      // Code revocation independently prevents new generic acceptance.
      const pendingTransfer = await prepared(
        native,
        first,
        { ...transfer.changeNote, ciphertext: transfer.outputCiphertexts[1] },
        11n,
        "transfer",
      );
      await registry.revokeCode(first.revocationSecret);
      await expect(
        native.transfer(
          first.tuple,
          first.codeProof,
          dataOf(pendingTransfer),
          pendingTransfer.proofBytes,
        ),
      ).to.be.revertedWithCustomError(registry, "CodeRevoked");
      assert.equal(await native.nullifierSpent(pendingTransfer.publicInput.inputNullifier), false);
      assert.equal(await native.commitmentExists(pendingTransfer.outputCommitments[0]), false);
      await expect(
        letters.registerLetter(7002n, first.tuple, first.codeProof, letterCiphertext),
      ).to.be.revertedWithCustomError(registry, "CodeRevoked");

      // Already claimed VALUE notes can leave the canonical ledger even after the
      // generic code or family capability is withdrawn. Both boundary relations
      // use their real pinned keys and the simplified ledger ABI.
      const boundaryProver = async (witness, capacity) => {
        const action = capacity === 1 ? "unshield" : "unshield4";
        const manifest = JSON.parse(
          fs.readFileSync(path.join(ROOT, BOUNDARY_DEVELOPMENT_MANIFEST)),
        );
        const entry = manifest.circuits[action];
        const source = capacity === 1 ? "shielded_unshield" : "shielded_unshield_4";
        const files = {
          wasm: path.join(shieldDir, `${source}.wasm`),
          zkey: path.join(shieldDir, `${source}_final.zkey`),
          vkey: path.join(shieldDir, `${source}.vkey.json`),
        };
        for (const [kind, hash] of [
          ["wasm", "wasmSha256"],
          ["zkey", "zkeySha256"],
          ["vkey", "verificationKeySha256"],
        ])
          assert.equal(
            createHash("sha256").update(fs.readFileSync(files[kind])).digest("hex"),
            entry[hash],
          );
        const result = await snarkjs.groth16.fullProve(
          witness,
          files.wasm,
          files.zkey,
          undefined,
          { singleThread: true },
          { singleThread: true },
        );
        assert.equal(
          await snarkjs.groth16.verify(
            JSON.parse(fs.readFileSync(files.vkey)),
            result.publicSignals,
            result.proof,
          ),
          true,
        );
        return result;
      };
      const recipientBalance = await hre.ethers.provider.getBalance(manager.address);
      const payoutDonor = {
        ...claimFirst.valueNote,
        ownerSecret: first.keyMaterial.ownerSecret,
        viewingKey: first.decoded.viewingKey,
        ciphertext: claimFirst.outputCiphertexts[1],
        membership: await noteMembership(native, 9n),
      };
      const withdrawal = await prepareUnshield(
        {
          donor: payoutDonor,
          amount: 2n,
          recipient: manager.address,
          proveUnshield: boundaryProver,
        },
        nativeDonor.scope,
      );
      await expect(
        native
          .connect(payer)
          .unshield(manager.address, 3n, dataOf(withdrawal), encodeProof(withdrawal.proof)),
      ).to.be.revertedWithCustomError(native, "InvalidZKProof");
      assert.equal(await native.nullifierSpent(withdrawal.publicInput.inputNullifiers[0]), false);
      await native
        .connect(payer)
        .unshield(manager.address, 2n, dataOf(withdrawal), encodeProof(withdrawal.proof));
      assert.equal(await native.totalShielded(), 998n);
      const fourWithdrawal = await prepareUnshield(
        {
          amount: 15n,
          recipient: manager.address,
          donors: [
            {
              ...withdrawal.notes[0],
              ownerSecret: first.keyMaterial.ownerSecret,
              viewingKey: first.decoded.viewingKey,
              ciphertext: withdrawal.outputCiphertexts[0],
              membership: await noteMembership(native, 12n),
            },
            {
              ...transfer.note,
              ownerSecret: first.keyMaterial.ownerSecret,
              viewingKey: first.decoded.viewingKey,
              ciphertext: transfer.outputCiphertexts[0],
              membership: await noteMembership(native, 10n),
            },
          ],
          proveUnshield: boundaryProver,
        },
        nativeDonor.scope,
      );
      assert.equal(fourWithdrawal.capacity, 4);
      const fourData = blankData({
        inputShardIds: fourWithdrawal.publicInput.inputShardIds,
        inputRoots: fourWithdrawal.publicInput.inputRoots,
        inputNullifiers: fourWithdrawal.publicInput.inputNullifiers,
        outputCommitments: fourWithdrawal.outputCommitments,
        outputCiphertexts: fourWithdrawal.outputCiphertexts,
      });
      await expect(
        native
          .connect(payer)
          .unshield(payer.address, 15n, fourData, encodeProof(fourWithdrawal.proof)),
      ).to.be.revertedWithCustomError(native, "InvalidZKProof");
      for (const nf of fourData.inputNullifiers)
        assert.equal(await native.nullifierSpent(nf), false);
      await native
        .connect(payer)
        .unshield(manager.address, 15n, fourData, encodeProof(fourWithdrawal.proof));
      for (const nf of fourData.inputNullifiers)
        assert.equal(await native.nullifierSpent(nf), true);
      assert.equal(await native.totalShielded(), 983n);
      assert.equal(await hre.ethers.provider.getBalance(manager.address), recipientBalance + 17n);
      await hre.networkHelpers.time.increaseTo(second.decoded.expiresAt);
      await expect(
        registry.verifyReceive(second.tuple, second.codeProof),
      ).to.be.revertedWithCustomError(registry, "CodeExpired");
      await expect(
        registry.verifyBudgetCapability(
          second.tuple,
          second.capability,
          second.codeProof,
          second.capabilityProof,
        ),
      ).to.be.revertedWithCustomError(registry, "CodeExpired");
    },
  );
});
