import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  inspectLinkedReceiveArtifacts,
  RECEIVE_LINK_KEYS_PATH,
  verifyLinkedReceiveArtifacts,
} from "../scripts/lib/linkedReceiveArtifacts.mjs";
import {
  RECEIVE_PRESENTATION_CIRCUITS,
  SHIELDED_CIRCUITS,
} from "../scripts/lib/zkCircuitSelection.mjs";

const repository = path.resolve(import.meta.dirname, "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

const groth16HeaderPoints = (raw) => {
  assert.equal(raw.subarray(0, 4).toString(), "zkey");
  const sectionCount = raw.readUInt32LE(8);
  let offset = 12;
  for (let index = 0; index < sectionCount; index++) {
    const sectionId = raw.readUInt32LE(offset);
    const sectionSize = Number(raw.readBigUInt64LE(offset + 4));
    offset += 12;
    if (sectionId !== 2) {
      offset += sectionSize;
      continue;
    }
    const end = offset + sectionSize;
    const n8q = raw.readUInt32LE(offset);
    offset += 4 + n8q;
    const n8r = raw.readUInt32LE(offset);
    offset += 4 + n8r + 12; // Skip r, nVars, nPublic and domainSize.
    const points = {};
    for (const [name, coordinates] of [
      ["alpha1", 2],
      ["beta1", 2],
      ["beta2", 4],
      ["gamma2", 4],
      ["delta1", 2],
      ["delta2", 4],
    ]) {
      points[name] = raw.subarray(offset, offset + n8q * coordinates);
      offset += n8q * coordinates;
    }
    assert.equal(offset, end);
    return points;
  }
  assert.fail("Real Groth16 zkey fixture must contain a public header section");
};

describe("Circom receive linking artifacts", function () {
  this.timeout(120_000);
  let root;
  let copiedFiles;
  const read = (file) => fs.readFileSync(path.join(root, file));
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), data);
    copiedFiles.add(file);
  };
  const copyZkeys = () => {
    const actions = new Set();
    for (const [action, spec] of Object.entries(RECEIVE_PRESENTATION_CIRCUITS)) {
      actions.add(action);
      actions.add(spec.issuer);
    }
    for (const action of actions) {
      const file = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[action]}_final.zkey`;
      if (!copiedFiles.has(file)) write(file, fs.readFileSync(path.join(repository, file)));
    }
  };
  const snapshot = () => new Map([...copiedFiles].map((file) => [file, hash(read(file))]));
  const verify = async (options = {}) => {
    copyZkeys();
    const before = snapshot();
    let temporaryDirectory;
    try {
      return await verifyLinkedReceiveArtifacts({
        ...options,
        root,
        privateDirectoryFactory: ({ prefix }) => {
          temporaryDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
          fs.chmodSync(temporaryDirectory, 0o700);
          return temporaryDirectory;
        },
      });
    } finally {
      assert.deepEqual(snapshot(), before, "verification must not rewrite source artifacts");
      if (temporaryDirectory) {
        assert.equal(
          fs.existsSync(temporaryDirectory),
          false,
          "verification snapshots must be removed",
        );
      }
    }
  };
  const writeManifest = (update) => {
    const file = "circuits/shielded-development-manifest.json";
    const manifest = JSON.parse(read(file));
    update(manifest);
    write(file, `${JSON.stringify(manifest, null, 2)}\n`);
  };
  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-link-artifacts-"));
    copiedFiles = new Set();
    const files = [
      "circuits/shielded-development-manifest.json",
      RECEIVE_LINK_KEYS_PATH,
      "contracts/libraries/LinkedGroth16Verifier.sol",
    ];
    for (const [action, spec] of Object.entries(RECEIVE_PRESENTATION_CIRCUITS))
      files.push(
        `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[action]}.vkey.json`,
        `frontend/public/zk/shielded/${SHIELDED_CIRCUITS[spec.issuer]}.vkey.json`,
        `contracts/${spec.contractName}.sol`,
      );
    for (const file of new Set(files)) write(file, fs.readFileSync(path.join(repository, file)));
  });
  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("pins both local linking verifiers without a second prover runtime", function () {
    const result = inspectLinkedReceiveArtifacts({ root });
    assert.equal(result.circuitCount, 2);
    assert.equal(result.status, "development");
    assert.equal(result.verification, "passed");
    assert.deepEqual(Object.keys(result.artifacts).sort(), ["fund", "receive"]);
  });

  for (const file of [
    RECEIVE_LINK_KEYS_PATH,
    "contracts/libraries/LinkedGroth16Verifier.sol",
    "contracts/FundReceivePresentationVerifier.sol",
    "frontend/public/zk/shielded/shielded_receive_credential.vkey.json",
    "frontend/public/zk/shielded/shielded_fund_receive_presentation.vkey.json",
  ]) {
    it(`rejects modified ${file}`, function () {
      write(file, `${read(file)} `);
      assert.throws(() => inspectLinkedReceiveArtifacts({ root }));
    });
  }

  it("rejects a presentation key swapped inside an otherwise freshly hashed bundle", function () {
    const keys = JSON.parse(read(RECEIVE_LINK_KEYS_PATH));
    keys.receive.verificationKey = keys.fund.verificationKey;
    const raw = JSON.stringify(keys);
    write(RECEIVE_LINK_KEYS_PATH, raw);
    const file = "circuits/shielded-development-manifest.json";
    const manifest = JSON.parse(read(file));
    manifest.linkKeys.sha256 = hash(raw);
    write(file, JSON.stringify(manifest));
    assert.throws(() => inspectLinkedReceiveArtifacts({ root }), /stale Circom presentation key/u);
  });

  it("rejects development artifacts when production is required", function () {
    assert.throws(
      () => inspectLinkedReceiveArtifacts({ root, requireProduction: true }),
      /production Circom artifacts/u,
    );
  });

  it("independently derives the link bundle and both verifiers from the real zkeys", async function () {
    const result = await verify();
    assert.equal(result.verification, "passed");
    assert.equal(result.status, "development");
    assert.equal(result.circuitCount, 2);
  });

  it("preserves an existing curve pool when zkey reader dependencies first load", function () {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import assert from "node:assert/strict";
import { readZkeyDeltaG1 } from "./scripts/lib/linkedVerifierSource.mjs";
const pool = { sentinel: true };
globalThis.curve_bn128 = pool;
await readZkeyDeltaG1("frontend/public/zk/shielded/shielded_receive_credential_final.zkey");
assert.equal(globalThis.curve_bn128, pool);`,
      ],
      { cwd: repository, timeout: 30_000, stdio: "pipe" },
    );
  });

  it("rejects a manifest different from the one bound by zkey verification", async function () {
    await assert.rejects(
      verify({ expectedManifestSha256: "0".repeat(64) }),
      /manifest changed since zkey verification/u,
    );
  });

  it("rejects a modified zkey whose manifest hash was not refreshed", async function () {
    copyZkeys();
    const file = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS.receiveCredential}_final.zkey`;
    write(file, Buffer.concat([read(file), Buffer.from([0])]));
    assert.equal(inspectLinkedReceiveArtifacts({ root }).verification, "passed");
    await assert.rejects(verify(), /SHA-256 mismatch/u);
  });

  for (const { name, replace, replacement, expected } of [
    { name: "unsupported gamma", replace: "gamma2", replacement: "delta2", expected: /gamma = 1/u },
    {
      name: "inconsistent delta G1/G2",
      replace: "delta1",
      replacement: "alpha1",
      expected: /delta G1\/G2 header mismatch/u,
    },
  ]) {
    it(`rejects a zkey with ${name} even after its manifest hash is refreshed`, async function () {
      copyZkeys();
      const file = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS.receivePresentation}_final.zkey`;
      const raw = read(file);
      const points = groth16HeaderPoints(raw);
      assert.equal(points[replace].equals(points[replacement]), false);
      points[replace].set(points[replacement]);
      write(file, raw);
      writeManifest((manifest) => {
        manifest.circuits.receivePresentation.zkeySha256 = hash(raw);
      });
      assert.equal(inspectLinkedReceiveArtifacts({ root }).verification, "passed");
      await assert.rejects(verify(), expected);
    });
  }

  for (const field of ["deltaG1", "issuerDeltaG1"]) {
    it(`rejects an invalid ${field} even after the bundle hash is refreshed`, async function () {
      const keys = JSON.parse(read(RECEIVE_LINK_KEYS_PATH));
      keys.receive[field] = ["0", "0"];
      const raw = `${JSON.stringify(keys, null, 2)}\n`;
      write(RECEIVE_LINK_KEYS_PATH, raw);
      writeManifest((manifest) => {
        manifest.linkKeys.sha256 = hash(raw);
      });
      assert.equal(inspectLinkedReceiveArtifacts({ root }).verification, "passed");
      await assert.rejects(verify(), /not derived from the zkey|mismatch|does not match/u);
    });
  }

  for (const spec of Object.values(RECEIVE_PRESENTATION_CIRCUITS)) {
    it(`rejects an empty ${spec.kind} verifier even after its manifest hash is refreshed`, async function () {
      const file = `contracts/${spec.contractName}.sol`;
      const source = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.28;\ncontract ${spec.contractName} {\n    function verifyProof(bytes calldata, uint256[${spec.publicInputs}] calldata) external view {}\n}\n`;
      write(file, source);
      writeManifest((manifest) => {
        manifest.linkKeys.verifiers[spec.kind].sha256 = hash(source);
      });
      assert.equal(inspectLinkedReceiveArtifacts({ root }).verification, "passed");
      await assert.rejects(verify(), /not derived from the zkey|mismatch|does not match/u);
    });
  }

  it("rejects a substituted vkey even when the bundle and manifest consistently use it", async function () {
    const file = `frontend/public/zk/shielded/${SHIELDED_CIRCUITS.receivePresentation}.vkey.json`;
    const vkey = JSON.parse(read(file));
    vkey.IC[0] = vkey.IC[1];
    const rawVkey = `${JSON.stringify(vkey, null, 2)}\n`;
    write(file, rawVkey);
    const keys = JSON.parse(read(RECEIVE_LINK_KEYS_PATH));
    keys.receive.verificationKey = vkey;
    const rawKeys = `${JSON.stringify(keys, null, 2)}\n`;
    write(RECEIVE_LINK_KEYS_PATH, rawKeys);
    writeManifest((manifest) => {
      manifest.circuits.receivePresentation.verificationKeySha256 = hash(rawVkey);
      manifest.linkKeys.sha256 = hash(rawKeys);
    });
    assert.equal(inspectLinkedReceiveArtifacts({ root }).verification, "passed");
    await assert.rejects(verify(), /not derived from the zkey|mismatch|does not match/u);
  });

  for (const file of [
    RECEIVE_LINK_KEYS_PATH,
    "contracts/ReceivePresentationVerifier.sol",
    `frontend/public/zk/shielded/${SHIELDED_CIRCUITS.receivePresentation}_final.zkey`,
  ]) {
    it(`rejects a symbolic link in place of ${file}`, async function () {
      copyZkeys();
      const original = path.join(root, file);
      const target = `${original}.target`;
      fs.renameSync(original, target);
      fs.symlinkSync(path.basename(target), original);
      await assert.rejects(verify(), /symbolic link|symlink|regular/u);
    });
  }

  it("rejects source changes after inspection and removes its temporary directory", async function () {
    copyZkeys();
    let temporaryDirectory;
    try {
      await assert.rejects(
        verifyLinkedReceiveArtifacts({
          root,
          privateDirectoryFactory: ({ prefix }) => {
            temporaryDirectory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
            fs.chmodSync(temporaryDirectory, 0o700);
            const file = "contracts/ReceivePresentationVerifier.sol";
            write(file, `${read(file)} `);
            return temporaryDirectory;
          },
        }),
        /changed|mismatch|does not match/u,
      );
    } finally {
      assert.equal(
        fs.existsSync(temporaryDirectory),
        false,
        "failed verification snapshots must be removed",
      );
    }
  });
});
