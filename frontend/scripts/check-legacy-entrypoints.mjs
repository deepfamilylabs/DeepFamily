import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(scriptDir, "..", "src");
const repositoryRoot = join(scriptDir, "..", "..");
const legacyDirs = ["components", "hooks", "context", "lib", "config", "constants", "types"];

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

const legacyFiles = legacyDirs.flatMap((dir) => listFiles(join(srcRoot, dir)));
const violations = [];

if (legacyFiles.length > 0) {
  for (const file of legacyFiles) {
    violations.push(`top-level legacy frontend file: ${relative(srcRoot, file)}`);
  }
}

const removedFreshV1Artifacts = [
  "shared/crypto/disclosureBinding.ts",
  "shared/crypto/identityCommitment.ts",
  "shared/crypto/secretDerivation.ts",
  "shared/crypto/__tests__/disclosureBinding.test.ts",
  "shared/crypto/__tests__/identityCommitment.test.ts",
  "shared/crypto/__tests__/phase1Vectors.test.ts",
  "shared/crypto/__tests__/secretDerivation.test.ts",
  "shared/crypto/__tests__/fixtures/phase1-test-vectors.json",
];

for (const path of removedFreshV1Artifacts) {
  if (existsSync(join(srcRoot, path))) {
    violations.push(`removed fresh-v1 legacy artifact was restored: ${path}`);
  }
}

const runtimeSourceFiles = listFiles(srcRoot).filter((file) => {
  const path = relative(srcRoot, file);
  return (
    /\.(?:js|jsx|ts|tsx)$/u.test(path) &&
    !path.split(/[\\/]/u).includes("__tests__") &&
    !/\.(?:test|spec)\.[^.]+$/u.test(path)
  );
});
const forbiddenRuntimeIdentifiers = [
  "IdentitySaltMode",
  "randomSalt",
  "recoverySalt",
  "identitySaltHex",
  "generateRandomSalt",
  "deriveIdentitySecret",
  "DerivedSecretBundle",
  "CanonicalIdentityInput",
  "cryptoSuiteVersion",
  "hashAlgoId",
];
const forbiddenLegacyCryptoModule =
  /shared\/crypto\/(?:disclosureBinding|identityCommitment|secretDerivation)/u;

for (const file of runtimeSourceFiles) {
  const source = readFileSync(file, "utf8");
  const path = relative(srcRoot, file);
  if (forbiddenLegacyCryptoModule.test(source)) {
    violations.push(`legacy crypto module import in ${path}`);
  }
  for (const identifier of forbiddenRuntimeIdentifiers) {
    if (new RegExp(`\\b${identifier}\\b`, "u").test(source)) {
      violations.push(`legacy fresh-v1 identifier ${identifier} in ${path}`);
    }
  }
}

const helperPath = join(repositoryRoot, "test", "helpers", "testHelper.mjs");
const helperSource = readFileSync(helperPath, "utf8");
for (const identifier of [
  "PROOF_PURPOSE_PERSON_COMMITMENT",
  "_legacyCryptoSuiteVersion",
  "_legacyHashAlgoId",
]) {
  if (helperSource.includes(identifier)) {
    violations.push(`legacy contract-test helper identifier ${identifier}`);
  }
}
if (/source\.schemaVersion|opts\.schemaVersion/u.test(helperSource)) {
  violations.push("contract-test identity suite resolution must not fall back to schemaVersion");
}

for (const file of listFiles(join(repositoryRoot, "test")).filter((path) =>
  path.endsWith(".mjs"),
)) {
  const source = readFileSync(file, "utf8").replace(/\s+/gu, " ");
  if (
    /compute(?:IdentityCommitment|DisclosureBinding)\([^;]*?,\s*1,\s*1,\s*1,?\s*\)/u.test(source)
  ) {
    violations.push(`legacy three-version commitment call in ${relative(repositoryRoot, file)}`);
  }
}

const frontendPackage = JSON.parse(
  readFileSync(join(repositoryRoot, "frontend", "package.json"), "utf8"),
);
if (Object.hasOwn(frontendPackage.dependencies ?? {}, "hash-wasm")) {
  violations.push("frontend must consume Argon2id through @deepfamily/protocol-core");
}

if (violations.length > 0) {
  console.error("Legacy source audit failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Legacy frontend entrypoints and pre-fresh-v1 identity APIs are absent.");
