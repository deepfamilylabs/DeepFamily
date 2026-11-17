import path from "node:path";

// Hardhat prunes artifacts/ during full builds and removes it on clean.
// Keep verification evidence outside that compiler-owned directory.
export function verificationPaths(root) {
  const directory = path.join(root, "test-results");
  return {
    checks: path.join(directory, "checks"),
    browserAcceptance: path.join(directory, "browser-acceptance"),
    security: path.join(directory, "security"),
  };
}
