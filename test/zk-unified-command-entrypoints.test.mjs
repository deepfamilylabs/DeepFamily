import { expect } from "chai";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkShieldedArtifacts,
  checkShieldedDevelopmentArtifacts,
  main as checkZkArtifacts,
} from "../scripts/check-zk-artifacts.mjs";
import { verifyAllProductionCeremonies } from "../scripts/zk-ceremony-verify.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/lib/zkCircuitSelection.mjs";
import { SHIELDED_SETUP_CIRCUITS } from "../scripts/lib/shieldedProductionSetup.mjs";
import { PRODUCTION_PTAU_RELATIVE_PATH } from "../scripts/lib/productionPtau.mjs";
import { hasShieldedSolidityVerifier } from "../scripts/lib/zkCircuitSelection.mjs";

const sha256 = (filePath) => createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

function write(root, relativePath, contents) {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
  return absolute;
}

async function developmentFixture() {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-unified-zk-check-")),
  );
  write(root, "node_modules/snarkjs/build/cli.cjs", "fixture snarkjs CLI\n");
  const ptau = path.join(root, PRODUCTION_PTAU_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(ptau), { recursive: true });
  fs.copyFileSync(
    fileURLToPath(new URL(`../${PRODUCTION_PTAU_RELATIVE_PATH}`, import.meta.url)),
    ptau,
    fs.constants.COPYFILE_FICLONE,
  );
  const manifest = {
    schema: "deepfamily/shielded-development-keys@1",
    developmentOnly: true,
    productionReady: false,
    ptauSha256: sha256(ptau),
    circuits: {},
  };
  for (const [action, name] of Object.entries(SHIELDED_CIRCUITS)) {
    const prefix = `zk-artifacts/shielded/${name}`;
    const files = {
      sourceSha256: write(root, `circuits/${name}.circom`, `${name} source\n`),
      r1csSha256: write(root, `${prefix}.r1cs`, `${name} r1cs\n`),
      wasmSha256: write(root, `${prefix}_js/${name}.wasm`, `${name} wasm\n`),
      zkeySha256: write(root, `${prefix}_dev_final.zkey`, `${name} zkey\n`),
      verificationKeySha256: write(root, `${prefix}.vkey.json`, `${name} vkey\n`),
      ...(hasShieldedSolidityVerifier(action) && {
        verifierSha256: write(
          root,
          `zk-artifacts/shielded/verifiers/${name}.sol`,
          `pragma solidity ^0.8.20;\ncontract Groth16Verifier {}\n`,
        ),
      }),
    };
    manifest.circuits[action] = {
      source: name,
      ...Object.fromEntries(Object.entries(files).map(([field, file]) => [field, sha256(file)])),
    };
    const browser = `frontend/public/zk/shielded/${name}`;
    for (const [field, destination] of [
      ["wasmSha256", `${browser}.wasm`],
      ["zkeySha256", `${browser}_final.zkey`],
      ["verificationKeySha256", `${browser}.vkey.json`],
    ]) {
      write(root, destination, fs.readFileSync(files[field]));
    }
    const spec = SHIELDED_SETUP_CIRCUITS[action];
    if (spec.verifierPath) {
      const verifier = write(
        root,
        spec.verifierPath,
        `pragma solidity ^0.8.20;\ncontract ${spec.verifierContractName} {}\n`,
      );
      Object.assign(manifest.circuits[action], {
        verifierPath: spec.verifierPath,
        verifierContractName: spec.verifierContractName,
        solidityVerifierSha256: sha256(verifier),
      });
    }
  }
  const manifestPath = "circuits/shielded-development-manifest.json";
  write(root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const calls = [];
  const runner = (_executable, args) => {
    calls.push(args);
    const name = path.basename(args[4], "_final.zkey");
    if (args[3] === "verificationkey") {
      fs.copyFileSync(path.join(root, `frontend/public/zk/shielded/${name}.vkey.json`), args[5]);
    } else {
      const item = Object.values(manifest.circuits).find((item) => item.source === name);
      fs.writeFileSync(
        args[5],
        fs
          .readFileSync(path.join(root, item.verifierPath), "utf8")
          .replace(`contract ${item.verifierContractName}`, "contract Groth16Verifier"),
      );
    }
  };
  return { root, manifest, manifestPath, runner, calls };
}

function movePtauOutsideCheckout(fixture) {
  fixture.externalRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-unified-external-ptau-")),
  );
  const external = path.join(fixture.externalRoot, "phase1.ptau");
  fs.renameSync(path.join(fixture.root, PRODUCTION_PTAU_RELATIVE_PATH), external);
  return external;
}

describe("unified ZK command entrypoints", function () {
  let fixture;

  beforeEach(async function () {
    fixture = await developmentFixture();
  });

  afterEach(function () {
    fs.rmSync(fixture.root, { recursive: true, force: true });
    if (fixture.externalRoot) fs.rmSync(fixture.externalRoot, { recursive: true, force: true });
  });

  it("awaits independent linking verification in the complete artifact check", async function () {
    const calls = [];
    const core = { status: "passed" };
    const shielded = { status: "production", circuitCount: 14 };
    const receive = { circuitCount: 3, manifestSha256: "ab".repeat(32) };
    const result = await checkZkArtifacts({
      coreChecker: () => core,
      shieldedChecker: () => shielded,
      receiveVerifier: async (options) => {
        await Promise.resolve();
        calls.push(options);
        return receive;
      },
    });
    expect(calls).to.deep.equal([
      {
        root: path.resolve(fileURLToPath(new URL("..", import.meta.url))),
        requireProduction: true,
      },
    ]);
    expect(result).to.deep.equal({ core, shielded, receive });
    const failure = new Error("linked verifier differs from zkey-derived source");
    await assert.rejects(
      () =>
        checkZkArtifacts({
          coreChecker: () => core,
          shieldedChecker: () => shielded,
          receiveVerifier: async () => {
            throw failure;
          },
        }),
      (error) => error === failure,
    );
  });

  it("keeps the intermediate issuer artifact check independent of unfinished linking outputs", async function () {
    const result = await checkZkArtifacts({
      circomOnly: true,
      coreChecker: () => ({ status: "passed" }),
      shieldedChecker: () => ({ status: "development" }),
      receiveVerifier: () => {
        throw new Error("Linking artifacts are installed after the intermediate check");
      },
    });
    expect(Object.keys(result)).to.deep.equal(["core", "shielded"]);
  });

  it("checks all configured shielded development circuits and their zkey-derived outputs", function () {
    const result = checkShieldedDevelopmentArtifacts({
      root: fixture.root,
      runner: fixture.runner,
    });
    expect(result).to.deep.equal({ status: "development", circuitCount: 14 });
    // Fourteen Circom verification keys and nine Solidity verifiers for owner updates and money actions.
    expect(fixture.calls).to.have.length(23);
  });

  it("checks development artifacts using an external pinned pTau selected by ZK_PTAU_PATH", function () {
    const external = movePtauOutsideCheckout(fixture);
    const result = checkShieldedDevelopmentArtifacts({
      root: fixture.root,
      runner: fixture.runner,
      env: { ZK_PTAU_PATH: external },
    });
    expect(result.circuitCount).to.equal(14);
    expect(fs.existsSync(path.join(fixture.root, PRODUCTION_PTAU_RELATIVE_PATH))).to.equal(false);
  });

  it("uses an explicit pinned pTau before the environment and respects Windows environment casing", function () {
    const external = movePtauOutsideCheckout(fixture);
    const options = { root: fixture.root, runner: fixture.runner, platform: "win32" };
    expect(
      checkShieldedDevelopmentArtifacts({ ...options, env: { zk_ptau_path: external } })
        .circuitCount,
    ).to.equal(14);
    expect(
      checkShieldedDevelopmentArtifacts({
        ...options,
        ptauPath: external,
        env: { ZK_PTAU_PATH: "missing.ptau" },
      }).circuitCount,
    ).to.equal(14);
  });

  it("rejects unpinned external pTau contents and symlink file or directory paths", function () {
    const external = movePtauOutsideCheckout(fixture);
    const options = { root: fixture.root, runner: fixture.runner };
    const link = path.join(fixture.root, "ptau-link");
    fs.symlinkSync(external, link);
    expect(() => checkShieldedDevelopmentArtifacts({ ...options, ptauPath: link })).to.throw(
      "regular non-symlink file",
    );
    fs.unlinkSync(link);
    fs.symlinkSync(fixture.externalRoot, link, "dir");
    expect(() =>
      checkShieldedDevelopmentArtifacts({ ...options, ptauPath: path.join(link, "phase1.ptau") }),
    ).to.throw("regular non-symlink file");
    fs.writeFileSync(external, "unreviewed powers of tau\n");
    expect(() => checkShieldedDevelopmentArtifacts({ ...options, ptauPath: external })).to.throw(
      "Shielded development Powers of Tau does not match",
    );
    expect(fixture.calls).to.have.length(0);
  });

  it("checks a checkout with no ignored proving keys or verification keys", function () {
    for (const name of Object.values(SHIELDED_CIRCUITS)) {
      fs.rmSync(path.join(fixture.root, `zk-artifacts/shielded/${name}_dev_final.zkey`));
      fs.rmSync(path.join(fixture.root, `zk-artifacts/shielded/${name}.vkey.json`));
      fs.rmSync(path.join(fixture.root, `zk-artifacts/shielded/verifiers/${name}.sol`), {
        force: true,
      });
    }
    const result = checkShieldedDevelopmentArtifacts({
      root: fixture.root,
      runner: fixture.runner,
    });
    expect(result.circuitCount).to.equal(14);
  });

  it("rejects an omitted circuit or a modified development zkey", function () {
    const claim = fixture.manifest.circuits.claim;
    delete fixture.manifest.circuits.claim;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    expect(() =>
      checkShieldedDevelopmentArtifacts({ root: fixture.root, runner: fixture.runner }),
    ).to.throw("exactly all configured circuits");

    fixture.manifest.circuits.claim = claim;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    fs.appendFileSync(
      path.join(fixture.root, "frontend/public/zk/shielded/shielded_claim_64_final.zkey"),
      "tampered",
    );
    expect(() =>
      checkShieldedDevelopmentArtifacts({ root: fixture.root, runner: fixture.runner }),
    ).to.throw("claim development zkeySha256 does not match");
  });

  it("rejects development keys mislabeled as production", function () {
    fixture.manifest.productionReady = true;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    expect(() =>
      checkShieldedDevelopmentArtifacts({ root: fixture.root, runner: fixture.runner }),
    ).to.throw("development-only");
    expect(fixture.calls).to.have.length(0);
  });

  it("rejects a verifier assigned to the wrong circuit action", function () {
    fixture.manifest.circuits.fund.verifierPath = fixture.manifest.circuits.claim.verifierPath;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    expect(() =>
      checkShieldedDevelopmentArtifacts({ root: fixture.root, runner: fixture.runner }),
    ).to.throw("fund development verifier identity differs from its circuit action");
  });

  it("uses production inspection when a production manifest exists", function () {
    write(fixture.root, "circuits/shielded-production-manifest.json", "{}\n");
    const calls = [];
    const result = checkShieldedArtifacts({
      root: fixture.root,
      productionInspector: ({ root }) => {
        calls.push(root);
        return {
          artifacts: Object.fromEntries(Object.keys(SHIELDED_CIRCUITS).map((name) => [name, {}])),
          manifestSha256: "ab".repeat(32),
        };
      },
    });
    expect(calls).to.deep.equal([fixture.root]);
    expect(result).to.deep.equal({ status: "production", circuitCount: 14 });
    expect(() =>
      checkShieldedArtifacts({
        root: fixture.root,
        productionInspector: () => ({
          artifacts: Object.fromEntries(
            Object.keys(SHIELDED_CIRCUITS)
              .slice(0, 5)
              .map((name) => [name, {}]),
          ),
          manifestSha256: "ab".repeat(32),
        }),
      }),
    ).to.throw("all configured circuits");
  });

  it("checks the fixed linking keys and both Circom ceremony groups without counting presentations twice", async function () {
    const calls = [];
    const options = {
      root: fixture.root,
      ptauPath: path.join(fixture.root, "ceremony.ptau"),
      receiveInspector: async (args) => {
        calls.push(["receive", args]);
        return {
          status: "production",
          verification: "passed",
          circuitCount: 3,
          manifestSha256: "33".repeat(32),
        };
      },
      coreVerifier: async (args) => {
        calls.push(["core", args]);
        return {
          circuits: ["person_commitment", "disclosure_binding"],
          manifestSha256: "11".repeat(32),
        };
      },
      shieldedVerifier: async (args) => {
        calls.push(["shielded", args]);
        return { circuitCount: 14, manifestSha256: "33".repeat(32) };
      },
    };
    const result = await verifyAllProductionCeremonies(options);
    expect(calls).to.deep.equal([
      ["receive", { root: options.root, requireProduction: true }],
      ["core", { root: options.root, ptauPath: options.ptauPath }],
      ["shielded", { root: options.root, ptauPath: options.ptauPath }],
      ["receive", { root: options.root, requireProduction: true }],
    ]);
    expect(result.circuitCount).to.equal(16);
    expect(result.core.circuits).to.deep.equal(["person_commitment", "disclosure_binding"]);
    expect(Object.keys(result)).to.deep.equal(["core", "shielded", "receive", "circuitCount"]);
    await assert.rejects(
      () =>
        verifyAllProductionCeremonies({
          ...options,
          shieldedVerifier: async () => ({ circuitCount: 5 }),
        }),
      /all configured circuits/u,
    );
    await assert.rejects(
      () =>
        verifyAllProductionCeremonies({
          ...options,
          coreVerifier: async () => ({ circuits: ["person_commitment"] }),
        }),
      /both circuits/u,
    );
  });

  it("rejects a mathematically verified shielded group from a different receive manifest", async function () {
    let receiveInspections = 0;
    await assert.rejects(
      () =>
        verifyAllProductionCeremonies({
          root: fixture.root,
          receiveInspector: async () => {
            receiveInspections += 1;
            return {
              status: "production",
              verification: "passed",
              circuitCount: 3,
              manifestSha256: "33".repeat(32),
            };
          },
          coreVerifier: async () => ({ circuits: ["person_commitment", "disclosure_binding"] }),
          shieldedVerifier: async () => ({ circuitCount: 14, manifestSha256: "44".repeat(32) }),
        }),
      /Verified shielded ceremony does not match the receive presentation manifest/u,
    );
    expect(receiveInspections).to.equal(1);
  });

  it("rechecks receive status, verification, coverage and manifest after both mathematical verifiers", async function () {
    const initial = {
      status: "production",
      verification: "passed",
      circuitCount: 3,
      manifestSha256: "33".repeat(32),
    };
    for (const changed of [
      { ...initial, status: "development" },
      { ...initial, verification: "failed" },
      { ...initial, circuitCount: 2 },
      { ...initial, manifestSha256: "44".repeat(32) },
    ]) {
      const calls = [];
      await assert.rejects(
        () =>
          verifyAllProductionCeremonies({
            root: fixture.root,
            receiveInspector: async () => {
              calls.push("receive");
              return calls.length === 1 ? initial : changed;
            },
            coreVerifier: async () => {
              calls.push("core");
              return { circuits: ["person_commitment", "disclosure_binding"] };
            },
            shieldedVerifier: async () => {
              calls.push("shielded");
              return { circuitCount: 14, manifestSha256: initial.manifestSha256 };
            },
          }),
        /Receive presentation artifacts changed during production ceremony verification/u,
      );
      expect(calls).to.deep.equal(["receive", "core", "shielded", "receive"]);
    }
  });

  it("rejects missing or invalid production linking keys before checking circuit ceremonies", async function () {
    let otherVerifiersCalled = false;
    const options = {
      root: fixture.root,
      coreVerifier: async () => {
        otherVerifiersCalled = true;
        return { circuits: ["person_commitment", "disclosure_binding"] };
      },
      shieldedVerifier: async () => {
        otherVerifiersCalled = true;
        return { circuitCount: 14 };
      },
    };
    await assert.rejects(
      () => verifyAllProductionCeremonies(options),
      /Receive presentations require production Circom artifacts/u,
    );
    expect(otherVerifiersCalled).to.equal(false);
    for (const receive of [
      { status: "development", manifestSha256: "33".repeat(32) },
      { status: "production", circuitCount: 3, manifestSha256: "33".repeat(32) },
    ]) {
      await assert.rejects(
        () =>
          verifyAllProductionCeremonies({
            ...options,
            receiveInspector: async () => receive,
          }),
        /requires.*production receive presentation evidence/u,
      );
    }
    expect(otherVerifiersCalled).to.equal(false);
  });
});
