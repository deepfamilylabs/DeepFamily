import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import fs from "node:fs";
import path from "node:path";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import { packGroth16ProofEnvelope } from "../lib/proofEnvelopeCodec.js";
import { PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC } from "../lib/publicSignalSpecs.js";

// Usage:
// npx hardhat add-person-version --proof ./proof.json --public ./public.json \
//   --father-version 0 --mother-version 0 \
//   --tag v1 --ipfs Qm...
// Notes:
// - publicSignals order: [identityCommitment, fatherIdentityCommitment,
//   motherIdentityCommitment, submitter, schemaVersion, cryptoSuiteVersion, hashAlgoId]
// - The submitter must equal msg.sender as uint160.
// - Ensure your DeepFamily deployment is configured with a valid verifier address.

function toBigIntArray(arr) {
  return arr.map((x) => (typeof x === "string" ? BigInt(x) : BigInt(x)));
}

function loadJson(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function addressToUint160(address) {
  if (typeof address !== "string") {
    throw new Error("address must be a string");
  }

  return BigInt(address);
}

function normalizePublicSignals(pubJson, sender) {
  const rawSignals = pubJson.publicSignals || pubJson;
  const publicSignals = toBigIntArray(rawSignals);

  if (publicSignals.length !== PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.length) {
    throw new Error(
      `publicSignals length must be ${PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.length}, got ${publicSignals.length}`,
    );
  }

  const senderUint160 = addressToUint160(sender);
  const submitter = publicSignals[3];
  if (submitter !== senderUint160) {
    throw new Error(
      `submitter mismatch: publicSignals[3]=${submitter} expected ${senderUint160} (from ${sender})`,
    );
  }

  return publicSignals;
}

function extractProofShape(proofJson) {
  const proof = proofJson.proof || proofJson;

  if (proof.pi_a && proof.pi_b && proof.pi_c) {
    return proof;
  }

  if (proof.a && proof.b && proof.c) {
    return {
      a: toBigIntArray(proof.a),
      b: [toBigIntArray(proof.b[0]), toBigIntArray(proof.b[1])],
      c: toBigIntArray(proof.c),
    };
  }

  throw new Error("Unknown proof format: expected pi_a/pi_b/pi_c or a/b/c");
}

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const { deepFamily } = await ensureIntegratedSystem(connection);
  const [signer] = await ethers.getSigners();
  const sender = await signer.getAddress();

  const proofJson = loadJson(args.proof);
  const pubJson = loadJson(args.public);

  const rawProof = extractProofShape(proofJson);
  const publicSignals = normalizePublicSignals(pubJson, sender);

  console.log("Public signals breakdown:");
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.forEach((fieldName, index) => {
    console.log(`  ${fieldName}:`, publicSignals[index].toString());
  });

  const proofSystemId = Number(args.proofsystem);

  const proofEnvelope = packGroth16ProofEnvelope(rawProof, { proofSystemId });

  const personProofPublicSignals = Object.fromEntries(
    PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.map((fieldName, index) => [
      fieldName,
      publicSignals[index],
    ]),
  );

  console.log("DeepFamily:", deepFamily.target || deepFamily.address);
  console.log("Sender:", sender);
  console.log("Submitting addPersonVersion ...");

  const tx = await deepFamily
    .connect(signer)
    .addPersonVersion(
      proofEnvelope,
      personProofPublicSignals,
      Number(args.fatherVersion),
      Number(args.motherVersion),
      args.tag,
      args.ipfs,
    );

  console.log("Tx:", tx.hash);
  const receipt = await tx.wait();
  console.log("Mined in block:", receipt.blockNumber);

  try {
    const iface = new ethers.Interface([
      "event PersonHashZKVerified(bytes32 indexed personHash, address indexed prover)",
    ]);
    for (const log of receipt.logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "PersonHashZKVerified") {
          console.log("ZK verified for:", parsed.args.personHash);
          break;
        }
      } catch (_) {}
    }
  } catch (_) {}
};

export default task("add-person-version", "Submit Groth16 proof to addPersonVersion")
  .addOption({
    name: "proof",
    description: "Path to proof.json from snarkjs",
    type: ArgumentType.FILE_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "public",
    description: "Path to public.json from snarkjs",
    type: ArgumentType.FILE_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "fatherVersion",
    description: "Father version index (0 if none)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "motherVersion",
    description: "Mother version index (0 if none)",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "proofsystem",
    description: "Proof system ID (default 1)",
    type: ArgumentType.STRING,
    defaultValue: "1",
  })
  .addOption({
    name: "tag",
    description: "Version tag, e.g. v1",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "ipfs",
    description: "Metadata IPFS CID / hash",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();

export { toBigIntArray, loadJson, addressToUint160, normalizePublicSignals, extractProofShape };
