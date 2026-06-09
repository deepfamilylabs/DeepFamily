import { expect } from "chai";
import {
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  decodeDisclosureBindingPublicSignals,
  decodePersonCommitmentPublicSignals,
  getPublicSignalSpec,
  getPublicSignalSpecByPurpose,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";

describe("public signal specs", function () {
  it("exports the active person and disclosure specs", function () {
    expect(PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.name).to.equal("person-commitment-v2");
    expect(PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.length).to.equal(
      PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.length,
    );

    expect(DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.name).to.equal("disclosure-binding-v2");
    expect(DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.length).to.equal(
      DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC.fieldOrder.length,
    );
  });

  it("resolves specs by name and purpose", function () {
    expect(getPublicSignalSpec("person-commitment-v2")).to.equal(
      PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
    );
    expect(getPublicSignalSpecByPurpose("DisclosureBinding")).to.equal(
      DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
    );
  });

  it("throws on unknown spec lookups", function () {
    expect(() => getPublicSignalSpec("missing")).to.throw(/Unknown public signal spec/);
    expect(() => getPublicSignalSpecByPurpose("missing")).to.throw(
      /Unknown public signal purpose/,
    );
  });

  it("normalizes public signals with exact length matching", function () {
    expect(() =>
      normalizePublicSignalsForSpec(["1", 2, 3], {
        name: "demo",
        length: 2,
      }),
    ).to.throw(/length mismatch/);

    expect(
      normalizePublicSignalsForSpec(["1", 2], {
        name: "demo",
        length: 2,
      }),
    ).to.deep.equal([1n, 2n]);
  });

  it("decodes person public signals by field order", function () {
    const decoded = decodePersonCommitmentPublicSignals(["11", "22", "33", "44", "1", "2", "3"]);
    expect(decoded).to.deep.equal({
      identityCommitment: 11n,
      fatherIdentityCommitment: 22n,
      motherIdentityCommitment: 33n,
      submitter: 44n,
      schemaVersion: 1n,
      cryptoSuiteVersion: 2n,
      hashAlgoId: 3n,
    });
  });

  it("decodes disclosure-binding public signals by field order", function () {
    const decoded = decodeDisclosureBindingPublicSignals(["11", "22", "33", "1", "2", "3"]);
    expect(decoded).to.deep.equal({
      identityCommitment: 11n,
      disclosureBinding: 22n,
      minter: 33n,
      schemaVersion: 1n,
      cryptoSuiteVersion: 2n,
      hashAlgoId: 3n,
    });
  });
});
