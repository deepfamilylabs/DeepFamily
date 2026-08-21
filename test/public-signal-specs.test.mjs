import { expect } from "chai";
import {
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
  decodeDisclosureBindingPublicSignals,
  decodePersonRelationPublicSignals,
  getPublicSignalSpec,
  getPublicSignalSpecByPurpose,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";

describe("fresh-v1 public signal specs", function () {
  it("freezes the PersonRelation five-signal ABI", function () {
    expect(PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC).to.include({
      name: "person-relation-v1",
      purpose: "PersonRelation",
      length: 5,
    });
    expect(PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder).to.deep.equal([
      "identityCommitment",
      "fatherIdentityCommitment",
      "motherIdentityCommitment",
      "submitterAndSelfSuiteId",
      "versionCommitment",
    ]);
  });

  it("freezes the DisclosureBinding four-signal ABI", function () {
    expect(DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC).to.include({
      name: "disclosure-binding-v1",
      purpose: "DisclosureBinding",
      length: 4,
    });
    expect(DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder).to.deep.equal([
      "identityCommitment",
      "disclosureBinding",
      "minter",
      "suiteCommitment",
    ]);
  });

  it("resolves specs only by the fresh-v1 names and purposes", function () {
    expect(getPublicSignalSpec("person-relation-v1")).to.equal(
      PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
    );
    expect(getPublicSignalSpecByPurpose("DisclosureBinding")).to.equal(
      DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
    );
    expect(() => getPublicSignalSpec("person-commitment-v2")).to.throw(
      /Unknown public signal spec/,
    );
    expect(() => getPublicSignalSpecByPurpose("PersonCommitment")).to.throw(
      /Unknown public signal purpose/,
    );
  });

  it("normalizes only exact-length vectors", function () {
    expect(() => normalizePublicSignalsForSpec(["1", 2, 3], { name: "demo", length: 2 })).to.throw(
      /length mismatch/,
    );
    expect(normalizePublicSignalsForSpec(["1", 2], { name: "demo", length: 2 })).to.deep.equal([
      1n,
      2n,
    ]);
  });

  it("decodes both frozen orders", function () {
    expect(decodePersonRelationPublicSignals(["11", "22", "33", "44", "55"])).to.deep.equal({
      identityCommitment: 11n,
      fatherIdentityCommitment: 22n,
      motherIdentityCommitment: 33n,
      submitterAndSelfSuiteId: 44n,
      versionCommitment: 55n,
    });
    expect(decodeDisclosureBindingPublicSignals(["11", "22", "33", "44"])).to.deep.equal({
      identityCommitment: 11n,
      disclosureBinding: 22n,
      minter: 33n,
      suiteCommitment: 44n,
    });
  });
});
