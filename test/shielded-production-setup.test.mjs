import { expect } from "chai";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CIRCOM_LINUX_X64_SHA256, CIRCOM_VERSION } from "../scripts/lib/circomToolchain.mjs";
import {
  PRODUCTION_PTAU_RELATIVE_PATH,
  PRODUCTION_PTAU_SHA256,
} from "../scripts/lib/productionPtau.mjs";
import {
  SHIELDED_PRODUCTION_MANIFEST_PATH,
  SHIELDED_SETUP_CIRCUITS,
  assertShieldedCompilationUnchanged,
  buildShieldedProductionRecords,
  inspectShieldedProductionArtifacts,
  shieldedProductionInstallEntries,
  snapshotShieldedCompilation,
  verifyShieldedProductionCeremony,
} from "../scripts/lib/shieldedProductionSetup.mjs";
import { sourceBundleSha256 } from "../scripts/lib/shieldedSourceBundle.mjs";
import { inspectSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";
import { sha256File } from "../scripts/lib/zkArtifactTrust.mjs";

const write = (root, relative, bytes) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
};
const writeJson = (root, relative, value) =>
  write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};
const criteria = {
  allocationMaxGas: 3000000,
  claim12MaxGas: 3000000,
  browserAllocationMaxMs: 60000,
  browserClaim12MaxMs: 60000,
  recoveryMaxMs: 30000,
  recoveryMinEvents: 100,
};

function createFixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-production-test-")),
  );
  const stageRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-shielded-staging-test-")),
  );
  const stageBuild = path.join(stageRoot, "build");
  write(
    root,
    "node_modules/snarkjs/package.json",
    JSON.stringify({ name: "snarkjs", version: "0.7.5", main: "build/cli.cjs" }),
  );
  write(root, "node_modules/snarkjs/build/cli.cjs", "pinned snarkjs CLI\n");
  writeJson(root, "package-lock.json", { name: "production-fixture", lockfileVersion: 3 });
  write(root, ".gitignore", "node_modules/\nzk-artifacts/\n");
  fs.mkdirSync(path.join(root, "circuits/ptau"), { recursive: true });
  fs.copyFileSync(
    fileURLToPath(new URL(`../${PRODUCTION_PTAU_RELATIVE_PATH}`, import.meta.url)),
    path.join(root, PRODUCTION_PTAU_RELATIVE_PATH),
    fs.constants.COPYFILE_FICLONE,
  );
  const finalized = {};
  const initialManifest = { circuits: {} };
  for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
    const source = write(root, `circuits/${spec.source}.circom`, `${action} reviewed source\n`);
    const r1cs = write(stageBuild, `${spec.source}.r1cs`, `${action} reviewed constraint system\n`);
    const wasm = write(
      stageBuild,
      `${spec.source}_js/${spec.source}.wasm`,
      `${action} reviewed WASM\n`,
    );
    initialManifest.circuits[action] = {
      source: spec.source,
      sourceSha256: sha256File(source),
      r1csSha256: sha256File(r1cs),
      wasmSha256: sha256File(wasm),
    };
    finalized[action] = {
      circuitName: spec.source,
      finalZkey: write(
        stageRoot,
        `keys/${spec.source}_final.zkey`,
        `${action} independent finalized proving key\n`,
      ),
      verificationKey: writeJson(stageRoot, `keys/${spec.source}.vkey.json`, {
        protocol: "groth16",
        nPublic: spec.publicSignals,
      }),
      solidityVerifier: write(
        stageRoot,
        `keys/${spec.source}.sol`,
        `contract ${spec.verifierContractName} { }\n`,
      ),
      metadata: {
        operatorContributionHash: "aa".repeat(64),
        beaconContributionHash: "bb".repeat(64),
      },
    };
  }
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync(
    "git",
    [
      "add",
      "--",
      ".gitignore",
      "package-lock.json",
      ...Object.values(SHIELDED_SETUP_CIRCUITS).map(({ source }) => `circuits/${source}.circom`),
    ],
    { cwd: root },
  );
  const compiled = snapshotShieldedCompilation({
    root,
    stageBuild,
    expectedManifest: initialManifest,
  });
  const runtimeSha256 = inspectSnarkjsRuntime({ root }).sha256;
  const createRecords = async (overrides = {}) => {
    const recordStage = fs.mkdtempSync(path.join(stageRoot, "records-"));
    fs.mkdirSync(path.join(recordStage, "release"));
    return buildShieldedProductionRecords({
      root,
      stageRoot: recordStage,
      compiled,
      finalized,
      ptau: { sha256: PRODUCTION_PTAU_SHA256 },
      compilerSha256: "cc".repeat(32),
      snarkjsRuntimeSha256: runtimeSha256,
      ceremonyId: "deepfamily-production-fixture",
      operatorParticipantId: "deepfamily-single-operator",
      beaconName: "deepfamily-finalization",
      beaconHash: "dd".repeat(32),
      beaconIterationsExp: 10,
      ...overrides,
    });
  };
  const install = (records) => {
    for (const entry of shieldedProductionInstallEntries({ compiled, finalized, records })) {
      const destination = path.join(root, entry.destination);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(entry.source, destination);
    }
  };
  return {
    root,
    stageRoot,
    stageBuild,
    compiled,
    finalized,
    initialManifest,
    runtimeSha256,
    createRecords,
    install,
  };
}

function movePtauOutsideCheckout(fixture) {
  const external = path.join(fixture.stageRoot, "published", "phase1.ptau");
  fs.mkdirSync(path.dirname(external), { recursive: true });
  fs.renameSync(path.join(fixture.root, PRODUCTION_PTAU_RELATIVE_PATH), external);
  return external;
}

describe("shielded production setup artifacts", function () {
  let fixture;
  beforeEach(function () {
    fixture = createFixture();
  });
  afterEach(function () {
    if (!fixture) return;
    fs.rmSync(fixture.root, { recursive: true, force: true });
    fs.rmSync(fixture.stageRoot, { recursive: true, force: true });
  });

  it("records all seven independently generated keys without requiring release thresholds", async function () {
    const records = await fixture.createRecords();
    expect(Object.keys(records.manifest.circuits).sort()).to.deep.equal(
      Object.keys(SHIELDED_SETUP_CIRCUITS).sort(),
    );
    expect(Object.hasOwn(records.manifest, "releaseCriteria")).to.equal(false);
    expect(records.manifest.toolchain.circomBinarySha256).to.equal(CIRCOM_LINUX_X64_SHA256);
    expect(records.manifest.toolchain.snarkjsRuntimeSha256).to.equal(fixture.runtimeSha256);
    expect(
      new Set(Object.values(records.manifest.circuits).map(({ zkeySha256 }) => zkeySha256)).size,
    ).to.equal(7);
    for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
      const item = records.manifest.circuits[action];
      expect(item.source).to.equal(spec.source);
      expect(item.zkeySha256).to.equal(sha256File(fixture.finalized[action].finalZkey));
      expect(records.transcript.circuits[action]).to.include({
        r1csSha256: fixture.compiled[action].r1csSha256,
        zkeySha256: item.zkeySha256,
      });
    }
    fixture.install(records);
    const inspected = inspectShieldedProductionArtifacts({ root: fixture.root });
    expect(Object.keys(inspected.artifacts)).to.have.length(7);
  });

  it("inspects production artifacts using an external pinned pTau selected by ZK_PTAU_PATH", async function () {
    fixture.install(await fixture.createRecords());
    const external = movePtauOutsideCheckout(fixture);
    const inspected = inspectShieldedProductionArtifacts({
      root: fixture.root,
      env: { ZK_PTAU_PATH: external },
    });
    expect(inspected.ptauPath).to.equal(external);
    expect(inspected.manifest.phase1.path).to.equal(PRODUCTION_PTAU_RELATIVE_PATH);
    expect(Object.keys(inspected.artifacts)).to.have.length(7);
    expect(fs.existsSync(path.join(fixture.root, PRODUCTION_PTAU_RELATIVE_PATH))).to.equal(false);
  });

  it("uses explicit pTau precedence and Windows environment casing during production inspection", async function () {
    fixture.install(await fixture.createRecords());
    const external = movePtauOutsideCheckout(fixture);
    const options = { root: fixture.root, platform: "win32" };
    expect(
      inspectShieldedProductionArtifacts({ ...options, env: { zk_ptau_path: external } }).ptauPath,
    ).to.equal(external);
    expect(
      inspectShieldedProductionArtifacts({
        ...options,
        ptauPath: external,
        env: { ZK_PTAU_PATH: "missing.ptau" },
      }).ptauPath,
    ).to.equal(external);
  });

  it("rejects unpinned external pTau contents and symlink file or directory paths", async function () {
    fixture.install(await fixture.createRecords());
    const external = movePtauOutsideCheckout(fixture);
    const options = { root: fixture.root };
    const link = path.join(fixture.root, "ptau-link");
    fs.symlinkSync(external, link);
    expect(() => inspectShieldedProductionArtifacts({ ...options, ptauPath: link })).to.throw(
      "regular non-symlink file",
    );
    fs.unlinkSync(link);
    fs.symlinkSync(path.dirname(external), link, "dir");
    expect(() =>
      inspectShieldedProductionArtifacts({ ...options, ptauPath: path.join(link, "phase1.ptau") }),
    ).to.throw("regular non-symlink file");
    fs.writeFileSync(external, "unreviewed powers of tau\n");
    expect(() => inspectShieldedProductionArtifacts({ ...options, ptauPath: external })).to.throw(
      "Shielded Phase 1 Powers of Tau SHA-256 mismatch",
    );
  });

  it("keeps the same external pTau through both ceremony inspections and cryptographic verification", async function () {
    this.timeout(15000);
    const records = await fixture.createRecords();
    fixture.install(records);
    const external = movePtauOutsideCheckout(fixture);
    const compiler = write(fixture.root, "bin/circom", "verified native source compiler\n");
    for (const selection of [
      { env: { ZK_PTAU_PATH: external } },
      { ptauPath: external, env: { ZK_PTAU_PATH: "missing.ptau" } },
    ]) {
      const calls = [];
      const runner = (invocation) => {
        calls.push(invocation);
        selection.env.ZK_PTAU_PATH = "changed-during-verification.ptau";
        if (invocation.executable !== process.execPath) {
          const source = path.basename(invocation.args[0], ".circom");
          const built = Object.values(fixture.compiled).find((entry) => entry.source === source);
          const output = invocation.args.at(-1);
          fs.copyFileSync(built.r1cs, path.join(output, `${source}.r1cs`));
          fs.mkdirSync(path.join(output, `${source}_js`), { recursive: true });
          fs.copyFileSync(built.wasm, path.join(output, `${source}_js`, `${source}.wasm`));
        } else if (invocation.args[2] === "export") {
          const action = path.basename(invocation.args[4], ".zkey");
          const finalized = fixture.finalized[action];
          const output = invocation.args[5];
          if (invocation.args[3] === "verificationkey") {
            fs.copyFileSync(finalized.verificationKey, output);
          } else {
            fs.writeFileSync(
              output,
              fs
                .readFileSync(finalized.solidityVerifier, "utf8")
                .replace(SHIELDED_SETUP_CIRCUITS[action].verifierContractName, "Groth16Verifier"),
            );
          }
        }
      };
      const result = await verifyShieldedProductionCeremony({
        root: fixture.root,
        ...selection,
        platform: "darwin",
        arch: "arm64",
        runner,
        overrideInspector: () => null,
        compilerInspector: async () => ({
          path: compiler,
          version: CIRCOM_VERSION,
          target: "darwin-arm64",
          strategy: "pinned-source",
          sha256: sha256File(compiler),
        }),
        mpcMetadataReader: async (zkey) => {
          const ceremony = records.transcript.circuits[path.basename(zkey, ".zkey")];
          return {
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
        },
      });
      expect(result).to.include({ status: "passed", circuitCount: 7 });
      expect(result.ptau.path).to.equal(external);
      // The receive code exports a verification key but no Solidity verifier.
      expect(calls).to.have.length(28);
    }
  });

  it("accepts complete optional release thresholds and rejects incomplete or nonpositive thresholds", async function () {
    const records = await fixture.createRecords({ releaseCriteria: criteria });
    expect(records.manifest.releaseCriteria).to.deep.equal(criteria);
    expect(records.manifest.releaseCriteria).not.to.equal(criteria);
    fixture.install(records);
    expect(
      inspectShieldedProductionArtifacts({ root: fixture.root }).manifest.releaseCriteria,
    ).to.deep.equal(criteria);
    for (const invalid of [{ allocationMaxGas: 1 }, { ...criteria, recoveryMinEvents: 0 }]) {
      const error = await captureError(() => fixture.createRecords({ releaseCriteria: invalid }));
      expect(error.message).to.match(
        /release criteria are incomplete|must be a positive safe integer/u,
      );
    }
  });

  it("installs exactly 18 browser artifacts and a distinct Solidity verifier for each pool circuit", async function () {
    const records = await fixture.createRecords();
    const plan = shieldedProductionInstallEntries({
      compiled: fixture.compiled,
      finalized: fixture.finalized,
      records,
    });
    const destinations = plan.map(({ destination }) => destination);
    expect(new Set(destinations).size).to.equal(destinations.length);
    expect(
      destinations.filter((name) => name.startsWith("frontend/public/zk/shielded/")),
    ).to.have.length(21);
    for (const [action, spec] of Object.entries(SHIELDED_SETUP_CIRCUITS)) {
      expect(
        plan.find(
          ({ destination }) =>
            destination === `frontend/public/zk/shielded/${spec.source}_final.zkey`,
        ).source,
      ).to.equal(fixture.finalized[action].finalZkey);
      if (spec.verifierPath) expect(destinations).to.include(spec.verifierPath);
    }
    expect(destinations.filter((name) => name.startsWith("contracts/"))).to.have.length(6);
    expect(destinations.at(-1)).to.equal(SHIELDED_PRODUCTION_MANIFEST_PATH);
  });

  it("validates public production keys in a clean clone without ignored zkey or vkey copies", async function () {
    fixture.install(await fixture.createRecords());
    for (const spec of Object.values(SHIELDED_SETUP_CIRCUITS)) {
      fs.rmSync(path.join(fixture.root, `zk-artifacts/shielded/${spec.source}_final.zkey`), {
        force: true,
      });
      fs.rmSync(path.join(fixture.root, `zk-artifacts/shielded/${spec.source}.vkey.json`), {
        force: true,
      });
    }
    const inspected = inspectShieldedProductionArtifacts({ root: fixture.root });
    expect(Object.keys(inspected.artifacts)).to.have.length(7);
    for (const artifact of Object.values(inspected.artifacts)) {
      expect(artifact.zkey).to.include(path.join("frontend", "public", "zk", "shielded"));
      expect(artifact.vkey).to.include(path.join("frontend", "public", "zk", "shielded"));
    }
  });

  it("rejects a missing finalized circuit before writing any production manifest", async function () {
    const finalized = { ...fixture.finalized };
    delete finalized.claim;
    const error = await captureError(() => fixture.createRecords({ finalized }));
    expect(error.message).to.include("Missing claim shielded production artifacts");
    expect(fs.existsSync(path.join(fixture.root, SHIELDED_PRODUCTION_MANIFEST_PATH))).to.equal(
      false,
    );
  });

  it("rejects an omitted manifest circuit and a public key replaced with another circuit's key", async function () {
    const records = await fixture.createRecords();
    fixture.install(records);
    const originalClaim = records.manifest.circuits.claim;
    delete records.manifest.circuits.claim;
    writeJson(fixture.root, SHIELDED_PRODUCTION_MANIFEST_PATH, records.manifest);
    expect(() => inspectShieldedProductionArtifacts({ root: fixture.root })).to.throw(
      "must cover all seven circuits",
    );
    records.manifest.circuits.claim = originalClaim;
    writeJson(fixture.root, SHIELDED_PRODUCTION_MANIFEST_PATH, records.manifest);
    fs.copyFileSync(
      fixture.finalized.fund.finalZkey,
      path.join(fixture.root, "frontend/public/zk/shielded/shielded_claim_final.zkey"),
    );
    expect(() => inspectShieldedProductionArtifacts({ root: fixture.root })).to.throw(
      "claim zkey SHA-256 mismatch",
    );
  });

  it("detects staged compilation that changes after its snapshot", function () {
    fs.appendFileSync(fixture.compiled.fund.r1cs, "changed constraints\n");
    expect(() => assertShieldedCompilationUnchanged(fixture.compiled)).to.throw(
      "fund shielded R1CS changed during production setup",
    );
  });

  it("rejects staged compilation differing from the reviewed development baseline", function () {
    const reviewed = structuredClone(fixture.initialManifest);
    reviewed.circuits.claim.wasmSha256 = "ff".repeat(32);
    expect(() =>
      snapshotShieldedCompilation({
        root: fixture.root,
        stageBuild: fixture.stageBuild,
        expectedManifest: reviewed,
      }),
    ).to.throw("claim shielded wasmSha256 differs from the reviewed compilation baseline");
  });

  it("uses the committed development compilation baseline by default and rejects an omitted circuit", function () {
    writeJson(fixture.root, "circuits/shielded-development-manifest.json", fixture.initialManifest);
    expect(
      Object.keys(
        snapshotShieldedCompilation({ root: fixture.root, stageBuild: fixture.stageBuild }),
      ),
    ).to.have.length(7);
    delete fixture.initialManifest.circuits.claim;
    writeJson(fixture.root, "circuits/shielded-development-manifest.json", fixture.initialManifest);
    expect(() =>
      snapshotShieldedCompilation({ root: fixture.root, stageBuild: fixture.stageBuild }),
    ).to.throw("compilation baseline must cover all seven circuits");
  });

  it("allows reviewed runtime rotation across source and lock changes while preserving artifact checks", async function () {
    fixture.install(await fixture.createRecords());
    writeJson(fixture.root, "package-lock.json", { name: "reviewed-new-lock", lockfileVersion: 3 });
    write(
      fixture.root,
      "node_modules/snarkjs/reviewed-dependency-update.js",
      "reviewed runtime dependency update\n",
    );
    const expectedSnarkjsRuntimeSha256 = inspectSnarkjsRuntime({ root: fixture.root }).sha256;
    expect(expectedSnarkjsRuntimeSha256).not.to.equal(fixture.runtimeSha256);
    expect(() => inspectShieldedProductionArtifacts({ root: fixture.root })).to.throw(
      "source bundle SHA-256 mismatch",
    );
    const options = { root: fixture.root, expectedSnarkjsRuntimeSha256 };
    expect(Object.keys(inspectShieldedProductionArtifacts(options).artifacts)).to.have.length(7);
    fs.appendFileSync(
      path.join(fixture.root, "frontend/public/zk/shielded/shielded_claim_final.zkey"),
      "modified key\n",
    );
    expect(() => inspectShieldedProductionArtifacts(options)).to.throw(
      "claim zkey SHA-256 mismatch",
    );
  });
});
