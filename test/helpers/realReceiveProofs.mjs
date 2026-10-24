import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/protocol-core";
import {
  inspectLinkedReceiveArtifacts,
  RECEIVE_LINK_KEYS_PATH,
} from "../../scripts/lib/linkedReceiveArtifacts.mjs";

export const RECEIVE_TEST_ROOT = path.resolve(import.meta.dirname, "../..");
const root = RECEIVE_TEST_ROOT;
const publicDir = path.join(root, "frontend/public/zk/shielded");
const issuers = {
  anonymous: "shielded_anonymous_receive_credential",
  fund: "shielded_fund_receive_credential",
};
const verifiers = {
  anonymous: "AnonymousReceivePresentationVerifier",
  fund: "FundReceivePresentationVerifier",
  attachment: "AttachedReceivePresentationVerifier",
};
const presentationSources = [
  "shielded_anonymous_receive_presentation",
  "shielded_fund_receive_presentation",
  "shielded_attached_receive_presentation",
];

/** The unified npm test requires real artifacts; targeted optional runs can skip if absent. */
export function checkRealReceiveArtifacts() {
  const required = [path.join(root, RECEIVE_LINK_KEYS_PATH)];
  for (const source of [
    ...Object.values(issuers),
    ...presentationSources,
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
  for (const contractName of Object.values(verifiers))
    required.push(path.join(root, "contracts", `${contractName}.sol`));
  const missing = required.filter((file) => !fs.existsSync(file));
  if (process.env.REQUIRE_REAL_RECEIVE_PROOFS === "1") {
    assert.deepEqual(missing, [], "Run npm run zk:setup before this required integration test");
  }
  if (missing.length) return { missing };
  assert.equal(inspectLinkedReceiveArtifacts({ root }).verification, "passed");
  return {};
}

/** Generated linked verifiers use their shared library through the normal Hardhat build. */
export async function deployRealReceiveVerifiers(hre) {
  const deployed = {};
  for (const contractName of Object.values(verifiers)) {
    deployed[contractName] = await hre.ethers.deployContract(contractName);
    await deployed[contractName].waitForDeployment();
  }
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
      "ShieldedShieldVerifier",
      "ShieldedFundVerifier",
      "ShieldedIdentityAuthorizationUpdateVerifier",
      "ShieldedPrivateTransferVerifier",
    ].map((name) => [
      `${name}.sol`,
      { content: fs.readFileSync(path.join(root, "contracts", `${name}.sol`), "utf8") },
    ]),
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
      run(process.execPath, [
        path.join(root, "scripts/lib/receiveProofs.mjs"),
        "--input",
        input,
        "--output",
        output,
      ]);
      const proof = JSON.parse(fs.readFileSync(output, "utf8"));
      assert.equal(proof.verified, true);
      assert.deepEqual(proof.publicSignals.map(BigInt), prepared.publicSignals);
      assert.equal(
        (proof.solidityProof.length - 2) / 2,
        (26 + prepared.request.credentialPublicSignals.length) * 32,
        "Linked receive proof must contain exactly its two proofs and equality responses",
      );
      return proof.solidityProof;
    },
  };
}
