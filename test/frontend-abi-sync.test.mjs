import { expect } from "chai";

import { normalizeFrontendArtifact } from "../frontend/scripts/sync-abi.mjs";

describe("frontend ABI synchronization", function () {
  it("removes only Hardhat's volatile buildInfoId from the runtime artifact", function () {
    const artifact = {
      _format: "hh3-artifact-1",
      contractName: "DeepFamily",
      sourceName: "contracts/DeepFamily.sol",
      abi: [{ type: "error", name: "FixtureError", inputs: [] }],
      bytecode: "0x1234",
      deployedBytecode: "0x5678",
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
  });

  it("rejects a malformed artifact instead of writing ambiguous frontend data", function () {
    for (const value of [null, [], "artifact"]) {
      expect(() => normalizeFrontendArtifact(value)).to.throw(
        "Contract artifact must be a JSON object",
      );
    }
  });
});
