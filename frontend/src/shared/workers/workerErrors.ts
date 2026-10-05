export interface PublicWorkerError {
  message: string;
  name?: string;
  code?: string;
}

// Only fixed, public diagnostics may cross a secret-bearing Worker boundary.
// Substring redaction cannot cover encodings, fragments, names, codes or causes.
const PUBLIC_ERRORS = new Map<string, PublicWorkerError>([
  [
    "UNSUPPORTED_IDENTITY_SUITE",
    {
      message: "Unsupported identity suite",
      name: "UnsupportedProtocolError",
      code: "UNSUPPORTED_IDENTITY_SUITE",
    },
  ],
  [
    "UNSUPPORTED_FILE_KDF_SUITE",
    {
      message: "Unsupported file KDF suite",
      name: "UnsupportedProtocolError",
      code: "UNSUPPORTED_FILE_KDF_SUITE",
    },
  ],
  [
    "UNSUPPORTED_ENVELOPE_FORMAT",
    {
      message: "Unsupported metadata envelope format",
      name: "UnsupportedProtocolError",
      code: "UNSUPPORTED_ENVELOPE_FORMAT",
    },
  ],
  [
    "AES_GCM_AUTHENTICATION_FAILED",
    {
      message: "Metadata authentication failed",
      name: "ProtocolError",
      code: "AES_GCM_AUTHENTICATION_FAILED",
    },
  ],
  [
    "DISALLOWED_CODE_POINT",
    {
      message: "Input contains a character the protocol does not accept",
      name: "ProtocolError",
      code: "DISALLOWED_CODE_POINT",
    },
  ],
  [
    "CONTEXTUAL_RULE_NOT_SATISFIED",
    {
      message: "Input contains a character in an unsupported context",
      name: "ProtocolError",
      code: "CONTEXTUAL_RULE_NOT_SATISFIED",
    },
  ],
  [
    "ISOLATED_SURROGATE",
    {
      message: "Input contains malformed Unicode",
      name: "ProtocolError",
      code: "ISOLATED_SURROGATE",
    },
  ],
  [
    "EMPTY_FULL_NAME",
    {
      message: "Identity name is required",
      name: "ProtocolError",
      code: "EMPTY_FULL_NAME",
    },
  ],
  [
    "KDF_FAILED",
    {
      message: "Identity key derivation failed",
      name: "Error",
      code: "KDF_FAILED",
    },
  ],
]);

const PUBLIC_MESSAGES = new Map<string, PublicWorkerError>([
  [
    "Refusing to cache metadata whose public anchors do not match NodeData",
    {
      message: "Refusing to cache metadata whose public anchors do not match NodeData",
      name: "MetadataUnlockError",
    },
  ],
]);

export function serializeWorkerError(error: unknown): PublicWorkerError {
  try {
    if (error && typeof error === "object") {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string") {
        const diagnostic = PUBLIC_ERRORS.get(code);
        if (diagnostic) return { ...diagnostic };
      }
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        const diagnostic = PUBLIC_MESSAGES.get(message);
        if (diagnostic) return { ...diagnostic };
      }
    }
  } catch {
    // Even an exception object with a throwing getter must stay private.
  }
  return { message: "Local cryptographic operation failed" };
}
