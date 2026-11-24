import { describe, expect, it } from "vitest";
import { publicShieldedAssetResult } from "./shieldedAssetResults";

const state = { credentials: { handle: "credentials:1" }, identity: null, independentKey: null };
describe("asset Worker public result boundary", () => {
  it("returns only the public identities found and preserves a child's unfamiliar suite in recovery", () => {
    const identity = { identitySuiteId: 2, personHash: "0x" + "12".repeat(32) };
    const match = { ...identity, history: "used" };
    expect(publicShieldedAssetResult("findWalletIdentities", { matches: [match] })).toEqual({ matches: [match] });
    for (const unexpected of [{ ...match, derivedSecretField: "secret" }, { ...match, history: "none" }, identity]) {
      expect(() => publicShieldedAssetResult("findWalletIdentities", { matches: [unexpected] }))
        .toThrow("invalid public result");
    }
    const wallet = {
      toBlock: 1, blockHash: "hash", parentVersions: [], policies: [], templates: [], claims: [], notes: [],
      children: [{ ...identity, eligible: true, rootVersionIndex: 1 }],
    };
    expect(publicShieldedAssetResult("recover", wallet)).toEqual(wallet);
  });
  it("retains public session handles while rejecting private fields at any depth", () => {
    expect(publicShieldedAssetResult("unlockIdentity", state)).toEqual(state);
    for (const value of [
      { ...state, rawPassphrase: "private-sentinel" },
      { ...state, credentials: { handle: "credentials:1", witness: "private-sentinel" } },
      {
        ...state,
        identity: {
          handle: "identity:1",
          identitySuiteId: 1,
          identityCommitment: "1",
          personHash: "0x11",
          identity: { fullName: "Example", ownerSecret: "private-sentinel" },
        },
      },
    ]) {
      expect(() => publicShieldedAssetResult("unlockIdentity", value)).toThrow(
        /^Asset Worker returned an invalid public result$/,
      );
    }
  });
  it("requires the explicit recovery export method for secret material", () => {
    const exported = {
      format: "mnemonic",
      material: "private-sentinel",
      version: 1,
      keyFingerprint: "fingerprint",
    };
    expect(publicShieldedAssetResult("exportRecoveryMaterial", exported)).toEqual(exported);
    for (const method of ["unlockIdentity", "receiveCode", "preview", "cancelPreview"] as const)
      expect(() => publicShieldedAssetResult(method, exported)).toThrow("invalid public result");
  });
  it("rejects nested recovery data without returning schema diagnostics", () => {
    expect(() =>
      publicShieldedAssetResult("recover", {
        toBlock: 1,
        blockHash: "hash",
        parentVersions: [],
        children: [],
        policies: [],
        templates: [],
        claims: [],
        notes: [
          {
            commitment: "1",
            ownerCommitment: "2",
            slot: "identity",
            kind: "value",
            amount: "3",
            opening: { nonce: "private-sentinel" },
          },
        ],
      }),
    ).toThrow(/^Asset Worker returned an invalid public result$/);
  });
});
