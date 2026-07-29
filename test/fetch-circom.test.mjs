import { expect } from "chai";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CIRCOM_CANONICAL_POLICY,
  CIRCOM_VERSION,
  buildPinnedCircomFromSource,
  buildCircomInstallPlan,
  installCircomToolchains,
  installPinnedCircom,
} from "../scripts/fetch-circom.mjs";
import {
  CIRCOM_SOURCE_COMMIT,
  CIRCOM_SOURCE_REPOSITORY,
  CIRCOM_TARGETS,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "../scripts/lib/circomToolchain.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expectedVersionOutput = `circom compiler ${CIRCOM_VERSION}`;
const supportedRuntimes = [
  { platform: "linux", arch: "x64", strategy: "official-binary" },
  { platform: "darwin", arch: "x64", strategy: "official-binary" },
  { platform: "win32", arch: "x64", strategy: "official-binary" },
  { platform: "linux", arch: "arm64", strategy: "pinned-source" },
  { platform: "darwin", arch: "arm64", strategy: "pinned-source" },
  { platform: "win32", arch: "arm64", strategy: "pinned-source" },
];

const officialBytes = Buffer.from("hermetic official Circom fixture");
const officialTarget = Object.freeze({
  id: "fixture-official-linux-x64",
  platform: "linux",
  arch: "x64",
  strategy: "official-binary",
  asset: "circom-fixture",
  url: "https://fixtures.invalid/circom-fixture",
  sha256: sha256(officialBytes),
});
const sourceBytes = Buffer.from("hermetic source-built Circom fixture");
const sourceTarget = CIRCOM_TARGETS["darwin-arm64"];
const sourceMetadata = Object.freeze({
  rustcVersion: "rustc 1.81.0 (fixture)",
  cargoVersion: "cargo 1.81.0 (fixture)",
});

describe("pinned Circom installer", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-circom-fetch-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("resolves all six supported targets and rejects unsupported hosts", function () {
    expect(Object.keys(CIRCOM_TARGETS)).to.deep.equal(
      supportedRuntimes.map(({ platform, arch }) => `${platform}-${arch}`),
    );

    for (const runtime of supportedRuntimes) {
      const key = `${runtime.platform}-${runtime.arch}`;
      const target = resolveLocalCircomTarget(runtime);

      expect(target).to.equal(CIRCOM_TARGETS[key]);
      expect(target).to.include({
        id: key,
        platform: runtime.platform,
        arch: runtime.arch,
        strategy: runtime.strategy,
      });
      expect(Object.isFrozen(target)).to.equal(true);

      if (runtime.strategy === "official-binary") {
        expect(target.url).to.equal(
          `https://github.com/iden3/circom/releases/download/v${CIRCOM_VERSION}/${target.asset}`,
        );
        expect(target.sha256).to.match(/^[0-9a-f]{64}$/);
      } else {
        expect(target.repository).to.equal(CIRCOM_SOURCE_REPOSITORY);
        expect(target.commit).to.equal(CIRCOM_SOURCE_COMMIT);
      }
    }

    expect(() => resolveLocalCircomTarget({ platform: "freebsd", arch: "riscv64" })).to.throw(
      "Unsupported Circom host freebsd/riscv64; supported targets: " +
        Object.keys(CIRCOM_TARGETS).join(", "),
    );
  });

  it("builds canonical and local install paths for every supported target", function () {
    for (const runtime of supportedRuntimes) {
      const plan = buildCircomInstallPlan(runtime);
      const [canonical, local] = plan;

      expect(plan).to.have.length(2);
      expect(canonical).to.deep.equal({
        role: "canonical-release",
        target: CIRCOM_CANONICAL_POLICY.target,
        destinationRelativePath: CIRCOM_CANONICAL_POLICY.binaryPath,
        verifyVersion: false,
      });
      expect(local).to.deep.equal({
        role: "local",
        target: CIRCOM_TARGETS[`${runtime.platform}-${runtime.arch}`],
        destinationRelativePath: localCircomBinaryPath(runtime),
        verifyVersion: true,
      });
      expect(canonical.destinationRelativePath).to.not.equal(local.destinationRelativePath);
      expect(Object.isFrozen(plan)).to.equal(true);
      expect(Object.isFrozen(canonical)).to.equal(true);
      expect(Object.isFrozen(local)).to.equal(true);
    }
  });

  it("installs the canonical compiler before the Linux x64 local compiler and reuses its bytes", async function () {
    const calls = [];
    const canonicalPath = path.join(root, CIRCOM_CANONICAL_POLICY.binaryPath);
    const installer = async (options) => {
      calls.push(options);
      if (calls.length === 1) {
        await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
        await fs.writeFile(canonicalPath, officialBytes);
      } else {
        expect(await options.download(options.target.url)).to.deep.equal(officialBytes);
      }
      return {
        status: "installed",
        path: calls.length === 1 ? canonicalPath : path.join(root, options.destinationRelativePath),
        target: options.target.id,
        sha256: options.target.sha256,
      };
    };

    const results = await installCircomToolchains({
      projectRoot: root,
      platform: "linux",
      arch: "x64",
      installer,
    });

    expect(calls.map(({ destinationRelativePath }) => destinationRelativePath)).to.deep.equal([
      CIRCOM_CANONICAL_POLICY.binaryPath,
      "bin/circom",
    ]);
    expect(results.map(({ role }) => role)).to.deep.equal(["canonical-release", "local"]);
  });

  it("builds arm64 from the exact source commit with locked Cargo dependencies", async function () {
    const target = CIRCOM_TARGETS["win32-arm64"];
    const temporaryRoot = path.join(root, "source-build");
    const commands = [];
    let removedDirectory;
    const commandRunner = async ({ executable, args, cwd, capture = false }) => {
      commands.push({ executable, args: [...args], cwd, capture });
      if (executable === "git" && args[0] === "init") {
        await fs.mkdir(args[1], { recursive: true });
        return;
      }
      if (executable === "git" && args[0] === "rev-parse") {
        return `${target.commit}\n`;
      }
      if (executable === "cargo" && args[0] === "--version") {
        return "cargo 1.89.0 (fixture)\n";
      }
      if (executable === "rustc") {
        return "rustc 1.89.0 (fixture)\n";
      }
      if (executable === "cargo" && args[0] === "build") {
        const outputDirectory = path.join(cwd, "target", "release");
        await fs.mkdir(outputDirectory, { recursive: true });
        await fs.writeFile(path.join(outputDirectory, "circom.exe"), sourceBytes);
        return;
      }
      if (path.basename(executable) === "circom.exe") {
        return `${expectedVersionOutput}\n`;
      }
    };

    const built = await buildPinnedCircomFromSource({
      target,
      commandRunner,
      temporaryDirectoryFactory: async () => {
        await fs.mkdir(temporaryRoot);
        return temporaryRoot;
      },
      temporaryDirectoryRemover: async (directory) => {
        removedDirectory = directory;
        await fs.rm(directory, { recursive: true, force: true });
      },
    });

    expect(built).to.deep.equal({
      bytes: sourceBytes,
      cargoVersion: "cargo 1.89.0 (fixture)",
      rustcVersion: "rustc 1.89.0 (fixture)",
    });
    expect(
      commands.some(
        ({ executable, args }) =>
          executable === "git" && args.join(" ") === `fetch --depth 1 origin ${target.commit}`,
      ),
    ).to.equal(true);
    expect(
      commands.some(
        ({ executable, args }) =>
          executable === "cargo" && args.join(" ") === "build --release --locked",
      ),
    ).to.equal(true);
    expect(commands.some(({ executable }) => path.basename(executable) === "circom.exe")).to.equal(
      true,
    );
    expect(removedDirectory).to.equal(temporaryRoot);
    await expectFileMissing(temporaryRoot);
  });

  it("installs an official binary only when its pinned digest and version match", async function () {
    const destinationRelativePath = "bin/circom-official-fixture";
    const installed = path.join(root, destinationRelativePath);
    let requestedUrl;
    let versionCheckedAt;

    const result = await installPinnedCircom({
      projectRoot: root,
      target: officialTarget,
      destinationRelativePath,
      download: async (requested) => {
        requestedUrl = requested;
        return officialBytes;
      },
      versionRunner: (executable) => {
        versionCheckedAt = executable;
        return expectedVersionOutput;
      },
    });

    expect(requestedUrl).to.equal(officialTarget.url);
    expect(versionCheckedAt).to.equal(installed);
    expect(result).to.deep.equal({
      status: "installed",
      path: installed,
      target: officialTarget.id,
      sha256: officialTarget.sha256,
    });
    expect(sha256(await fs.readFile(installed))).to.equal(officialTarget.sha256);
    expect((await fs.stat(installed)).mode & 0o777).to.equal(0o755);
  });

  it("reuses an exact official binary without downloading it again", async function () {
    const destinationRelativePath = "bin/circom-official-reuse";
    let downloads = 0;
    const install = () =>
      installPinnedCircom({
        projectRoot: root,
        target: officialTarget,
        destinationRelativePath,
        download: async () => {
          downloads += 1;
          return officialBytes;
        },
        versionRunner: () => expectedVersionOutput,
      });

    await install();
    const result = await install();

    expect(downloads).to.equal(1);
    expect(result).to.deep.equal({
      status: "already-installed",
      path: path.join(root, destinationRelativePath),
      target: officialTarget.id,
      sha256: officialTarget.sha256,
    });
  });

  it("repairs the executable mode before validating a reused compiler version", async function () {
    const destinationRelativePath = "bin/circom-official-mode-repair";
    const installed = path.join(root, destinationRelativePath);
    await installPinnedCircom({
      projectRoot: root,
      target: officialTarget,
      destinationRelativePath,
      download: async () => officialBytes,
      versionRunner: () => expectedVersionOutput,
    });
    await fs.chmod(installed, 0o644);

    const result = await installPinnedCircom({
      projectRoot: root,
      target: officialTarget,
      destinationRelativePath,
      download: async () => {
        throw new Error("download must not run");
      },
      versionRunner: (executable) => {
        expect(fsSync.statSync(executable).mode & 0o777).to.equal(0o755);
        return expectedVersionOutput;
      },
    });

    expect(result.status).to.equal("already-installed");
    expect((await fs.stat(installed)).mode & 0o777).to.equal(0o755);
  });

  it("rejects a bad official download without installing it", async function () {
    const destinationRelativePath = "bin/circom-official-bad-download";
    const error = await captureError(() =>
      installPinnedCircom({
        projectRoot: root,
        target: officialTarget,
        destinationRelativePath,
        download: async () => Buffer.from("tampered download"),
        versionRunner: () => expectedVersionOutput,
      }),
    );

    expect(error, "expected digest mismatch rejection").to.be.an("error");
    expect(error.message).to.include("Downloaded Circom SHA-256 mismatch");
    await expectFileMissing(path.join(root, destinationRelativePath));
  });

  it("refuses to overwrite an unexpected official compiler", async function () {
    const destinationRelativePath = "bin/circom-official-existing";
    const installed = path.join(root, destinationRelativePath);
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.writeFile(installed, "unexpected compiler");
    let downloaded = false;

    const error = await captureError(() =>
      installPinnedCircom({
        projectRoot: root,
        target: officialTarget,
        destinationRelativePath,
        download: async () => {
          downloaded = true;
          return officialBytes;
        },
        versionRunner: () => expectedVersionOutput,
      }),
    );

    expect(error, "expected existing compiler rejection").to.be.an("error");
    expect(error.message).to.include("does not match the pinned SHA-256");
    expect(downloaded).to.equal(false);
    expect(await fs.readFile(installed, "utf8")).to.equal("unexpected compiler");
  });

  it("refuses to replace a symlink even when its target has the pinned bytes", async function () {
    const destinationRelativePath = "bin/circom-official-symlink";
    const installed = path.join(root, destinationRelativePath);
    const symlinkTarget = path.join(root, "symlink-target");
    await fs.mkdir(path.dirname(installed), { recursive: true });
    await fs.writeFile(symlinkTarget, officialBytes);
    await fs.symlink(symlinkTarget, installed);

    const error = await captureError(() =>
      installPinnedCircom({
        projectRoot: root,
        target: officialTarget,
        destinationRelativePath,
        download: async () => {
          throw new Error("download must not run");
        },
        versionRunner: () => expectedVersionOutput,
      }),
    );

    expect(error, "expected symlink rejection").to.be.an("error");
    expect(error.message).to.include("regular non-symlink file");
    expect((await fs.lstat(installed)).isSymbolicLink()).to.equal(true);
    expect(await fs.readFile(symlinkTarget)).to.deep.equal(officialBytes);
  });

  it("installs a pinned source build with complete provenance", async function () {
    const destinationRelativePath = "bin/circom-source-fixture";
    const installed = path.join(root, destinationRelativePath);
    let requestedTarget;

    const result = await installPinnedCircom({
      projectRoot: root,
      target: sourceTarget,
      destinationRelativePath,
      sourceBuilder: async ({ target }) => {
        requestedTarget = target;
        return { bytes: sourceBytes, ...sourceMetadata };
      },
      versionRunner: () => expectedVersionOutput,
    });
    const provenancePath = `${installed}.provenance.json`;
    const provenance = JSON.parse(await fs.readFile(provenancePath, "utf8"));

    expect(requestedTarget).to.equal(sourceTarget);
    expect(result).to.deep.equal({
      status: "installed",
      path: installed,
      target: sourceTarget.id,
      sha256: sha256(sourceBytes),
    });
    expect(provenance).to.deep.equal({
      schemaVersion: 1,
      circomVersion: CIRCOM_VERSION,
      target: sourceTarget.id,
      strategy: sourceTarget.strategy,
      sourceRepository: CIRCOM_SOURCE_REPOSITORY,
      sourceCommit: CIRCOM_SOURCE_COMMIT,
      rustcVersion: sourceMetadata.rustcVersion,
      cargoVersion: sourceMetadata.cargoVersion,
      binarySha256: sha256(sourceBytes),
    });
    expect((await fs.stat(installed)).mode & 0o777).to.equal(0o755);
    expect((await fs.stat(provenancePath)).mode & 0o777).to.equal(0o644);
  });

  it("reuses a source build only when its binary and provenance remain exact", async function () {
    const destinationRelativePath = "bin/circom-source-reuse";
    let builds = 0;
    const install = () =>
      installPinnedCircom({
        projectRoot: root,
        target: sourceTarget,
        destinationRelativePath,
        sourceBuilder: async () => {
          builds += 1;
          return { bytes: sourceBytes, ...sourceMetadata };
        },
        versionRunner: () => expectedVersionOutput,
      });

    await install();
    const result = await install();

    expect(builds).to.equal(1);
    expect(result).to.deep.equal({
      status: "already-installed",
      path: path.join(root, destinationRelativePath),
      target: sourceTarget.id,
      sha256: sha256(sourceBytes),
    });
  });

  it("rejects tampering with either a source-built binary or its provenance", async function () {
    const installSourceFixture = (destinationRelativePath) =>
      installPinnedCircom({
        projectRoot: root,
        target: sourceTarget,
        destinationRelativePath,
        sourceBuilder: async () => ({ bytes: sourceBytes, ...sourceMetadata }),
        versionRunner: () => expectedVersionOutput,
      });

    const binaryDestination = "bin/circom-source-binary-tamper";
    await installSourceFixture(binaryDestination);
    await fs.appendFile(path.join(root, binaryDestination), "tampered");
    const binaryError = await captureError(() => installSourceFixture(binaryDestination));
    expect(binaryError, "expected source binary tampering rejection").to.be.an("error");
    expect(binaryError.message).to.include("provenance binarySha256 mismatch");

    const provenanceDestination = "bin/circom-source-provenance-tamper";
    await installSourceFixture(provenanceDestination);
    const provenancePath = `${path.join(root, provenanceDestination)}.provenance.json`;
    const provenance = JSON.parse(await fs.readFile(provenancePath, "utf8"));
    provenance.sourceCommit = "0".repeat(40);
    await fs.writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
    const provenanceError = await captureError(() => installSourceFixture(provenanceDestination));
    expect(provenanceError, "expected source provenance tampering rejection").to.be.an("error");
    expect(provenanceError.message).to.include("provenance sourceCommit mismatch");
  });
});

const captureError = async (operation) => {
  try {
    await operation();
    return null;
  } catch (error) {
    return error;
  }
};

const expectFileMissing = async (filePath) => {
  try {
    await fs.access(filePath);
    throw new Error(`Expected file to be missing: ${filePath}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
};
