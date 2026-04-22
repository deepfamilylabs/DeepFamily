export {
  PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC,
  DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC,
  PUBLIC_SIGNAL_SPECS,
  PUBLIC_SIGNAL_SPECS_BY_PURPOSE,
  getPublicSignalSpec,
  getPublicSignalSpecByPurpose,
  normalizePublicSignalsForSpec,
} from "../../../../lib/publicSignalSpecs.js";

import {
  decodeDisclosureBindingPublicSignals as decodeDisclosureBindingPublicSignalsRaw,
  decodePersonCommitmentPublicSignals as decodePersonCommitmentPublicSignalsRaw,
} from "../../../../lib/publicSignalSpecs.js";

export type {
  DecodePublicSignalsOptions,
  PublicSignalSpec,
  PublicSignalValue,
} from "../../../../lib/publicSignalSpecs.js";

type PersonPublicSignalsStruct = {
  identityCommitment: bigint;
  fatherIdentityCommitment: bigint;
  motherIdentityCommitment: bigint;
  submitter: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

type DisclosureBindingPublicSignalsStruct = {
  identityCommitment: bigint;
  disclosureBinding: bigint;
  minter: bigint;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

const VERSION_FIELD_TRANSFORMS = {
  schemaVersion: (value: bigint) => Number(value),
  cryptoSuiteVersion: (value: bigint) => Number(value),
  hashAlgoId: (value: bigint) => Number(value),
} as const;

export function decodePersonCommitmentPublicSignals(
  publicSignals: ReadonlyArray<string | number | bigint>,
): PersonPublicSignalsStruct {
  return decodePersonCommitmentPublicSignalsRaw(publicSignals, {
    fieldTransforms: VERSION_FIELD_TRANSFORMS,
  }) as PersonPublicSignalsStruct;
}

export function decodeDisclosureBindingPublicSignals(
  publicSignals: ReadonlyArray<string | number | bigint>,
): DisclosureBindingPublicSignalsStruct {
  return decodeDisclosureBindingPublicSignalsRaw(publicSignals, {
    fieldTransforms: VERSION_FIELD_TRANSFORMS,
  }) as DisclosureBindingPublicSignalsStruct;
}
