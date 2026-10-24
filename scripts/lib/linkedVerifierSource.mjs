import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { validateLinkedGroth16VerificationKey } from "../../packages/protocol-core/groth16-link.js";

/** Read public Groth16 data without loading the proving-key sections. */
async function readZkeyPublicData(zkeyPath, { runtimeRoot, includeVerificationKey = false } = {}) {
  const require = createRequire(
    runtimeRoot ? path.join(runtimeRoot, "package.json") : import.meta.url,
  );
  const snarkjsRoot = path.resolve(path.dirname(require.resolve("snarkjs")), "..");
  const existingPool = globalThis.curve_bn128;
  let bin, readHeader;
  try {
    bin = await import(pathToFileURL(require.resolve("@iden3/binfileutils")));
    ({ readHeader } = await import(pathToFileURL(path.join(snarkjsRoot, "src/zkey_utils.js"))));
  } finally {
    // Either runtime entry point can initialize ffjavascript and reset its global
    // pool. Header reads use their own single-thread curve and must preserve it.
    if (existingPool && globalThis.curve_bn128 === null) globalThis.curve_bn128 = existingPool;
  }
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
    const deltaG1 = curve.G1.toObject(header.vk_delta_1).map(String);
    if (!includeVerificationKey) return { deltaG1 };

    // Match snarkjs's Groth16 vkey export: the public header plus section 3 (IC).
    const verificationKey = {
      protocol: header.protocol,
      curve: curve.name,
      nPublic: header.nPublic,
      vk_alpha_1: curve.G1.toObject(header.vk_alpha_1),
      vk_beta_2: curve.G2.toObject(header.vk_beta_2),
      vk_gamma_2: curve.G2.toObject(header.vk_gamma_2),
      vk_delta_2: curve.G2.toObject(header.vk_delta_2),
      vk_alphabeta_12: curve.Gt.toObject(await curve.pairing(header.vk_alpha_1, header.vk_beta_2)),
      IC: [],
    };
    await bin.startReadUniqueSection(fd, sections, 3);
    for (let i = 0; i <= header.nPublic; i++) {
      verificationKey.IC.push(curve.G1.toObject(await fd.read(curve.G1.F.n8 * 2)));
    }
    await bin.endReadSection(fd);
    return {
      deltaG1,
      verificationKey: JSON.parse(
        JSON.stringify(verificationKey, (_key, value) =>
          typeof value === "bigint" ? String(value) : value,
        ),
      ),
    };
  } finally {
    await fd.close();
    await curve?.terminate();
  }
}

/** Read only the public Groth16 header; never load or export the proving key. */
export async function readZkeyDeltaG1(zkeyPath) {
  return (await readZkeyPublicData(zkeyPath)).deltaG1;
}

export async function readZkeyLinkParameters({ root = process.cwd(), zkeyPath, runtimeRoot }) {
  return readZkeyPublicData(path.resolve(root, zkeyPath), {
    runtimeRoot,
    includeVerificationKey: true,
  });
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
