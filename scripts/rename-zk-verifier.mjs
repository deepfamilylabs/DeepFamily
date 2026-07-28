import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const renameZkVerifierSource = (source, contractName) => {
  if (typeof contractName !== "string" || !/^[A-Z][A-Za-z0-9]{2,79}$/.test(contractName)) {
    throw new Error("Verifier contract name is invalid");
  }
  if (
    source.includes(`contract ${contractName} `) ||
    source.includes(`contract ${contractName}{`)
  ) {
    return source;
  }

  const updated = source.replace(/\bcontract\s+Groth16Verifier\b/, `contract ${contractName}`);
  if (updated === source) {
    throw new Error("Unable to find the generated Groth16Verifier contract declaration");
  }
  return updated;
};

export const renameZkVerifierFile = ({ targetPath, contractName, root = process.cwd() }) => {
  const resolvedPath = path.resolve(root, targetPath);
  const source = fs.readFileSync(resolvedPath, "utf8");
  const updated = renameZkVerifierSource(source, contractName);
  if (updated !== source) fs.writeFileSync(resolvedPath, updated, "utf8");
  return resolvedPath;
};

export const main = (argv = process.argv.slice(2)) => {
  const [targetPath, contractName] = argv;
  if (argv.length !== 2 || !targetPath || !contractName) {
    throw new Error("Usage: node scripts/rename-zk-verifier.mjs <file> <contractName>");
  }
  renameZkVerifierFile({ targetPath, contractName });
};

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`[rename-zk-verifier] ${error.message}`);
    process.exitCode = 1;
  }
}
