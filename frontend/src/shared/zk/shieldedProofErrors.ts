export const SHIELDED_PROOF_CONFIGURATION_ERROR_MESSAGE =
  "Proof verification configuration is unavailable. Refresh the page; if running locally, restart the development server.";

/** Fixed public error: never attach a witness or a cryptographic library failure. */
export class ShieldedProofConfigurationError extends Error {
  constructor() {
    super(SHIELDED_PROOF_CONFIGURATION_ERROR_MESSAGE);
    this.name = "ShieldedProofConfigurationError";
  }
}
