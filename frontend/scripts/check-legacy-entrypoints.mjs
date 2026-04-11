import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(scriptDir, "..", "src");
const legacyDirs = ["components", "hooks", "context"];

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

if (legacyFiles.length > 0) {
  console.error("Top-level legacy frontend entrypoints must stay empty:");
  for (const file of legacyFiles) {
    console.error(`- ${relative(srcRoot, file)}`);
  }
  process.exit(1);
}

console.log("Top-level legacy frontend entrypoints are empty.");
