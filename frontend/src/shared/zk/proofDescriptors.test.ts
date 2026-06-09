import { describe, expect, it } from "vitest";
import {
  DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
  PERSON_COMMITMENT_PROOF_DESCRIPTOR,
  getProofDescriptorByPurpose,
} from "./proofDescriptors";

describe("browser proof descriptors", () => {
  it("adds browser artifact URLs to the shared proof definitions", () => {
    expect(PERSON_COMMITMENT_PROOF_DESCRIPTOR).toMatchObject({
      key: "person-commitment-groth16-bn254-v1",
      publicSignalSpec: "person-commitment-v2",
      files: {
        browser: {
          wasm: "/zk/person_commitment.wasm",
          zkey: "/zk/person_commitment_final.zkey",
          vkey: "/zk/person_commitment.vkey.json",
        },
      },
    });
    expect(DISCLOSURE_BINDING_PROOF_DESCRIPTOR.files).not.toHaveProperty("node");
  });

  it("resolves browser descriptors by purpose", () => {
    expect(getProofDescriptorByPurpose("DisclosureBinding")).toBe(
      DISCLOSURE_BINDING_PROOF_DESCRIPTOR,
    );
  });
});
