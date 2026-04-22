export type PublicSignalSpec = {
  readonly name: string;
  readonly version: number;
  readonly purpose: string;
  readonly fieldOrder: readonly string[];
  readonly length: number;
};

export type PublicSignalValue = string | number | bigint;
export type PublicSignalFieldTransform = (value: bigint, index: number) => unknown;
export type DecodePublicSignalsOptions = {
  readonly label?: string;
  readonly fieldTransforms?: Readonly<Record<string, PublicSignalFieldTransform>>;
};

export const PERSON_COMMITMENT_V2_PUBLIC_SIGNAL_SPEC: PublicSignalSpec;
export const DISCLOSURE_BINDING_V2_PUBLIC_SIGNAL_SPEC: PublicSignalSpec;
export const PUBLIC_SIGNAL_SPECS: Readonly<Record<string, PublicSignalSpec>>;
export const PUBLIC_SIGNAL_SPECS_BY_PURPOSE: Readonly<Record<string, PublicSignalSpec>>;

export function normalizePublicSignalsForSpec(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  spec: PublicSignalSpec,
  opts?: { readonly label?: string },
): bigint[];
export function decodePublicSignals(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  spec: PublicSignalSpec,
  opts?: DecodePublicSignalsOptions,
): Record<string, unknown>;
export function getPublicSignalSpec(name: string): PublicSignalSpec;
export function getPublicSignalSpecByPurpose(purpose: string): PublicSignalSpec;
export function decodePersonCommitmentPublicSignals(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  opts?: DecodePublicSignalsOptions,
): Record<string, unknown>;
export function decodeDisclosureBindingPublicSignals(
  publicSignals: ReadonlyArray<PublicSignalValue>,
  opts?: DecodePublicSignalsOptions,
): Record<string, unknown>;
