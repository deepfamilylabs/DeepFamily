import assert from "node:assert/strict";
import test from "node:test";
import { poseidon2, poseidon3, poseidon6 } from "poseidon-lite";
import * as protocol from "../index.js";
import {
  buildShieldedIdentityAuthorizationState,
  createShieldedIdentityAuthorizationTree,
  createShieldedIdentityAuthorizationTreeFromNodes,
  verifyShieldedIdentityAuthorizationNode,
  getShieldedIdentityAuthorizationWitness,
  verifyShieldedIdentityAuthorizationWitness,
  computeShieldedAuthorizationAlias,
  prepareShieldedIdentityCounterAuthorization,
  SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN,
} from "../index.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "../constants.js";

const scope = {
  chainId: 1030n,
  authorizationStateAddress: "0x1111111111111111111111111111111111111111",
  identityCommitment: 19n,
  derivedSecretField: 13n,
};

test("authorization node streams round-trip empty, collision and full-depth trees", () => {
  for (const entries of [
    [],
    [[11n, 2n]],
    [
      [11n, 2n],
      [12n, 3n],
    ],
    [
      [11n, 2n],
      [11n ^ (1n << 63n), 3n],
    ],
  ]) {
    const tree = createShieldedIdentityAuthorizationTree(entries);
    const records = [...tree.exportNodes()];
    const restored = createShieldedIdentityAuthorizationTreeFromNodes(tree.root, records);
    assert.deepEqual(restored.snapshot(), tree.snapshot());
    for (const alias of [11n, 12n, 13n, 11n ^ (1n << 63n)]) {
      assert.equal(restored.getCounter(alias), tree.getCounter(alias));
      assert.deepEqual(restored.getWitness(alias), tree.getWitness(alias));
    }
    for (const record of records) {
      assert.deepEqual(verifyShieldedIdentityAuthorizationNode(record, record.hash), record);
      assert.ok(Object.isFrozen(record));
      assert.throws(() => verifyShieldedIdentityAuthorizationNode(record, record.hash + 1n));
    }
  }
});

test("authorization exports capture immutable roots and emit only changed paths", () => {
  const tree = createShieldedIdentityAuthorizationTree(
    Array.from({ length: 64 }, (_, i) => [BigInt(i + 1), 1n]),
  );
  const previous = tree.clone();
  assert.deepEqual([...tree.exportNodes(previous)], []);
  const cache = new Map([...previous.exportNodes()].map((record) => [record.hash, record]));
  const oldWitness = previous.getWitness(17n);
  tree.increment(17n, 1n, 2n);
  const root = tree.root;
  const captured = tree.exportNodes(previous);
  tree.increment(17n, 2n, 3n);
  const changed = [...captured];
  assert.equal(changed[0].hash, root);
  assert.equal(changed.length, Number(oldWitness.depth) + 1);
  for (const record of changed) cache.set(record.hash, record);
  const reachable = [];
  const visit = (hash) => {
    if (hash === 0n) return;
    const record = cache.get(hash);
    assert.ok(record);
    reachable.push(record);
    if (record.kind === "branch") {
      visit(record.leftHash);
      visit(record.rightHash);
    }
  };
  visit(root);
  const restored = createShieldedIdentityAuthorizationTreeFromNodes(root, reachable);
  assert.equal(restored.getCounter(17n), 2n);
  assert.equal(tree.getCounter(17n), 3n);
  assert.equal(previous.getCounter(17n), 1n);
  assert.deepEqual(previous.getWitness(17n), oldWitness);
  const singleton = createShieldedIdentityAuthorizationTree([[11n, 1n]]);
  const beforeSplit = singleton.clone();
  singleton.increment(11n ^ (1n << 63n), 0n, 1n);
  const split = [...singleton.exportNodes(beforeSplit)];
  assert.equal(split.length, 65);
  assert.ok(!split.some((record) => record.hash === beforeSplit.root));
});

test("authorization node import rejects missing, duplicate, misplaced and uncompressed records", () => {
  const tree = createShieldedIdentityAuthorizationTree([
    [11n, 1n],
    [12n, 2n],
  ]);
  const records = [...tree.exportNodes()];
  for (const input of [
    records.slice(1),
    [...records, records[0]],
    records.map((node, i) => (i === 0 ? { ...node, hash: node.hash + 1n } : node)),
  ])
    assert.throws(() => createShieldedIdentityAuthorizationTreeFromNodes(tree.root, input));
  const leaf = { kind: "leaf", key: 11n, value: 1n, hash: poseidon3([11n, 1n, 1n]) };
  const wrongSide = {
    kind: "branch",
    leftHash: leaf.hash,
    rightHash: 0n,
    hash: poseidon2([leaf.hash, 0n]),
  };
  assert.throws(() =>
    createShieldedIdentityAuthorizationTreeFromNodes(wrongSide.hash, [wrongSide, leaf]),
  );
  const redundant = {
    kind: "branch",
    leftHash: 0n,
    rightHash: leaf.hash,
    hash: poseidon2([0n, leaf.hash]),
  };
  assert.throws(
    () => createShieldedIdentityAuthorizationTreeFromNodes(redundant.hash, [redundant, leaf]),
    /compressed/u,
  );
  for (const node of [
    { kind: "empty", hash: 1n },
    { ...leaf, value: 0n },
    { ...leaf, hash: 0n },
    { ...leaf, key: SNARK_SCALAR_FIELD },
    { kind: "branch", hash: poseidon2([0n, 0n]), leftHash: 0n, rightHash: 0n },
  ])
    assert.throws(() => verifyShieldedIdentityAuthorizationNode(node));
  assert.throws(() => createShieldedIdentityAuthorizationTreeFromNodes(0n, [leaf]), /Unreachable/u);
});

test("public dictionary distinguishes genuine absence, collisions and membership", () => {
  const state = buildShieldedIdentityAuthorizationState([
    [11n, 1n],
    [12n, 2n],
  ]);
  for (const [alias, counter] of [
    [11n, 1n],
    [12n, 2n],
    [13n, 0n],
  ]) {
    const witness = getShieldedIdentityAuthorizationWitness(state, alias);
    assert.equal(witness.authorizationCounter, counter);
    assert.equal(witness.siblings.length, 64);
    assert.equal(witness.fnc, counter === 0n ? 1n : 0n);
  }
  const empty = getShieldedIdentityAuthorizationWitness(
    buildShieldedIdentityAuthorizationState(),
    11n,
  );
  assert.equal(empty.stateRoot, 0n);
  assert.equal(empty.isOld0, 1n);
  assert.equal(empty.oldKey, 0n);
  assert.equal(empty.oldValue, 0n);
  const collision = getShieldedIdentityAuthorizationWitness(
    buildShieldedIdentityAuthorizationState([[11n, 1n]]),
    12n,
  );
  assert.equal(collision.isOld0, 0n);
  assert.equal(collision.oldKey, 11n);
  assert.equal(collision.oldValue, 1n);
});

test("owner authorizations bind exact successive counters without deriving a tree transition", () => {
  const first = prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 0n });
  const second = prepareShieldedIdentityCounterAuthorization({
    ...scope,
    authorizationCounter: 1n,
  });
  assert.deepEqual(first.publicSignals.slice(4), [0n, 1n]);
  assert.deepEqual(second.publicSignals.slice(4), [1n, 2n]);
  assert.notEqual(first.publicSignals[0], second.publicSignals[0]);
  for (const patch of [
    { chainId: 1n },
    { authorizationStateAddress: "0x2222222222222222222222222222222222222222" },
  ]) {
    assert.notEqual(
      prepareShieldedIdentityCounterAuthorization({ ...scope, ...patch, authorizationCounter: 0n })
        .publicSignals[0],
      first.publicSignals[0],
    );
  }
});

test("dictionary rejects explicit zero, duplicates, wrong roots and exhausted counters", () => {
  for (const entries of [
    [[0n, 1n]],
    [[11n, 0n]],
    [
      [11n, 1n],
      [11n, 2n],
    ],
  ])
    assert.throws(() => buildShieldedIdentityAuthorizationState(entries));
  assert.throws(() =>
    getShieldedIdentityAuthorizationWitness({ root: 1n, entries: new Map() }, 11n),
  );
  assert.throws(
    () =>
      prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: MAX_UINT64 }),
    /cannot be incremented/u,
  );
  assert.throws(
    () =>
      buildShieldedIdentityAuthorizationState([
        [11n, 1n],
        [11n + (1n << 64n), 1n],
      ]),
    /path depth/u,
  );
});

test("incremental dictionary matches independent full rebuilds after insertions and updates", () => {
  const initial = [[11n, 3n]];
  const tree = createShieldedIdentityAuthorizationTree(initial);
  const records = new Map(initial);
  let random = 17n;
  const aliases = [11n];
  for (let index = 0; index < 48; index += 1) {
    random = (random * 6364136223846793005n + 1442695040888963407n) % SNARK_SCALAR_FIELD;
    const alias = index % 3 === 0 ? aliases[index % aliases.length] : random;
    if (!records.has(alias)) aliases.push(alias);
    const oldCounter = records.get(alias) ?? 0n;
    tree.increment(alias, oldCounter, oldCounter + 1n);
    records.set(alias, oldCounter + 1n);
    const rebuilt = buildShieldedIdentityAuthorizationState(records);
    assert.equal(tree.root, rebuilt.root, `root after event ${index}`);
    assert.equal(tree.getCounter(alias), oldCounter + 1n);
    assert.deepEqual(tree.snapshot(), rebuilt);
    for (const query of [alias, aliases[0], random + 1n])
      assert.deepEqual(
        getShieldedIdentityAuthorizationWitness(tree.snapshot(), query),
        getShieldedIdentityAuthorizationWitness(rebuilt, query),
      );
  }
});

test("incremental dictionary preserves empty, collision and full-depth lookup semantics", () => {
  const tree = createShieldedIdentityAuthorizationTree();
  const absent = getShieldedIdentityAuthorizationWitness(tree.snapshot(), 17n);
  assert.equal(absent.depth, 0n);
  assert.equal(absent.isOld0, 1n);
  tree.increment(17n, 0n, 1n);
  const collision = getShieldedIdentityAuthorizationWitness(tree.snapshot(), 19n);
  assert.equal(collision.depth, 0n);
  assert.equal(collision.absent, 1n);
  assert.equal(collision.isOld0, 0n);
  assert.equal(collision.oldKey, 17n);
  const other = 17n ^ (1n << 63n);
  tree.increment(other, 0n, 1n);
  tree.increment(17n, 1n, 2n);
  const rebuilt = buildShieldedIdentityAuthorizationState([
    [17n, 2n],
    [other, 1n],
  ]);
  assert.deepEqual(tree.snapshot(), rebuilt);
  const full = getShieldedIdentityAuthorizationWitness(tree.snapshot(), 17n);
  assert.equal(full.depth, 64n);
  assert.notEqual(full.siblings[63], 0n);
  assert.deepEqual(full, getShieldedIdentityAuthorizationWitness(rebuilt, 17n));
  assert.equal(tree.getCounter(19n), 0n);
  const before = tree.snapshot();
  assert.throws(() => tree.increment(17n + (1n << 64n), 0n, 1n), /path depth/u);
  assert.deepEqual(tree.snapshot(), before);
});

test("failed incremental updates leave the mirror and its clones unchanged", () => {
  const tree = createShieldedIdentityAuthorizationTree([
    [11n, 2n],
    [12n, MAX_UINT64],
  ]);
  const before = tree.snapshot();
  const clone = tree.clone();
  for (const args of [
    [0n, 0n, 1n],
    [SNARK_SCALAR_FIELD, 0n, 1n],
    [-1n, 0n, 1n],
    ["011", 2n, 3n],
    [11n, 1n, 2n],
    [11n, 2n, 2n],
    [11n, 2n, 4n],
    [11n, -1n, 0n],
    [11n, 2n, 0n],
    [13n, 0n, 0n],
    [12n, MAX_UINT64, MAX_UINT64 + 1n],
  ]) {
    assert.throws(() => tree.increment(...args));
    assert.deepEqual(tree.snapshot(), before);
    assert.deepEqual(clone.snapshot(), before);
  }
  for (const alias of [0n, -1n, SNARK_SCALAR_FIELD, "011"])
    assert.throws(() => tree.getCounter(alias));
});

test("clones, constructor records and mutable snapshots cannot change another mirror", () => {
  const input = new Map([
    [11n, 1n],
    [12n, 2n],
  ]);
  const tree = createShieldedIdentityAuthorizationTree(input);
  const original = tree.snapshot();
  const originalWitness = getShieldedIdentityAuthorizationWitness(original, 11n);
  const clone = tree.clone();
  const snapshot = tree.snapshot();
  input.set(11n, 99n);
  snapshot.root = 0n;
  snapshot.entries.set(11n, 99n);
  snapshot.entries.set(13n, 1n);
  assert.deepEqual(tree.snapshot(), original);
  assert.deepEqual(clone.snapshot(), original);
  assert.throws(() => getShieldedIdentityAuthorizationWitness(snapshot, 11n), /inconsistent/u);
  const changedRecords = tree.snapshot();
  changedRecords.entries.set(11n, 99n);
  assert.throws(
    () => getShieldedIdentityAuthorizationWitness(changedRecords, 11n),
    /inconsistent/u,
  );
  clone.increment(11n, 1n, 2n);
  clone.increment(13n, 0n, 1n);
  assert.deepEqual(tree.snapshot(), original);
  tree.increment(12n, 2n, 3n);
  assert.equal(clone.getCounter(12n), 2n);
  assert.equal(tree.getCounter(13n), 0n);
  assert.deepEqual(getShieldedIdentityAuthorizationWitness(original, 11n), originalWitness);
  assert.throws(() => {
    tree.root = 0n;
  }, TypeError);
});

test("node-backed and externally verified paths match map witnesses without exposing nodes", () => {
  for (const entries of [
    [],
    [[11n, 1n]],
    [
      [11n, 2n],
      [12n, 3n],
    ],
    [
      [11n, 2n],
      [11n ^ (1n << 63n), 3n],
    ],
  ]) {
    const tree = createShieldedIdentityAuthorizationTree(entries);
    const state = tree.snapshot();
    for (const alias of [11n, 12n, 13n, 11n ^ (1n << 63n)]) {
      const path = tree.getWitness(alias);
      assert.deepEqual(path, getShieldedIdentityAuthorizationWitness(state, alias));
      assert.deepEqual(verifyShieldedIdentityAuthorizationWitness(path, state.root, alias), path);
      path.siblings.fill(42n);
      assert.deepEqual(
        tree.getWitness(alias),
        getShieldedIdentityAuthorizationWitness(state, alias),
      );
    }
  }
});

test("external paths reject malformed, noncanonical and unauthenticated lookups", () => {
  const tree = createShieldedIdentityAuthorizationTree([
    [11n, 2n],
    [12n, 3n],
  ]);
  const path = tree.getWitness(11n);
  const collision = createShieldedIdentityAuthorizationTree([[11n, 2n]]).getWitness(12n);
  const empty = createShieldedIdentityAuthorizationTree().getWitness(11n);
  for (const patch of [
    { authorizationAlias: 0n },
    { authorizationAlias: SNARK_SCALAR_FIELD },
    { authorizationCounter: 0n },
    { authorizationCounter: MAX_UINT64 + 1n },
    { stateRoot: path.stateRoot + 1n },
    { depth: 65n },
    { depth: -1n },
    { siblings: path.siblings.slice(1) },
    { siblings: path.siblings.map(() => 0n) },
    { siblings: path.siblings.map((sibling, index) => (index === 63 ? 1n : sibling)) },
    {
      siblings: path.siblings.map((sibling, index) => (index === 0 ? SNARK_SCALAR_FIELD : sibling)),
    },
    { oldKey: 12n },
    { oldValue: 3n },
    { isOld0: 1n },
    { isOld0: 2n },
    { absent: 1n },
    { absent: 2n },
    { fnc: 1n },
    { oldValue: "02" },
  ])
    assert.throws(() =>
      verifyShieldedIdentityAuthorizationWitness({ ...path, ...patch }, path.stateRoot),
    );
  assert.throws(() => verifyShieldedIdentityAuthorizationWitness(path, undefined));
  assert.throws(() => verifyShieldedIdentityAuthorizationWitness(path, path.stateRoot, 12n));
  for (const patch of [{ oldKey: 0n }, { oldKey: 12n }, { oldValue: 0n }])
    assert.throws(() =>
      verifyShieldedIdentityAuthorizationWitness({ ...collision, ...patch }, collision.stateRoot),
    );
  for (const patch of [{ oldKey: 1n }, { oldValue: 1n }, { isOld0: 0n }])
    assert.throws(() => verifyShieldedIdentityAuthorizationWitness({ ...empty, ...patch }, 0n));
  const wrongPath = { ...collision, depth: 1n, siblings: [1n, ...Array(63).fill(0n)] };
  assert.throws(
    () => verifyShieldedIdentityAuthorizationWitness(wrongPath, collision.stateRoot),
    /wrong path/u,
  );
  const redundant = { ...empty, depth: 1n };
  assert.throws(() => verifyShieldedIdentityAuthorizationWitness(redundant, 0n), /terminal/u);
});

test("counter authorization is independent of full-depth state and exposes no legacy tree update API", () => {
  for (const name of [
    "prepareShieldedIdentityAuthorizationIncrement",
    "prepareShieldedIdentityAuthorizationIncrementFromWitness",
  ]) {
    assert.equal(Object.hasOwn(protocol, name), false);
  }
  const alias = computeShieldedAuthorizationAlias(scope);
  const tree = createShieldedIdentityAuthorizationTree([
    [alias, 1n],
    [alias ^ (1n << 63n), 2n],
  ]);
  const before = tree.snapshot();
  assert.equal(tree.getWitness(alias).depth, 64n);
  const input = { ...scope, authorizationCounter: tree.getCounter(alias) };
  for (const name of ["state", "authorizationWitness", "authorizationStateRoot"]) {
    Object.defineProperty(input, name, {
      get() {
        throw new Error("Owner authorization must not read tree state");
      },
    });
  }
  const authorization = prepareShieldedIdentityCounterAuthorization(input);
  assert.deepEqual(authorization.publicSignals.slice(3), [alias, 1n, 2n]);
  assert.deepEqual(tree.snapshot(), before);
  assert.deepEqual(Object.keys(authorization).sort(), ["publicSignals", "witness"]);
  assert.deepEqual(Object.keys(authorization.witness).sort(), [
    "aliasR",
    "chainId",
    "consumer",
    "newCounter",
    "oldCounter",
  ]);
});

test("counter authorization matches its six-signal statement and binds identity, secret, counter and scope", () => {
  const alias = computeShieldedAuthorizationAlias(scope);
  for (const counter of [0n, 1n, 7n, MAX_UINT64 - 1n]) {
    const actual = prepareShieldedIdentityCounterAuthorization({
      ...scope,
      authorizationCounter: counter,
    });
    const nullifier = poseidon6([
      SHIELDED_IDENTITY_COUNTER_AUTHORIZATION_DOMAIN,
      scope.derivedSecretField,
      alias,
      scope.chainId,
      BigInt(scope.authorizationStateAddress),
      counter,
    ]);
    assert.deepEqual(actual.publicSignals, [
      nullifier,
      scope.chainId,
      BigInt(scope.authorizationStateAddress),
      alias,
      counter,
      counter + 1n,
    ]);
    assert.deepEqual(actual.witness, {
      chainId: String(scope.chainId),
      consumer: String(BigInt(scope.authorizationStateAddress)),
      aliasR: String(alias),
      oldCounter: String(counter),
      newCounter: String(counter + 1n),
    });
  }
  const base = prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 3n });
  for (const patch of [
    { chainId: 1n },
    { authorizationStateAddress: "0x2222222222222222222222222222222222222222" },
    { authorizationCounter: 4n },
    { identityCommitment: 20n },
    { derivedSecretField: 14n },
  ])
    assert.notEqual(
      prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 3n, ...patch })
        .publicSignals[0],
      base.publicSignals[0],
    );
});

test("counter authorization rejects exhausted counters and invalid field or scope encodings", () => {
  for (const patch of [
    { authorizationCounter: MAX_UINT64 },
    { authorizationCounter: -1n },
    { authorizationCounter: "03" },
    { authorizationCounter: MAX_UINT64 + 1n },
    { identityCommitment: 0n },
    { derivedSecretField: 0n },
    { derivedSecretField: SNARK_SCALAR_FIELD },
    { identityCommitment: SNARK_SCALAR_FIELD },
    { chainId: 0n },
    { chainId: MAX_UINT64 + 1n },
    { chainId: -1n },
    { chainId: "01030" },
    { authorizationStateAddress: "0x0000000000000000000000000000000000000000" },
    { authorizationStateAddress: `0x1${"0".repeat(40)}` },
  ])
    assert.throws(() =>
      prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 3n, ...patch }),
    );
  const atLimit = prepareShieldedIdentityCounterAuthorization({
    ...scope,
    chainId: MAX_UINT64,
    authorizationStateAddress: `0x${"ff".repeat(20)}`,
    authorizationCounter: MAX_UINT64 - 1n,
  });
  assert.deepEqual(atLimit.publicSignals.slice(1, 3), [MAX_UINT64, (1n << 160n) - 1n]);
  assert.deepEqual(atLimit.publicSignals.slice(4), [MAX_UINT64 - 1n, MAX_UINT64]);
});
