import { readFile } from "node:fs/promises";

// Fixed public test material. Only the candidate adapter's read-only verification entry is called.
const person = {
  fullName: "Verifier route check",
  derivedSecretField: 1n,
  isBirthBC: false,
  birthYear: 1990,
  birthMonth: 1,
  birthDay: 1,
  gender: 1,
};
const submitter = "0x0000000000000000000000000000000000000001";
const probes = new Map();

async function currentProof(purpose) {
  if (probes.has(purpose)) return probes.get(purpose);
  let result;
  if (purpose === 0) {
    const { generatePersonRelationProof } = await import("../../lib/personCommitmentProof.js");
    result = await generatePersonRelationProof(person, null, null, submitter, {
      contentDigest: "0x" + "01".repeat(32),
    });
  } else {
    const { generateDisclosureBindingProof } = await import("../../lib/disclosureBindingProof.js");
    result = await generateDisclosureBindingProof(person, submitter);
  }
  const sample = { ...result.proofEnvelope, publicSignals: result.publicSignals };
  probes.set(purpose, sample);
  return sample;
}

export async function checkVerifierRoute(adapter, purpose, circuitId, sampleFile) {
  purpose = Number(purpose);
  if (purpose !== 0 && purpose !== 1) throw new Error("Unknown family proof purpose");
  let sample;
  if (sampleFile) {
    sample = JSON.parse(await readFile(sampleFile, "utf8"));
    if (
      String(sample.purpose) !== String(purpose) ||
      String(sample.circuitId) !== String(circuitId)
    )
      throw new Error("The proof sample belongs to a different verifier route");
  } else {
    sample = await currentProof(purpose);
  }
  if (
    !(await adapter.verifyProof(
      purpose,
      sample.proofEncodingId,
      sample.proofData,
      sample.publicSignals,
    ))
  ) {
    throw new Error(
      `Verifier rejected the reference proof for purpose ${purpose}, circuit ${circuitId}`,
    );
  }
}
