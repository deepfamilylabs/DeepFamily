import { poseidon2, poseidon3, poseidon4, poseidon5, poseidon6, poseidon8 } from "poseidon-lite";
import { eligibilityFixture, strings } from "./receive_fixture.mjs";

export function sourceFactFixture(options = {}) {
  const issue = eligibilityFixture();
  const w = Object.fromEntries(
    [
      "chainId",
      "parentIdentity",
      "endorser",
      "parentVersion",
      "xChild",
      "xEndorse",
      "sourceFactSalt",
    ].map((name) => [name, BigInt(issue.witness[name])]),
  );
  Object.assign(w, {
    sourceAddress: 0x3333333333333333333333333333333333333333n,
    childIdentity: issue.identity,
    childVersion: 5n,
    fatherIdentity: w.parentIdentity,
    motherIdentity: 998877n,
    rootIsMother: 0n,
    writtenAt: 1800000000n,
    endorsementDepth: 0n,
    endorsementIndex: 0n,
    endorsementSiblings: Array(64).fill(0n),
    ...options,
  });
  const parents = poseidon3([1009n, w.fatherIdentity, w.motherIdentity]);
  w.endorsementRoot = poseidon5([
    1007n,
    w.childIdentity,
    parents,
    w.childVersion,
    w.endorser + (w.writtenAt << 160n),
  ]);
  const leaf = hashesFact(w);
  return {
    witness: strings(w),
    publicSignals: [
      leaf,
      poseidon2([74201n, w.xChild]),
      poseidon2([74202n, w.xEndorse]),
      w.chainId,
      w.sourceAddress,
      w.childIdentity,
      w.parentIdentity,
      w.endorser,
      w.parentVersion,
      w.endorsementRoot,
    ],
  };
}
const hashesFact = (w) =>
  poseidon8([
    71002n,
    w.childIdentity,
    w.parentIdentity,
    w.endorser,
    w.xChild,
    w.xEndorse,
    w.parentVersion,
    w.sourceFactSalt,
  ]);
export function sourceTrustFixture(options = {}) {
  const issue = eligibilityFixture();
  const w = Object.fromEntries(
    ["chainId", "parentIdentity", "endorser", "parentVersion", "xTrust", "sourceTrustSalt"].map(
      (name) => [name, BigInt(issue.witness[name])],
    ),
  );
  Object.assign(w, {
    sourceAddress: 0x3333333333333333333333333333333333333333n,
    trustedDepth: 0n,
    trustedIndex: 0n,
    trustedSiblings: Array(64).fill(0n),
    ...options,
  });
  w.trustedRoot = poseidon4([1008n, w.parentIdentity, w.parentVersion, w.endorser]);
  const leaf = poseidon6([
    71003n,
    w.parentIdentity,
    w.endorser,
    w.xTrust,
    w.parentVersion,
    w.sourceTrustSalt,
  ]);
  return {
    witness: strings(w),
    publicSignals: [
      leaf,
      poseidon2([74203n, w.xTrust]),
      w.chainId,
      w.sourceAddress,
      w.parentIdentity,
      w.endorser,
      w.parentVersion,
      w.trustedRoot,
    ],
  };
}
