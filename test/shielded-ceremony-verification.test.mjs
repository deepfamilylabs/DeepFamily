import { expect } from "chai";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CIRCOM_LINUX_X64_SHA256, CIRCOM_VERSION } from "../scripts/lib/circomToolchain.mjs";
import { inspectPtauFile } from "../scripts/lib/productionPtau.mjs";
import { verifyShieldedCeremonyArtifacts } from "../scripts/lib/shieldedCeremonyVerification.mjs";
import { inspectSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";
import { SHIELDED_SETUP_CIRCUITS } from "../scripts/lib/shieldedProductionSetup.mjs";
import { sha256File } from "../scripts/lib/zkArtifactTrust.mjs";

const write = (root, relativePath, contents) => {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return file;
};
const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};
const mutate = (file) => {
  fs.chmodSync(file, 0o600);
  fs.appendFileSync(file, "modified during verification\n");
};

async function createFixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-verify-test-")),
  );
  write(
    root,
    "node_modules/snarkjs/package.json",
    JSON.stringify({ name: "snarkjs", version: "0.7.5", main: "build/cli.cjs" }),
  );
  write(root, "node_modules/snarkjs/build/cli.cjs", "reviewed snarkjs runtime\n");
  const ptau = write(root, "published/phase1.ptau", "reviewed Powers of Tau\n");
  const compiler = write(root, "bin/circom", "verified native source compiler\n");
  const artifacts = {};
  const metadata = {};
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const { source, verifierContractName } = spec;
    const files = {
      sourcePath: write(root, `circuits/${source}.circom`, `${source} source\n`),
      r1cs: write(root, `compiled/${source}.r1cs`, `${source} reviewed R1CS\n`),
      wasm: write(root, `compiled/${source}.wasm`, `${source} reviewed WASM\n`),
      zkey: write(root, `public/${source}.zkey`, `${source} reviewed zkey\n`),
      vkey: write(
        root,
        `public/${source}.vkey.json`,
        JSON.stringify({ protocol: "groth16", nPublic: spec.publicSignals }),
      ),
      verifier:
        verifierContractName &&
        write(
          root,
          `contracts/${verifierContractName}.sol`,
          `contract ${verifierContractName} { }\n`,
        ),
    };
    const ceremony = {
      contributions: [
        { participantId: "deepfamily-single-operator", contributionHash: "aa".repeat(64) },
      ],
      beacon: {
        name: "deepfamily-finalization",
        hash: "bb".repeat(32),
        contributionHash: "cc".repeat(64),
        numIterationsExp: 10,
      },
    };
    artifacts[action] = {
      ...files,
      ceremony,
      item: {
        source,
        sourceSha256: sha256File(files.sourcePath),
        r1csSha256: sha256File(files.r1cs),
        wasmSha256: sha256File(files.wasm),
        zkeySha256: sha256File(files.zkey),
        verificationKeySha256: sha256File(files.vkey),
        ...(verifierContractName && {
          verifierContractName,
          verifierSha256: sha256File(files.verifier),
        }),
      },
    };
    metadata[action] = {
      contributionCount: 2,
      contributions: [
        {
          type: 0,
          name: ceremony.contributions[0].participantId,
          contributionHash: ceremony.contributions[0].contributionHash,
        },
        {
          type: 1,
          name: ceremony.beacon.name,
          beaconHash: ceremony.beacon.hash,
          contributionHash: ceremony.beacon.contributionHash,
          numIterationsExp: ceremony.beacon.numIterationsExp,
        },
      ],
    };
  }
  const expectedProductionPhase1 = await inspectPtauFile(ptau);
  const inspected = {
    manifestSha256: "dd".repeat(32),
    artifacts,
    manifest: {
      phase1: { sha256: expectedProductionPhase1.sha256 },
      sourceBundleSha256: "ee".repeat(32),
      toolchain: {
        circomBinarySha256: CIRCOM_LINUX_X64_SHA256,
        snarkjsRuntimeSha256: inspectSnarkjsRuntime({ root }).sha256,
      },
    },
  };
  const calls = [];
  const runner = (invocation) => {
    calls.push(invocation);
    if (invocation.executable !== process.execPath) {
      const source = path.basename(invocation.args[0], ".circom");
      const artifact = Object.values(artifacts).find(
        (candidate) => candidate.item.source === source,
      );
      const output = invocation.args.at(-1);
      fs.copyFileSync(artifact.r1cs, path.join(output, `${source}.r1cs`));
      fs.mkdirSync(path.join(output, `${source}_js`), { recursive: true });
      fs.copyFileSync(artifact.wasm, path.join(output, `${source}_js`, `${source}.wasm`));
      return;
    }
    if (invocation.args[2] === "export") {
      const action = path.basename(invocation.args[4], ".zkey");
      const output = invocation.args[5];
      if (invocation.args[3] === "verificationkey") {
        fs.copyFileSync(artifacts[action].vkey, output);
      } else {
        fs.writeFileSync(output, "contract Groth16Verifier { }\n");
      }
    }
  };
  const options = {
    root,
    inspected,
    ptauPath: ptau,
    expectedProductionPhase1,
    platform: "darwin",
    arch: "arm64",
    env: {},
    runner,
    compilerInspector: async () => ({
      path: compiler,
      version: CIRCOM_VERSION,
      target: "darwin-arm64",
      strategy: "pinned-source",
      sha256: sha256File(compiler),
    }),
    overrideInspector: () => null,
    sourceBundleInspector: () => inspected.manifest.sourceBundleSha256,
    mpcMetadataReader: async (zkey) => metadata[path.basename(zkey, ".zkey")],
  };
  return { root, ptau, compiler, artifacts, metadata, inspected, calls, runner, options };
}

describe("shielded production ceremony verification snapshots", function () {
  let fixture;
  beforeEach(async function () {
    fixture = await createFixture();
  });
  afterEach(function () {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  it("verifies every circuit using private compiler, runtime, pTau and artifact copies", async function () {
    const result = await verifyShieldedCeremonyArtifacts(fixture.options);
    expect(result).to.include({
      status: "passed",
      circuitCount: 8,
      manifestSha256: fixture.inspected.manifestSha256,
    });
    expect(fixture.calls).to.have.length(32);
    // The receive code is verified in the browser and exports no Solidity verifier.
    expect(fixture.calls.filter(({ args }) => args[3] === "solidityverifier")).to.have.length(7);
    const snapshotRoot = path.dirname(fixture.calls[0].args[3]);
    expect(snapshotRoot).not.to.equal(path.dirname(fixture.ptau));
    const nativeCalls = fixture.calls.filter(({ executable }) => executable !== process.execPath);
    expect(nativeCalls).to.have.length(8);
    expect(
      nativeCalls.every(({ executable }) => executable === path.join(snapshotRoot, "circom")),
    ).to.equal(true);
    const snarkjsCalls = fixture.calls.filter(({ executable }) => executable === process.execPath);
    expect(
      snarkjsCalls.every(({ args }) =>
        args[0].startsWith(path.join(snapshotRoot, "snarkjs-runtime")),
      ),
    ).to.equal(true);
    expect(fs.existsSync(snapshotRoot)).to.equal(false);
    // A verified native build can differ in bytes from the canonical Linux compiler.
    expect(sha256File(fixture.compiler)).not.to.equal(
      fixture.inspected.manifest.toolchain.circomBinarySha256,
    );
  });

  it("removes loader and configuration injections from every subprocess environment", async function () {
    await verifyShieldedCeremonyArtifacts({
      ...fixture.options,
      env: {
        PATH: "/trusted/bin",
        RELEASE_VALUE: "kept",
        NODE_OPTIONS: "--require=untrusted",
        node_path: "/untrusted",
        LD_PRELOAD: "/untrusted",
        DYLD_INSERT_LIBRARIES: "/untrusted",
        NPM_CONFIG_SCRIPT_SHELL: "/untrusted",
        GIT_CONFIG_COUNT: "1",
        DOTENV_CONFIG_PATH: "/untrusted",
      },
    });
    for (const invocation of fixture.calls) {
      expect(invocation.env).to.deep.equal({ PATH: "/trusted/bin", RELEASE_VALUE: "kept" });
      expect(Object.isFrozen(invocation.env)).to.equal(true);
    }
  });

  it("uses a pinned pTau selected by ZK_PTAU_PATH without a repository-local copy", async function () {
    const result = await verifyShieldedCeremonyArtifacts({
      ...fixture.options,
      ptauPath: undefined,
      env: { ZK_PTAU_PATH: fixture.ptau },
    });
    expect(result.ptau.path).to.equal(fixture.ptau);
    expect(fs.existsSync(path.join(fixture.root, "circuits/ptau/ppot_0080_17.ptau"))).to.equal(
      false,
    );
  });

  it("rejects unpinned pTau before invoking compiler or snarkjs", async function () {
    mutate(fixture.ptau);
    const error = await captureError(() => verifyShieldedCeremonyArtifacts(fixture.options));
    expect(error.message).to.include("Powers of Tau bytes differs from the pinned production file");
    expect(fixture.calls).to.have.length(0);
  });

  it("checks the embedded final beacon after the mathematical zkey check", async function () {
    fixture.metadata.receiveCode.contributions[1].beaconHash = "ff".repeat(32);
    const error = await captureError(() => verifyShieldedCeremonyArtifacts(fixture.options));
    expect(error.message).to.include("receiveCode zkey beacon differs");
    expect(fixture.calls).to.have.length(3);
    const snapshotRoot = path.dirname(fixture.calls[0].args[3]);
    expect(fs.existsSync(snapshotRoot)).to.equal(false);
  });

  for (const [name, locate, message] of [
    [
      "zkey",
      (root) => path.join(root, "receiveCode.zkey"),
      "receiveCode zkey snapshot SHA-256 mismatch",
    ],
    ["compiler", (root) => path.join(root, "circom"), "Circom compiler snapshot SHA-256 mismatch"],
    ["pTau", (root) => path.join(root, "phase1.ptau"), "Powers of Tau snapshot SHA-256 mismatch"],
    [
      "runtime dependency",
      (root) => path.join(root, "snarkjs-runtime/node_modules/snarkjs/build/cli.cjs"),
      "Installed snarkjs runtime SHA-256 mismatch",
    ],
  ]) {
    it(`rejects a ${name} snapshot changed during verification`, async function () {
      const error = await captureError(() =>
        verifyShieldedCeremonyArtifacts({
          ...fixture.options,
          runner: (invocation) => {
            fixture.runner(invocation);
            if (fixture.calls.length === 32) {
              mutate(locate(path.dirname(fixture.calls[0].args[3])));
            }
          },
        }),
      );
      expect(error.message).to.include(message);
      expect(fs.existsSync(path.dirname(fixture.calls[0].args[3]))).to.equal(false);
    });
  }

  it("rejects rebuilt constraints that differ from the production manifest", async function () {
    const error = await captureError(() =>
      verifyShieldedCeremonyArtifacts({
        ...fixture.options,
        runner: (invocation) => {
          fixture.runner(invocation);
          if (fixture.calls.length === 2) {
            mutate(path.join(invocation.args.at(-1), "shielded_receive_code.r1cs"));
          }
        },
      }),
    );
    expect(error.message).to.include("receiveCode rebuilt R1CS SHA-256 mismatch");
    expect(fixture.calls).to.have.length(2);
  });
});
