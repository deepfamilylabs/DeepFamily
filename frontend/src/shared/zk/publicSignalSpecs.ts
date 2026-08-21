export {
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
  PUBLIC_SIGNAL_SPECS,
  PUBLIC_SIGNAL_SPECS_BY_PURPOSE,
  getPublicSignalSpec,
  getPublicSignalSpecByPurpose,
  normalizePublicSignalsForSpec,
} from "@deepfamily/proof-core";

import {
  decodeDisclosureBindingPublicSignals as decodeDisclosureBindingPublicSignalsRaw,
  decodePersonRelationPublicSignals as decodePersonRelationPublicSignalsRaw,
} from "@deepfamily/proof-core";

export type {
  DecodePublicSignalsOptions,
  PublicSignalSpec,
  PublicSignalValue,
} from "@deepfamily/proof-core";

export type PersonRelationPublicSignalsStruct = {
  identityCommitment: bigint;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
  submitterAndSelfSuiteId: bigint;
  versionCommitment: bigint;
};

export type DisclosureBindingPublicSignalsStruct = {
  identityCommitment: bigint;
  disclosureBinding: bigint;
  minter: bigint;
  suiteCommitment: bigint;
};

export function decodePersonRelationPublicSignals(
  publicSignals: ReadonlyArray<string | number | bigint>,
): PersonRelationPublicSignalsStruct {
  return decodePersonRelationPublicSignalsRaw(publicSignals) as PersonRelationPublicSignalsStruct;
}

export function decodeDisclosureBindingPublicSignals(
  publicSignals: ReadonlyArray<string | number | bigint>,
): DisclosureBindingPublicSignalsStruct {
  return decodeDisclosureBindingPublicSignalsRaw(
    publicSignals,
  ) as DisclosureBindingPublicSignalsStruct;
}
