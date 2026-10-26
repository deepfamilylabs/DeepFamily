import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectCanonicalBoundaryArtifacts } from "./lib/canonicalBoundaryArtifacts.mjs";
import { inspectProtocolArtifacts } from "./protocol-zk-development.mjs";

export function inspectCanonicalDevelopmentArtifacts({
  root = process.cwd(),
  requireCompiledProtocol = false,
} = {}) {
  const boundaries = inspectCanonicalBoundaryArtifacts({ root });
  const protocol = inspectProtocolArtifacts({ root, requireCompiled: requireCompiledProtocol });
  return { developmentOnly: true, boundaries, protocol };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    inspectCanonicalDevelopmentArtifacts({ requireCompiledProtocol: true });
    console.log(
      "Canonical development artifacts verified: three VALUE boundary relations and nine protocol relations. This is not a production ceremony approval.",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
