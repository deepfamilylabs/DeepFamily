import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "chai";
import {
  DEFAULT_PROOF_ENCODING_ID,
  PROOF_ENCODING_ID_ABI_GROTH16_ABC,
  DISCLOSURE_BINDING_CIRCUIT_ID_V1,
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_CIRCUIT_ID_V1,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
} from "@deepfamily/proof-core";
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_RELATION_PROOF_DESCRIPTOR,
} from "../lib/proofDescriptors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractUintConstant(source, name) {
  const match = source.match(
    new RegExp(`uint(?:8|16|256)\\s+internal\\s+constant\\s+${name}\\s*=\\s*(\\d+)\\s*;`),
  );
  if (!match) {
    throw new Error(`Unable to find Solidity constant: ${name}`);
  }
  return Number(match[1]);
}

describe("ProofConstants consistency tests", () => {
  const proofConstantsSource = readFileSync(
    path.resolve(__dirname, "../contracts/libraries/ProofConstants.sol"),
    "utf8",
  );
  const deepFamilySource = readFileSync(
    path.resolve(__dirname, "../contracts/DeepFamily.sol"),
    "utf8",
  );

  const solidityConstants = {
    proofEncodingId: extractUintConstant(proofConstantsSource, "PROOF_ENCODING_ID_ABI_GROTH16_ABC"),
    personRelationPurpose: extractUintConstant(
      proofConstantsSource,
      "PROOF_PURPOSE_PERSON_RELATION",
    ),
    disclosureBindingPurpose: extractUintConstant(
      proofConstantsSource,
      "PROOF_PURPOSE_DISCLOSURE_BINDING",
    ),
    personSignalsLength: extractUintConstant(
      proofConstantsSource,
      "PERSON_RELATION_PUBLIC_SIGNALS_LEN",
    ),
    disclosureSignalsLength: extractUintConstant(
      proofConstantsSource,
      "DISCLOSURE_BINDING_PUBLIC_SIGNALS_LEN",
    ),
  };

  const proofPurposeMembers = deepFamilySource
    .match(/enum\s+ProofPurpose\s*{([^}]*)}/s)[1]
    .split(",")
    .map((member) => member.trim())
    .filter(Boolean);

  it("keeps proof encoding and circuit ids aligned across descriptors", () => {
    expect(PROOF_ENCODING_ID_ABI_GROTH16_ABC).to.equal(solidityConstants.proofEncodingId);
    expect(DEFAULT_PROOF_ENCODING_ID).to.equal(solidityConstants.proofEncodingId);
    expect(PERSON_RELATION_PROOF_DESCRIPTOR.proofEncodingId).to.equal(
      solidityConstants.proofEncodingId,
    );
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.proofEncodingId).to.equal(
      solidityConstants.proofEncodingId,
    );
    expect(PERSON_RELATION_PROOF_DESCRIPTOR.circuitId).to.equal(PERSON_RELATION_CIRCUIT_ID_V1);
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.circuitId).to.equal(
      DISCLOSURE_BINDING_CIRCUIT_ID_V1,
    );
    expect(PERSON_RELATION_CIRCUIT_ID_V1).to.be.greaterThan(0);
    expect(DISCLOSURE_BINDING_CIRCUIT_ID_V1).to.be.greaterThan(0);
  });

  it("keeps proof-purpose ids aligned with DeepFamily.ProofPurpose", () => {
    expect(proofPurposeMembers[solidityConstants.personRelationPurpose]).to.equal("PersonRelation");
    expect(proofPurposeMembers[solidityConstants.disclosureBindingPurpose]).to.equal(
      "DisclosureBinding",
    );
  });

  it("keeps public-signal lengths aligned across JS authority and Solidity mirrors", () => {
    expect(PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.length).to.equal(
      solidityConstants.personSignalsLength,
    );
    expect(PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder).to.have.length(
      solidityConstants.personSignalsLength,
    );
    expect(PERSON_RELATION_PROOF_DESCRIPTOR.publicSignalSpec).to.equal(
      PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.name,
    );

    expect(DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.length).to.equal(
      solidityConstants.disclosureSignalsLength,
    );
    expect(DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder).to.have.length(
      solidityConstants.disclosureSignalsLength,
    );
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.publicSignalSpec).to.equal(
      DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.name,
    );
  });
});
