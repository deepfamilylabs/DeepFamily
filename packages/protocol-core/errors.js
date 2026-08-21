export class ProtocolError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export class UnsupportedProtocolError extends ProtocolError {
  constructor(code, message, options) {
    super(code, message, options);
    this.name = "UnsupportedProtocolError";
  }
}

export function protocolAssert(condition, code, message) {
  if (!condition) throw new ProtocolError(code, message);
}
