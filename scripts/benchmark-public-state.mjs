import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { keccak256, toBeHex, zeroPadValue } from "ethers";
import {
  SNARK_SCALAR_FIELD,
  createShieldedIdentityAuthorizationTree,
  createLineageTree,
  verifyShieldedIdentityAuthorizationWitness,
  buildLineageMerkleProofFromPath,
} from "@deepfamily/protocol-core";

// Pure Node CPU observations, not a browser/RPC/disk/one-hundred-million-record test.
// Example: node scripts/benchmark-public-state.mjs 1000,10000,50000
const sizes = (process.argv[2] ?? "1000,10000").split(",").map(Number);
assert(sizes.every((size) => Number.isSafeInteger(size) && size > 0 && size <= 1_000_000));
const time = (operation) => {
  const start = performance.now();
  const value = operation();
  return { milliseconds: performance.now() - start, value };
};
console.log(
  JSON.stringify({
    kind: "environment",
    node: process.version,
    sizes,
    excluded: ["alias generation", "RPC", "IndexedDB", "KDF", "proof generation", "browser/mobile"],
    interpretation: "clone samples retain shared roots; timings are observations, not guarantees",
  }),
);
for (const size of sizes) {
  const aliases = Array.from(
    { length: size },
    (_, index) =>
      (BigInt(keccak256(zeroPadValue(toBeHex(index + 1), 32))) % (SNARK_SCALAR_FIELD - 1n)) + 1n,
  );
  const built = time(() =>
    createShieldedIdentityAuthorizationTree(aliases.map((alias) => [alias, 1n])),
  );
  const authorization = built.value;
  const lineageBuilt = time(() => createLineageTree(aliases));
  const lineage = lineageBuilt.value;
  const repetitions = 10_000;
  const authClone = time(() => Array.from({ length: repetitions }, () => authorization.clone()));
  const lineageClone = time(() => Array.from({ length: repetitions }, () => lineage.clone()));
  assert.equal(authClone.value.length, repetitions);
  assert.equal(lineageClone.value.length, repetitions);
  assert.equal(authClone.value[repetitions - 1].root, authorization.root);
  assert.equal(lineageClone.value[repetitions - 1].root, lineage.root);
  const samples = Math.min(1000, size);
  const authPaths = time(() => {
    for (let i = 0; i < samples; i++) {
      const alias = aliases[Math.floor((i * size) / samples)];
      const path = authorization.getWitness(alias);
      assert.equal(path.authorizationCounter, 1n);
    }
  });
  const lineageLookup = time(() => {
    for (let i = 0; i < samples; i++) {
      const index = Math.floor((i * size) / samples);
      assert.equal(BigInt(lineage.indexOf(aliases[index])), BigInt(index));
    }
  });
  const lineagePaths = time(() => {
    for (let i = 0; i < samples; i++) lineage.generateProof(Math.floor((i * size) / samples));
  });
  const oldAuthorization = authorization.clone(),
    oldLineage = lineage.clone();
  authorization.increment(aliases[0], 1n, 2n);
  lineage.update(0, 0n);
  assert.equal(oldAuthorization.getCounter(aliases[0]), 1n);
  assert.equal(oldLineage.indexOf(aliases[0]), 0);
  verifyShieldedIdentityAuthorizationWitness(
    authorization.getWitness(aliases[0]),
    authorization.root,
    aliases[0],
  );
  buildLineageMerkleProofFromPath(lineage.generateProof(0));
  const authDirtyNodes = [...authorization.exportNodes(oldAuthorization)].length;
  const lineageDirtyNodes = [...lineage.exportNodes(oldLineage)].length;
  assert(authDirtyNodes <= 65 && lineageDirtyNodes <= 65);
  console.log(
    JSON.stringify({
      kind: "result",
      records: size,
      buildMilliseconds: built.milliseconds,
      lineageBuildMilliseconds: lineageBuilt.milliseconds,
      cloneRepetitions: repetitions,
      authorizationCloneTotalMilliseconds: authClone.milliseconds,
      lineageCloneTotalMilliseconds: lineageClone.milliseconds,
      samples,
      authorizationPathsMilliseconds: authPaths.milliseconds,
      lineageIndexedLookupsMilliseconds: lineageLookup.milliseconds,
      lineagePathsMilliseconds: lineagePaths.milliseconds,
      authorizationDirtyNodes: authDirtyNodes,
      lineageDirtyNodes,
      rssBytes: process.memoryUsage().rss,
    }),
  );
}
