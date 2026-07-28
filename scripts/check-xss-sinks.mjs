#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const SOURCE_EXTENSIONS = Object.freeze(
  new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]),
);

const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const GLOBAL_OBJECT_NAMES = new Set(["globalThis", "self", "window"]);

const RULES = Object.freeze({
  dangerouslySetInnerHTML: {
    ruleId: "react-dangerously-set-inner-html",
    sink: "dangerouslySetInnerHTML",
  },
  innerHTML: {
    ruleId: "dom-inner-html-assignment",
    sink: "innerHTML assignment",
  },
  insertAdjacentHTML: {
    ruleId: "dom-insert-adjacent-html",
    sink: "insertAdjacentHTML",
  },
  documentWrite: {
    ruleId: "document-write",
    sink: "document.write",
  },
  functionConstructor: {
    ruleId: "dynamic-function-constructor",
    sink: "new Function",
  },
  eval: {
    ruleId: "eval-call",
    sink: "eval",
  },
});

export const isSourceFileName = (fileName) =>
  SOURCE_EXTENSIONS.has(path.extname(fileName).toLowerCase());

const scriptKindFor = (filePath) => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
};

const staticPropertyName = (node) => {
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
};

const accessedPropertyName = (expression) => {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && expression.argumentExpression) {
    return staticPropertyName(expression.argumentExpression);
  }
  return null;
};

const isGlobalMember = (expression, memberName) => {
  if (accessedPropertyName(expression) !== memberName) return false;
  const target = expression.expression;
  return ts.isIdentifier(target) && GLOBAL_OBJECT_NAMES.has(target.text);
};

const isDocumentReference = (expression) =>
  (ts.isIdentifier(expression) && expression.text === "document") ||
  isGlobalMember(expression, "document");

const isDocumentWriteCall = (node) => {
  if (!ts.isCallExpression(node) || accessedPropertyName(node.expression) !== "write") {
    return false;
  }
  return isDocumentReference(node.expression.expression);
};

const isEvalCall = (node) => {
  if (!ts.isCallExpression(node)) return false;
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === "eval") ||
    isGlobalMember(node.expression, "eval")
  );
};

const isFunctionConstructor = (node) => {
  if (!ts.isNewExpression(node)) return false;
  return (
    (ts.isIdentifier(node.expression) && node.expression.text === "Function") ||
    isGlobalMember(node.expression, "Function")
  );
};

const isDangerouslySetInnerHtml = (node) => {
  if (ts.isJsxAttribute(node)) {
    return node.name.getText() === "dangerouslySetInnerHTML";
  }
  return (
    ts.isPropertyAssignment(node) && staticPropertyName(node.name) === "dangerouslySetInnerHTML"
  );
};

const isInnerHtmlAssignment = (node) =>
  ts.isBinaryExpression(node) &&
  ASSIGNMENT_OPERATORS.has(node.operatorToken.kind) &&
  accessedPropertyName(node.left) === "innerHTML";

const isInsertAdjacentHtmlCall = (node) =>
  ts.isCallExpression(node) && accessedPropertyName(node.expression) === "insertAdjacentHTML";

const findingFor = (sourceFile, filePath, node, rule) => {
  const start = node.getStart(sourceFile);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    file: filePath,
    line: line + 1,
    column: character + 1,
    ruleId: rule.ruleId,
    sink: rule.sink,
  };
};

/**
 * Statically scans one JavaScript/TypeScript source string. Using the TypeScript parser avoids
 * treating comments and string literals as executable sinks.
 */
export const scanSourceText = (sourceText, { filePath = "source.ts" } = {}) => {
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(filePath),
  );
  const findings = [];

  const visit = (node) => {
    let rule;
    if (isDangerouslySetInnerHtml(node)) rule = RULES.dangerouslySetInnerHTML;
    else if (isInnerHtmlAssignment(node)) rule = RULES.innerHTML;
    else if (isInsertAdjacentHtmlCall(node)) rule = RULES.insertAdjacentHTML;
    else if (isDocumentWriteCall(node)) rule = RULES.documentWrite;
    else if (isFunctionConstructor(node)) rule = RULES.functionConstructor;
    else if (isEvalCall(node)) rule = RULES.eval;

    if (rule) findings.push(findingFor(sourceFile, filePath, node, rule));
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
};

const collectSourceFiles = async (sourceRoot) => {
  const files = [];

  const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      // A skipped link could hide executable source, escape frontend/src, or make traversal
      // recursive. Reject every link so a successful scan always covers the complete source tree.
      if (entry.isSymbolicLink()) {
        throw new Error(`XSS scan source tree contains a symbolic link: ${absolutePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && isSourceFileName(entry.name)) {
        files.push(absolutePath);
      }
    }
  };

  const rootStat = await fs.lstat(sourceRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`XSS scan source root is a symbolic link: ${sourceRoot}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`XSS scan source root is not a directory: ${sourceRoot}`);
  }
  await visit(sourceRoot);
  return files;
};

export const scanXssSinks = async ({
  projectRoot = process.cwd(),
  sourceRoot = path.join(projectRoot, "frontend", "src"),
} = {}) => {
  const findings = [];
  for (const absolutePath of await collectSourceFiles(sourceRoot)) {
    const sourceText = await fs.readFile(absolutePath, "utf8");
    const relativePath = path.relative(projectRoot, absolutePath).split(path.sep).join("/");
    findings.push(...scanSourceText(sourceText, { filePath: relativePath }));
  }
  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId),
  );
};

export const formatFinding = ({ file, line, column, ruleId, sink }) =>
  `${file}:${line}:${column} [${ruleId}] ${sink}`;

export const runXssSinkCheck = async ({
  projectRoot = process.cwd(),
  sourceRoot = path.join(projectRoot, "frontend", "src"),
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
} = {}) => {
  const findings = await scanXssSinks({ projectRoot, sourceRoot });
  if (findings.length === 0) {
    stdout("XSS sink scan passed: no dangerous frontend sinks found.");
    return { exitCode: 0, findings };
  }

  stderr(`XSS sink scan failed: found ${findings.length} dangerous frontend sink(s).`);
  for (const finding of findings) stderr(formatFinding(finding));
  return { exitCode: 1, findings };
};

export const main = async () => {
  const result = await runXssSinkCheck();
  return result.exitCode;
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`[xss-sink-scan] ${error.message}`);
      process.exitCode = 1;
    });
}
