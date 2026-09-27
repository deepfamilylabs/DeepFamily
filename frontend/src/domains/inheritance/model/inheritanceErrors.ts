export type InheritanceErrorCode =
  | "nameRequired"
  | "passphraseDisallowed"
  | "rootVersionNotFound"
  | "snapshotMismatch";

/** A failure the flow recognises and explains in its own words. */
export class InheritanceError extends Error {
  readonly code: InheritanceErrorCode;

  constructor(code: InheritanceErrorCode, message: string = code) {
    super(message);
    this.name = "InheritanceError";
    this.code = code;
  }
}
