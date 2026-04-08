import fs from "node:fs";
import path from "node:path";

const [, , targetPath, contractName] = process.argv;

if (!targetPath || !contractName) {
  console.error("Usage: node scripts/rename-zk-verifier.mjs <file> <contractName>");
  process.exit(1);
}

const resolvedPath = path.resolve(process.cwd(), targetPath);
const source = fs.readFileSync(resolvedPath, "utf8");

if (source.includes(`contract ${contractName} `) || source.includes(`contract ${contractName}{`)) {
  process.exit(0);
}

const updated = source.replace(/\bcontract\s+Groth16Verifier\b/, `contract ${contractName}`);

if (updated === source) {
  console.error(`Unable to rename verifier contract in ${resolvedPath}`);
  process.exit(1);
}

fs.writeFileSync(resolvedPath, updated, "utf8");
