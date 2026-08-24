import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

describe("macOS CI Rust trust boundary", function () {
  it("bootstraps a pinned toolchain under the protected runner home before zk:fetch", async function () {
    const workflow = await fs.readFile(path.resolve(".github/workflows/ci.yml"), "utf8");
    const nativeJob = workflow.slice(workflow.indexOf("  zk-native-platforms:"));
    const bootstrapStart = nativeJob.indexOf(
      "      - name: Install protected Rust toolchain for macOS source builds",
    );
    const dependencyInstallStart = nativeJob.indexOf(
      "      - name: Install dependencies",
      bootstrapStart,
    );
    const fetchStart = nativeJob.indexOf(
      "      - name: Install native and canonical Circom compilers",
      dependencyInstallStart,
    );
    const bootstrap = nativeJob.slice(bootstrapStart, dependencyInstallStart);

    expect(bootstrapStart).to.be.greaterThan(-1);
    expect(dependencyInstallStart).to.be.greaterThan(bootstrapStart);
    expect(fetchStart).to.be.greaterThan(dependencyInstallStart);
    expect(bootstrap).to.include("if: matrix.name == 'macos-arm64'");
    expect(bootstrap).to.include('DEEPFAMILY_RUSTUP_VERSION: "1.28.2"');
    expect(bootstrap).to.include(
      'DEEPFAMILY_RUSTUP_INIT_SHA256: "20ef5516c31b1ac2290084199ba77dbbcaa1406c45c1d978ca68558ef5964ef5"',
    );
    expect(bootstrap).to.include('DEEPFAMILY_RUST_TOOLCHAIN: "1.89.0"');
    expect(bootstrap).to.include(
      "rustup/archive/${DEEPFAMILY_RUSTUP_VERSION}/aarch64-apple-darwin/rustup-init",
    );
    expect(bootstrap).to.include(
      'if [[ "$deepfamily_actual_sha256" != "$DEEPFAMILY_RUSTUP_INIT_SHA256" ]]',
    );
    expect(bootstrap).to.include("env -i");
    expect(bootstrap).to.include('CARGO_HOME="$HOME/.cargo"');
    expect(bootstrap).to.include('RUSTUP_HOME="$HOME/.rustup"');
    expect(bootstrap).to.include("umask 077");
    expect(bootstrap).to.include('if [[ -L "$deepfamily_directory" ]]');
    expect(bootstrap).to.include('"$HOME/.cargo/bin"');
    expect(bootstrap).to.include('"$HOME/.rustup"');
    expect(bootstrap).not.to.include("/opt/homebrew");
  });
});
