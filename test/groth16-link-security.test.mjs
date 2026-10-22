import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { AbiCoder, concat, keccak256, toBeHex } from "ethers";
import hre from "hardhat";
import {
  BN254_BASE_FIELD,
  BN254_SCALAR_FIELD,
  LINKED_GROTH16_DOMAIN,
  linkedGroth16VerificationKey,
  verifyLinkedGroth16Proof,
} from "../packages/protocol-core/groth16-link.js";
import { linkedVerifierSource, readZkeyDeltaG1 } from "../scripts/lib/linkedVerifierSource.mjs";

const root = path.resolve(import.meta.dirname, "..");
const mod = (value) => ((value % BN254_SCALAR_FIELD) + BN254_SCALAR_FIELD) % BN254_SCALAR_FIELD;
const bigInts = (value) => {
  if (Array.isArray(value)) return value.map(bigInts);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, bigInts(entry)]));
  return typeof value === "string" && /^[0-9]+$/u.test(value) ? BigInt(value) : value;
};
const replaceWord = (proof, i, value) => {
  const words = proof.slice(2).match(/.{64}/gu);
  words[i] = value.toString(16).padStart(64, "0");
  return `0x${words.join("")}`;
};

describe("LinkG16 independent adversarial verification", function () {
  this.timeout(180_000);
  let temp, curve, parameters, verifier, source, rawProofs, otherPresentationProof;
  const common = [49n, 25n];
  const publicInputs = [539n];
  const g1 = (point) => curve.G1.fromObject(point);
  const mul = (point, value) => curve.G1.timesScalar(point, value);
  const sum = (points, values) =>
    points.reduce((acc, point, i) => curve.G1.add(acc, mul(point, values[i])), curve.G1.zero);
  const g1Words = (point) =>
    curve.G1.isZero(point) ? [0n, 0n] : curve.G1.toObject(curve.G1.toAffine(point)).slice(0, 2);
  const g2Words = (point) => {
    const [[x0, x1], [y0, y1]] = curve.G2.toObject(curve.G2.toAffine(point));
    return [x1, x0, y1, y0];
  };

  // Independently assemble a linkage transcript with known blinders. This lets
  // attacks retain valid EqWire equations after changing underlying proofs;
  // ordinary byte corruption would fail the transcript before testing pairings.
  function assemble({ mutate, vectors = [common, common], proofs = rawProofs } = {}) {
    const keys = [parameters.issuer, parameters.presentation];
    const blinders = [11n, 13n];
    const sharedNonces = [17n, 19n];
    const blindingNonces = [23n, 29n];
    const parts = keys.map((key, i) => ({
      a: g1(proofs[i].pi_a),
      b: curve.G2.fromObject(proofs[i].pi_b),
      c: curve.G1.add(g1(proofs[i].pi_c), curve.G1.neg(mul(curve.G1.one, blinders[i]))),
      delta1: g1(key.deltaG1),
      delta2: curve.G2.fromObject(key.verificationKey.vk_delta_2),
      alpha: g1(key.verificationKey.vk_alpha_1),
      beta: curve.G2.fromObject(key.verificationKey.vk_beta_2),
      ic: key.verificationKey.IC.map(g1),
    }));
    const u = parts.map((part, i) =>
      curve.G1.add(sum(part.ic.slice(1, 3), vectors[i]), mul(part.delta1, blinders[i])),
    );
    const commitments = parts.map((part, i) =>
      curve.G1.add(sum(part.ic.slice(1, 3), sharedNonces), mul(part.delta1, blindingNonces[i])),
    );
    mutate?.(parts);
    const pointWords = [
      ...parts.flatMap((part) => [...g1Words(part.a), ...g2Words(part.b), ...g1Words(part.c)]),
      ...u.flatMap(g1Words),
      ...commitments.flatMap(g1Words),
    ];
    const challenge =
      BigInt(
        keccak256(
          AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "uint256", "uint256", "bytes32", "bytes32", "uint256[]", "uint256[]"],
            [
              LINKED_GROTH16_DOMAIN,
              common.length,
              publicInputs.length,
              ...keys.map((key) => linkedGroth16VerificationKey(key).digest),
              pointWords,
              publicInputs,
            ],
          ),
        ),
      ) % BN254_SCALAR_FIELD;
    assert.notEqual(challenge, 0n);
    const words = [
      ...pointWords,
      ...sharedNonces.map((nonce, i) => mod(nonce - challenge * vectors[0][i])),
      ...blindingNonces.map((nonce, i) => mod(nonce - challenge * blinders[i])),
    ];
    const prepared = parts.map((part, i) => {
      let input = curve.G1.add(part.ic[0], u[i]);
      if (i === 1) input = curve.G1.add(input, sum(part.ic.slice(3), publicInputs));
      return input;
    });
    const pairings = parts.map((part, i) => [
      curve.G1.neg(part.a),
      part.b,
      prepared[i],
      curve.G2.one,
      part.c,
      part.delta2,
      part.alpha,
      part.beta,
    ]);
    return {
      proof: concat(words.map((word) => toBeHex(word, 32))),
      pairings,
    };
  }

  before(async function () {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-link-security-"));
    const cpus = os.cpus;
    os.cpus = () => cpus().slice(0, 2);
    try {
      const snarkjs = await import("snarkjs");
      const { buildBn128 } = await import("ffjavascript");
      curve = await buildBn128(true);
      const keys = {};
      rawProofs = [];
      for (const kind of ["issuer", "presentation"]) {
        const issuer = kind === "issuer";
        const circuit = `pragma circom 2.2.3;
template Circuit() {
  signal output common[2];
  ${issuer ? "" : "signal output operation;"}
  signal input left;
  signal input right;
  ${issuer ? "" : "signal input salt;"}
  common[0] <== ${issuer ? "left * left" : "left"};
  common[1] <== right * right;
  ${issuer ? "" : "operation <== left * salt;"}
}
component main = Circuit();`;
        const base = path.join(temp, kind);
        fs.writeFileSync(`${base}.circom`, circuit);
        execFileSync(
          path.join(root, "bin/circom"),
          [`${base}.circom`, "--r1cs", "--wasm", "--O2", "-o", temp],
          { stdio: "pipe" },
        );
        await snarkjs.zKey.newZKey(
          `${base}.r1cs`,
          path.join(root, "circuits/ptau/ppot_0080_17.ptau"),
          `${base}.initial.zkey`,
        );
        await snarkjs.zKey.contribute(
          `${base}.initial.zkey`,
          `${base}.zkey`,
          "isolated security fixture",
          randomBytes(32).toString("hex"),
        );
        keys[kind] = bigInts({
          verificationKey: await snarkjs.zKey.exportVerificationKey(`${base}.zkey`),
          deltaG1: await readZkeyDeltaG1(`${base}.zkey`),
        });
        const generated = await snarkjs.groth16.fullProve(
          issuer ? { left: "7", right: "5" } : { left: "49", right: "5", salt: "11" },
          `${base}_js/${kind}.wasm`,
          `${base}.zkey`,
          undefined,
          { singleThread: true },
          { singleThread: true },
        );
        assert.deepEqual(
          generated.publicSignals.map(BigInt),
          issuer ? common : [...common, ...publicInputs],
        );
        assert.equal(
          await snarkjs.groth16.verify(
            keys[kind].verificationKey,
            generated.publicSignals,
            generated.proof,
          ),
          true,
        );
        rawProofs.push(bigInts(generated.proof));
        if (!issuer) {
          const other = await snarkjs.groth16.fullProve(
            { left: "49", right: "6", salt: "11" },
            `${base}_js/${kind}.wasm`,
            `${base}.zkey`,
            undefined,
            { singleThread: true },
            { singleThread: true },
          );
          assert.deepEqual(other.publicSignals.map(BigInt), [49n, 36n, 539n]);
          assert.equal(
            await snarkjs.groth16.verify(
              keys[kind].verificationKey,
              other.publicSignals,
              other.proof,
            ),
            true,
          );
          otherPresentationProof = bigInts(other.proof);
        }
      }
      parameters = { ...keys, publicInputs };
      for (const [i, kind] of ["issuer", "presentation"].entries()) {
        const vk = keys[kind].verificationKey;
        const prepared = curve.G1.add(
          g1(vk.IC[0]),
          sum(vk.IC.slice(1).map(g1), i === 0 ? common : [...common, ...publicInputs]),
        );
        assert.equal(
          await curve.pairingEq(
            curve.G1.neg(g1(rawProofs[i].pi_a)),
            curve.G2.fromObject(rawProofs[i].pi_b),
            prepared,
            curve.G2.one,
            g1(rawProofs[i].pi_c),
            curve.G2.fromObject(vk.vk_delta_2),
            g1(vk.vk_alpha_1),
            curve.G2.fromObject(vk.vk_beta_2),
          ),
          true,
          `raw pairing ${kind}`,
        );
        assert.equal(
          await curve.pairingEq(
            g1(keys[kind].deltaG1),
            curve.G2.one,
            curve.G1.neg(curve.G1.one),
            curve.G2.fromObject(vk.vk_delta_2),
          ),
          true,
          `delta pairing ${kind}`,
        );
      }
      source = await linkedVerifierSource({
        contractName: "AdversarialLinkedVerifier",
        issuerVerificationKey: keys.issuer.verificationKey,
        issuerDeltaG1: keys.issuer.deltaG1,
        presentationVerificationKey: keys.presentation.verificationKey,
        presentationDeltaG1: keys.presentation.deltaG1,
        publicSignals: publicInputs.length,
      });
      const { getCompiler } = await import(
        pathToFileURL(
          path.join(
            root,
            "node_modules/hardhat/dist/src/internal/builtin-plugins/solidity/build-system/compiler/index.js",
          ),
        ).href
      );
      const compiler = await getCompiler("0.8.28", { preferWasm: false });
      const compiled = await compiler.compile({
        language: "Solidity",
        sources: {
          "AdversarialLinkedVerifier.sol": { content: source },
          "libraries/LinkedGroth16Verifier.sol": {
            content: fs.readFileSync(
              path.join(root, "contracts/libraries/LinkedGroth16Verifier.sol"),
              "utf8",
            ),
          },
        },
        settings: {
          optimizer: { enabled: true, runs: 1 },
          viaIR: true,
          evmVersion: "cancun",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      });
      assert.deepEqual(compiled.errors?.filter((entry) => entry.severity === "error") ?? [], []);
      const artifact =
        compiled.contracts["AdversarialLinkedVerifier.sol"].AdversarialLinkedVerifier;
      const [signer] = await hre.ethers.getSigners();
      verifier = await new hre.ethers.ContractFactory(
        artifact.abi,
        artifact.evm.bytecode.object,
        signer,
      ).deploy();
      await verifier.waitForDeployment();
    } finally {
      os.cpus = cpus;
    }
  });

  after(async function () {
    await curve?.terminate();
    await globalThis.curve_bn128?.terminate?.();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  });

  async function rejects(proof, inputs = publicInputs) {
    assert.equal(
      await verifyLinkedGroth16Proof({ ...parameters, proof, publicInputs: inputs }),
      false,
    );
    await assert.rejects(verifier.verifyProof(proof, inputs));
  }

  it("accepts an independently assembled transcript in JS and EVM", async function () {
    const { proof, pairings } = assemble();
    for (const [index, equation] of pairings.entries()) {
      assert.equal(await curve.pairingEq(...equation), true, `pairing ${index}`);
    }
    assert.equal(await verifyLinkedGroth16Proof({ ...parameters, proof }), true);
    await verifier.verifyProof(proof, publicInputs);
  });

  it("rejects different hidden statements even when both Groth16 pairings are valid", async function () {
    const { proof, pairings } = assemble({
      vectors: [common, [49n, 36n]],
      proofs: [rawProofs[0], otherPresentationProof],
    });
    for (const equation of pairings) assert.equal(await curve.pairingEq(...equation), true);
    // Each proof is valid in isolation, but one hidden coordinate differs.
    // Sharing one response vector must prevent EqWire authenticating both.
    await rejects(proof);
  });

  it("rejects invalid relations whose pairing errors cancel in an unweighted batch", async function () {
    const { proof, pairings } = assemble({
      mutate(parts) {
        parts[0].c = curve.G1.add(parts[0].c, parts[1].delta1);
        parts[1].c = curve.G1.sub(parts[1].c, parts[0].delta1);
      },
    });
    // These are valid points and the recomputed EqWire remains valid. A single
    // product of the two equations would incorrectly accept this attack.
    for (const equation of pairings) assert.equal(await curve.pairingEq(...equation), false);
    assert.equal(await curve.pairingEq(...pairings.flat()), true);
    await rejects(proof);
  });

  it("rejects a valid-curve G2 point outside the prime-order subgroup", async function () {
    const field = curve.G2.F;
    let nonSubgroup;
    for (let x = 0n; x < 100n; x++) {
      const fx = field.fromObject([x, 0n]);
      const rhs = field.add(field.mul(field.square(fx), fx), curve.G2.b);
      if (!field.isSquare(rhs)) continue;
      const point = curve.G2.fromObject([
        field.toObject(fx),
        field.toObject(field.sqrt(rhs)),
        [1n, 0n],
      ]);
      if (!curve.G2.isZero(curve.G2.timesScalar(point, BN254_SCALAR_FIELD))) {
        nonSubgroup = point;
        break;
      }
    }
    assert.ok(nonSubgroup);
    assert.equal(curve.G2.isValid(nonSubgroup), true);
    const { proof } = assemble({ mutate: (parts) => (parts[0].b = nonSubgroup) });
    await rejects(proof);
  });

  it("rejects operation replay, scalar aliases, coordinate aliases and truncated encoding in both verifiers", async function () {
    const { proof } = assemble();
    await rejects(proof, [publicInputs[0] + 1n]);
    await rejects(proof, [BN254_SCALAR_FIELD]);
    await rejects(replaceWord(proof, 24, BN254_SCALAR_FIELD));
    await rejects(replaceWord(proof, 16, BN254_BASE_FIELD));
    await rejects(proof.slice(0, -2));
    await rejects(`${proof}00`);
  });
});
