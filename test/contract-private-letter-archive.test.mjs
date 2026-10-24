import {
  deployIdentityAuthorizationState,
  identityAuthorizationStateFactory,
} from "./helpers/shieldedReceiveAuthorization.mjs";
import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { buildShieldedIdentityAuthorizationState } from "@deepfamily/protocol-core";
import { readArchiveBlob } from "../packages/protocol-core/archive.js";

// These tests deliberately use exact-input mocks to isolate contract boundary checks.
// They do not claim a mock authenticates a receipt, a canonical R, or a private Fund note.
const abi = () => hre.ethers.AbiCoder.defaultAbiCoder();
const encode = (inputs) => abi().encode([`uint256[${inputs.length}]`], [inputs]);
const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ciphertext = `0x${"ab".repeat(512)}`;

async function now() {
  return BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
}

async function fixture() {
  const counterVerifier = await hre.ethers.deployContract("IdentityCounterVerifierMock");
  const state = await deployIdentityAuthorizationState(hre, await counterVerifier.getAddress());
  const verifier = await hre.ethers.deployContract("PrivateLetterVerifierMock");
  const family = await hre.ethers.deployContract("ArchiveCallerHarness");
  const factory = await hre.ethers.deployContract("PrivateLetterPoolFactoryMock", [
    await state.getAddress(),
  ]);
  const pool = await hre.ethers.deployContract("PrivateLetterPoolMock", [await state.getAddress()]);
  await factory.registerPool(hre.ethers.ZeroAddress, await pool.getAddress());
  await pool.setKnownNoteRoot(3n, 987n);
  const config = [
    await family.getAddress(),
    await state.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    await factory.getAddress(),
  ];
  const archive = await hre.ethers.deployContract("PrivateLetterArchive", config);
  return { state, counterVerifier, verifier, family, factory, pool, config, archive };
}

async function update(context, overrides = {}) {
  const { state } = context;
  const checkpointId = await state.currentCheckpointId();
  const values = {
    authorizationNullifier: 100n + checkpointId,
    aliasR: 200n + checkpointId,
    oldCounter: 0n,
    newCounter: 1n,
    ...overrides,
  };
  const inputs = [
    values.authorizationNullifier,
    (await hre.ethers.provider.getNetwork()).chainId,
    BigInt(await state.getAddress()),
    values.aliasR,
    values.oldCounter,
    values.newCounter,
  ];
  const args = [
    values.authorizationNullifier,
    values.aliasR,
    values.oldCounter,
    values.newCounter,
    encode(inputs),
  ];
  return { values, inputs, args, execute: () => state.incrementCounter(...args) };
}

async function delivery(context, overrides = {}) {
  const checkpointId = await context.state.currentCheckpointId();
  return {
    messageId: 123n,
    checkpointId,
    asOf: await now(),
    expiresAt: (await now()) + 3600n,
    recipientBinding: 456n,
    ...overrides,
  };
}

async function proof(context, data, payload = ciphertext, attachment, overrides = {}) {
  const checkpoint = await context.state.getCheckpoint(data.checkpointId);
  const digest = BigInt(hre.ethers.keccak256(payload));
  const input = [
    overrides.chainId ?? (await hre.ethers.provider.getNetwork()).chainId,
    BigInt(overrides.archive ?? (await context.archive.getAddress())),
    attachment ? 2n : 1n,
    data.messageId,
    digest & ((1n << 128n) - 1n),
    digest >> 128n,
    data.checkpointId,
    checkpoint.root,
    data.asOf,
    data.expiresAt,
    data.recipientBinding,
  ];
  if (attachment) {
    input.push(BigInt(attachment.pool), attachment.noteRoot, attachment.relationCommitment);
  }
  return encode(input);
}

describe("Shared identity authorization counter state", function () {
  this.timeout(120_000);

  it("starts with the canonical empty dictionary and exposes no administration bypass", async () => {
    const { state } = await hre.networkHelpers.loadFixture(fixture);
    expect(await state.currentRoot()).to.equal(0n);
    expect((await state.getCheckpoint(1n)).root).to.equal(0n);
    for (const name of ["advance", "setRoot", "setVerifier", "initialize", "owner"]) {
      expect(state.interface.hasFunction(name)).to.equal(false);
    }
    const State = await identityAuthorizationStateFactory(hre);
    await expect(State.deploy(hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      State,
      "InvalidVerifier",
    );
  });

  it("binds owner authorization to actual context and commits the canonical current dictionary increment", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const prepared = await update(context);
    for (const index of [0, 1, 2, 3, 4, 5]) {
      const changed = [...prepared.inputs];
      changed[index] += 1n;
      await expect(
        context.state.incrementCounter(...prepared.args.slice(0, -1), encode(changed)),
      ).to.be.revertedWithCustomError(context.state, "InvalidCounterProof");
    }
    expect(await context.state.currentCheckpointId()).to.equal(1n);
    await prepared.execute();
    expect(await context.state.currentRoot()).to.equal(
      buildShieldedIdentityAuthorizationState([[prepared.values.aliasR, 1n]]).root,
    );
    expect(await context.state.authorizationUsed(prepared.values.authorizationNullifier)).to.equal(
      true,
    );
    await expect(prepared.execute()).to.be.revertedWithCustomError(
      context.state,
      "AuthorizationAlreadyUsed",
    );
    const replay = await update(context, {
      authorizationNullifier: prepared.values.authorizationNullifier,
    });
    await expect(replay.execute()).to.be.revertedWithCustomError(
      context.state,
      "AuthorizationAlreadyUsed",
    );
    for (const values of [{ newCounter: 2n }, { oldCounter: (1n << 64n) - 1n, newCounter: 0n }]) {
      await expect((await update(context, values)).execute()).to.be.revertedWithCustomError(
        context.state,
        "InvalidCounterIncrement",
      );
    }
    await expect(
      (await update(context, { aliasR: field })).execute(),
    ).to.be.revertedWithCustomError(context.state, "InvalidFieldElement");
  });

  it("keeps checkpoints through unrelated updates and expires at exactly retirement +900 seconds", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const initial = await context.state.getCheckpoint(1n);
    await (await update(context)).execute();
    const retired = await context.state.getCheckpoint(1n);
    for (let i = 0; i < 24; i++) await (await update(context)).execute();
    expect((await context.state.getCheckpoint(1n)).retiredAt).to.equal(retired.retiredAt);
    expect(await context.state.validateCheckpoint(1n, initial.createdAt)).to.equal(0n);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 899n));
    expect(await context.state.validateCheckpoint(1n, initial.createdAt)).to.equal(0n);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 900n));
    await expect(
      context.state.validateCheckpoint(1n, initial.createdAt),
    ).to.be.revertedWithCustomError(context.state, "CheckpointExpired");
  });

  it("computes each root from its own nodes without extending an older checkpoint's retirement", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    await (await update(context)).execute();
    const original = await context.state.getCheckpoint(2n);
    await (await update(context)).execute();
    const retired = await context.state.getCheckpoint(2n);
    await hre.networkHelpers.time.increase(10);
    await (await update(context)).execute();
    expect(await context.state.firstRetiredAtByRoot(original.root)).to.equal(retired.retiredAt);
    expect(await context.state.validateCheckpoint(2n, original.createdAt)).to.equal(original.root);
    const current = await context.state.getCheckpoint(await context.state.currentCheckpointId());
    expect(current.root).not.to.equal(original.root);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 900n));
    await expect(
      context.state.validateCheckpoint(2n, original.createdAt),
    ).to.be.revertedWithCustomError(context.state, "CheckpointExpired");
  });

  it("rejects missing checkpoints and state times outside their actual lifetime", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const current = await context.state.getCheckpoint(1n);
    for (const id of [0n, 2n]) {
      await expect(context.state.validateCheckpoint(id, await now())).to.be.revertedWithCustomError(
        context.state,
        "UnknownCheckpoint",
      );
    }
    for (const asOf of [current.createdAt - 1n, (await now()) + 1n]) {
      await expect(context.state.validateCheckpoint(1n, asOf)).to.be.revertedWithCustomError(
        context.state,
        "InvalidStateTime",
      );
    }
    await (await update(context)).execute();
    const retired = await context.state.getCheckpoint(1n);
    await expect(
      context.state.validateCheckpoint(1n, retired.retiredAt + 1n),
    ).to.be.revertedWithCustomError(context.state, "InvalidStateTime");
  });
});

describe("Authenticated private letter archive boundaries", function () {
  this.timeout(120_000);

  it("binds ciphertext, message, recipient, authenticated expiry, chain and actual archive", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const data = await delivery(context);
    const valid = await proof(context, data);
    for (const changed of [
      { ...data, messageId: data.messageId + 1n },
      { ...data, recipientBinding: data.recipientBinding + 1n },
      { ...data, expiresAt: data.expiresAt + 1n },
      { ...data, asOf: data.asOf + 1n },
    ]) {
      if (changed.asOf > (await now())) await hre.networkHelpers.time.increase(1);
      await expect(
        context.archive.registerLetter(changed, ciphertext, valid),
      ).to.be.revertedWithCustomError(context.archive, "InvalidLetterProof");
    }
    await expect(context.archive.registerLetter(data, "0x01", valid)).to.be.revertedWithCustomError(
      context.archive,
      "InvalidLetterProof",
    );
    const wrongChain = await proof(context, data, ciphertext, undefined, { chainId: 1n });
    await expect(
      context.archive.registerLetter(data, ciphertext, wrongChain),
    ).to.be.revertedWithCustomError(context.archive, "InvalidLetterProof");
    const other = await hre.ethers.deployContract("PrivateLetterArchive", context.config);
    await expect(other.registerLetter(data, ciphertext, valid)).to.be.revertedWithCustomError(
      other,
      "InvalidLetterProof",
    );
    expect(await context.archive.usedMessage(data.messageId)).to.equal(false);
    expect((await context.archive.letterRecord(data.messageId)).blob.pointer).to.equal(
      hre.ethers.ZeroAddress,
    );
    await context.archive.registerLetter(data, ciphertext, valid);
    await expect(
      context.archive.registerLetter(data, ciphertext, valid),
    ).to.be.revertedWithCustomError(context.archive, "MessageAlreadyRegistered");
  });

  it("round-trips immutable ciphertext with no person or NFT and preserves it after code expiry", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    for (const length of [512, 16_385]) {
      const payload = `0x${"de".repeat(length)}`;
      const data = await delivery(context, { messageId: BigInt(length) });
      await context.archive.registerLetter(data, payload, await proof(context, data, payload));
      const record = await context.archive.letterRecord(data.messageId);
      expect(record.blob.payloadHash).to.equal(hre.ethers.keccak256(payload));
      expect(record.blob.segmentCount).to.equal(length === 512 ? 1n : 2n);
      expect(record.relationCommitment).to.equal(0n);
      const fetched = await readArchiveBlob({
        ...record.blob.toObject(),
        getCode: (address) => hre.ethers.provider.getCode(address),
      });
      expect(hre.ethers.hexlify(fetched.payload)).to.equal(payload);
    }
    await hre.networkHelpers.time.increase(3601);
    expect((await context.archive.letterRecord(512n)).blob.payloadLength).to.equal(512n);
    expect((await context.archive.storyState(512n)).totalRecords).to.equal(0n);
  });

  it("uses authenticated expiry strictly without applying the counter retirement grace", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const data = await delivery(context, { expiresAt: (await now()) + 30n });
    const valid = await proof(context, data);
    await (await update(context)).execute();
    const retired = await context.state.getCheckpoint(data.checkpointId);
    expect(retired.retiredAt).to.be.lessThan(data.expiresAt);
    await hre.networkHelpers.time.increaseTo(Number(data.expiresAt - 1n));
    await context.archive.registerLetter.staticCall(data, ciphertext, valid);
    await hre.networkHelpers.time.increaseTo(Number(data.expiresAt));
    await expect(
      context.archive.registerLetter(data, ciphertext, valid),
    ).to.be.revertedWithCustomError(context.archive, "ExpiredReceiveCode");
  });

  it("uses the same state checkpoint and rejects retired counter proofs at the exact deadline", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const data = await delivery(context);
    const valid = await proof(context, data);
    await (await update(context)).execute();
    const retired = await context.state.getCheckpoint(data.checkpointId);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 899n));
    await context.archive.registerLetter.staticCall(data, ciphertext, valid);
    await hre.networkHelpers.time.increaseTo(Number(retired.retiredAt + 900n));
    await expect(
      context.archive.registerLetter(data, ciphertext, valid),
    ).to.be.revertedWithCustomError(context.state, "CheckpointExpired");
    const fresh = await delivery(context, { messageId: 999n });
    await context.archive.registerLetter(fresh, ciphertext, await proof(context, fresh));
  });

  it("requires a canonical pool, its actual shared state, and a known root in the selected shard", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const data = await delivery(context);
    const attachment = {
      asset: hre.ethers.ZeroAddress,
      pool: await context.pool.getAddress(),
      shardId: 3n,
      noteRoot: 987n,
      relationCommitment: 654n,
    };
    const valid = await proof(context, data, ciphertext, attachment);
    const [, account] = await hre.ethers.getSigners();
    for (const changed of [
      { ...attachment, asset: account.address },
      { ...attachment, pool: account.address },
      { ...attachment, shardId: 4n },
      { ...attachment, noteRoot: 988n },
    ]) {
      await expect(
        context.archive.registerAttachedLetter(data, changed, ciphertext, valid),
      ).to.be.revertedWithCustomError(context.archive, "InvalidBudgetSource");
    }
    const wrongState = await hre.ethers.deployContract("PrivateLetterPoolMock", [account.address]);
    await wrongState.setKnownNoteRoot(3n, 987n);
    await context.factory.registerPool(account.address, await wrongState.getAddress());
    await expect(
      context.archive.registerAttachedLetter(
        data,
        { ...attachment, asset: account.address, pool: await wrongState.getAddress() },
        ciphertext,
        valid,
      ),
    ).to.be.revertedWithCustomError(context.archive, "InvalidBudgetSource");
    await expect(
      context.archive.registerAttachedLetter(
        data,
        { ...attachment, relationCommitment: 655n },
        ciphertext,
        valid,
      ),
    ).to.be.revertedWithCustomError(context.archive, "InvalidLetterProof");
    await context.archive.registerAttachedLetter(data, attachment, ciphertext, valid);
    expect((await context.archive.letterRecord(data.messageId)).relationCommitment).to.equal(654n);
    await expect(
      context.archive.registerLetter(data, ciphertext, await proof(context, data)),
    ).to.be.revertedWithCustomError(context.archive, "MessageAlreadyRegistered");
  });

  it("cannot reuse the standalone proof route for an attachment or store empty ciphertext", async () => {
    const context = await hre.networkHelpers.loadFixture(fixture);
    const data = await delivery(context);
    const attachment = {
      asset: hre.ethers.ZeroAddress,
      pool: await context.pool.getAddress(),
      shardId: 3n,
      noteRoot: 987n,
      relationCommitment: 654n,
    };
    await expect(
      context.archive.registerAttachedLetter(
        data,
        attachment,
        ciphertext,
        await proof(context, data),
      ),
    ).to.be.revertedWithCustomError(context.archive, "InvalidLetterProof");
    await expect(context.archive.registerLetter(data, "0x", "0x")).to.be.revertedWithCustomError(
      context.archive,
      "InvalidPayloadLength",
    );
    expect(await context.archive.usedMessage(data.messageId)).to.equal(false);
    expect(context.archive.interface.hasFunction("storeLetter")).to.equal(false);
  });
});
