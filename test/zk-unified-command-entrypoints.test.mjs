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
} from "../scripts/check-zk-artifacts.mjs";
import { verifyAllProductionCeremonies } from "../scripts/zk-ceremony-verify.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/zk-shielded-build.mjs";
import { syncShieldedDevelopmentAssets } from "../scripts/lib/shieldedDevelopmentAssets.mjs";
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-unified-zk-check-"));
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
  }
  const manifestPath = "circuits/shielded-development-manifest.json";
  await syncShieldedDevelopmentAssets({ root, manifest, output: { log() {}, error() {} } });
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

  it("checks all nine shielded development circuits and their zkey-derived outputs", function () {
    const result = checkShieldedDevelopmentArtifacts({
      root: fixture.root,
      runner: fixture.runner,
    });
    expect(result).to.deep.equal({ status: "development", circuitCount: 9 });
    // Nine verification keys and eight Solidity verifiers: the receive code has none.
    expect(fixture.calls).to.have.length(17);
  });

  it("checks development artifacts using an external pinned pTau selected by ZK_PTAU_PATH", function () {
    const external = movePtauOutsideCheckout(fixture);
    const result = checkShieldedDevelopmentArtifacts({
      root: fixture.root,
      runner: fixture.runner,
      env: { ZK_PTAU_PATH: external },
    });
    expect(result.circuitCount).to.equal(9);
    expect(fs.existsSync(path.join(fixture.root, PRODUCTION_PTAU_RELATIVE_PATH))).to.equal(false);
  });

  it("uses an explicit pinned pTau before the environment and respects Windows environment casing", function () {
    const external = movePtauOutsideCheckout(fixture);
    const options = { root: fixture.root, runner: fixture.runner, platform: "win32" };
    expect(
      checkShieldedDevelopmentArtifacts({ ...options, env: { zk_ptau_path: external } })
        .circuitCount,
    ).to.equal(9);
    expect(
      checkShieldedDevelopmentArtifacts({
        ...options,
        ptauPath: external,
        env: { ZK_PTAU_PATH: "missing.ptau" },
      }).circuitCount,
    ).to.equal(9);
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

  it("synchronizes every development proof file and verifier to the shared public locations", function () {
    const publicDirectory = path.join(fixture.root, "frontend/public/zk/shielded");
    expect(fs.readdirSync(publicDirectory)).to.have.length(27);
    for (const [action, item] of Object.entries(fixture.manifest.circuits)) {
      expect(sha256(path.join(publicDirectory, `${item.source}_final.zkey`))).to.equal(
        item.zkeySha256,
      );
      if (!hasShieldedSolidityVerifier(action)) {
        expect(item).not.to.have.property("verifierPath");
        continue;
      }
      expect(sha256(path.join(fixture.root, item.verifierPath))).to.equal(
        item.solidityVerifierSha256,
      );
    }
    expect(
      JSON.parse(fs.readFileSync(path.join(fixture.root, fixture.manifestPath), "utf8")),
    ).to.deep.equal(fixture.manifest);
  });

  it("rejects a modified input before replacing any public development assets", async function () {
    const publicKey = path.join(
      fixture.root,
      "frontend/public/zk/shielded/shielded_allocate_final.zkey",
    );
    const baseline = sha256(publicKey);
    fs.appendFileSync(
      path.join(fixture.root, "zk-artifacts/shielded/shielded_allocate_dev_final.zkey"),
      "tampered",
    );
    await assert.rejects(
      () => syncShieldedDevelopmentAssets({ root: fixture.root, manifest: fixture.manifest }),
      /zkeySha256 mismatch/u,
    );
    expect(sha256(publicKey)).to.equal(baseline);
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
    expect(result.circuitCount).to.equal(9);
  });

  it("rejects an omitted circuit or a modified development zkey", function () {
    const claim = fixture.manifest.circuits.claim;
    delete fixture.manifest.circuits.claim;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    expect(() =>
      checkShieldedDevelopmentArtifacts({ root: fixture.root, runner: fixture.runner }),
    ).to.throw("exactly all nine circuits");

    fixture.manifest.circuits.claim = claim;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    fs.appendFileSync(
      path.join(fixture.root, "frontend/public/zk/shielded/shielded_claim_final.zkey"),
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
    fixture.manifest.circuits.allocate.verifierPath = fixture.manifest.circuits.claim.verifierPath;
    write(fixture.root, fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
    expect(() =>
      checkShieldedDevelopmentArtifacts({ root: fixture.root, runner: fixture.runner }),
    ).to.throw("allocate development verifier identity differs from its circuit action");
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
    expect(result).to.deep.equal({ status: "production", circuitCount: 9 });
    expect(() =>
      checkShieldedArtifacts({
        root: fixture.root,
        productionInspector: () => ({
          artifacts: Object.fromEntries(
            Object.keys(SHIELDED_CIRCUITS)
              .slice(0, 8)
              .map((name) => [name, {}]),
          ),
          manifestSha256: "ab".repeat(32),
        }),
      }),
    ).to.throw("all nine circuits");
  });

  it("runs both production ceremony verifiers and requires all nine shielded circuits", async function () {
    const calls = [];
    const options = {
      root: fixture.root,
      ptauPath: path.join(fixture.root, "ceremony.ptau"),
      legacyVerifier: async (args) => {
        calls.push(["legacy", args]);
        return {
          circuits: ["person_commitment", "disclosure_binding"],
          manifestSha256: "11".repeat(32),
        };
      },
      shieldedVerifier: async (args) => {
        calls.push(["shielded", args]);
        return { circuitCount: 9, manifestSha256: "22".repeat(32) };
      },
    };
    const result = await verifyAllProductionCeremonies(options);
    expect(calls).to.deep.equal([
      ["legacy", { root: options.root, ptauPath: options.ptauPath }],
      ["shielded", { root: options.root, ptauPath: options.ptauPath }],
    ]);
    expect(result.circuitCount).to.equal(11);
    await assert.rejects(
      () =>
        verifyAllProductionCeremonies({
          ...options,
          shieldedVerifier: async () => ({ circuitCount: 8 }),
        }),
      /all nine circuits/u,
    );
    await assert.rejects(
      () =>
        verifyAllProductionCeremonies({
          ...options,
          legacyVerifier: async () => ({ circuits: ["person_commitment"] }),
        }),
      /both circuits/u,
    );
  });
});
