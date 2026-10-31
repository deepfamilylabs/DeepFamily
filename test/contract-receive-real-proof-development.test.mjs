import { deployIdentityAuthorizationState } from "./helpers/shieldedReceiveAuthorization.mjs";
import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import {
  SHIELDED_RECEIVE_CREDENTIAL_VERSION,
  buildShieldedIdentityAuthorizationState,
  buildShieldedPoolPublicInputs,
  computeShieldedBudgetNoteCommitment,
  computeShieldedBudgetUseNullifier,
  computeShieldedEnrollmentCommitment,
  computeShieldedOwnerCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  createShieldedLetterEnvelope,
  decodeShieldedIndependentKey,
  decodeShieldedIndependentKeyMnemonic,
  decryptShieldedLetter,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyIdentitySecret,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  emptyShieldedReceiveAuthorizations,
  encodeShieldedBudgetNotePayload,
  encryptShieldedLetter,
  encryptShieldedNote,
  prepareShieldedReceivePresentation,
  prepareShieldedIdentityCounterAuthorization,
  readArchiveBlob,
  verifyShieldedNotePayload,
} from "@deepfamily/protocol-core";
import { buildShieldedFundingFixtures } from "../circuits/test/generate_shielded_funding_input.mjs";
import { buildLineageFixture } from "../circuits/test/generate_lineage_fixture.mjs";
import {
  prepareReceiveProofFixtures,
  receiveProofFixtureKeyMaterial,
  RECEIVE_PROOF_INDEPENDENT_RECOVERY,
} from "../scripts/receive-proof-smoke.mjs";
import { deployUnifiedVerifierAdapter } from "./helpers/unifiedVerifierAdapter.mjs";
import {
  checkRealReceiveArtifacts,
  deployRealReceiveVerifiers,
  realReceiveProver,
  RECEIVE_TEST_ROOT,
} from "./helpers/realReceiveProofs.mjs";

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const now = async () => BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
const hashField = (ciphertext) => BigInt(hre.ethers.keccak256(ciphertext)) % FIELD;
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
const membership = (proof) => ({
  depth: String(proof.proofDepth),
  index: String(proof.proofIndex),
  siblings: [...proof.siblings.map(String), ...Array(32 - proof.siblings.length).fill("0")],
});

describe("Receive presentation real-proof canonical pool and letter integration", function () {
  this.timeout(1_800_000);

  for (const keyMode of [0n, 1n]) {
    it(`atomically authenticates Fund and transfer receipts and recovers letters with ${keyMode === 1n ? "independent" : "identity-derived"} keys (keyMode ${keyMode})`, async function () {
      if (checkRealReceiveArtifacts().missing) this.skip();
      const snapshot = await hre.networkHelpers.takeSnapshot();
      const prover = realReceiveProver();
      const credentialDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "deepfamily-receive-credentials-"),
      );
      const gasUsed = {};
      const recordTransaction = async (label, transaction) => {
        const receipt = await (await transaction).wait();
        gasUsed[label] = receipt.gasUsed.toString();
        return receipt;
      };
      try {
        // Issuance, both Fund verifications and all letter presentations use real proofs.
        // Only lineage roots are supplied by the established test fixture.
        await prepareReceiveProofFixtures(credentialDir, {
          issuerDirectory: path.join(RECEIVE_TEST_ROOT, "frontend/public/zk/shielded"),
          authorizationCounter: 0n,
          keyMode,
        });
        const credentialInput = (name) =>
          JSON.parse(fs.readFileSync(path.join(credentialDir, `${name}.input.json`), "utf8"));
        const raw = credentialInput("anonymous");
        let keys = await receiveProofFixtureKeyMaterial(keyMode);
        const heirOwnerCommitment = keys.ownerCommitment;
        const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
        const commonCredential = {
          authorizationAlias: BigInt(raw.credentialPublicSignals[0]),
          authorizationCounter: 0n,
          expiresAt: BigInt(raw.credentialPublicSignals[2]),
          ownerCommitment: keys.ownerCommitment,
          viewingKey,
          keyMode,
        };
        const anonymous = {
          ...commonCredential,
          disclosure: "anonymous",
          proof: raw.credentialProof,
        };
        const fundCredential = {
          ...commonCredential,
          disclosure: "fund",
          proof: credentialInput("fund").credentialProof,
          identityCommitment: BigInt(credentialInput("fund").credentialPublicSignals[3]),
        };
        const generated = await deployRealReceiveVerifiers(hre);
        const adapter = await deployUnifiedVerifierAdapter(hre, {
          shield: generated.ShieldedShieldVerifier,
          fund: generated.ShieldedFundVerifier,
          privateTransfer: generated.ShieldedPrivateTransferVerifier,
        });
        const router = await hre.ethers.deployContract("ReceivePresentationVerifierRouter", [
          await generated.AnonymousReceivePresentationVerifier.getAddress(),
          await generated.FundReceivePresentationVerifier.getAddress(),
        ]);
        // A genuine empty-state absence proof authenticates zero before revocation below.
        const counterVerifier = generated.ShieldedIdentityAuthorizationUpdateVerifier;
        const counterAdapter = await hre.ethers.deployContract(
          "IdentityAuthorizationVerifierAdapter",
          [await counterVerifier.getAddress()],
        );
        const state = await deployIdentityAuthorizationState(
          hre,
          await counterAdapter.getAddress(),
        );
        const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
        const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
        const poseidon = await hre.ethers.deployContract("PoseidonT3");
        const library = { libraries: { PoseidonT3: await poseidon.getAddress() } };
        const Pool = await hre.ethers.getContractFactory("ShieldedNativePool", library);
        const pool = await Pool.deploy(
          await lineage.getAddress(),
          await adapter.getAddress(),
          await state.getAddress(),
          await router.getAddress(),
        );
        const Factory = await hre.ethers.getContractFactory("ShieldedPoolFactory", library);
        const factory = await Factory.deploy(
          await token.getAddress(),
          await lineage.getAddress(),
          await adapter.getAddress(),
          await pool.getAddress(),
          await state.getAddress(),
          await router.getAddress(),
        );
        const family = await hre.ethers.deployContract("ArchiveCallerHarness");
        const letters = await hre.ethers.deployContract("PrivateLetterArchive", [
          await family.getAddress(),
          await state.getAddress(),
          await generated.AnonymousReceivePresentationVerifier.getAddress(),
          await factory.getAddress(),
        ]);
        const poolAddress = await pool.getAddress();
        const lettersAddress = await letters.getAddress();
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        const scope = { chainId, poolAddress };
        assert.equal(await factory.poolFor(hre.ethers.ZeroAddress), poolAddress);
        const fixture = buildShieldedFundingFixtures({
          ...scope,
          keyMode: Number(keyMode),
          viewingKey,
        });
        assert.equal(
          BigInt(fixture.initial.heirIdentityCommitment),
          fundCredential.identityCommitment,
        );
        await lineage.setRoots(fixture.initial.endorsementRoot, fixture.initial.trustedRoot);
        const asOf = await now();
        const eligibleFrom = asOf + 7200n;
        const enrollment = computeShieldedEnrollmentCommitment(
          {
            policyCommitment: fixture.policy,
            heirIdentityCommitment: fundCredential.identityCommitment,
            eligibleFrom,
            enrollmentSalt: BigInt(fixture.initial.enrollmentSalt),
          },
          scope,
        );
        const donorSecret = BigInt(fixture.initial.donorOwnerSecret);
        const donorOwner = computeShieldedOwnerCommitment(donorSecret);
        const value = (amount, nonce, byte, ownerCommitment = donorOwner) => {
          const ciphertext = `0x${byte.repeat(512)}`;
          return {
            amount,
            nonce,
            ciphertext,
            ciphertextHashField: hashField(ciphertext),
            commitment: computeShieldedValueNoteCommitment(
              {
                ownerCommitment,
                amount,
                nonce,
                ciphertextHashField: hashField(ciphertext),
              },
              scope,
            ),
          };
        };
        let donor = value(1000n, 101n, "a1");
        const dummy = value(0n, 102n, "a2");
        const shield = {
          ...zeroData(),
          outputCommitments: [donor.commitment, dummy.commitment],
          outputCiphertexts: [donor.ciphertext, dummy.ciphertext],
        };
        const shieldInputs = buildShieldedPoolPublicInputs({
          action: 0,
          ...scope,
          ...shield,
          amount: 1000n,
        });
        const shieldProof = prover.circom(
          "shielded_shield",
          {
            ...shieldInputs.witness,
            ownerSecret: String(donorSecret),
            outputAmounts: ["1000", "0"],
            outputNonces: ["101", "102"],
          },
          shieldInputs.signals,
        ).solidityProof;
        await recordTransaction(
          "shield",
          pool.shield(1000n, shield, shieldProof, { value: 1000n }),
        );
        const counterState = buildShieldedIdentityAuthorizationState();
        const prepare = async (credential, consumer, action, messageId, payloadHash, salt) =>
          prepareShieldedReceivePresentation({
            credential,
            chainId,
            consumer,
            action,
            messageId,
            payloadHash,
            salt,
            checkpointId: 1n,
            asOf: await now(),
            state: counterState,
          });
        const makeBudget = async (remaining, nonce) => {
          const note = {
            budgetOrigin: "fund",
            rootIdentityCommitment: BigInt(fixture.initial.rootIdentityCommitment),
            rootVersionIndex: BigInt(fixture.initial.rootVersionIndex),
            policySalt: BigInt(fixture.initial.policySalt),
            allocationKeyCommitment: BigInt(fixture.initial.allocationKeyCommitment),
            heirIdentityCommitment: fundCredential.identityCommitment,
            eligibleFrom,
            enrollmentSalt: BigInt(fixture.initial.enrollmentSalt),
            heirOwnerCommitment,
            viewingKey: hre.ethers.hexlify(viewingKey),
            keyMode,
            amountPerPeriod: 100n,
            periodDays: BigInt(fixture.initial.periodDays),
            remaining,
            nonce,
          };
          const payload = encodeShieldedBudgetNotePayload(note, scope);
          let ciphertext;
          try {
            ciphertext = hre.ethers.hexlify(
              await encryptShieldedNote({ ...scope, recipientPublicKey: viewingKey, payload }),
            );
          } finally {
            payload.fill(0);
          }
          const committed = {
            ...note,
            policyCommitment: fixture.policy,
            enrollmentCommitment: enrollment,
            ciphertextHashField: hashField(ciphertext),
          };
          return {
            ...committed,
            ciphertext,
            commitment: computeShieldedBudgetNoteCommitment(committed, scope),
          };
        };
        const budgets = [];
        let donorLeaf = 0;
        for (const iteration of [0, 1]) {
          const nonce = 107n + BigInt(iteration) * 10n;
          const budget = await makeBudget(iteration === 0 ? 400n : 100n, nonce);
          const change = value(
            donor.amount - budget.remaining,
            nonce + 1n,
            iteration === 0 ? "c1" : "c2",
          );
          const root = (await pool.noteShard(0)).root;
          const donorPath = membership(await pool.getNoteMerkleProof(0, donorLeaf));
          const template = budgets[0];
          const data = {
            ...zeroData(),
            fundMode: BigInt(iteration),
            inputRoots: [root, root],
            inputNullifiers: [
              computeShieldedSpendNullifier(
                { ownerSecret: donorSecret, noteCommitment: donor.commitment },
                scope,
              ),
              iteration === 0 ? BigInt(fixture.initial.inputNullifiers[1]) : 0n,
            ],
            outputCommitments: [budget.commitment, change.commitment],
            outputCiphertexts: [budget.ciphertext, change.ciphertext],
            ...(iteration === 0
              ? {
                  relation0: BigInt(fixture.initial.endorsementRoot),
                  relation1: BigInt(fixture.initial.trustedRoot),
                  asOf,
                  lineageCheckpointId: await lineage.currentCheckpointId(),
                }
              : {}),
          };
          const base = iteration === 0 ? fixture.initial : fixture.continuation;
          const templatePath = template
            ? membership(await pool.getNoteMerkleProof(0, template.leaf))
            : undefined;
          if (iteration) {
            data.inputNullifiers[1] = computeShieldedBudgetUseNullifier(
              {
                policySalt: BigInt(base.policySalt),
                budgetNoteCommitment: template.commitment,
                useNonce: nonce + 2n,
              },
              scope,
            );
          }
          const presented = await prepare(
            fundCredential,
            poolAddress,
            3n,
            0n,
            await pool.receiveActionHash(data),
            nonce,
          );
          data.receiveAuthorizations[0] = {
            checkpointId: 1n,
            asOf: BigInt(presented.presentation.asOf),
            deadline: BigInt(presented.presentation.deadline),
            recipientBinding: presented.recipientBinding,
            proof: prover.presentation(presented),
          };
          const inputs = buildShieldedPoolPublicInputs({ action: 1, ...scope, ...data });
          const witness = {
            ...base,
            ...inputs.witness,
            heirOwnerCommitment: String(heirOwnerCommitment),
            receiveAuthorizationAlias: String(fundCredential.authorizationAlias),
            receiveSalt: String(nonce),
            donorAmount: String(donor.amount),
            donorNonce: String(donor.nonce),
            donorCiphertextHash: String(donor.ciphertextHashField),
            donorDepth: donorPath.depth,
            donorIndex: donorPath.index,
            donorSiblings: donorPath.siblings,
            eligibleFrom: String(eligibleFrom),
            budgetPeriods: iteration === 0 ? "4" : "1",
            budgetNonce: String(nonce),
            changeNonce: String(nonce + 1n),
            ...(iteration
              ? {
                  oldHeirOwnerCommitment: String(heirOwnerCommitment),
                  oldBudgetRemaining: String(template.remaining),
                  oldBudgetRemainingPeriods: String(template.remaining / 100n),
                  oldBudgetNonce: String(template.nonce),
                  oldBudgetCiphertextHash: String(template.ciphertextHashField),
                  oldBudgetDepth: templatePath.depth,
                  oldBudgetIndex: templatePath.index,
                  oldBudgetSiblings: templatePath.siblings,
                  budgetUseNonce: String(nonce + 2n),
                }
              : {}),
          };
          const businessProof = prover.circom(
            "shielded_fund",
            witness,
            inputs.signals,
          ).solidityProof;
          const wrongDeadline = structuredClone(data);
          wrongDeadline.receiveAuthorizations[0].deadline += 1n;
          await expect(pool.fund(wrongDeadline, businessProof)).to.be.revertedWithCustomError(
            pool,
            "InvalidReceiveProof",
          );
          await expect(pool.fund(data, "0x")).to.be.revertedWithCustomError(
            adapter,
            "MalformedProofData",
          );
          await expect(pool.fund(data, `0x${"00".repeat(256)}`)).to.be.revertedWithCustomError(
            pool,
            "InvalidZKProof",
          );
          const changedCiphertext = {
            ...data,
            outputCiphertexts: [`0x${"ff".repeat(512)}`, change.ciphertext],
          };
          await expect(pool.fund(changedCiphertext, businessProof)).to.be.revertedWithCustomError(
            pool,
            "InvalidReceiveProof",
          );
          assert.equal(await pool.nullifierSpent(data.inputNullifiers[0]), false);
          assert.equal(await pool.commitmentExists(budget.commitment), false);
          budget.leaf = Number((await pool.noteShard(0)).size);
          await recordTransaction(
            iteration === 0 ? "fundInitial" : "fundContinuation",
            pool.fund(data, businessProof),
          );
          assert.equal(await pool.commitmentExists(budget.commitment), true);
          budget.acceptedRoot = (await pool.noteShard(0)).root;
          budgets.push(budget);
          donor = change;
          donorLeaf = budget.leaf + 1;
        }
        assert.equal(await pool.totalShielded(), 1000n);
        const transferRoot = (await pool.noteShard(0)).root;
        const transferPath = membership(await pool.getNoteMerkleProof(0, donorLeaf));
        const external = value(100n, 201n, "d1", keys.ownerCommitment);
        const selfChange = value(donor.amount - 100n, 202n, "d2");
        const transfer = {
          ...zeroData(),
          inputShardIds: [0n],
          inputRoots: [transferRoot],
          inputNullifiers: [
            computeShieldedSpendNullifier(
              { ownerSecret: donorSecret, noteCommitment: donor.commitment },
              scope,
            ),
          ],
          outputCommitments: [external.commitment, selfChange.commitment],
          outputCiphertexts: [external.ciphertext, selfChange.ciphertext],
        };
        const transferSalt = 203n;
        const transferPresentation = await prepare(
          anonymous,
          poolAddress,
          4n,
          0n,
          await pool.receiveActionHash(transfer),
          transferSalt,
        );
        transfer.receiveAuthorizations[0] = {
          checkpointId: 1n,
          asOf: BigInt(transferPresentation.presentation.asOf),
          deadline: BigInt(transferPresentation.presentation.deadline),
          recipientBinding: transferPresentation.recipientBinding,
          proof: prover.presentation(transferPresentation),
        };
        const transferInputs = buildShieldedPoolPublicInputs({ action: 3, ...scope, ...transfer });
        const first = (value) => [String(value)];
        const transferProof = prover.circom(
          "shielded_private_transfer",
          {
            ...transferInputs.witness,
            inputEnabled: first(1n),
            inputOwnerSecrets: first(donorSecret),
            inputAmounts: first(donor.amount),
            inputNonces: first(donor.nonce),
            inputCiphertextHashes: first(donor.ciphertextHashField),
            inputDepths: first(transferPath.depth),
            inputIndices: first(transferPath.index),
            inputSiblings: [transferPath.siblings],
            outputOwnerCommitments: [String(keys.ownerCommitment), String(donorOwner)],
            outputAmounts: ["100", String(selfChange.amount)],
            outputNonces: ["201", "202"],
            receiveAuthorizationAliases: [String(anonymous.authorizationAlias), "0"],
            receiveSalts: [String(transferSalt), "0"],
            receiveKeyModes: [String(keyMode), "0"],
            receiveViewKeyLo: [raw.credentialPublicSignals[4], "0"],
            receiveViewKeyHi: [raw.credentialPublicSignals[5], "0"],
          },
          transferInputs.signals,
        ).solidityProof;
        const missingReceive = {
          ...transfer,
          receiveAuthorizations: emptyShieldedReceiveAuthorizations(),
        };
        await expect(
          pool.privateTransfer(missingReceive, transferProof),
        ).to.be.revertedWithCustomError(pool, "InvalidZKProof");
        const swappedReceive = {
          ...transfer,
          receiveAuthorizations: [...transfer.receiveAuthorizations].reverse(),
        };
        await expect(
          pool.privateTransfer(swappedReceive, transferProof),
        ).to.be.revertedWithCustomError(pool, "InvalidReceiveProof");
        const alteredTransfer = {
          ...transfer,
          outputCiphertexts: [selfChange.ciphertext, external.ciphertext],
        };
        await expect(
          pool.privateTransfer(alteredTransfer, transferProof),
        ).to.be.revertedWithCustomError(pool, "InvalidReceiveProof");
        assert.equal(await pool.nullifierSpent(transfer.inputNullifiers[0]), false);
        assert.equal(await pool.commitmentExists(external.commitment), false);
        await recordTransaction("privateTransfer", pool.privateTransfer(transfer, transferProof));
        assert.equal(await pool.nullifierSpent(transfer.inputNullifiers[0]), true);
        assert.equal(await pool.commitmentExists(external.commitment), true);
        assert.equal(await pool.commitmentExists(selfChange.commitment), true);
        assert.equal(await pool.totalShielded(), 1000n);
        const messageId = 700n;
        const envelope = createShieldedLetterEnvelope({ body: "家书\n落款：家人", salt: 800n });
        const ciphertext = hre.ethers.hexlify(
          await encryptShieldedLetter({
            chainId,
            lettersAddress,
            messageId,
            recipientPublicKey: viewingKey,
            envelope,
          }),
        );
        const prepared = await prepare(
          anonymous,
          lettersAddress,
          1n,
          messageId,
          hre.ethers.keccak256(ciphertext),
          envelope.salt,
        );
        const proof = prover.presentation(prepared);
        const delivery = {
          messageId,
          checkpointId: 1n,
          asOf: BigInt(prepared.presentation.asOf),
          deadline: BigInt(prepared.presentation.deadline),
          recipientBinding: prepared.recipientBinding,
        };
        await expect(
          letters.registerLetter(delivery, `${ciphertext}00`, proof),
        ).to.be.revertedWithCustomError(letters, "InvalidLetterProof");
        await recordTransaction(
          "standaloneLetter",
          letters.registerLetter(delivery, ciphertext, proof),
        );
        const record = await letters.letterRecord(messageId);
        const fetched = await readArchiveBlob({
          ...record.blob.toObject(),
          getCode: (address) => hre.ethers.provider.getCode(address),
        });
        assert.equal(hre.ethers.hexlify(fetched.payload), ciphertext);
        assert.deepEqual(
          await decryptShieldedLetter({
            chainId,
            lettersAddress,
            messageId,
            hpkeIkm: keys.hpkeIkm,
            ciphertext: fetched.payload,
            expectedCiphertextHash: record.blob.payloadHash,
          }),
          envelope,
        );
        await expect(
          letters.registerLetter(delivery, ciphertext, proof),
        ).to.be.revertedWithCustomError(letters, "MessageAlreadyRegistered");
        const records = [{ messageId, record, envelope, ciphertext: fetched.payload }];
        const pendingId = 799n;
        const pendingEnvelope = createShieldedLetterEnvelope({ body: "撤销窗口检查", salt: 899n });
        const pendingCiphertext = hre.ethers.hexlify(
          await encryptShieldedLetter({
            chainId,
            lettersAddress,
            messageId: pendingId,
            recipientPublicKey: viewingKey,
            envelope: pendingEnvelope,
          }),
        );
        const pending = await prepare(
          anonymous,
          lettersAddress,
          1n,
          pendingId,
          hre.ethers.keccak256(pendingCiphertext),
          899n,
        );
        const pendingProof = prover.presentation(pending);
        const pendingDelivery = {
          messageId: pendingId,
          checkpointId: 1n,
          asOf: BigInt(pending.presentation.asOf),
          deadline: BigInt(pending.presentation.deadline),
          recipientBinding: pending.recipientBinding,
        };
        const identity = buildLineageFixture().witness;
        const authorization = prepareShieldedIdentityCounterAuthorization({
          chainId,
          authorizationStateAddress: await state.getAddress(),
          identityCommitment: fundCredential.identityCommitment,
          derivedSecretField: identity.derivedSecretField,
          authorizationCounter: 0n,
        });
        const privateIdentity = Object.fromEntries(
          [
            "nameField",
            "derivedSecretField",
            "isBirthBC",
            "birthYear",
            "birthMonth",
            "birthDay",
            "gender",
            "suiteId",
          ].map((name) => [name, identity[name]]),
        );
        const incrementProof = prover.circom(
          "shielded_identity_authorization_update",
          {
            ...privateIdentity,
            ...authorization.witness,
          },
          authorization.publicSignals,
        ).solidityProof;
        const [authorizationNullifier, , , alias, oldCounter, newCounter] =
          authorization.publicSignals;
        await recordTransaction(
          "authorizationIncrement",
          state.incrementCounter(
            authorizationNullifier,
            alias,
            oldCounter,
            newCounter,
            incrementProof,
          ),
        );
        const updatedCounterState = buildShieldedIdentityAuthorizationState([[alias, newCounter]]);
        assert.equal(await state.currentRoot(), updatedCounterState.root);
        // Discard the issuing device's material. Recovery below uses only the original
        // backups plus credentials, after the on-chain counter has changed.
        keys = undefined;
        const restoredKeys = [];
        if (keyMode === 1n) {
          for (const originalRoot of [
            decodeShieldedIndependentKeyMnemonic(RECEIVE_PROOF_INDEPENDENT_RECOVERY.mnemonic),
            decodeShieldedIndependentKey(RECEIVE_PROOF_INDEPENDENT_RECOVERY.shieldedKey),
          ]) {
            const identitySecret = await deriveShieldedIndependentKeyIdentitySecret(
              RECEIVE_PROOF_INDEPENDENT_RECOVERY,
            );
            try {
              const restored = await deriveShieldedIndependentKeyMaterial({
                independentKeyRoot: originalRoot,
                independentKeyIdentitySecret: identitySecret,
              });
              assert.equal(restored.ownerCommitment, heirOwnerCommitment);
              assert.deepEqual(await deriveShieldedViewPublicKey(restored.hpkeIkm), viewingKey);
              restoredKeys.push(restored);
            } finally {
              originalRoot.fill(0);
              identitySecret.fill(0);
            }
          }
        } else {
          restoredKeys.push(deriveShieldedHeirKeyMaterial(BigInt(identity.derivedSecretField)));
        }
        // A proof prepared before the revocation ends at its own deadline, which never
        // outlasts the 15-minute retirement window of the checkpoint it used.
        const retired = await state.getCheckpoint(1n);
        assert.ok(pendingDelivery.deadline <= retired.retiredAt + 900n);
        await hre.networkHelpers.time.increaseTo(pendingDelivery.deadline - 1n);
        await letters.registerLetter.staticCall(pendingDelivery, pendingCiphertext, pendingProof);
        await hre.networkHelpers.time.increaseTo(pendingDelivery.deadline);
        await expect(
          letters.registerLetter.staticCall(pendingDelivery, pendingCiphertext, pendingProof),
        ).to.be.revertedWithCustomError(letters, "ExpiredReceiveCode");
        assert.equal(await letters.usedMessage(pendingId), false);
        assert.throws(
          () =>
            prepareShieldedReceivePresentation({
              credential: anonymous,
              chainId,
              consumer: lettersAddress,
              action: 1n,
              messageId: pendingId,
              payloadHash: hre.ethers.keccak256(pendingCiphertext),
              checkpointId: 2n,
              asOf: retired.retiredAt,
              state: updatedCounterState,
              salt: 899n,
            }),
          /revoked/u,
        );
        const renewedIssuer = prover.circom("shielded_anonymous_receive_credential", {
          ...privateIdentity,
          identityCommitment: String(fundCredential.identityCommitment),
          authorizationCounter: "1",
          expiresAt: String(anonymous.expiresAt),
          ownerCommitment: String(restoredKeys[0].ownerCommitment),
          viewKeyLo: raw.credentialPublicSignals[4],
          viewKeyHi: raw.credentialPublicSignals[5],
          keyMode: String(keyMode),
          identitySuiteId: "1",
          independentKeySuiteId: "1",
          independentKeyDerivationVersion: "1",
          receiveCodeVersion: String(SHIELDED_RECEIVE_CREDENTIAL_VERSION),
          spendingSecret: String(restoredKeys[0].ownerSecret),
        });
        const renewed = prepareShieldedReceivePresentation({
          credential: { ...anonymous, authorizationCounter: 1n, proof: renewedIssuer.proof },
          chainId,
          consumer: lettersAddress,
          action: 1n,
          messageId: pendingId,
          payloadHash: hre.ethers.keccak256(pendingCiphertext),
          checkpointId: 2n,
          asOf: await now(),
          state: updatedCounterState,
          salt: pendingEnvelope.salt,
        });
        const renewedProof = prover.presentation(renewed);
        const renewedDelivery = {
          ...pendingDelivery,
          checkpointId: 2n,
          asOf: BigInt(renewed.presentation.asOf),
          deadline: BigInt(renewed.presentation.deadline),
          recipientBinding: renewed.recipientBinding,
        };
        await recordTransaction(
          "renewedLetter",
          letters.registerLetter(renewedDelivery, pendingCiphertext, renewedProof),
        );
        records.push({
          messageId: pendingId,
          record: await letters.letterRecord(pendingId),
          envelope: pendingEnvelope,
          ciphertext: hre.ethers.getBytes(pendingCiphertext),
        });
        // A letter proved one minute before the code expires still lands within its own
        // deadline. Once the code has expired no new proof can be prepared, while every
        // previously authenticated immutable blob still recovers below.
        const lastId = 801n;
        const lastEnvelope = createShieldedLetterEnvelope({ body: "到期前一分钟", salt: 901n });
        const lastCiphertext = hre.ethers.hexlify(
          await encryptShieldedLetter({
            chainId,
            lettersAddress,
            messageId: lastId,
            recipientPublicKey: viewingKey,
            envelope: lastEnvelope,
          }),
        );
        const lastRequest = {
          credential: { ...anonymous, authorizationCounter: 1n, proof: renewedIssuer.proof },
          chainId,
          consumer: lettersAddress,
          action: 1n,
          messageId: lastId,
          payloadHash: hre.ethers.keccak256(lastCiphertext),
          checkpointId: 2n,
          state: updatedCounterState,
          salt: lastEnvelope.salt,
        };
        await hre.networkHelpers.time.increaseTo(anonymous.expiresAt - 60n);
        const last = prepareShieldedReceivePresentation({ ...lastRequest, asOf: await now() });
        const lastProof = prover.presentation(last);
        await hre.networkHelpers.time.increaseTo(anonymous.expiresAt + 60n);
        await recordTransaction(
          "lastMinuteLetter",
          letters.registerLetter(
            {
              messageId: lastId,
              checkpointId: 2n,
              asOf: BigInt(last.presentation.asOf),
              deadline: BigInt(last.presentation.deadline),
              recipientBinding: last.recipientBinding,
            },
            lastCiphertext,
            lastProof,
          ),
        );
        records.push({
          messageId: lastId,
          record: await letters.letterRecord(lastId),
          envelope: lastEnvelope,
          ciphertext: hre.ethers.getBytes(lastCiphertext),
        });
        assert.throws(
          () => prepareShieldedReceivePresentation({ ...lastRequest, asOf: anonymous.expiresAt }),
          /expired/u,
        );
        await expect(
          letters.registerLetter.staticCall(pendingDelivery, pendingCiphertext, pendingProof),
        ).to.be.revertedWithCustomError(letters, "ExpiredReceiveCode");
        const noteEvents = await pool.queryFilter(pool.filters.NoteAppended());
        assert.equal(new Set(budgets.map((budget) => budget.commitment)).size, 2);
        for (const restored of restoredKeys) {
          const restoredViewingKey = await deriveShieldedViewPublicKey(restored.hpkeIkm);
          for (const budget of budgets) {
            const event = noteEvents.find((entry) => entry.args.commitment === budget.commitment);
            assert.ok(event, "Recover each actual Fund budget from its on-chain ciphertext");
            const ciphertext = hre.ethers.getBytes(event.args.ciphertext);
            const payload = await decryptShieldedNote({
              ...scope,
              hpkeIkm: restored.hpkeIkm,
              ciphertext,
            });
            try {
              const opened = verifyShieldedNotePayload(
                { payload, ciphertext, noteCommitment: event.args.commitment },
                { ...scope, viewingKey: restoredViewingKey },
              );
              assert.equal(opened.note.kind, "budget");
              assert.equal(opened.note.keyMode, keyMode);
              assert.equal(opened.note.budgetOrigin, 0n);
              assert.equal(opened.note.heirOwnerCommitment, heirOwnerCommitment);
              assert.equal(opened.note.heirIdentityCommitment, fundCredential.identityCommitment);
              assert.equal(opened.note.remaining, budget.remaining);
              assert.equal(opened.policyCommitment, fixture.policy);
              assert.equal(opened.enrollmentCommitment, enrollment);
            } finally {
              payload.fill(0);
            }
          }
          for (const { messageId, envelope } of records) {
            const record = await letters.letterRecord(messageId);
            const { payload: ciphertext } = await readArchiveBlob({
              ...record.blob.toObject(),
              getCode: (address) => hre.ethers.provider.getCode(address),
            });
            assert.deepEqual(
              await decryptShieldedLetter({
                chainId,
                lettersAddress,
                messageId,
                hpkeIkm: restored.hpkeIkm,
                ciphertext,
                expectedCiphertextHash: record.blob.payloadHash,
              }),
              envelope,
            );
          }
        }
        if (keyMode === 1n) {
          const identityDerivedKeys = deriveShieldedHeirKeyMaterial(
            BigInt(identity.derivedSecretField),
          );
          assert.notEqual(identityDerivedKeys.ownerCommitment, heirOwnerCommitment);
          for (const budget of budgets) {
            const event = noteEvents.find((entry) => entry.args.commitment === budget.commitment);
            await assert.rejects(
              decryptShieldedNote({
                ...scope,
                hpkeIkm: identityDerivedKeys.hpkeIkm,
                ciphertext: hre.ethers.getBytes(event.args.ciphertext),
              }),
              { code: "SHIELDED_DECRYPTION_FAILED" },
            );
          }
          for (const { messageId, record, ciphertext } of records) {
            await assert.rejects(
              decryptShieldedLetter({
                chainId,
                lettersAddress,
                messageId,
                hpkeIkm: identityDerivedKeys.hpkeIkm,
                ciphertext,
                expectedCiphertextHash: record.blob.payloadHash,
              }),
              { code: "SHIELDED_LETTER_DECRYPTION_FAILED" },
            );
          }
        }
        if (process.env.RECEIVE_GAS_REPORT === "1") {
          console.log(`Receive real-proof gas (keyMode ${keyMode}): ${JSON.stringify(gasUsed)}`);
        }
      } finally {
        prover.cleanup();
        fs.rmSync(credentialDir, { recursive: true, force: true });
        await snapshot.restore();
      }
    });
  }
});
