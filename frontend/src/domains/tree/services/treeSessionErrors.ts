import { resolveErrorReason } from "../../../shared/lib/errors";

export type TreeSessionStatus =
  | "rateLimited"
  | "networkError"
  | "contractModeRootNotFound"
  | "rootNotFound";

function getErrorMessage(error: any): string {
  return String(
    error?.message ||
      error?.shortMessage ||
      (error?.cause && (error.cause.message || error.cause.shortMessage)) ||
      "",
  );
}

function getErrorCode(error: any): any {
  return (
    error?.code ??
    (error?.error && error.error.code) ??
    (error?.info && error.info.error && error.info.error.code) ??
    (error?.cause && error.cause.code)
  );
}

export function classifyTreeSessionConnectionError(error: any): TreeSessionStatus {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const reason = resolveErrorReason(error);
  const isRateLimit =
    code === -32005 ||
    /Too\s*many\s*requests|daily\s*request\s*count\s*exceeded|rate[-\s]?limit|status\s*429/i.test(
      message,
    );
  const isConnectionRefused = /ECONNREFUSED|ERR_CONNECTION_REFUSED|connection\s*refused/i.test(
    message,
  );
  const isAbort = /AbortError|The user aborted a request/i.test(message);
  const isFetchFail =
    /Failed\s*to\s*fetch|NetworkError\s*when\s*attempting\s*to\s*fetch/i.test(message);
  const isNetwork =
    reason === "NETWORK_ERROR" ||
    reason === "WALLET_POPUP_TIMEOUT" ||
    isConnectionRefused ||
    isAbort ||
    isFetchFail ||
    /network|timeout|ECONN|ENET|EAI_AGAIN/i.test(message) ||
    String(code).includes("NETWORK");

  if (isRateLimit) return "rateLimited";
  if (isNetwork) return "networkError";
  return "contractModeRootNotFound";
}

export function classifyTreeRootCheckError(error: any): {
  status: TreeSessionStatus;
  isRootInvalid: boolean;
} {
  const message = getErrorMessage(error);
  const name = String(error?.errorName || "");
  const reason = resolveErrorReason(error);
  const baseStatus = classifyTreeSessionConnectionError(error);
  const isRootInvalid =
    reason === "InvalidPersonHash" ||
    reason === "InvalidVersionIndex" ||
    name.includes("InvalidPersonHash") ||
    name.includes("InvalidVersionIndex") ||
    /InvalidPersonHash|InvalidVersionIndex/i.test(message);

  if (isRootInvalid) {
    return { status: "rootNotFound", isRootInvalid: true };
  }
  return { status: baseStatus, isRootInvalid: false };
}
