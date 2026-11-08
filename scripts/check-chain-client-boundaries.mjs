import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const roots = ["frontend/src", "frontend/scripts", "lib", "tasks", "scripts", "hardhat"];
const waitMethods = new Set(["wait", "waitForTransaction", "waitForDeployment"]);

async function sourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    if (["node_modules", "test-helpers", "__tests__"].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:m?js|tsx?)$/.test(entry.name) && !/\.(?:test|spec|d)\./.test(entry.name)
      ? [filename] : [];
  }));
  return files.flat();
}

const violations = [];
for (const directory of roots) {
  for (const filename of await sourceFiles(path.join(root, directory))) {
    const source = await fs.readFile(filename, "utf8");
    const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const report = (node, message) => {
      const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
      violations.push(`${path.relative(root, filename)}:${line}: ${message}`);
    };
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          waitMethods.has(node.expression.name.text)) {
        report(node, "use chain-client execution or receipt tracking");
      }
      if (ts.isNewExpression(node) &&
          (ts.isIdentifier(node.expression) && node.expression.text === "Contract" ||
           ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "Contract")) {
        report(node, "construct contracts with createChainContract");
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "getContractAt") {
        let parent = node.parent;
        while (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
        if (!ts.isCallExpression(parent) || !ts.isIdentifier(parent.expression) ||
            parent.expression.text !== "instrumentChainContract") {
          report(node, "instrument Hardhat contract instances with instrumentChainContract");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Runtime contract clients and transaction waits use @deepfamily/chain-client.");
}
