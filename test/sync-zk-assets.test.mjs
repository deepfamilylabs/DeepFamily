import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FILES_TO_COPY, syncZkAssets } from "../circuits/sync-zk-assets.mjs";

const createOutput = () => {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    output: {
      log: (line) => stdout.push(line),
      error: (line) => stderr.push(line),
    },
  };
};

const populateArtifacts = async (sourceDirectory) => {
  for (const entry of FILES_TO_COPY) {
    const sourcePath = path.join(sourceDirectory, entry.source);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, `exact:${entry.source}`, "utf8");
  }
};

describe("ZK frontend artifact synchronization", function () {
  const temporaryDirectories = [];

  afterEach(async function () {
    while (temporaryDirectories.length > 0) {
      await fs.rm(temporaryDirectories.pop(), { recursive: true, force: true });
    }
  });

  const createFixture = async () => {
    const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-zk-sync-"));
    temporaryDirectories.push(fixtureRoot);
    const sourceDirectory = path.join(fixtureRoot, "artifacts");
    const destinationDirectory = path.join(fixtureRoot, "public", "zk");
    await populateArtifacts(sourceDirectory);
    return { sourceDirectory, destinationDirectory };
  };

  it("copies only the declared artifact paths into their declared destinations", async function () {
    const { sourceDirectory, destinationDirectory } = await createFixture();
    await fs.writeFile(path.join(sourceDirectory, "disclosure_binding.wasm"), "decoy", "utf8");
    await fs.writeFile(path.join(sourceDirectory, "person_commitment.wasm"), "decoy", "utf8");
    const { output, stderr } = createOutput();

    const result = await syncZkAssets({ sourceDirectory, destinationDirectory, output });

    expect(result).to.deep.equal({ exitCode: 0, failedFiles: [] });
    expect(stderr).to.deep.equal([]);
    for (const entry of FILES_TO_COPY) {
      expect(
        await fs.readFile(path.join(destinationDirectory, entry.destination), "utf8"),
      ).to.equal(`exact:${entry.source}`);
    }
  });

  it("fails closed when an exact artifact is missing even if a same-named decoy exists", async function () {
    const { sourceDirectory, destinationDirectory } = await createFixture();
    const missingSource = path.join(
      sourceDirectory,
      "person_commitment_js",
      "person_commitment.wasm",
    );
    await fs.rm(missingSource);
    await fs.writeFile(path.join(sourceDirectory, "person_commitment.wasm"), "decoy", "utf8");
    const { output, stderr } = createOutput();

    const result = await syncZkAssets({ sourceDirectory, destinationDirectory, output });

    expect(result.exitCode).to.equal(1);
    expect(result.failedFiles).to.deep.equal([missingSource]);
    expect(stderr).to.include(`Missing artifact: ${missingSource}`);
    let accessError;
    try {
      await fs.access(path.join(destinationDirectory, "person_commitment.wasm"));
    } catch (error) {
      accessError = error;
    }
    expect(accessError).to.include({ code: "ENOENT" });
  });

  it("fails closed and identifies the declared artifact when copying fails", async function () {
    const { sourceDirectory, destinationDirectory } = await createFixture();
    const failedSource = path.join(sourceDirectory, "person_commitment_final.zkey");
    const { output, stderr } = createOutput();

    const result = await syncZkAssets({
      sourceDirectory,
      destinationDirectory,
      output,
      copyArtifact: async (sourcePath, destinationPath) => {
        if (sourcePath === failedSource) {
          throw new Error("simulated copy failure");
        }
        await fs.copyFile(sourcePath, destinationPath);
      },
    });

    expect(result.exitCode).to.equal(1);
    expect(result.failedFiles).to.deep.equal([failedSource]);
    expect(stderr).to.include(
      "Failed to copy person_commitment_final.zkey: simulated copy failure",
    );
  });

  it("fails closed instead of implicitly generating a missing verification key", async function () {
    const { sourceDirectory, destinationDirectory } = await createFixture();
    const failedSource = path.join(sourceDirectory, "disclosure_binding.vkey.json");
    await fs.rm(failedSource);
    const { output, stderr } = createOutput();
    let copyCount = 0;

    const result = await syncZkAssets({
      sourceDirectory,
      destinationDirectory,
      output,
      copyArtifact: async () => {
        copyCount += 1;
      },
    });

    expect(result.exitCode).to.equal(1);
    expect(result.failedFiles).to.deep.equal([failedSource]);
    expect(stderr).to.include(`Missing artifact: ${failedSource}`);
    expect(stderr).to.include("Refusing to partially synchronize incomplete circuit artifacts.");
    expect(copyCount).to.equal(0);
    let accessError;
    try {
      await fs.access(destinationDirectory);
    } catch (error) {
      accessError = error;
    }
    expect(accessError).to.include({ code: "ENOENT" });
  });
});
