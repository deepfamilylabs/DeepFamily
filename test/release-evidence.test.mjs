import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ethers } from "ethers";

import {
  RELEASE_INPUT_DIRECTORY_NAMES,
  RELEASE_INPUT_FILE_NAMES,
  hashReleaseInputs,
  readProductionBuildInfoState,
} from "../scripts/lib/releaseEvidence.mjs";

const PROJECT_BUILD_ID = "solc-0_8_28-project-fixture";
const POSEIDON_BUILD_ID = "solc-0_8_28-poseidon-fixture";
const PROJECT_SOURCE_NAME = "project/contracts/DeepFamily.sol";
const SCOPED_SOURCE_NAME = "npm/@scope/library@1.2.3/src/Library.sol";
const POSEIDON_SOURCE_NAME = "npm/poseidon-solidity@0.0.5/PoseidonT5.sol";

const settings = (viaIR) => ({
  optimizer: { enabled: true, runs: 1 },
  evmVersion: "cancun",
  viaIR,
});

const contractOutput = {
  abi: [
    {
      inputs: [],
      name: "version",
      outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
      stateMutability: "pure",
      type: "function",
    },
  ],
  evm: {
    bytecode: {
      object: "6001600055",
      linkReferences: {
        "project/contracts/Library.sol": {
          Library: [{ length: 20, start: 1 }],
        },
      },
    },
    deployedBytecode: {
      object: "60016000",
      linkReferences: {
        "project/contracts/Library.sol": {
          Library: [{ length: 20, start: 2 }],
        },
      },
      immutableReferences: {
        7: [{ length: 32, start: 3 }],
      },
    },
  },
};

const buildInfo = ({ id, sources, viaIR, userSourceNameMap }) => ({
  _format: "hh3-sol-build-info-1",
  id,
  solcVersion: "0.8.28",
  solcLongVersion: "0.8.28+commit.7893614a",
  compilerType: "solcjs",
  userSourceNameMap,
  input: {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(sources).map(([sourceName, content]) => [sourceName, { content }]),
    ),
    settings: settings(viaIR),
  },
});

const writeFile = async (root, relativePath, content) => {
  const target = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
};

const writeBuildPair = async (root, input, output) => {
  const directory = path.join(root, "artifacts", "build-info");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${input.id}.json`), JSON.stringify(input));
  await fs.writeFile(
    path.join(directory, `${input.id}.output.json`),
    JSON.stringify({ _format: "hh3-sol-build-info-output-1", id: input.id, output }),
  );
};

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-release-evidence-"));
  const projectSource = "pragma solidity 0.8.28; contract DeepFamily {}\n";
  const scopedSource = "pragma solidity 0.8.28; library Library {}\n";
  const poseidonSource = "pragma solidity 0.8.28; library PoseidonT5 {}\n";
  await writeFile(root, "contracts/DeepFamily.sol", projectSource);
  await writeFile(root, "node_modules/@scope/library/src/Library.sol", scopedSource);
  await writeFile(root, "node_modules/poseidon-solidity/PoseidonT5.sol", poseidonSource);

  await writeBuildPair(
    root,
    buildInfo({
      id: PROJECT_BUILD_ID,
      sources: {
        [PROJECT_SOURCE_NAME]: projectSource,
        [SCOPED_SOURCE_NAME]: scopedSource,
      },
      viaIR: true,
      userSourceNameMap: {
        "contracts/DeepFamily.sol": PROJECT_SOURCE_NAME,
        "@scope/library/src/Library.sol": SCOPED_SOURCE_NAME,
      },
    }),
    {
      contracts: {
        [PROJECT_SOURCE_NAME]: { DeepFamily: contractOutput },
      },
    },
  );
  await writeBuildPair(
    root,
    buildInfo({
      id: POSEIDON_BUILD_ID,
      sources: { [POSEIDON_SOURCE_NAME]: poseidonSource },
      viaIR: false,
      userSourceNameMap: {
        "poseidon-solidity/PoseidonT5.sol": POSEIDON_SOURCE_NAME,
      },
    }),
    {
      contracts: {
        [POSEIDON_SOURCE_NAME]: { PoseidonT5: contractOutput },
      },
    },
  );

  const artifact = {
    _format: "hh3-artifact-1",
    contractName: "DeepFamily",
    sourceName: "contracts/DeepFamily.sol",
    inputSourceName: PROJECT_SOURCE_NAME,
    buildInfoId: PROJECT_BUILD_ID,
    abi: structuredClone(contractOutput.abi),
    bytecode: `0x${contractOutput.evm.bytecode.object}`,
    deployedBytecode: `0x${contractOutput.evm.deployedBytecode.object}`,
    linkReferences: structuredClone(contractOutput.evm.bytecode.linkReferences),
    deployedLinkReferences: structuredClone(contractOutput.evm.deployedBytecode.linkReferences),
    immutableReferences: structuredClone(contractOutput.evm.deployedBytecode.immutableReferences),
  };
  return { root, artifact };
};

const expectRejected = async (operation, pattern) => {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error, "expected operation to reject").to.be.an("error");
  expect(error.message).to.match(pattern);
};

describe("multi-chain production release build evidence", function () {
  let fixture;

  beforeEach(async function () {
    fixture = await createFixture();
  });

  afterEach(async function () {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it("matches every project/npm source and traces a release artifact to compiler output", async function () {
    const result = await readProductionBuildInfoState(ethers, fixture.root, {
      artifacts: { readArtifact: async () => fixture.artifact },
      releaseArtifactNames: ["DeepFamily"],
    });

    expect(result.productionSettingsMatched).to.equal(true);
    expect(result.buildInfoOutputsMatched).to.equal(true);
    expect(result.buildInfoOutputFileCount).to.equal(2);
    expect(result.sourceContentsMatched).to.equal(true);
    expect(result.sourceFileCount).to.equal(3);
    expect(result.sourceInputDigest).to.match(/^0x[0-9a-f]{64}$/u);
    expect(result.artifactProvenanceChecked).to.equal(true);
    expect(result.artifactProvenanceMatched).to.equal(true);
    expect(result.releaseArtifactCount).to.equal(1);
    expect(result.artifactProvenance[0]).to.include({
      artifactName: "DeepFamily",
      inputSourceName: PROJECT_SOURCE_NAME,
      buildInfoId: PROJECT_BUILD_ID,
    });
  });

  it("keeps the legacy no-artifact call while making unchecked provenance explicit", async function () {
    const result = await readProductionBuildInfoState(ethers, fixture.root);
    expect(result.sourceContentsMatched).to.equal(true);
    expect(result.artifactProvenanceChecked).to.equal(false);
    expect(result.artifactProvenanceMatched).to.equal(null);
    expect(result.releaseArtifactCount).to.equal(0);
  });

  it("rejects stale build-info when a workspace or npm source byte changes", async function () {
    await writeFile(
      fixture.root,
      "node_modules/@scope/library/src/Library.sol",
      "pragma solidity 0.8.28; library ChangedLibrary {}\n",
    );
    await expectRejected(
      () => readProductionBuildInfoState(ethers, fixture.root),
      /does not exactly match.*compiler input/iu,
    );
  });

  it("requires an exact one-to-one build-info input/output pair with the same ID", async function () {
    const outputPath = path.join(
      fixture.root,
      "artifacts",
      "build-info",
      `${PROJECT_BUILD_ID}.output.json`,
    );
    const output = JSON.parse(await fs.readFile(outputPath, "utf8"));
    output.id = "different-build-id";
    await fs.writeFile(outputPath, JSON.stringify(output));
    await expectRejected(
      () => readProductionBuildInfoState(ethers, fixture.root),
      /inconsistent IDs or output/iu,
    );
  });

  it("rejects every deployable artifact field when it differs from compiler output", async function () {
    const mutations = [
      ["abi", (artifact) => artifact.abi.push({ type: "error", name: "Changed", inputs: [] })],
      ["bytecode", (artifact) => (artifact.bytecode = "0x6002")],
      ["deployedBytecode", (artifact) => (artifact.deployedBytecode = "0x6003")],
      ["linkReferences", (artifact) => (artifact.linkReferences = {})],
      ["deployedLinkReferences", (artifact) => (artifact.deployedLinkReferences = {})],
      ["immutableReferences", (artifact) => (artifact.immutableReferences = {})],
    ];
    for (const [field, mutate] of mutations) {
      const artifact = structuredClone(fixture.artifact);
      mutate(artifact);
      await expectRejected(
        () =>
          readProductionBuildInfoState(ethers, {
            root: fixture.root,
            artifacts: { readArtifact: async () => artifact },
            contractNames: ["DeepFamily"],
          }),
        new RegExp(`DeepFamily ${field} does not match`, "iu"),
      );
    }
  });

  it("rejects an artifact that cannot be traced to an available build-info ID", async function () {
    const artifact = { ...fixture.artifact, buildInfoId: "missing-build-info" };
    await expectRejected(
      () =>
        readProductionBuildInfoState(ethers, fixture.root, {
          artifacts: { readArtifact: async () => artifact },
          artifactNames: ["DeepFamily"],
        }),
      /references unavailable buildInfoId/iu,
    );
  });
});

describe("shared acceptance and mainnet release input evidence", function () {
  it("uses one directory/file definition and includes protocol vectors in both flows", async function () {
    expect(RELEASE_INPUT_DIRECTORY_NAMES).to.include("protocol-vectors");
    expect(RELEASE_INPUT_FILE_NAMES).to.include("protocol-release-manifest.json");
    const [acceptanceSource, mainnetSource] = await Promise.all([
      fs.readFile("scripts/evm-acceptance.mjs", "utf8"),
      fs.readFile("scripts/evm-mainnet-release.mjs", "utf8"),
    ]);
    for (const source of [acceptanceSource, mainnetSource]) {
      expect(source).to.match(
        /import\s*\{[^}]*hashReleaseInputs[^}]*\}\s*from "\.\/lib\/releaseEvidence\.mjs"/u,
      );
      expect(source).to.include("hashReleaseInputs(ethers)");
    }
    expect(acceptanceSource).not.to.include("const hashAcceptanceInputs");
  });

  it("produces the same digest and detects a protocol-vector byte change", async function () {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-shared-input-evidence-"));
    try {
      for (const name of RELEASE_INPUT_FILE_NAMES) await writeFile(root, name, `${name}\n`);
      await writeFile(root, "protocol-vectors/vector.json", '{"version":1}\n');
      const acceptanceSnapshot = await hashReleaseInputs(ethers, root);
      const mainnetSnapshot = await hashReleaseInputs(ethers, root);
      expect(acceptanceSnapshot).to.deep.equal(mainnetSnapshot);
      await writeFile(root, "protocol-vectors/vector.json", '{"version":2}\n');
      const changed = await hashReleaseInputs(ethers, root);
      expect(changed.directories["protocol-vectors"].digest).not.to.equal(
        acceptanceSnapshot.directories["protocol-vectors"].digest,
      );
      expect(changed.digest).not.to.equal(acceptanceSnapshot.digest);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
