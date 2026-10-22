#!/usr/bin/env node
// Full production relation with insecure local development setup. Generates
// fresh issuer proofs, reconstructs every outer witness from raw JSON, and
// exercises actual Groth16 proving/verification rather than a mock verifier.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { poseidon2, poseidon3 } from "poseidon-lite";
import { getBytes, keccak256 } from "ethers";
import {
  computeShieldedBudgetNoteCommitment,
  decodeShieldedIndependentKey,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyIdentitySecret,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedIndependentKeyMnemonic,
  splitShieldedViewPublicKey,
} from "../packages/protocol-core/index.js";
import { prepareShieldedReceivePresentation } from "../packages/protocol-core/shielded-receive-presentation.js";
import { buildShieldedIdentityAuthorizationState } from "../packages/protocol-core/shielded-identity-authorization.js";
import { buildShieldedClaimFixture } from "../circuits/test/generate_shielded_claim_input.mjs";
import { buildLineageFixture } from "../circuits/test/generate_lineage_fixture.mjs";
import { inspectLinkedReceiveArtifacts } from "./lib/linkedReceiveArtifacts.mjs";
import { proveReceivePresentation, verifyReceivePresentation } from "./lib/receiveProofs.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceNames = {
  anonymous: "shielded_anonymous_receive_credential",
  fund: "shielded_fund_receive_credential",
};
const json = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

// Public synthetic recovery credentials for proving tests, never user material.
const independentFixtureKey = "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
export const RECEIVE_PROOF_INDEPENDENT_RECOVERY = Object.freeze({
  identity: Object.freeze({
    fullName: "First Heir",
    gender: 2,
    birthYear: 1960,
    birthMonth: 5,
    birthDay: 17,
    isBirthBC: false,
  }),
  rawPassphrase: "local receive-proof independent key recovery fixture",
  shieldedKey: independentFixtureKey,
  mnemonic: encodeShieldedIndependentKeyMnemonic(getBytes(independentFixtureKey)),
});

/** Derive real receiving branches so fixtures also support HPKE and key recovery. */
export async function receiveProofFixtureKeyMaterial(keyMode = 0) {
  keyMode = Number(BigInt(keyMode));
  assert(keyMode === 0 || keyMode === 1, "keyMode must be 0 or 1");
  if (keyMode === 0) {
    return deriveShieldedHeirKeyMaterial(BigInt(buildLineageFixture().witness.derivedSecretField));
  }
  const identitySecret = await deriveShieldedIndependentKeyIdentitySecret(
    RECEIVE_PROOF_INDEPENDENT_RECOVERY,
  );
  try {
    return await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: decodeShieldedIndependentKey(independentFixtureKey),
      independentKeyIdentitySecret: identitySecret,
    });
  } finally {
    identitySecret.fill(0);
  }
}

export async function prepareReceiveProofFixtures(
  outDir,
  { existingIssuers = false, issuerDirectory, authorizationCounter = 3n, keyMode = 0 } = {},
) {
  authorizationCounter = BigInt(authorizationCounter);
  assert(authorizationCounter >= 0n && authorizationCounter < 1n << 64n);
  fs.mkdirSync(outDir, { recursive: true });
  const issuerDir = issuerDirectory ?? path.join(outDir, "issuers");
  fs.mkdirSync(issuerDir, { recursive: true });
  const originalCpus = os.cpus;
  os.cpus = () => originalCpus().slice(0, 2);
  const snarkjs = await import("snarkjs");
  try {
    const lineage = buildLineageFixture().witness;
    const identity = buildShieldedClaimFixture().heirIdentityCommitment;
    const keys = await receiveProofFixtureKeyMaterial(keyMode);
    keyMode = Number(BigInt(keyMode));
    const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
    const view = splitShieldedViewPublicKey(viewingKey);
    const alias = poseidon3([202610210001n, identity, BigInt(lineage.derivedSecretField)]);
    const witness = {
      ...Object.fromEntries(
        [
          "nameField",
          "derivedSecretField",
          "isBirthBC",
          "birthYear",
          "birthMonth",
          "birthDay",
          "gender",
          "suiteId",
        ].map((name) => [name, lineage[name]]),
      ),
      identityCommitment: String(identity),
      authorizationCounter: String(authorizationCounter),
      expiresAt: "1900000000",
      ownerCommitment: String(keys.ownerCommitment),
      viewKeyLo: String(view.viewKeyLo),
      viewKeyHi: String(view.viewKeyHi),
      keyMode: String(keyMode),
      identitySuiteId: "1",
      independentKeySuiteId: "1",
      independentKeyDerivationVersion: "1",
      receiveCodeVersion: "2",
      spendingSecret: String(keys.ownerSecret),
    };
    const credentials = {};
    for (const [disclosure, source] of Object.entries(sourceNames)) {
      if (!existingIssuers) {
        execFileSync(
          path.join(root, "bin/circom"),
          [
            `circuits/${source}.circom`,
            "--r1cs",
            "--wasm",
            "--O2",
            "--sanity_check",
            "2",
            "-l",
            "node_modules",
            "-l",
            "node_modules/circomlib/circuits",
            "-o",
            issuerDir,
          ],
          { cwd: root, stdio: "inherit" },
        );
        const zkey = path.join(issuerDir, `${source}.DEVELOPMENT.zkey`);
        await snarkjs.zKey.newZKey(
          path.join(issuerDir, `${source}.r1cs`),
          path.join(root, "circuits/ptau/ppot_0080_17.ptau"),
          zkey,
        );
        const vk = await snarkjs.zKey.exportVerificationKey(zkey);
        json(path.join(issuerDir, `${source}.vkey.json`), vk);
      }
      const vk = JSON.parse(fs.readFileSync(path.join(issuerDir, `${source}.vkey.json`), "utf8"));
      const existingZkey = [
        path.join(issuerDir, `${source}_dev_final.zkey`),
        path.join(issuerDir, `${source}_final.zkey`),
        path.join(issuerDir, `${source}.DEVELOPMENT.zkey`),
      ].find((file) => fs.existsSync(file));
      const existingWasm = [
        path.join(issuerDir, `${source}.wasm`),
        path.join(issuerDir, `${source}_js/${source}.wasm`),
      ].find((file) => fs.existsSync(file));
      const proof = await snarkjs.groth16.fullProve(
        witness,
        existingWasm,
        existingZkey,
        undefined,
        { singleThread: true },
        { singleThread: true },
      );
      assert.equal(await snarkjs.groth16.verify(vk, proof.publicSignals, proof.proof), true);
      credentials[disclosure] = {
        disclosure,
        authorizationAlias: alias,
        authorizationCounter,
        expiresAt: 1900000000n,
        ownerCommitment: keys.ownerCommitment,
        viewingKey,
        keyMode: BigInt(keyMode),
        ...(disclosure === "fund" ? { identityCommitment: identity } : {}),
        proof: proof.proof,
      };
    }
    // Counter zero is the canonical empty-state fixture for a newly deployed
    // contract. The default nonzero counter exercises the full supported path.
    const state = buildShieldedIdentityAuthorizationState(
      authorizationCounter === 0n
        ? []
        : [
            [alias, authorizationCounter],
            [alias ^ (1n << 63n), 5n],
          ],
    );
    const consumer = "0x1111111111111111111111111111111111111111";
    const pool = "0x2222222222222222222222222222222222222222";
    const cases = [];
    for (const [name, action, disclosure] of [
      ["anonymous", 1n, "anonymous"],
      ["transfer", 4n, "anonymous"],
      ["fund", 3n, "fund"],
      ["attachment", 2n, "anonymous"],
    ]) {
      const prepared = prepareShieldedReceivePresentation({
        credential: credentials[disclosure],
        chainId: 31337n,
        consumer,
        action,
        messageId: action === 3n || action === 4n ? 0n : 42n,
        payloadHash: keccak256("0x123456"),
        checkpointId: authorizationCounter === 0n ? 1n : 2n,
        asOf: 1800000000n,
        state,
        salt: 4321n,
      });
      if (name === "attachment") {
        const note = {
          budgetOrigin: "fund",
          policyCommitment: 31n,
          enrollmentCommitment: 32n,
          heirOwnerCommitment: keys.ownerCommitment,
          viewingKey,
          keyMode: BigInt(keyMode),
          amountPerPeriod: 5n,
          remaining: 15n,
          nonce: 33n,
          ciphertextHashField: 34n,
        };
        const leaf = computeShieldedBudgetNoteCommitment(note, {
          chainId: 31337n,
          poolAddress: pool,
        });
        let noteRoot = leaf;
        for (let level = 0; level < 32; level++) noteRoot = poseidon2([noteRoot, 0n]);
        const relation = poseidon3([
          poseidon3([202610210401n, BigInt(pool), leaf]),
          prepared.recipientBinding,
          4321n,
        ]);
        prepared.request.attachment = {
          budgetPool: String(BigInt(pool)),
          budgetRoot: String(noteRoot),
          relation: String(relation),
          policy: "31",
          enrollment: "32",
          rate: "5",
          remaining: "15",
          nonce: "33",
          ciphertextHash: "34",
          depth: "32",
          index: "0",
          siblings: Array(32).fill("0"),
        };
      }
      const file = path.join(outDir, `${name}.input.json`);
      json(file, prepared.request);
      cases.push({ name, kind: prepared.request.kind, input: file });
    }
    json(path.join(outDir, "fixtures.json"), { issuerDir, keyMode, cases });
    return { issuerDir, keyMode, cases };
  } finally {
    os.cpus = originalCpus;
    if (globalThis.curve_bn128?.terminate) await globalThis.curve_bn128.terminate();
  }
}

export async function smokeReceiveProofs({
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-smoke-")),
  prepareOnly = false,
  reuse = false,
  keyMode = 0,
} = {}) {
  outDir = path.resolve(outDir);
  const evidence = inspectLinkedReceiveArtifacts({ root });
  const fixtures = reuse
    ? JSON.parse(fs.readFileSync(path.join(outDir, "fixtures.json"), "utf8"))
    : await prepareReceiveProofFixtures(outDir, {
        existingIssuers: true,
        issuerDirectory: path.join(root, "frontend/public/zk/shielded"),
        keyMode,
      });
  if (prepareOnly) return { outDir, ...fixtures };
  const checks = [];
  for (const item of fixtures.cases) {
    const request = JSON.parse(fs.readFileSync(item.input, "utf8"));
    const proof = await proveReceivePresentation({ root, request });
    json(path.join(outDir, `${item.name}.proof.json`), proof);
    assert.equal(proof.verified, true);
    assert.equal(proof.publicSignals.length, item.kind === "attachment" ? 14 : 11);
    checks.push(`${item.name}: full-depth Circom proof and hidden credential linkage verify`);
    for (let index = 0; index < proof.publicSignals.length; index++) {
      const altered = [...proof.publicSignals];
      altered[index] = String(BigInt(altered[index]) + 1n);
      assert.equal(
        await verifyReceivePresentation({
          root,
          kind: item.kind,
          proof: proof.solidityProof,
          publicSignals: altered,
        }),
        false,
        `${item.name} public field mutation ${index}`,
      );
    }
    checks.push(`${item.name}: every public operation field mutation rejected`);
    const changes = [
      [
        "authenticated recipient",
        (r) => {
          r.credentialPublicSignals[item.kind === "fund" ? 4 : 3] = "123";
        },
      ],
      [
        "authenticated alias",
        (r) => {
          r.credentialPublicSignals[0] = "124";
        },
      ],
      [
        "counter state path",
        (r) => {
          r.presentation.siblings[63] = "1";
        },
      ],
      [
        "expiry from issuer proof",
        (r) => {
          r.presentation.expiresAt = "1900000001";
        },
      ],
      [
        "recipient binding",
        (r) => {
          r.presentation.binding = "125";
        },
      ],
      [
        "operation kind",
        (r) => {
          r.presentation.action = "0";
        },
      ],
      [
        "zero checkpoint ID",
        (r) => {
          r.presentation.checkpointId = "0";
        },
      ],
    ];
    if (item.kind === "attachment")
      changes.push(
        [
          "Fund budget owner relation",
          (r) => {
            r.attachment.nonce = "99";
          },
        ],
        [
          "Fund note membership",
          (r) => {
            r.attachment.siblings[31] = "1";
          },
        ],
        [
          "Fund attachment relation",
          (r) => {
            r.attachment.relation = "126";
          },
        ],
      );
    for (const [name, change] of changes) {
      const altered = structuredClone(request);
      change(altered);
      await assert.rejects(
        proveReceivePresentation({ root, request: altered }),
        undefined,
        `${item.name}: invalid ${name}`,
      );
      checks.push(`${item.name}: rejects ${name}`);
    }
  }
  json(path.join(outDir, "smoke-results.json"), {
    developmentOnly: evidence.status !== "production",
    protocol: "linked-groth16-receive-v1",
    manifestSha256: evidence.manifestSha256,
    checks,
  });
  console.log(`Receive proof smoke: ${checks.length} checks passed; ${outDir}`);
  return { outDir, checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (flag) =>
    process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;
  try {
    const result = await smokeReceiveProofs({
      outDir: value("--out-dir"),
      prepareOnly: process.argv.includes("--prepare-only"),
      reuse: process.argv.includes("--reuse"),
      keyMode: value("--key-mode") ?? 0,
    });
    if (process.argv.includes("--prepare-only")) console.log(JSON.stringify(result));
  } finally {
    await globalThis.curve_bn128?.terminate?.();
  }
}
