import { expect } from "chai";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_RELATION_PROOF_DESCRIPTOR,
  getProofDescriptor,
  getProofDescriptorByPurpose,
} from "../lib/proofDescriptors.js";
import {
  DISCLOSURE_BINDING_PROOF_DEFINITION,
  PERSON_RELATION_PROOF_DEFINITION,
  getProofDefinitionByPurpose,
} from "@deepfamily/proof-core";
import { resolveDescriptorNodeArtifactCandidates } from "../lib/proofCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("proof descriptors", function () {
  it("keeps shared proof definitions free of environment-specific artifact paths", function () {
    expect(PERSON_RELATION_PROOF_DEFINITION).not.to.have.property("files");
    expect(DISCLOSURE_BINDING_PROOF_DEFINITION).not.to.have.property("files");
    expect(getProofDefinitionByPurpose("PersonRelation")).to.equal(
      PERSON_RELATION_PROOF_DEFINITION,
    );
  });

  it("exports the active person and disclosure descriptors", function () {
    expect(PERSON_RELATION_PROOF_DESCRIPTOR).to.include({
      key: "person-relation-groth16-bn254-v1",
      purpose: "PersonRelation",
      circuitId: 1,
      proofEncodingId: 1,
      backend: "groth16-bn254",
      publicSignalSpec: "person-relation-v1",
      proverDriver: "snarkjs-groth16",
      proofPacker: "abi-groth16-abc",
    });

    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR).to.include({
      key: "disclosure-binding-groth16-bn254-v1",
      purpose: "DisclosureBinding",
      circuitId: 1,
      proofEncodingId: 1,
      backend: "groth16-bn254",
      publicSignalSpec: "disclosure-binding-v1",
      proverDriver: "snarkjs-groth16",
      proofPacker: "abi-groth16-abc",
    });
    expect(PERSON_RELATION_PROOF_DESCRIPTOR.files).not.to.have.property("browser");
  });

  it("resolves descriptors by key and purpose", function () {
    expect(getProofDescriptor(PERSON_RELATION_PROOF_DESCRIPTOR.key)).to.equal(
      PERSON_RELATION_PROOF_DESCRIPTOR,
    );
    expect(getProofDescriptorByPurpose("DisclosureBinding")).to.equal(
      DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
    );
  });

  it("throws on unknown descriptor lookups", function () {
    expect(() => getProofDescriptor("missing")).to.throw(/Unknown proof descriptor/);
    expect(() => getProofDescriptorByPurpose("missing")).to.throw(
      /Unknown proof descriptor purpose/,
    );
  });

  it("resolves node artifact candidates from repo-relative descriptor paths", function () {
    const wasmCandidates = resolveDescriptorNodeArtifactCandidates(
      path.join(__dirname, "../lib"),
      PERSON_RELATION_PROOF_DESCRIPTOR,
      "wasm",
    );
    const vkeyCandidates = resolveDescriptorNodeArtifactCandidates(
      path.join(__dirname, "../lib"),
      DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
      "vkey",
    );

    expect(wasmCandidates[0]).to.equal(
      path.resolve(__dirname, "../frontend/public/zk/person_commitment.wasm"),
    );
    expect(vkeyCandidates[0]).to.equal(
      path.resolve(__dirname, "../frontend/public/zk/disclosure_binding.vkey.json"),
    );
  });
});
