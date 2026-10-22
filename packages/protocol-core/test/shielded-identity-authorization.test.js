import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShieldedIdentityAuthorizationState,
  getShieldedIdentityAuthorizationWitness,
  prepareShieldedIdentityAuthorizationIncrement,
} from "../index.js";

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
