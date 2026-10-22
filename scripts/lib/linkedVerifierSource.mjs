import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { validateLinkedGroth16VerificationKey } from "../../packages/protocol-core/groth16-link.js";

/** Read only the public Groth16 header; never load or export the proving key. */
export async function readZkeyDeltaG1(zkeyPath) {
  const require = createRequire(import.meta.url);
  const snarkjsRoot = path.resolve(path.dirname(require.resolve("snarkjs")), "..");
  const bin = await import("@iden3/binfileutils");
  const existingPool = globalThis.curve_bn128;
  const { readHeader } = await import(pathToFileURL(path.join(snarkjsRoot, "src/zkey_utils.js")));
  if (existingPool && globalThis.curve_bn128 === null) globalThis.curve_bn128 = existingPool;
  const { fd, sections } = await bin.readBinFile(zkeyPath, "zkey", 2);
  let curve;
  try {
    const header = await readHeader(fd, sections, false, { singleThread: true });
    if (header.protocol !== "groth16") throw new Error("LinkG16 requires a Groth16 zkey");
    curve = header.curve;
    if (!curve.G2.eq(header.vk_gamma_2, curve.G2.one))
      throw new Error("LinkG16 requires gamma = 1");
    if (
      !(await curve.pairingEq(
        header.vk_delta_1,
        curve.G2.one,
        curve.G1.neg(curve.G1.one),
        header.vk_delta_2,
      ))
    ) {
      throw new Error("Groth16 delta G1/G2 header mismatch");
    }
    return curve.G1.toObject(header.vk_delta_1).map(String);
  } finally {
    await fd.close();
    await curve?.terminate();
  }
}

export async function readZkeyLinkParameters({ root = process.cwd(), zkeyPath }) {
  return { deltaG1: await readZkeyDeltaG1(path.resolve(root, zkeyPath)) };
}

function keySource(method, key) {
  const tuple = (words) => `[${words.map((word) => `uint256(${word})`).join(", ")}]`;
  return `    function ${method}() internal pure override returns (VerificationKey memory vk) {
        vk.digest = ${key.digest};
        vk.deltaG1 = ${tuple(key.deltaG1)};
        vk.alpha = ${tuple(key.alpha)};
        vk.beta = ${tuple(key.beta)};
        vk.delta = ${tuple(key.delta)};
        vk.ic = new uint256[2][](${key.ic.length});
${key.ic.map((point, i) => `        vk.ic[${i}] = ${tuple(point)};`).join("\n")}
    }`;
}

/** Generate a verifier with immutable issuer, presentation and linkage layouts. */
export async function linkedVerifierSource({
  contractName,
  issuerVerificationKey,
  issuerDeltaG1,
  presentationVerificationKey,
  presentationDeltaG1,
  publicSignals,
}) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(contractName ?? ""))
    throw new Error("Invalid verifier contract name");
  if (!Number.isSafeInteger(publicSignals) || publicSignals < 1 || publicSignals > 64) {
    throw new Error("Invalid verifier public signal count");
  }
  const issuer = await validateLinkedGroth16VerificationKey({
    verificationKey: issuerVerificationKey,
    deltaG1: issuerDeltaG1,
  });
  const presentation = await validateLinkedGroth16VerificationKey({
    verificationKey: presentationVerificationKey,
    deltaG1: presentationDeltaG1,
  });
  if (presentation.nPublic !== issuer.nPublic + publicSignals)
    throw new Error("LinkG16 public layouts do not match");
  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Generated from the fixed Circom issuer and presentation keys. Do not edit.
import {LinkedGroth16Verifier} from "./libraries/LinkedGroth16Verifier.sol";

contract ${contractName} is LinkedGroth16Verifier {
    function verifyProof(bytes calldata proof, uint256[${publicSignals}] calldata input) external view {
        uint256[] memory values = new uint256[](${publicSignals});
        for (uint256 i; i < ${publicSignals}; ++i) values[i] = input[i];
        _verifyLinked(proof, values);
    }

    function _commonInputCount() internal pure override returns (uint256) { return ${issuer.nPublic}; }
    function _publicInputCount() internal pure override returns (uint256) { return ${publicSignals}; }

${keySource("_issuerKey", issuer)}

${keySource("_presentationKey", presentation)}
}
`;
}

export default linkedVerifierSource;
