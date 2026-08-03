import { expect } from "chai";

import { normalizeFrontendArtifact } from "../frontend/scripts/sync-abi.mjs";

describe("frontend ABI synchronization", function () {
  it("removes volatile build and immutable-reference IDs from the frontend artifact", function () {
    const artifact = {
      _format: "hh3-artifact-1",
      contractName: "DeepFamily",
      sourceName: "contracts/DeepFamily.sol",
      abi: [{ type: "error", name: "FixtureError", inputs: [] }],
      bytecode: "0x1234",
      deployedBytecode: "0x5678",
      immutableReferences: { 4545: [{ start: 12, length: 32 }] },
      inputSourceName: "project/contracts/DeepFamily.sol",
      buildInfoId: "solc-volatile-build-id",
    };

    expect(normalizeFrontendArtifact(artifact)).to.deep.equal({
      _format: artifact._format,
      contractName: artifact.contractName,
      sourceName: artifact.sourceName,
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      deployedBytecode: artifact.deployedBytecode,
      inputSourceName: artifact.inputSourceName,
    });
    expect(artifact.buildInfoId).to.equal("solc-volatile-build-id");
    expect(artifact.immutableReferences).to.deep.equal({ 4545: [{ start: 12, length: 32 }] });
  });

  it("stays stable across volatile IDs while preserving runtime artifact changes", function () {
    const artifact = {
      abi: [{ type: "function", name: "read", inputs: [] }],
      bytecode: "0x1234",
      deployedBytecode: "0x5678",
    };
    const normalized = normalizeFrontendArtifact({
      ...artifact,
      buildInfoId: "first-build",
      immutableReferences: { 1: [{ start: 12, length: 32 }] },
    });

    expect(
      normalizeFrontendArtifact({
        ...artifact,
        buildInfoId: "second-build",
        immutableReferences: { 999: [{ start: 12, length: 32 }] },
      }),
    ).to.deep.equal(normalized);
    expect(normalizeFrontendArtifact({ ...artifact, bytecode: "0xabcd" })).not.to.deep.equal(
      normalized,
    );
  });

  it("rejects a malformed artifact instead of writing ambiguous frontend data", function () {
    for (const value of [null, [], "artifact"]) {
      expect(() => normalizeFrontendArtifact(value)).to.throw(
        "Contract artifact must be a JSON object",
      );
    }
  });
});
