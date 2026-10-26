import { CANONICAL_CIRCUIT_NAMES } from "./zkCircuitSelection.mjs";

export const PRODUCTION_CIRCUITS = CANONICAL_CIRCUIT_NAMES;
export const PRODUCTION_SETUP_UNAVAILABLE =
  "The 14-relation receive protocol has no reviewed production ceremony yet. " +
  "Local development keys cannot authorize a public deployment or release. " +
  "A production ceremony must cover person/disclosure, Shield/Unshield/Unshield4, " +
  "eligibility source/issuance/revocation scan, receiving code, budget capability/deposit/claim and transfer.";

/** Closed until the current relation graph has a reviewed ceremony and verifier. */
export function inspectProtocolProductionArtifacts() {
  throw new Error(PRODUCTION_SETUP_UNAVAILABLE);
}
