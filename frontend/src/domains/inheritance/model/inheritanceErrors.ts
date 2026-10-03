export type InheritanceErrorCode =
  | "nameRequired"
  | "passphraseRequired"
  | "passphraseDisallowed"
  | "snapshotMismatch"
  | "amountInvalid"
  | "periodsInvalid"
  | "periodDaysInvalid";

/** A failure the flow recognises and explains in its own words. */
export class InheritanceError extends Error {
  readonly code: InheritanceErrorCode;

  constructor(code: InheritanceErrorCode, message: string = code) {
    super(message);
    this.name = "InheritanceError";
    this.code = code;
  }
}
