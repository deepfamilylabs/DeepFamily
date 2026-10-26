import { beforeEach, describe, expect, it } from "vitest";
import { ZeroAddress } from "ethers";
import { validateReceiveDeployment } from "./receiveDeployment.mjs";
const address = (i) => `0x${i.toString(16).padStart(40, "0")}`;
const routes = ["VERIFIER", "FUND_VERIFIER", "CLAIM_VERIFIER", "TRANSFER_VERIFIER"];
function fixture() {
  const deepFamily = {
    getAddress: async () => address(1),
    DEEP_FAMILY_TOKEN_CONTRACT: async () => address(2),
    lineageIndex: async () => address(3),
    eligibilitySource: async () => address(4),
  };
  const registry = { getAddress: async () => address(5), SOURCE: async () => address(4) };
  const source = {
    getAddress: async () => address(4),
    DEEP_FAMILY: async () => address(1),
    LINEAGE_INDEX: async () => address(3),
  };
  const verifiers = Object.fromEntries(routes.map((key, i) => [key, async () => address(10 + i)]));
  const pool = {
    getAddress: async () => address(6),
    TOKEN: async () => address(2),
    RECEIVE_REGISTRY: async () => address(5),
    protocolVersion: async () => 1n,
    assetKind: async () => 0n,
    ...verifiers,
  };
  const nativePool = { ...pool, getAddress: async () => address(7), assetKind: async () => 1n };
  const factory = {
    DEEP_TOKEN: async () => address(2),
    NATIVE_POOL: async () => address(7),
    poolFor: async (token) => (token === ZeroAddress ? address(7) : address(6)),
    ...verifiers,
  };
  const letters = { RECEIVE_REGISTRY: async () => address(5) };
  return { deepFamily, registry, source, pool, nativePool, factory, letters };
}
describe("local receiving deployment configuration", () => {
  let state;
  beforeEach(() => {
    state = fixture();
  });
  it("accepts a canonical registry, live qualification source and native/token pools", async () => {
    await expect(validateReceiveDeployment(state)).resolves.toEqual({
      registryAddress: address(5),
    });
  });
  it.each(["active source", "letters", "source lineage", "native registry", "fund route"])(
    "rejects a mismatched %s",
    async (kind) => {
      if (kind === "active source") state.deepFamily.eligibilitySource = async () => address(99);
      if (kind === "letters") state.letters.RECEIVE_REGISTRY = async () => address(99);
      if (kind === "source lineage") state.source.LINEAGE_INDEX = async () => address(99);
      if (kind === "native registry") state.nativePool.RECEIVE_REGISTRY = async () => address(99);
      if (kind === "fund route") state.pool.FUND_VERIFIER = async () => address(99);
      await expect(validateReceiveDeployment(state)).rejects.toThrow(/canonical|inconsistent/);
    },
  );
});
