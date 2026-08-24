import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  CIRCOM_CANONICAL_POLICY,
  CIRCOM_VERSION,
  assertLocalCircomInstallation,
  buildPinnedCircomFromSource,
  buildCircomInstallPlan,
  installCircomToolchains,
  installPinnedCircom,
  resolveTrustedSourceBuildTool,
} from "../scripts/fetch-circom.mjs";
import {
  CIRCOM_SOURCE_COMMIT,
  CIRCOM_SOURCE_REPOSITORY,
  CIRCOM_RUNTIME_TARGET_ALLOWLIST,
  CIRCOM_TARGET_POLICIES,
  CIRCOM_TARGETS,
  circomTargetKey,
  detectLinuxLibcEvidence,
  localCircomBinaryPath,
  resolveLocalCircomTarget,
} from "../scripts/lib/circomToolchain.mjs";
import { expectRegularFileWithPosixMode } from "./helpers/fileMode.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const expectedVersionOutput = `circom compiler ${CIRCOM_VERSION}`;
const supportedRuntimes = [
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    libc: "glibc",
    strategy: "official-binary",
  },
  { id: "darwin-arm64", platform: "darwin", arch: "arm64", strategy: "pinned-source" },
  { id: "win32-x64", platform: "win32", arch: "x64", strategy: "official-binary" },
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

  it("detects glibc and musl but accepts only the supported glibc runtime", function () {
    const glibc = detectLinuxLibcEvidence({
      report: {
        getReport: () => ({ header: { glibcVersionRuntime: " 2.39 " } }),
      },
    });
    const musl = detectLinuxLibcEvidence({
      report: {
        getReport: () => ({ header: {} }),
      },
    });

    expect(glibc).to.deep.equal({
      family: "glibc",
      version: "2.39",
      source: "process.report.header.glibcVersionRuntime",
    });
    expect(musl).to.deep.equal({
      family: "musl",
      version: null,
      source: "process.report.header.glibcVersionRuntime",
    });
    expect(Object.isFrozen(glibc)).to.equal(true);
    expect(Object.isFrozen(musl)).to.equal(true);

    expect(
      resolveLocalCircomTarget({
        platform: "linux",
        arch: "x64",
        report: { header: { glibcVersionRuntime: "2.36" } },
      }),
    ).to.include({
      id: "linux-x64",
      strategy: "official-binary",
    });
    expect(() =>
      resolveLocalCircomTarget({
        platform: "linux",
        arch: "x64",
        report: { header: {} },
      }),
    ).to.throw("Unsupported Linux libc musl; the supported Linux runtime is x64 with glibc");
  });

  it("resolves every supported target and rejects unsupported hosts or libc families", function () {
    expect(CIRCOM_RUNTIME_TARGET_ALLOWLIST).to.deep.equal(supportedRuntimes.map(({ id }) => id));
    expect(Object.isFrozen(CIRCOM_RUNTIME_TARGET_ALLOWLIST)).to.equal(true);

    for (const runtime of supportedRuntimes) {
      const target = resolveLocalCircomTarget(runtime);

      expect(target).to.include({
        id: runtime.id,
        platform: runtime.platform,
        arch: runtime.arch,
        strategy: runtime.strategy,
      });
      expect(Object.isFrozen(target)).to.equal(true);
      if (runtime.platform === "linux") {
        expect(target.libcEvidence).to.deep.equal({
          family: runtime.libc,
          version: null,
          source: "explicit-libc",
        });
        expect(Object.isFrozen(target.libcEvidence)).to.equal(true);
      } else {
        expect(target).to.equal(CIRCOM_TARGETS[runtime.id]);
      }

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
      "Unsupported Circom host freebsd/riscv64; supported runtime targets: " +
        CIRCOM_RUNTIME_TARGET_ALLOWLIST.join(", "),
    );
    expect(() =>
      resolveLocalCircomTarget({
        version: "9.9.9",
        platform: "linux",
        arch: "x64",
      }),
    ).to.throw("Unsupported Circom version policy 9.9.9");
    expect(() =>
      resolveLocalCircomTarget({
        platform: "linux",
        arch: "x64",
        libc: "uclibc",
      }),
    ).to.throw("Unsupported Linux libc uclibc; expected glibc or musl");
    expect(() =>
      resolveLocalCircomTarget({
        platform: "darwin",
        arch: "arm64",
        libc: "musl",
      }),
    ).to.throw("A libc override is only valid for Linux hosts, got darwin");
    expect(() =>
      resolveLocalCircomTarget({
        platform: "linux",
        arch: "x64",
        libc: "musl",
      }),
    ).to.throw("Unsupported Linux libc musl; the supported Linux runtime is x64 with glibc");
    expect(() =>
      resolveLocalCircomTarget({
        platform: "linux",
        arch: "arm64",
        libc: "glibc",
      }),
    ).to.throw("Unsupported Circom host linux/arm64");
    expect(() =>
      resolveLocalCircomTarget({
        platform: "darwin",
        arch: "x64",
      }),
    ).to.throw("Unsupported Circom host darwin/x64");
    expect(() => circomTargetKey({ platform: "darwin", arch: "x64" })).to.throw(
      "Unsupported Circom host darwin/x64",
    );
    expect(() => circomTargetKey({ platform: "linux", arch: "arm64", libc: "glibc" })).to.throw(
      "Unsupported Circom host linux/arm64",
    );
    expect(() =>
      resolveLocalCircomTarget({
        platform: "win32",
        arch: "x64",
        env: {
          PROCESSOR_ARCHITECTURE: "AMD64",
          PROCESSOR_ARCHITEW6432: "ARM64",
        },
      }),
    ).to.throw("Unsupported Windows ARM64 host, including x64 Node.js emulation");
  });

  it("registers only the three supported Circom 2.2.3 targets", function () {
    expect(Object.keys(CIRCOM_TARGET_POLICIES["2.2.3"])).to.deep.equal(
      supportedRuntimes.map(({ id }) => id),
    );
    expect(CIRCOM_TARGETS).to.equal(CIRCOM_TARGET_POLICIES["2.2.3"]);
    expect(CIRCOM_TARGET_POLICIES["2.2.3"]["linux-x64"]).to.include({
      asset: "circom-linux-amd64",
      sha256: "85342c7ff332d948df7c0c50ecf201e6129349aef550ce873f3c811b79fe53a3",
    });
    expect(CIRCOM_TARGET_POLICIES["2.2.3"]["darwin-arm64"]).to.include({
      repository: "https://github.com/iden3/circom.git",
      commit: "ad44e915a12bb047b05745c2884aad9cc8326bc6",
    });
    expect(CIRCOM_TARGET_POLICIES["2.2.3"]["win32-x64"]).to.include({
      asset: "circom-windows-amd64.exe",
      sha256: "e43f132ee6f0aa79b705beceb59c2a7e6a54d7bdeab917ca34e9fc1951d185e1",
    });
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
        target: resolveLocalCircomTarget(runtime),
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
      libc: "glibc",
      installer,
    });

    expect(calls.map(({ destinationRelativePath }) => destinationRelativePath)).to.deep.equal([
      CIRCOM_CANONICAL_POLICY.binaryPath,
      "bin/circom",
    ]);
    expect(results.map(({ role }) => role)).to.deep.equal(["canonical-release", "local"]);
  });

  it("refuses to plan a compiler installation for Linux x64 musl", function () {
    expect(() =>
      buildCircomInstallPlan({
        platform: "linux",
        arch: "x64",
        libc: "musl",
      }),
    ).to.throw("Unsupported Linux libc musl; the supported Linux runtime is x64 with glibc");
  });

  it("refuses to plan installations for unsupported targets", function () {
    for (const runtime of [
      { platform: "darwin", arch: "x64" },
      { platform: "linux", arch: "arm64", libc: "glibc" },
    ]) {
      expect(() => buildCircomInstallPlan(runtime)).to.throw("Unsupported Circom host");
    }
  });

  it("builds macOS arm64 from the exact source commit with locked Cargo dependencies", async function () {
    const target = CIRCOM_TARGETS["darwin-arm64"];
    const temporaryRoot = path.join(root, "source-build");
    const commands = [];
    const fixtureTools = Object.fromEntries(
      ["git", "cargo", "rustc"].map((name) => [
        name,
        process.platform === "win32"
          ? path.join(root, "trusted-tools", `${name}.exe`)
          : path.join("/usr/bin", name),
      ]),
    );
    if (process.platform === "win32") await fs.mkdir(path.dirname(fixtureTools.git));
    let removedDirectory;
    const commandRunner = async ({ executable, args, cwd, capture = false, env }) => {
      commands.push({ executable, args: [...args], cwd, capture, env });
      const toolName = path.basename(executable).replace(/\.exe$/u, "");
      if (toolName === "git" && args[0] === "init") {
        await fs.mkdir(args[1], { recursive: true });
        return;
      }
      if (toolName === "git" && args[0] === "rev-parse") {
        return `${target.commit}\n`;
      }
      if (toolName === "cargo" && args[0] === "--version") {
        return "cargo 1.89.0 (fixture)\n";
      }
      if (toolName === "rustc") {
        return "rustc 1.89.0 (fixture)\n";
      }
      if (toolName === "cargo" && args[0] === "build") {
        const outputDirectory = path.join(cwd, "target", "release");
        await fs.mkdir(outputDirectory, { recursive: true });
        await fs.writeFile(path.join(outputDirectory, "circom"), sourceBytes);
        return;
      }
      if (path.basename(executable) === "circom") {
        return `${expectedVersionOutput}\n`;
      }
    };

    const built = await buildPinnedCircomFromSource({
      target,
      env: {
        FIXTURE_SAFE: "preserved",
        HOME: "/untrusted/source-home",
        PATH: path.join(root, "node_modules", ".bin"),
        TMPDIR: "/untrusted/source-tmp",
        NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
        LD_PRELOAD: "/untrusted/preload.so",
        NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
        GIT_CONFIG_COUNT: "9",
        RUSTUP_TOOLCHAIN: "nightly-untrusted",
        RUSTUP_HOME: "/untrusted/rustup-home",
        RUSTC_BOOTSTRAP: "1",
        RUSTC_LINKER: "/untrusted/linker",
        RUSTC_WRAPPER: "/untrusted/rust-wrapper",
        RUST_PATH: "/untrusted/rust-path",
        RUST_TARGET_PATH: "/untrusted/rust-targets",
        CARGO_HOME: "/untrusted/cargo-home",
        CC: "/untrusted/compiler",
      },
      commandRunner,
      toolPathResolver: async ({ name }) => fixtureTools[name],
      sourceBuildBaseDirectory: root,
      temporaryDirectoryFactory: async ({ baseDirectory }) => {
        expect(baseDirectory).to.equal(root);
        await fs.mkdir(temporaryRoot);
        return temporaryRoot;
      },
      sourceBuildDirectoryValidator: async ({ sourceDirectory }) => {
        expect(sourceDirectory).to.equal(path.join(temporaryRoot, "source"));
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
          executable === fixtureTools.git &&
          args.join(" ") === `fetch --depth 1 origin ${target.commit}`,
      ),
    ).to.equal(true);
    expect(
      commands.some(
        ({ executable, args }) =>
          executable === fixtureTools.cargo && args.join(" ") === "build --release --locked",
      ),
    ).to.equal(true);
    expect(commands.some(({ executable }) => path.basename(executable) === "circom")).to.equal(
      true,
    );
    for (const { env } of commands) {
      expect(env.FIXTURE_SAFE).to.equal("preserved");
      for (const blocked of [
        "NODE_OPTIONS",
        "LD_PRELOAD",
        "NPM_CONFIG_SCRIPT_SHELL",
        "RUSTUP_TOOLCHAIN",
        "RUSTUP_HOME",
        "RUSTC_BOOTSTRAP",
        "RUSTC_LINKER",
        "RUSTC_WRAPPER",
        "RUST_PATH",
        "RUST_TARGET_PATH",
        "CC",
      ]) {
        expect(env).not.to.have.property(blocked);
      }
      expect(env.GIT_CONFIG_COUNT).to.equal("1");
      expect(env.GIT_CONFIG_KEY_0).to.equal("core.hooksPath");
      expect(env.GIT_CONFIG_VALUE_0).to.equal(path.join(temporaryRoot, "empty-git-hooks"));
      expect(env.CARGO_HOME).to.equal(path.join(temporaryRoot, "cargo-home"));
      expect(env.HOME).to.equal(path.join(temporaryRoot, "source-home"));
      expect(env.TMPDIR).to.equal(path.join(temporaryRoot, "tmp"));
      expect(env.TMP).to.equal(path.join(temporaryRoot, "tmp"));
      expect(env.TEMP).to.equal(path.join(temporaryRoot, "tmp"));
      expect(env.RUSTC).to.equal(fixtureTools.rustc);
      expect(env.PATH.split(path.delimiter)).to.include(path.dirname(fixtureTools.cargo));
      expect(env.PATH).not.to.include("node_modules");
    }
    expect(removedDirectory).to.equal(temporaryRoot);
    await expectFileMissing(temporaryRoot);
  });

  it("ignores executable PATH wrappers and resolves only protected absolute build tools", async function () {
    if (process.platform === "win32") this.skip();

    const attackerDirectory = path.join(root, "node_modules", ".bin");
    const markerDirectory = path.join(root, "path-wrapper-markers");
    await fs.mkdir(attackerDirectory, { recursive: true });
    await fs.mkdir(markerDirectory);
    for (const name of ["git", "cargo", "rustc"]) {
      const marker = path.join(markerDirectory, name);
      const wrapper = path.join(attackerDirectory, name);
      await fs.writeFile(wrapper, `#!/bin/sh\nprintf attacked > '${marker}'\nexit 0\n`, {
        mode: 0o755,
      });
      await fs.chmod(wrapper, 0o755);
    }

    const originalPath = process.env.PATH;
    process.env.PATH = attackerDirectory;
    try {
      for (const name of ["git", "cargo", "rustc"]) {
        let executable;
        try {
          executable = await resolveTrustedSourceBuildTool({ name });
        } catch (error) {
          expect(error.message).to.include(`Unable to find a trusted absolute ${name}`);
          continue;
        }
        expect(path.isAbsolute(executable)).to.equal(true);
        expect(path.dirname(executable)).not.to.equal(attackerDirectory);
        execFileSync(executable, ["--version"], {
          env: { HOME: os.userInfo().homedir, PATH: "/usr/bin:/bin" },
          stdio: "ignore",
        });
      }
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }

    for (const name of ["git", "cargo", "rustc"]) {
      await expectFileMissing(path.join(markerDirectory, name));
    }
  });

  it("keeps the source-build tool lookup fail-closed for writable Cargo directories", async function () {
    if (process.platform === "win32") this.skip();

    const trustedHome = path.join(root, "writable-cargo-home");
    const cargoDirectory = path.join(trustedHome, ".cargo");
    const cargoBinDirectory = path.join(cargoDirectory, "bin");
    const cargoExecutable = path.join(cargoBinDirectory, "cargo");
    await fs.mkdir(cargoBinDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(cargoExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.chmod(cargoExecutable, 0o755);
    await fs.chmod(cargoDirectory, 0o770);

    const error = await captureError(() =>
      resolveTrustedSourceBuildTool({ name: "cargo", homeDirectory: trustedHome }),
    );

    expect(error, "expected writable Cargo directory rejection").to.be.an("error");
    expect(error.message).to.include("must not be group- or other-writable");
    expect(error.message).to.include(cargoDirectory);
  });

  it("resolves rustup hardlink proxies before isolating HOME", async function () {
    if (process.platform === "win32") this.skip();

    const realHome = await fs.realpath(path.resolve(os.userInfo().homedir));
    const trustedHome = await fs.mkdtemp(path.join(realHome, ".deepfamily-rustup-hardlink-"));
    try {
      const proxyDirectory = path.join(trustedHome, ".cargo", "bin");
      const toolchainDirectory = path.join(trustedHome, ".rustup", "toolchains", "fixture", "bin");
      await fs.mkdir(proxyDirectory, { recursive: true, mode: 0o700 });
      await fs.mkdir(toolchainDirectory, { recursive: true, mode: 0o700 });
      const rustup = path.join(proxyDirectory, "rustup");
      const cargoProxy = path.join(proxyDirectory, "cargo");
      const rustcProxy = path.join(proxyDirectory, "rustc");
      const actualCargo = path.join(toolchainDirectory, "cargo");
      const actualRustc = path.join(toolchainDirectory, "rustc");
      await fs.writeFile(
        rustup,
        '#!/bin/sh\ncase "$1:$2" in\n  which:cargo) printf "%s\\n" "$HOME/.rustup/toolchains/fixture/bin/cargo" ;;\n  which:rustc) printf "%s\\n" "$HOME/.rustup/toolchains/fixture/bin/rustc" ;;\n  *) exit 64 ;;\nesac\n',
        { mode: 0o755 },
      );
      await fs.chmod(rustup, 0o755);
      await fs.link(rustup, cargoProxy);
      await fs.link(rustup, rustcProxy);
      for (const executable of [actualCargo, actualRustc]) {
        await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        await fs.chmod(executable, 0o755);
      }

      const [rustupState, cargoProxyState, rustcProxyState] = await Promise.all(
        [rustup, cargoProxy, rustcProxy].map((filePath) => fs.stat(filePath)),
      );
      expect(cargoProxyState.ino).to.equal(rustupState.ino);
      expect(rustcProxyState.ino).to.equal(rustupState.ino);

      expect(
        await resolveTrustedSourceBuildTool({ name: "cargo", homeDirectory: trustedHome }),
      ).to.equal(await fs.realpath(actualCargo));
      expect(
        await resolveTrustedSourceBuildTool({ name: "rustc", homeDirectory: trustedHome }),
      ).to.equal(await fs.realpath(actualRustc));
    } finally {
      await fs.rm(trustedHome, { recursive: true, force: true });
    }
  });

  it("uses a persistent user-owned base instead of the OS temporary directory by default", async function () {
    const sentinel = new Error("stop after observing the source-build base");
    let observedBaseDirectory;

    const error = await captureError(() =>
      buildPinnedCircomFromSource({
        target: CIRCOM_TARGETS["darwin-arm64"],
        temporaryDirectoryFactory: async ({ baseDirectory }) => {
          observedBaseDirectory = baseDirectory;
          throw sentinel;
        },
      }),
    );

    expect(error).to.equal(sentinel);
    expect(observedBaseDirectory).to.equal(
      path.join(
        await fs.realpath(path.resolve(os.userInfo().homedir)),
        ".deepfamily",
        "circom-source-builds",
      ),
    );
    expect(observedBaseDirectory).to.not.equal(os.tmpdir());
  });

  it("rejects a source-build base with a group-writable POSIX ancestor", async function () {
    if (process.platform === "win32") this.skip();

    const unsafeAncestor = path.join(root, "group-writable-source-parent");
    const configuredBase = path.join(unsafeAncestor, "source-builds");
    await fs.mkdir(unsafeAncestor, { mode: 0o700 });
    await fs.chmod(unsafeAncestor, 0o770);
    let commands = 0;

    const error = await captureError(() =>
      buildPinnedCircomFromSource({
        target: CIRCOM_TARGETS["darwin-arm64"],
        sourceBuildBaseDirectory: configuredBase,
        commandRunner: async () => {
          commands += 1;
        },
      }),
    );

    expect(error, "expected writable ancestor rejection").to.be.an("error");
    expect(error.message).to.include("must not be group- or other-writable");
    expect(error.message).to.include(unsafeAncestor);
    expect(commands).to.equal(0);
  });

  for (const cargoConfigName of ["config", "config.toml"]) {
    it(`rejects an ancestor .cargo/${cargoConfigName} outside the source checkout`, async function () {
      const configuredBase = path.join(root, `cargo-${cargoConfigName.replace(".", "-")}-base`);
      const temporaryRoot = path.join(configuredBase, "private-source-build");
      const cargoConfigPath = path.join(root, ".cargo", cargoConfigName);
      await fs.mkdir(path.dirname(cargoConfigPath), { recursive: true, mode: 0o700 });
      await fs.writeFile(cargoConfigPath, "[build]\nrustc-wrapper = '/untrusted/wrapper'\n");
      await fs.mkdir(configuredBase, { mode: 0o700 });
      let commands = 0;
      let removedDirectory;

      const error = await captureError(() =>
        buildPinnedCircomFromSource({
          target: CIRCOM_TARGETS["darwin-arm64"],
          sourceBuildBaseDirectory: configuredBase,
          temporaryDirectoryFactory: async () => {
            await fs.mkdir(temporaryRoot, { mode: 0o700 });
            return temporaryRoot;
          },
          temporaryDirectoryRemover: async (directory) => {
            removedDirectory = directory;
            await fs.rm(directory, { recursive: true, force: true });
          },
          commandRunner: async () => {
            commands += 1;
          },
        }),
      );

      expect(error, "expected ancestor Cargo config rejection").to.be.an("error");
      expect(error.message).to.include("Cargo configuration outside its source directory");
      expect(error.message).to.include(cargoConfigPath);
      expect(commands).to.equal(0);
      expect(removedDirectory).to.equal(temporaryRoot);
      await expectFileMissing(temporaryRoot);
    });
  }

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
    expectRegularFileWithPosixMode(await fs.lstat(installed), 0o755);
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

  it("repairs the POSIX executable mode before validating a reused compiler version", async function () {
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
        expectRegularFileWithPosixMode(fsSync.lstatSync(executable), 0o755);
        return expectedVersionOutput;
      },
    });

    expect(result.status).to.equal("already-installed");
    expectRegularFileWithPosixMode(await fs.lstat(installed), 0o755);
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
    expectRegularFileWithPosixMode(await fs.lstat(installed), 0o755);
    expectRegularFileWithPosixMode(await fs.lstat(provenancePath), 0o644);
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

  it("rejects Linux x64 musl when inspecting a local compiler", async function () {
    const error = await captureError(() =>
      assertLocalCircomInstallation({
        root,
        platform: "linux",
        arch: "x64",
        libc: "musl",
        versionRunner: () => expectedVersionOutput,
      }),
    );

    expect(error, "expected unsupported musl rejection").to.be.an("error");
    expect(error.message).to.equal(
      "Unsupported Linux libc musl; the supported Linux runtime is x64 with glibc",
    );
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
