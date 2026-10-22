import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import { nativeReceiveBinary } from "../../scripts/receive-build.mjs";
import { RECEIVE_CIRCUIT_VERSION } from "../../packages/receive-prover/browser.mjs";

export const RECEIVE_TEST_ROOT = path.resolve(import.meta.dirname, "../..");
const root = RECEIVE_TEST_ROOT;
const publicDir = path.join(root, "frontend/public/zk/shielded");
const receiveDir = path.resolve(
  process.env.RECEIVE_PROOF_ARTIFACTS ?? path.join(root, "zk-artifacts/receive"),
);
const issuers = {
  anonymous: "shielded_anonymous_receive_credential",
  fund: "shielded_fund_receive_credential",
};
const verifiers = {
  anonymous: "AnonymousReceivePresentationVerifier",
  fund: "FundReceivePresentationVerifier",
  attachment: "AttachedReceivePresentationVerifier",
};
const digest = (file) => {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(fd);
  }
};

/** The unified npm test requires real artifacts; targeted optional runs can skip if absent. */
export function checkRealReceiveArtifacts() {
  const required = [nativeReceiveBinary(receiveDir)];
  for (const source of [
    ...Object.values(issuers),
    "shielded_shield",
    "shielded_fund",
    "shielded_identity_authorization_update",
    "shielded_private_transfer",
  ]) {
    required.push(
      ...["wasm", "vkey.json", "zkey"].map((extension) =>
        path.join(
          publicDir,
          extension === "zkey" ? `${source}_final.zkey` : `${source}.${extension}`,
        ),
      ),
    );
  }
  for (const kind of Object.keys(verifiers)) {
    required.push(
      ...["manifest.json", "receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"].map(
        (name) => path.join(receiveDir, kind, name),
      ),
    );
  }
  const missing = required.filter((file) => !fs.existsSync(file));
  if (process.env.REQUIRE_REAL_RECEIVE_PROOFS === "1") {
    assert.deepEqual(
      missing,
      [],
      "Run npm run zk:development:setup before this required integration test",
    );
  }
  if (missing.length) return { missing };
  for (const [kind, contractName] of Object.entries(verifiers)) {
    const directory = path.join(receiveDir, kind);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.kind, kind);
    assert.equal(manifest.circuitVersion, RECEIVE_CIRCUIT_VERSION);
    assert.equal(manifest.publicSignals, kind === "attachment" ? 14 : 11);
    assert.equal(
      manifest.issuerVkSha256,
      digest(path.join(publicDir, `${issuers[kind === "fund" ? "fund" : "anonymous"]}.vkey.json`)),
      "Presentation artifacts must authenticate the current canonical issuer",
    );
    for (const name of ["receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"]) {
      assert.equal(
        digest(path.join(directory, name)),
        manifest.artifacts[name],
        `${kind}/${name} digest mismatch`,
      );
    }
    assert.match(
      fs.readFileSync(path.join(directory, "ReceiptVerifier.sol"), "utf8"),
      new RegExp(`contract ${contractName} \\{`, "u"),
    );
  }
  return {};
}

/** Compile each verifier from the exact source tied to the proving artifacts used below. */
export async function deployRealReceiveVerifiers(hre) {
  const { getCompiler } = await import(
    pathToFileURL(
      path.join(
        root,
        "node_modules/hardhat/dist/src/internal/builtin-plugins/solidity/build-system/compiler/index.js",
      ),
    ).href
  );
  const compiler = await getCompiler("0.8.28", { preferWasm: false });
  const sources = Object.fromEntries(
    [
      ...Object.entries(verifiers).map(([kind, name]) => [
        name,
        path.join(receiveDir, kind, "ReceiptVerifier.sol"),
      ]),
      ...[
        "ShieldedShieldVerifier",
        "ShieldedFundVerifier",
        "ShieldedIdentityAuthorizationUpdateVerifier",
        "ShieldedPrivateTransferVerifier",
      ].map((name) => [name, path.join(root, "contracts", `${name}.sol`)]),
    ].map(([name, file]) => [`${name}.sol`, { content: fs.readFileSync(file, "utf8") }]),
  );
  const compiled = await compiler.compile({
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 1 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  });
  assert.deepEqual(compiled.errors?.filter((entry) => entry.severity === "error") ?? [], []);
  const [signer] = await hre.ethers.getSigners();
  const deployed = {};
  for (const [file, contracts] of Object.entries(compiled.contracts)) {
    const name = file.slice(0, -4);
    const artifact = contracts[name];
    deployed[name] = await new hre.ethers.ContractFactory(
      artifact.abi,
      artifact.evm.bytecode.object,
      signer,
    ).deploy();
    await deployed[name].waitForDeployment();
  }
  return deployed;
}

/** Fresh proofs are reconstructed from raw witnesses, independently verified and cleaned up. */
export function realReceiveProver() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-receive-contract-"));
  const json = (name, value) => {
    const file = path.join(temporary, name);
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    return file;
  };
  const cli = path.join(root, "node_modules/snarkjs/build/cli.cjs");
  const run = (binary, args) =>
    execFileSync(binary, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  return {
    cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }),
    circom(source, witness, expectedSignals) {
      const input = json("input.json", witness);
      const proof = path.join(temporary, "proof.json");
      const signals = path.join(temporary, "public.json");
      run(process.execPath, [
        cli,
        "groth16",
        "fullprove",
        input,
        path.join(publicDir, `${source}.wasm`),
        path.join(publicDir, `${source}_final.zkey`),
        proof,
        signals,
      ]);
      const publicSignals = JSON.parse(fs.readFileSync(signals, "utf8"));
      if (expectedSignals)
        assert.deepEqual(
          publicSignals.map(BigInt),
          expectedSignals,
          `${source} public input order drifted`,
        );
      assert.match(
        run(process.execPath, [
          cli,
          "groth16",
          "verify",
          path.join(publicDir, `${source}.vkey.json`),
          signals,
          proof,
        ]),
        /OK!/u,
      );
      const raw = JSON.parse(fs.readFileSync(proof, "utf8"));
      return {
        proof: raw,
        publicSignals,
        solidityProof: encodeGroth16AbcProofData(normalizeGroth16Proof(raw)),
      };
    },
    presentation(prepared) {
      const input = json("request.json", prepared.request);
      const output = path.join(temporary, "presentation.json");
      const artifacts = path.join(receiveDir, prepared.request.kind);
      run(nativeReceiveBinary(receiveDir), [
        "prove",
        "--artifacts",
        artifacts,
        "--input",
        input,
        "--output",
        output,
      ]);
      run(nativeReceiveBinary(receiveDir), ["verify", "--artifacts", artifacts, "--input", output]);
      const proof = JSON.parse(fs.readFileSync(output, "utf8"));
      assert.equal(proof.verified, true);
      assert.deepEqual(proof.publicSignals.map(BigInt), prepared.publicSignals);
      return proof.solidityProof;
    },
  };
}
