export const PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC = Object.freeze({
  name: "person-relation-v1",
  version: 1,
  purpose: "PersonRelation",
  fieldOrder: Object.freeze([
    "identityCommitment",
    "fatherIdentityCommitment",
    "motherIdentityCommitment",
    "submitterAndSelfSuiteId",
    "versionCommitment",
  ]),
  fieldBitWidths: Object.freeze({
    identityCommitment: 254,
    fatherIdentityCommitment: 254,
    motherIdentityCommitment: 254,
    submitterAndSelfSuiteId: 192,
    versionCommitment: 254,
  }),
  length: 5,
});

export const DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC = Object.freeze({
  name: "disclosure-binding-v1",
  version: 1,
  purpose: "DisclosureBinding",
  fieldOrder: Object.freeze([
    "identityCommitment",
    "disclosureBinding",
    "minter",
    "suiteCommitment",
  ]),
  fieldBitWidths: Object.freeze({
    identityCommitment: 254,
    disclosureBinding: 254,
    minter: 160,
    suiteCommitment: 254,
  }),
  length: 4,
});

export const PUBLIC_SIGNAL_SPECS = Object.freeze({
  [PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.name]: PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
  [DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.name]: DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
});

export const PUBLIC_SIGNAL_SPECS_BY_PURPOSE = Object.freeze({
  [PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.purpose]: PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
  [DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.purpose]: DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
});

function resolveSpecLabel(spec, label) {
  if (label && String(label).trim().length > 0) {
    return String(label).trim();
  }
  if (spec?.name && String(spec.name).trim().length > 0) {
    return String(spec.name).trim();
  }
  return "public signals";
}

export function normalizePublicSignalsForSpec(publicSignals, spec, { label } = {}) {
  const resolvedLabel = resolveSpecLabel(spec, label);
  if (!Array.isArray(publicSignals) || publicSignals.length !== spec.length) {
    throw new Error(
      `${resolvedLabel} public signals length mismatch (expected ${spec.length}, got ${publicSignals?.length})`,
    );
  }
  return publicSignals.map((value) => BigInt(value));
}

export function decodePublicSignals(publicSignals, spec, { fieldTransforms = {}, label } = {}) {
  const normalizedSignals = normalizePublicSignalsForSpec(publicSignals, spec, { label });
  return Object.fromEntries(
    spec.fieldOrder.map((fieldName, index) => {
      const value = normalizedSignals[index];
      const transform = fieldTransforms[fieldName];
      return [fieldName, typeof transform === "function" ? transform(value, index) : value];
    }),
  );
}

export function getPublicSignalSpec(name) {
  const spec = PUBLIC_SIGNAL_SPECS[name];
  if (!spec) {
    throw new Error(`Unknown public signal spec: ${name}`);
  }
  return spec;
}

export function getPublicSignalSpecByPurpose(purpose) {
  const spec = PUBLIC_SIGNAL_SPECS_BY_PURPOSE[purpose];
  if (!spec) {
    throw new Error(`Unknown public signal purpose: ${purpose}`);
  }
  return spec;
}

export function decodePersonRelationPublicSignals(publicSignals, opts = {}) {
  return decodePublicSignals(publicSignals, PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC, {
    label: "Person relation",
    ...opts,
  });
}

export function decodeDisclosureBindingPublicSignals(publicSignals, opts = {}) {
  return decodePublicSignals(publicSignals, DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC, {
    label: "Disclosure binding",
    ...opts,
  });
}
