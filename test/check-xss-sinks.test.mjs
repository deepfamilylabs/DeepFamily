import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  formatFinding,
  isSourceFileName,
  runXssSinkCheck,
  scanSourceText,
  scanXssSinks,
} from "../scripts/check-xss-sinks.mjs";

const writeFile = async (root, relativePath, content) => {
  const target = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return target;
};

const expectRejectionMessage = async (promise, expectedMessage) => {
  let rejection;
  try {
    await promise;
  } catch (error) {
    rejection = error;
  }
  expect(rejection).to.be.instanceOf(Error);
  expect(rejection.message).to.equal(expectedMessage);
};

describe("frontend dangerous XSS sink scanner", function () {
  const temporaryDirectories = [];

  afterEach(async function () {
    while (temporaryDirectories.length > 0) {
      await fs.rm(temporaryDirectories.pop(), { recursive: true, force: true });
    }
  });

  const createProject = async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-xss-scan-"));
    temporaryDirectories.push(projectRoot);
    await fs.mkdir(path.join(projectRoot, "frontend", "src"), { recursive: true });
    return projectRoot;
  };

  it("detects every prohibited executable sink with its source line", function () {
    const source = [
      "export function Unsafe({ html }) {",
      "  const node = document.body;",
      "  node.innerHTML = html;",
      '  node.insertAdjacentHTML("beforeend", html);',
      "  document.write(html);",
      "  const dynamic = new Function(html);",
      "  eval(html);",
      "  return <div dangerouslySetInnerHTML={{ __html: html }} />;",
      "}",
    ].join("\n");

    const findings = scanSourceText(source, { filePath: "frontend/src/Unsafe.tsx" });

    expect(findings.map(({ ruleId, line }) => [ruleId, line])).to.deep.equal([
      ["dom-inner-html-assignment", 3],
      ["dom-insert-adjacent-html", 4],
      ["document-write", 5],
      ["dynamic-function-constructor", 6],
      ["eval-call", 7],
      ["react-dangerously-set-inner-html", 8],
    ]);
    expect(formatFinding(findings[0])).to.equal(
      "frontend/src/Unsafe.tsx:3:3 [dom-inner-html-assignment] innerHTML assignment",
    );
  });

  it("detects computed properties and explicit global-object variants", function () {
    const findings = scanSourceText(
      [
        'element["innerHTML"] += html;',
        'element["insertAdjacentHTML"]("beforeend", html);',
        'globalThis.document["write"](html);',
        "window.eval(html);",
        "new globalThis.Function(html);",
        'const props = { "dangerouslySetInnerHTML": { __html: html } };',
      ].join("\n"),
      { filePath: "frontend/src/computed.ts" },
    );

    expect(findings.map(({ ruleId }) => ruleId)).to.deep.equal([
      "dom-inner-html-assignment",
      "dom-insert-adjacent-html",
      "document-write",
      "eval-call",
      "dynamic-function-constructor",
      "react-dangerously-set-inner-html",
    ]);
  });

  it("does not report comments, strings, or similarly named safe calls", function () {
    const findings = scanSourceText(
      [
        "// node.innerHTML = html; document.write(html); eval(html);",
        'const examples = "dangerouslySetInnerHTML insertAdjacentHTML new Function";',
        "const innerHTML = examples;",
        "validator.eval(examples);",
        "otherDocument.write(examples);",
      ].join("\n"),
      { filePath: "frontend/src/safe.ts" },
    );

    expect(findings).to.deep.equal([]);
  });

  it("recurses through source files while skipping non-source files", async function () {
    const projectRoot = await createProject();
    await writeFile(
      projectRoot,
      "frontend/src/nested/Unsafe.tsx",
      "export const Unsafe = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />;",
    );
    await writeFile(projectRoot, "frontend/src/ignored.json", '{"example":"document.write(html)"}');
    await writeFile(projectRoot, "frontend/src/ignored.css", "eval(html);");

    const findings = await scanXssSinks({ projectRoot });

    expect(findings).to.have.lengthOf(1);
    expect(findings[0]).to.include({
      file: "frontend/src/nested/Unsafe.tsx",
      line: 1,
      ruleId: "react-dangerously-set-inner-html",
    });
    expect(isSourceFileName("component.TSX")).to.equal(true);
    expect(isSourceFileName("metadata.json")).to.equal(false);
  });

  it("fails closed when a source file is a symbolic link", async function () {
    const projectRoot = await createProject();
    const outsideFile = await writeFile(
      projectRoot,
      "outside/Linked.ts",
      "export const linked = true;",
    );
    const linkedFile = path.join(projectRoot, "frontend", "src", "Linked.ts");
    await fs.symlink(outsideFile, linkedFile);

    await expectRejectionMessage(
      scanXssSinks({ projectRoot }),
      `XSS scan source tree contains a symbolic link: ${linkedFile}`,
    );
  });

  it("fails closed when a source subdirectory is a symbolic link", async function () {
    const projectRoot = await createProject();
    const outsideDirectory = path.join(projectRoot, "outside");
    await fs.mkdir(outsideDirectory);
    const linkedDirectory = path.join(projectRoot, "frontend", "src", "linked-directory");
    await fs.symlink(outsideDirectory, linkedDirectory);

    await expectRejectionMessage(
      scanXssSinks({ projectRoot }),
      `XSS scan source tree contains a symbolic link: ${linkedDirectory}`,
    );
  });

  it("fails closed when the source root is a symbolic link", async function () {
    const projectRoot = await createProject();
    const sourceRoot = path.join(projectRoot, "frontend", "src");
    const actualSourceRoot = path.join(projectRoot, "actual-source");
    await fs.rm(sourceRoot, { recursive: true });
    await fs.mkdir(actualSourceRoot);
    await fs.symlink(actualSourceRoot, sourceRoot);

    await expectRejectionMessage(
      scanXssSinks({ projectRoot }),
      `XSS scan source root is a symbolic link: ${sourceRoot}`,
    );
  });

  it("returns zero and a clean message when no dangerous sink exists", async function () {
    const projectRoot = await createProject();
    await writeFile(
      projectRoot,
      "frontend/src/Safe.tsx",
      "export const Safe = ({ text }) => <div>{text}</div>;",
    );
    const stdout = [];
    const stderr = [];

    const result = await runXssSinkCheck({
      projectRoot,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(result).to.deep.equal({ exitCode: 0, findings: [] });
    expect(stdout).to.deep.equal(["XSS sink scan passed: no dangerous frontend sinks found."]);
    expect(stderr).to.deep.equal([]);
  });

  it("returns non-zero and prints project-relative path, line, and column for findings", async function () {
    const projectRoot = await createProject();
    await writeFile(
      projectRoot,
      "frontend/src/nested/Unsafe.ts",
      ["export function unsafe(html: string) {", "  document.write(html);", "}"].join("\n"),
    );
    const stdout = [];
    const stderr = [];

    const result = await runXssSinkCheck({
      projectRoot,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    expect(result.exitCode).to.equal(1);
    expect(result.findings).to.have.lengthOf(1);
    expect(stdout).to.deep.equal([]);
    expect(stderr).to.deep.equal([
      "XSS sink scan failed: found 1 dangerous frontend sink(s).",
      "frontend/src/nested/Unsafe.ts:2:3 [document-write] document.write",
    ]);
  });
});
