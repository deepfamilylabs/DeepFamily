import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectSnarkjsRuntime, snapshotSnarkjsRuntime } from "../scripts/lib/snarkjsToolchain.mjs";

const writePackage = async ({ root, relativePath, name, version, dependencies = {} }) => {
  const packageRoot = path.join(root, "node_modules", ...relativePath.split("/"));
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name,
        version,
        main: "index.cjs",
        dependencies,
      },
      null,
      2,
    )}\n`,
  );
  await fs.writeFile(
    path.join(packageRoot, "index.cjs"),
    `module.exports = ${JSON.stringify(`${name}@${version}`)};\n`,
  );
  return packageRoot;
};

const createRuntimeFixture = async ({ sharedLayout = "nested", versions = ["1.0.0", "1.0.0"] }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-snarkjs-runtime-"));
  await writePackage({
    root,
    relativePath: "snarkjs",
    name: "snarkjs",
    version: "0.7.5",
    dependencies: { "branch-a": "*", "branch-b": "*" },
  });
  for (const branch of ["branch-a", "branch-b"]) {
    await writePackage({
      root,
      relativePath: branch,
      name: branch,
      version: "1.0.0",
      dependencies: { shared: "*" },
    });
  }
  if (sharedLayout === "hoisted") {
    await writePackage({
      root,
      relativePath: "shared",
      name: "shared",
      version: versions[0],
    });
  } else {
    await writePackage({
      root,
      relativePath: "branch-a/node_modules/shared",
      name: "shared",
      version: versions[0],
    });
    await writePackage({
      root,
      relativePath: "branch-b/node_modules/shared",
      name: "shared",
      version: versions[1],
    });
  }
  return root;
};

describe("snarkjs runtime graph digest", function () {
  const temporaryRoots = [];

  afterEach(async function () {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    );
  });

  it("binds each logical dependency edge even when the package-content set is unchanged", async function () {
    const root = await createRuntimeFixture({ versions: ["1.0.0", "2.0.0"] });
    temporaryRoots.push(root);
    const before = inspectSnarkjsRuntime({ root });
    const branchA = path.join(root, "node_modules", "branch-a", "node_modules", "shared");
    const branchB = path.join(root, "node_modules", "branch-b", "node_modules", "shared");
    const temporary = path.join(root, "node_modules", "shared.swap");

    await fs.rename(branchA, temporary);
    await fs.rename(branchB, branchA);
    await fs.rename(temporary, branchB);

    const after = inspectSnarkjsRuntime({ root });
    expect(after.sha256).not.to.equal(before.sha256);
    expect(
      before.packages.find(({ logicalPath }) => logicalPath.join("/") === "snarkjs/branch-a/shared")
        ?.version,
    ).to.equal("1.0.0");
    expect(
      after.packages.find(({ logicalPath }) => logicalPath.join("/") === "snarkjs/branch-a/shared")
        ?.version,
    ).to.equal("2.0.0");
  });

  it("is stable across absolute roots and equivalent npm hoisting layouts", async function () {
    const nestedRoot = await createRuntimeFixture({ sharedLayout: "nested" });
    const hoistedRoot = await createRuntimeFixture({ sharedLayout: "hoisted" });
    temporaryRoots.push(nestedRoot, hoistedRoot);

    expect(inspectSnarkjsRuntime({ root: nestedRoot }).sha256).to.equal(
      inspectSnarkjsRuntime({ root: hoistedRoot }).sha256,
    );
  });

  it("copies the reviewed closure to an independent runtime snapshot", async function () {
    const root = await createRuntimeFixture({ versions: ["1.0.0", "2.0.0"] });
    temporaryRoots.push(root);
    const expected = inspectSnarkjsRuntime({ root }).sha256;
    const canonicalRoot = await fs.realpath(root);
    const destinationRoot = path.join(canonicalRoot, "reviewed-runtime");
    const snapshot = snapshotSnarkjsRuntime({
      root,
      destinationRoot,
      expectedSha256: expected,
    });

    await fs.writeFile(
      path.join(root, "node_modules", "branch-a", "node_modules", "shared", "index.cjs"),
      "module.exports = 'tampered';\n",
    );

    expect(snapshot.root).to.equal(destinationRoot);
    expect(inspectSnarkjsRuntime({ root: destinationRoot }).sha256).to.equal(expected);
    expect(inspectSnarkjsRuntime({ root }).sha256).not.to.equal(expected);
  });
});
