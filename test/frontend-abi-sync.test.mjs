import { expect } from "chai";

import { normalizeFrontendArtifact } from "../frontend/scripts/sync-abi.mjs";

describe("frontend ABI synchronization", function () {
  it("keeps only the ABI and contract identity from the compiler artifact", function () {
    const artifact = {
      _format: "hh3-artifact-1",
      contractName: "DeepFamily",
      sourceName: "contracts/DeepFamily.sol",
      abi: [{ type: "error", name: "FixtureError", inputs: [] }],
      bytecode: "0x1234",
      deployedBytecode: "0x5678",
      linkReferences: {},
      deployedLinkReferences: {},
      immutableReferences: { 4545: [{ start: 12, length: 32 }] },
      inputSourceName: "project/contracts/DeepFamily.sol",
      buildInfoId: "solc-volatile-build-id",
    };

    expect(normalizeFrontendArtifact(artifact)).to.deep.equal({
      _format: artifact._format,
      contractName: artifact.contractName,
      sourceName: artifact.sourceName,
      abi: artifact.abi,
      inputSourceName: artifact.inputSourceName,
    });
    expect(artifact.bytecode).to.equal("0x1234");
    expect(artifact.buildInfoId).to.equal("solc-volatile-build-id");
    expect(artifact.immutableReferences).to.deep.equal({ 4545: [{ start: 12, length: 32 }] });
  });

  it("stays stable across build-dependent output while preserving ABI changes", function () {
    const abi = [{ type: "function", name: "read", inputs: [] }];
    const normalized = normalizeFrontendArtifact({
      abi,
      bytecode: "0x6080aa",
      deployedBytecode: "0x6080aa",
      immutableReferences: { 1: [{ start: 12, length: 32 }] },
      buildInfoId: "first-build",
    });

    // Same code with another metadata hash, as after an incremental build of a different batch.
    expect(
      normalizeFrontendArtifact({
        abi,
        bytecode: "0x6080bb",
        deployedBytecode: "0x6080bb",
        immutableReferences: { 999: [{ start: 12, length: 32 }] },
        buildInfoId: "second-build",
      }),
    ).to.deep.equal(normalized);
    expect(
      normalizeFrontendArtifact({ abi: [...abi, { type: "error", name: "Changed", inputs: [] }] }),
    ).not.to.deep.equal(normalized);
  });

  it("rejects a malformed artifact instead of writing ambiguous frontend data", function () {
    for (const value of [null, [], "artifact"]) {
      expect(() => normalizeFrontendArtifact(value)).to.throw(
        "Contract artifact must be a JSON object",
      );
    }
    for (const value of [{}, { abi: {} }]) {
      expect(() => normalizeFrontendArtifact(value)).to.throw(
        "Contract artifact must contain an ABI array",
      );
    }
  });
});
