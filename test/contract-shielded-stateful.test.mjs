import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { expect } from "chai";
import hre from "hardhat";
import { poseidon2 } from "poseidon-lite";
import {
  buildShieldedPoolPublicSignals,
  emptyShieldedReceiveAuthorizations,
} from "@deepfamily/protocol-core";
import {
  authorizeMockReceive,
  deployMockReceiveAuthorization,
} from "./helpers/shieldedReceiveAuthorization.mjs";

// These are stateful CONTRACT-BOUNDARY tests. The existing mock verifier authenticates
// exact purpose/public inputs, not ZK ownership, membership, maturity or conservation.
// An independent note ledger only constructs conserving, owned transitions; this tests
// their on-chain accounting, replay protection and atomic rollback across mixed sequences.
// Circuit constraints and real-proof integration remain separate required test suites.
const DAY = 86_400n;
const ACTIONS = ["shield", "fund", "claim", "privateTransfer", "unshield"];

function configuredSeeds(value = process.env.SHIELDED_STATEFUL_SEEDS) {
  if (value === undefined) return [0x5eed1234, 0xc0ffee];
  const words = value.split(",").map((word) => word.trim());
  assert(words.length >= 1 && words.length <= 8, "SHIELDED_STATEFUL_SEEDS needs 1–8 seeds");
  const seeds = words.map((word) => {
    assert(/^(?:0x[0-9a-fA-F]{1,8}|[0-9]{1,10})$/.test(word), "Invalid stateful seed");
    const seed = BigInt(word);
    assert(seed > 0n && seed <= 0xffffffffn, "Stateful seeds must be nonzero uint32 values");
    return Number(seed);
  });
  assert.equal(new Set(seeds).size, seeds.length, "Stateful seeds must be distinct");
  return seeds;
}

function configuredSteps(value = process.env.SHIELDED_STATEFUL_STEPS) {
  if (value === undefined) return 32;
  assert(/^[0-9]{1,3}$/.test(value), "Invalid SHIELDED_STATEFUL_STEPS");
  const steps = Number(value);
  assert(steps >= 16 && steps <= 256, "SHIELDED_STATEFUL_STEPS must be between 16 and 256");
  return steps;
}

function randomSource(seed) {
  let state = seed;
  return (limit) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % limit;
  };
}

// Independently rebuild the compact tree from the model's append-only leaf list.
function rootOf(leaves) {
  if (!leaves.length) return 0n;
  let row = [...leaves];
  while (row.length > 1) {
    const next = [];
    for (let i = 0; i < row.length; i += 2)
      next.push(i + 1 < row.length ? poseidon2([row[i], row[i + 1]]) : row[i]);
    row = next;
  }
  return row[0];
}

async function setup(native) {
  const [depositor, recipient] = await hre.ethers.getSigners();
  const token = await hre.ethers.deployContract("ShieldedPoolBehaviorTokenMock", [18]);
  const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
  const verifier = await hre.ethers.deployContract("ShieldedPoolVerifierMock");
  const poseidon = await hre.ethers.deployContract("PoseidonT3");
  const receive = await deployMockReceiveAuthorization(hre);
  const Pool = await hre.ethers.getContractFactory(
    native ? "ShieldedNativePool" : "ShieldedErc20Pool",
    {
      libraries: { PoseidonT3: await poseidon.getAddress() },
    },
  );
  const bindings = [
    await lineage.getAddress(),
    await verifier.getAddress(),
    ...receive.constructorArgs,
  ];
  const pool = await Pool.deploy(...(native ? bindings : [await token.getAddress(), ...bindings]));
  const receiver = await hre.ethers.deployContract("ShieldedNativeReceiverMock");
  await pool.waitForDeployment();
  await lineage.setRoots(700n, 800n);
  await token.mint(depositor.address, 1_000_000n);
  await token.approve(await pool.getAddress(), 1_000_000n);
  return { native, pool, token, lineage, receiver, depositor, recipient };
}

async function runSequence(fixture, seed, steps) {
  const { native, pool, token, lineage, receiver, depositor, recipient } = fixture;
  const poolAddress = await pool.getAddress();
  const receiverAddress = await receiver.getAddress();
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const initialRecipient = native
    ? await hre.ethers.provider.getBalance(recipient.address)
    : await token.balanceOf(recipient.address);
  const random = randomSource(seed);
  const choose = (items) => items[random(items.length)];
  let nextHandle = 1_000n;
  const fresh = () => nextHandle++;
  const model = {
    notes: [],
    leaves: [],
    roots: [],
    spent: new Set(),
    deposits: 0n,
    withdrawals: 0n,
    actions: Array(5).fill(0),
    history: [],
  };
  const available = (kind) =>
    model.notes.filter((note) => !note.spent && note.kind === kind && note.amount > 0n);
  const now = async () => BigInt((await hre.ethers.provider.getBlock("latest")).timestamp);
  const note = (kind, amount, owner, policy) => ({
    commitment: fresh(),
    nullifier: fresh(),
    kind,
    amount,
    owner,
    policy,
    spent: false,
  });
  const inputRoot = (input) =>
    choose(model.roots.filter((entry) => entry.size > input.leafIndex)).root;
  const proofFor = (plan, address = recipient.address) =>
    hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "uint256[]"],
      [
        plan.action + 2,
        buildShieldedPoolPublicSignals({
          action: plan.action,
          chainId,
          poolAddress,
          ...plan.data,
          amount: plan.amount,
          recipient: plan.action === 4 ? address : undefined,
        }),
      ],
    );
  const execute = (
    plan,
    { proof = proofFor(plan), address = recipient.address, value = plan.amount } = {},
  ) => {
    if (plan.action === 0)
      return pool.shield(plan.amount, plan.data, proof, native ? { value } : {});
    if (plan.action === 4) return pool.unshield(address, plan.amount, plan.data, proof);
    return pool[ACTIONS[plan.action]](plan.data, proof);
  };
  const poolBalance = () =>
    native ? hre.ethers.provider.getBalance(poolAddress) : token.balanceOf(poolAddress);
  const recipientBalance = () =>
    native ? hre.ethers.provider.getBalance(recipient.address) : token.balanceOf(recipient.address);

  async function stateFor(plan) {
    const nullifiers = [...plan.data.inputNullifiers, ...plan.data.periodNullifiers].filter(
      (n) => n !== 0n,
    );
    return Promise.all([
      pool.totalShielded(),
      pool.nullifierCount(),
      pool.noteShard(0).then((shard) => [...shard]),
      poolBalance(),
      recipientBalance(),
      Promise.all(nullifiers.map((n) => pool.nullifierSpent(n))),
      Promise.all(plan.data.outputCommitments.map((c) => pool.commitmentExists(c))),
      token.balanceOf(depositor.address),
      token.allowance(depositor.address, poolAddress),
    ]);
  }

  async function rejected(plan, error, options = {}) {
    const before = await stateFor(plan);
    await expect(execute(plan, options)).to.be.revertedWithCustomError(pool, error);
    assert.deepEqual(
      await stateFor(plan),
      before,
      "reverted action must restore all touched state and balances",
    );
  }

  async function makePlan(action) {
    if (action !== 0 && action !== 2 && available("value").length === 0) return makePlan(0);
    const data = {
      inputShardIds: [0n, 0n],
      inputRoots: [0n, 0n],
      inputNullifiers: [0n, 0n],
      periodNullifiers: [0n, 0n, 0n],
      outputCommitments: [],
      outputCiphertexts: [`0x${"11".repeat(512)}`, `0x${"22".repeat(512)}`],
      relation0: 0n,
      relation1: 0n,
      asOf: 0n,
      lineageCheckpointId: 0n,
      fundMode: 0n,
      budgetKind: 0n,
      receiveAuthorizations: emptyShieldedReceiveAuthorizations(),
    };
    const plan = {
      action,
      data,
      amount: 0n,
      inputs: [],
      outputs: [],
      periods: [],
      bindings: [0n, 0n],
    };
    if (action === 0) {
      plan.amount = BigInt(100 + random(901));
      const first = BigInt(1 + random(Number(plan.amount) - 1));
      plan.outputs = [note("value", first, 0), note("value", plan.amount - first, 0)];
    } else if (action === 1) {
      const donor = choose(available("value"));
      plan.inputs = [donor];
      const templates = model.notes.filter(
        (n) => n.kind === "budget" && n.policy.rate <= donor.amount,
      );
      const template = templates.length && random(2) ? choose(templates) : null;
      const rate = template?.policy.rate ?? BigInt(1 + random(Math.min(5, Number(donor.amount))));
      const periods = BigInt(1 + random(Math.min(10, Number(donor.amount / rate))));
      const policy = template?.policy ?? {
        id: fresh(),
        rate,
        eligibleFrom: (await now()) + 7200n,
        claimed: new Set(),
        tags: new Map(),
      };
      plan.outputs = [
        note("budget", rate * periods, template?.owner ?? 1 + random(2), policy),
        note("value", donor.amount - rate * periods, donor.owner),
      ];
      data.inputRoots = [inputRoot(donor), template ? inputRoot(template) : inputRoot(donor)];
      if (!template) data.inputRoots[1] = data.inputRoots[0];
      data.inputNullifiers = [donor.nullifier, fresh()];
      data.fundMode = template ? 1n : 0n;
      if (!template) {
        data.relation0 = 700n;
        data.relation1 = 800n;
        data.asOf = policy.eligibleFrom - 7200n;
        data.lineageCheckpointId = await lineage.currentCheckpointId();
      }
      plan.bindings[0] = fresh();
    } else if (action === 2) {
      const timestamp = await now();
      const candidates = available("budget")
        .map((budget) => {
          const due = Number((timestamp - budget.policy.eligibleFrom) / DAY);
          const periods = Array.from({ length: Math.max(0, due) }, (_, i) => i).filter(
            (i) => !budget.policy.claimed.has(i),
          );
          return { budget, periods };
        })
        .filter((entry) => entry.periods.length);
      if (!candidates.length) return makePlan(0);
      const { budget, periods } = choose(candidates);
      const count =
        1 + random(Math.min(3, periods.length, Number(budget.amount / budget.policy.rate)));
      plan.inputs = [budget];
      plan.periods = periods.slice(0, count);
      const payout = budget.policy.rate * BigInt(count);
      plan.outputs = [
        note("budget", budget.amount - payout, budget.owner, budget.policy),
        note("value", payout, budget.owner),
      ];
      data.inputRoots = [inputRoot(budget)];
      data.inputNullifiers = [budget.nullifier];
      data.periodNullifiers = Array.from({ length: 3 }, (_, slot) => {
        if (slot >= count) return fresh();
        const period = plan.periods[slot];
        if (!budget.policy.tags.has(period)) budget.policy.tags.set(period, fresh());
        return budget.policy.tags.get(period);
      });
      data.relation0 = 700n;
      data.relation1 = 800n;
      data.asOf = timestamp;
      data.lineageCheckpointId = await lineage.currentCheckpointId();
      data.inputShardIds = [0n];
    } else {
      const first = choose(available("value"));
      const sameOwner = available("value").filter((n) => n.owner === first.owner);
      const count = 1 + random(Math.min(4, sameOwner.length));
      plan.inputs = [first, ...sameOwner.filter((n) => n !== first)].slice(0, count);
      const total = plan.inputs.reduce((sum, n) => sum + n.amount, 0n);
      const width = count === 1 ? 1 : 4;
      data.inputShardIds = Array(width).fill(0n);
      data.inputRoots = Array.from({ length: width }, (_, i) =>
        i < count ? inputRoot(plan.inputs[i]) : 0n,
      );
      for (let i = count; i < width; i++) data.inputRoots[i] = data.inputRoots[0];
      data.inputNullifiers = Array.from(
        { length: width },
        (_, i) => plan.inputs[i]?.nullifier ?? fresh(),
      );
      const amount = BigInt(1 + random(Number(total)));
      if (action === 3) {
        const owner = random(2) ? first.owner : (first.owner + 1) % 3;
        plan.outputs = [note("value", amount, owner), note("value", total - amount, first.owner)];
        if (owner !== first.owner) plan.bindings[0] = fresh();
      } else {
        plan.amount = amount;
        plan.outputs = [note("value", total - amount, first.owner), note("value", 0n, first.owner)];
      }
    }
    data.outputCommitments = plan.outputs.map((n) => n.commitment);
    if (plan.bindings.some((binding) => binding !== 0n))
      await authorizeMockReceive(hre, pool, data, action === 1 ? 3 : 4, plan.bindings);
    return plan;
  }

  async function accepted(plan) {
    const inputTotal = plan.inputs.reduce((sum, n) => sum + n.amount, 0n);
    const outputTotal = plan.outputs.reduce((sum, n) => sum + n.amount, 0n);
    assert(
      plan.inputs.every((n) => !n.spent),
      "planner may only spend live notes",
    );
    assert(
      plan.outputs.every((n) => n.amount >= 0n),
      "planner cannot create negative notes",
    );
    assert.equal(
      new Set(plan.inputs).size,
      plan.inputs.length,
      "planner must not count a note twice",
    );
    if (plan.action >= 3) {
      assert(
        plan.inputs.every((n) => n.kind === "value"),
        "VALUE actions require VALUE inputs",
      );
      assert.equal(
        new Set(plan.inputs.map((n) => n.owner)).size,
        1,
        "VALUE inputs must share their owner",
      );
    }
    if (plan.action === 2) {
      const budget = plan.inputs[0];
      assert.equal(budget.kind, "budget");
      assert.equal(new Set(plan.periods).size, plan.periods.length);
      const timestamp = await now();
      for (const period of plan.periods) {
        assert(!budget.policy.claimed.has(period), "a model allowance cannot be claimed twice");
        assert(
          timestamp >= budget.policy.eligibleFrom + BigInt(period + 1) * DAY,
          "model claims require complete mature periods",
        );
      }
      assert(
        plan.outputs.every((n) => n.owner === budget.owner),
        "claim preserves its authorized owner",
      );
      assert.equal(plan.outputs[1].amount, budget.policy.rate * BigInt(plan.periods.length));
    }
    assert.equal(
      inputTotal + (plan.action === 0 ? plan.amount : 0n),
      outputTotal + (plan.action === 4 ? plan.amount : 0n),
      "model transition must conserve value",
    );
    const proof = proofFor(plan);
    const receipt = await (await execute(plan, { proof })).wait();
    for (const input of plan.inputs) input.spent = true;
    if (plan.action === 2)
      for (const period of plan.periods) plan.inputs[0].policy.claimed.add(period);
    for (const output of plan.outputs) {
      output.leafIndex = model.leaves.length;
      model.notes.push(output);
      model.leaves.push(output.commitment);
    }
    const nullifiers =
      plan.action === 0
        ? []
        : [...plan.data.inputNullifiers, ...(plan.action === 2 ? plan.data.periodNullifiers : [])];
    for (const nullifier of nullifiers) {
      assert(!model.spent.has(nullifier));
      model.spent.add(nullifier);
    }
    if (plan.action === 0) model.deposits += plan.amount;
    if (plan.action === 4) model.withdrawals += plan.amount;
    model.actions[plan.action]++;
    const root = rootOf(model.leaves);
    model.roots.push({ root, size: model.leaves.length });
    const liability = model.deposits - model.withdrawals;
    assert.equal(
      model.notes.filter((n) => !n.spent).reduce((sum, n) => sum + n.amount, 0n),
      liability,
    );
    const actual = await Promise.all([
      pool.totalShielded(),
      poolBalance(),
      recipientBalance(),
      pool.nullifierCount(),
      pool.noteShard(0),
      pool.isKnownNoteRoot(0, root),
      pool.isKnownNoteRoot(0, rootOf(model.leaves.slice(0, -1))),
      Promise.all(nullifiers.map((n) => pool.nullifierSpent(n))),
      Promise.all(plan.data.outputCommitments.map((c) => pool.commitmentExists(c))),
    ]);
    assert.equal(actual[0], liability);
    assert.equal(actual[1], liability);
    assert.equal(actual[2], initialRecipient + model.withdrawals);
    assert.equal(actual[3], BigInt(model.spent.size));
    assert.deepEqual(
      [...actual[4]],
      [BigInt(model.leaves.length), BigInt(Math.ceil(Math.log2(model.leaves.length))), root],
    );
    assert.equal(actual[5], true);
    assert.equal(actual[6], false);
    assert(actual[7].every(Boolean));
    assert(actual[8].every(Boolean));
    const emitted = receipt.logs
      .filter((log) => log.address.toLowerCase() === poolAddress.toLowerCase())
      .map((log) => pool.interface.parseLog(log));
    assert.deepEqual(
      emitted.filter((log) => log.name === "NullifierSpent").map((log) => log.args.nullifier),
      nullifiers,
    );
    assert.deepEqual(
      emitted.filter((log) => log.name === "NoteAppended").map((log) => log.args.commitment),
      plan.data.outputCommitments,
    );
    const boundaries = emitted.filter((log) => log.name === "ActionExecuted");
    assert.equal(boundaries.length, 1);
    assert.equal(boundaries[0].args.action, BigInt(plan.action));
    const appended = emitted.filter((log) => log.name === "NoteAppended");
    for (let slot = 0; slot < 2; slot++) {
      assert.equal(appended[slot].args.shardId, 0n);
      assert.equal(appended[slot].args.leafIndex, BigInt(model.leaves.length - 2 + slot));
      assert.equal(appended[slot].args.root, slot === 0 ? rootOf(model.leaves.slice(0, -1)) : root);
      assert.equal(appended[slot].args.ciphertext, plan.data.outputCiphertexts[slot]);
    }
    model.history.push({ plan, proof });
    return proof;
  }

  // Guarantee every action and critical rollback path is exercised for every seed/asset.
  const initial = await makePlan(0);
  await rejected(initial, "InvalidZKProof", { proof: "0x" });
  if (native) await rejected(initial, "UnexpectedNativeValue", { value: initial.amount + 1n });
  else {
    await token.setBehavior(1, depositor.address, poolAddress);
    await rejected(initial, "UnexpectedTokenTransfer");
    await token.setBehavior(0, hre.ethers.ZeroAddress, hre.ethers.ZeroAddress);
  }
  const initialProof = await accepted(initial);
  await rejected(initial, "DuplicateCommitment", { proof: initialProof });
  const funding = await makePlan(1);
  const duplicate = structuredClone(funding);
  duplicate.data.inputNullifiers[1] = duplicate.data.inputNullifiers[0];
  await rejected(duplicate, "NullifierAlreadySpent");
  await accepted(funding);
  await hre.networkHelpers.time.increase(Number(7200n + 3n * DAY));
  const claim = await makePlan(2);
  assert.equal(claim.action, 2);
  const duplicatePeriod = structuredClone(claim);
  duplicatePeriod.data.periodNullifiers[1] = duplicatePeriod.data.periodNullifiers[0];
  await rejected(duplicatePeriod, "NullifierAlreadySpent");
  await accepted(claim);
  await accepted(await makePlan(3));
  const withdrawal = await makePlan(4);
  if (native) {
    await receiver.configure(1, hre.ethers.ZeroAddress, "0x");
    await rejected(withdrawal, "NativeTransferFailed", {
      address: receiverAddress,
      proof: proofFor(withdrawal, receiverAddress),
    });
  } else {
    await token.setBehavior(1, poolAddress, recipient.address);
    await rejected(withdrawal, "UnexpectedTokenTransfer");
    await token.setBehavior(0, hre.ethers.ZeroAddress, hre.ethers.ZeroAddress);
  }
  await accepted(withdrawal);

  for (let step = 0; step < steps; step++) {
    try {
      await hre.networkHelpers.time.increase(Number(DAY));
      const plan = await makePlan(random(5));
      if (step % 4 === 0) await rejected(plan, "InvalidZKProof", { proof: "0x" });
      if (step % 5 === 0 && plan.action !== 0) {
        const unknownRoot = structuredClone(plan);
        unknownRoot.data.inputRoots[0] = 12345678901234567890n;
        await rejected(unknownRoot, "UnknownNoteRoot", { proof: proofFor(plan) });
      }
      await accepted(plan);
      if (step % 3 === 0) {
        const replay = choose(model.history.filter((entry) => entry.plan.action !== 0));
        await rejected(replay.plan, "NullifierAlreadySpent", { proof: replay.proof });
      }
    } catch (error) {
      error.message = `seed=0x${seed.toString(16)} asset=${native ? "native" : "erc20"} step=${step}: ${error.message}`;
      throw error;
    }
  }
  assert(
    model.actions.every((count) => count > 0),
    "every action must execute in every sequence",
  );
}

describe("Shielded pool seeded stateful contract boundaries (mock proofs)", function () {
  this.timeout(120_000);
  const steps = configuredSteps();
  for (const seed of configuredSeeds()) {
    for (const native of [false, true]) {
      it(`preserves its note/accounting model across ${steps} random steps (seed 0x${seed.toString(16)}, ${native ? "native" : "ERC-20"})`, async () => {
        const snapshot = await hre.networkHelpers.takeSnapshot();
        try {
          await runSequence(await setup(native), seed, steps);
        } finally {
          await snapshot.restore();
        }
      });
    }
  }
});
