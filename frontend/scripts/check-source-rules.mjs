import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(scriptDir, "..", "src");
const repositoryRoot = join(scriptDir, "..", "..");
// Source lives in app/, pages/, domains/, shared/ and workers/ (see docs/frontend.md).
const unownedTopLevelDirs = [
  "components",
  "hooks",
  "context",
  "lib",
  "config",
  "constants",
  "types",
];

function listFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return listFiles(fullPath);
    }

    return [fullPath];
  });
}

const violations = [];

for (const file of unownedTopLevelDirs.flatMap((dir) => listFiles(join(srcRoot, dir)))) {
  violations.push(`frontend source outside an owning layer: ${relative(srcRoot, file)}`);
}

const checkRootSource = readFileSync(join(repositoryRoot, "scripts", "check-root.mjs"), "utf8");
if (/console\.(?:log|info|warn|error)\([^\n]*passphrase/iu.test(checkRootSource)) {
  violations.push("check-root must not print an identity passphrase");
}

const frontendPackage = JSON.parse(
  readFileSync(join(repositoryRoot, "frontend", "package.json"), "utf8"),
);
if (Object.hasOwn(frontendPackage.dependencies ?? {}, "hash-wasm")) {
  violations.push("frontend must consume Argon2id through @deepfamily/protocol-core");
}

if (violations.length > 0) {
  console.error("Source rules check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Frontend source layout, check-root output and Argon2id dependency rules hold.");
