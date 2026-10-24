import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShieldedIdentityAuthorizationState,
  createShieldedIdentityAuthorizationTree,
  getShieldedIdentityAuthorizationWitness,
  prepareShieldedIdentityAuthorizationIncrement,
  prepareShieldedIdentityAuthorizationIncrementFromWitness,
  verifyShieldedIdentityAuthorizationWitness,
  computeShieldedAuthorizationAlias,
  prepareShieldedIdentityCounterAuthorization,
} from "../index.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "../constants.js";

const scope = {
  chainId: 1030n,
  authorizationStateAddress: "0x1111111111111111111111111111111111111111",
  identityCommitment: 19n,
  derivedSecretField: 13n,
};

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

test("counter transitions preserve caller state and bind authorization to its chain and contract", () => {
  const state = buildShieldedIdentityAuthorizationState();
  const first = prepareShieldedIdentityAuthorizationIncrement({ ...scope, state });
  assert.equal(state.entries.size, 0);
  assert.equal(first.publicSignals[6], 0n);
  assert.equal(first.publicSignals[7], 1n);
  const second = prepareShieldedIdentityAuthorizationIncrement({
    ...scope,
    state: first.nextState,
  });
  assert.equal(second.publicSignals[6], 1n);
  assert.equal(second.publicSignals[7], 2n);
  assert.notEqual(first.publicSignals[0], second.publicSignals[0]);
  for (const patch of [
    { chainId: 1n },
    { authorizationStateAddress: "0x2222222222222222222222222222222222222222" },
  ]) {
    assert.notEqual(
      prepareShieldedIdentityAuthorizationIncrement({ ...scope, ...patch, state }).publicSignals[0],
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
  const first = prepareShieldedIdentityAuthorizationIncrement({
    ...scope,
    state: buildShieldedIdentityAuthorizationState(),
  });
  const exhausted = buildShieldedIdentityAuthorizationState([
    [first.publicSignals[3], (1n << 64n) - 1n],
  ]);
  assert.throws(
    () => prepareShieldedIdentityAuthorizationIncrement({ ...scope, state: exhausted }),
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

test("path-only owner increments match existing full-state preparation", () => {
  const alias = computeShieldedAuthorizationAlias(scope);
  for (const entries of [
    [],
    [[11n, 1n]],
    [
      [alias, 1n],
      [11n, 2n],
    ],
    [[alias ^ (1n << 62n), 1n]],
  ]) {
    const tree = createShieldedIdentityAuthorizationTree(entries);
    const expected = prepareShieldedIdentityAuthorizationIncrement({
      ...scope,
      state: tree.snapshot(),
    });
    const actual = prepareShieldedIdentityAuthorizationIncrementFromWitness({
      ...scope,
      authorizationWitness: tree.getWitness(alias),
      authorizationStateRoot: tree.root,
    });
    assert.equal(actual.newRoot, expected.nextState.root);
    assert.deepEqual(actual.publicSignals, expected.publicSignals);
    assert.deepEqual(actual.witness, expected.witness);
  }
  const tree = createShieldedIdentityAuthorizationTree([[alias, MAX_UINT64]]);
  assert.throws(
    () =>
      prepareShieldedIdentityAuthorizationIncrementFromWitness({
        ...scope,
        authorizationWitness: tree.getWitness(alias),
        authorizationStateRoot: tree.root,
      }),
    /cannot be incremented/u,
  );
  assert.throws(
    () =>
      prepareShieldedIdentityAuthorizationIncrementFromWitness({
        ...scope,
        authorizationWitness: tree.getWitness(11n),
        authorizationStateRoot: tree.root,
      }),
    /alias/u,
  );
});

test("counter authorization has constant-size singleton roots and binds the expected counter and scope", () => {
  const alias = computeShieldedAuthorizationAlias(scope);
  for (const counter of [0n, 1n, 7n, MAX_UINT64 - 1n]) {
    const state = buildShieldedIdentityAuthorizationState(counter === 0n ? [] : [[alias, counter]]);
    const expected = prepareShieldedIdentityAuthorizationIncrement({ ...scope, state });
    const actual = prepareShieldedIdentityCounterAuthorization({
      ...scope,
      authorizationCounter: counter,
    });
    assert.deepEqual(actual.publicSignals, expected.publicSignals);
    assert.deepEqual(actual.witness, expected.witness);
    assert.equal(actual.newRoot, expected.nextState.root);
    assert.deepEqual(actual.witness.siblings, Array(64).fill("0"));
    assert.equal(actual.publicSignals[6], counter);
    assert.equal(actual.publicSignals[7], counter + 1n);
  }
  const base = prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 3n });
  for (const patch of [
    { chainId: 1n },
    { authorizationStateAddress: "0x2222222222222222222222222222222222222222" },
    { authorizationCounter: 4n },
    { identityCommitment: 20n },
  ])
    assert.notEqual(
      prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 3n, ...patch })
        .publicSignals[0],
      base.publicSignals[0],
    );
  for (const patch of [
    { authorizationCounter: MAX_UINT64 },
    { authorizationCounter: -1n },
    { authorizationCounter: "03" },
    { authorizationCounter: MAX_UINT64 + 1n },
    { identityCommitment: 0n },
    { derivedSecretField: 0n },
    { chainId: 0n },
    { authorizationStateAddress: "0x0000000000000000000000000000000000000000" },
  ])
    assert.throws(() =>
      prepareShieldedIdentityCounterAuthorization({ ...scope, authorizationCounter: 3n, ...patch }),
    );
});
