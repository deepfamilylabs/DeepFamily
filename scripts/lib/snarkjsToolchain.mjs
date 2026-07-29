import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const SNARKJS_CLI_PATH = "node_modules/snarkjs/build/cli.cjs";
const SNARKJS_RUNTIME_PACKAGE = "snarkjs";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const PACKAGE_DIGEST_DOMAIN = "deepfamily:snarkjs-package-content:v1\n";
const RUNTIME_DIGEST_DOMAIN = "deepfamily:snarkjs-runtime-graph:v2\n";

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const readPackageManifest = (packageRoot) => {
  const manifestPath = path.join(packageRoot, "package.json");
  const state = fs.lstatSync(manifestPath);
  if (!state.isFile() || state.isSymbolicLink()) {
    throw new Error(`snarkjs runtime package manifest must be a regular file: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    typeof manifest.name !== "string" ||
    manifest.name === "" ||
    typeof manifest.version !== "string" ||
    manifest.version === ""
  ) {
    throw new Error(`snarkjs runtime package manifest is invalid: ${manifestPath}`);
  }
  return manifest;
};

const assertResolutionPathHasNoSymlinks = ({ candidate, nodeModulesRoot }) => {
  const relative = path.relative(nodeModulesRoot, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`snarkjs runtime package escapes node_modules: ${candidate}`);
  }
  let current = nodeModulesRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`snarkjs runtime package paths must not use symbolic links: ${current}`);
    }
  }
};

const resolvePackageRoot = ({ packageName, fromDirectory, nodeModulesRoot }) => {
  const resolver = createRequire(path.join(fromDirectory, "__deepfamily_snarkjs_resolver__.cjs"));
  let current = path.dirname(resolver.resolve(packageName));
  while (isInside(nodeModulesRoot, current) || current === nodeModulesRoot) {
    const manifestPath = path.join(current, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = readPackageManifest(current);
      if (manifest.name === packageName) {
        const resolved = fs.realpathSync(current);
        if (!isInside(nodeModulesRoot, resolved)) {
          throw new Error(`snarkjs runtime package escapes node_modules: ${packageName}`);
        }
        const resolutionCandidate = (resolver.resolve.paths(packageName) ?? [])
          .map((searchRoot) => path.join(searchRoot, ...packageName.split("/")))
          .find((candidate) => fs.existsSync(candidate) && fs.realpathSync(candidate) === resolved);
        if (resolutionCandidate === undefined) {
          throw new Error(`Unable to bind snarkjs runtime package path: ${packageName}`);
        }
        assertResolutionPathHasNoSymlinks({
          candidate: resolutionCandidate,
          nodeModulesRoot,
        });
        return resolved;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to resolve snarkjs runtime package root: ${packageName}`);
};

const listPackageFiles = (packageRoot) => {
  const files = [];
  const visit = (directory, relativeDirectory = "") => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name === "node_modules") continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const state = fs.lstatSync(absolutePath);
      if (state.isSymbolicLink()) {
        throw new Error(
          `snarkjs runtime packages must not contain symbolic links: ${absolutePath}`,
        );
      }
      if (state.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (state.isFile()) {
        files.push(Object.freeze({ absolutePath, relativePath }));
      } else {
        throw new Error(`snarkjs runtime packages must contain only files: ${absolutePath}`);
      }
    }
  };
  visit(packageRoot);
  return files;
};

const digestPackageContent = ({ packageRoot, manifest }) => {
  const hash = createHash("sha256");
  hash.update(PACKAGE_DIGEST_DOMAIN);
  hash.update(`${JSON.stringify([manifest.name, manifest.version])}\n`);
  for (const file of listPackageFiles(packageRoot)) {
    const bytes = fs.readFileSync(file.absolutePath);
    hash.update(`${Buffer.byteLength(file.relativePath)}:${file.relativePath}:${bytes.length}:`);
    hash.update(bytes);
    hash.update("\n");
  }
  return hash.digest("hex");
};

export const inspectSnarkjsRuntime = ({ root = process.cwd() } = {}) => {
  const resolvedRoot = fs.realpathSync(path.resolve(root));
  const nodeModulesPath = path.join(resolvedRoot, "node_modules");
  const nodeModulesState = fs.lstatSync(nodeModulesPath);
  if (!nodeModulesState.isDirectory() || nodeModulesState.isSymbolicLink()) {
    throw new Error("snarkjs runtime node_modules must be a real directory");
  }
  const nodeModulesRoot = fs.realpathSync(nodeModulesPath);
  const pending = [
    {
      packageName: SNARKJS_RUNTIME_PACKAGE,
      fromDirectory: resolvedRoot,
      logicalPath: Object.freeze([SNARKJS_RUNTIME_PACKAGE]),
      ancestors: Object.freeze([]),
    },
  ];
  const packageContent = new Map();
  const records = [];

  while (pending.length > 0) {
    const request = pending.pop();
    const packageRoot = resolvePackageRoot({ ...request, nodeModulesRoot });
    if (request.ancestors.includes(packageRoot)) {
      throw new Error(
        `snarkjs runtime dependency graph contains a cycle at ${request.logicalPath.join(" -> ")}`,
      );
    }

    const rootState = fs.lstatSync(packageRoot);
    if (!rootState.isDirectory() || rootState.isSymbolicLink()) {
      throw new Error(`snarkjs runtime package root must be a real directory: ${packageRoot}`);
    }
    let content = packageContent.get(packageRoot);
    if (content === undefined) {
      const manifest = readPackageManifest(packageRoot);
      content = Object.freeze({
        manifest,
        sha256: digestPackageContent({ packageRoot, manifest }),
      });
      packageContent.set(packageRoot, content);
    }
    const { manifest, sha256 } = content;
    records.push(
      Object.freeze({
        logicalPath: request.logicalPath,
        name: manifest.name,
        version: manifest.version,
        sha256,
      }),
    );
    const ancestors = Object.freeze([...request.ancestors, packageRoot]);
    for (const dependency of Object.keys(manifest.dependencies ?? {})
      .sort()
      .reverse()) {
      pending.push({
        packageName: dependency,
        fromDirectory: packageRoot,
        logicalPath: Object.freeze([...request.logicalPath, dependency]),
        ancestors,
      });
    }
  }

  if (records.length === 0) {
    throw new Error("Unable to resolve the snarkjs runtime root package");
  }
  const sortedRecords = [...records].sort((left, right) =>
    JSON.stringify(left.logicalPath) < JSON.stringify(right.logicalPath)
      ? -1
      : JSON.stringify(left.logicalPath) > JSON.stringify(right.logicalPath)
        ? 1
        : 0,
  );
  const closureHash = createHash("sha256");
  closureHash.update(RUNTIME_DIGEST_DOMAIN);
  for (const record of sortedRecords) {
    closureHash.update(
      `${JSON.stringify([
        "package",
        record.logicalPath,
        record.name,
        record.version,
        record.sha256,
      ])}\n`,
    );
  }
  const instances = [...packageContent.entries()]
    .map(([sourcePath, { manifest, sha256 }]) =>
      Object.freeze({
        sourcePath,
        relativePath: path.relative(nodeModulesRoot, sourcePath).split(path.sep).join("/"),
        name: manifest.name,
        version: manifest.version,
        sha256,
      }),
    )
    .sort((left, right) =>
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
    );
  return Object.freeze({
    sha256: closureHash.digest("hex"),
    packages: Object.freeze(sortedRecords),
    instances: Object.freeze(instances),
  });
};

export const assertSnarkjsRuntimeHash = ({ root = process.cwd(), expectedSha256 } = {}) => {
  if (typeof expectedSha256 !== "string" || !SHA256_PATTERN.test(expectedSha256)) {
    throw new Error("Expected snarkjs runtime SHA-256 must be a lowercase digest");
  }
  const evidence = inspectSnarkjsRuntime({ root });
  if (evidence.sha256 !== expectedSha256) {
    throw new Error(
      `Installed snarkjs runtime SHA-256 mismatch; expected ${expectedSha256}, ` +
        `got ${evidence.sha256}`,
    );
  }
  return evidence;
};

const copyPackageContent = ({ sourceRoot, destinationRoot }) => {
  fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
  for (const file of listPackageFiles(sourceRoot)) {
    const destination = path.join(destinationRoot, ...file.relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.copyFileSync(file.absolutePath, destination, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(destination, 0o600);
  }
};

export const snapshotSnarkjsRuntime = ({
  root = process.cwd(),
  destinationRoot,
  expectedSha256,
  platform = process.platform,
} = {}) => {
  if (typeof destinationRoot !== "string" || !path.isAbsolute(destinationRoot)) {
    throw new Error("snarkjs runtime snapshot destination must be an absolute path");
  }
  const resolvedDestination = path.resolve(destinationRoot);
  const destinationParent = path.dirname(resolvedDestination);
  if (fs.realpathSync(destinationParent) !== destinationParent) {
    throw new Error("snarkjs runtime snapshot destination must not traverse a symbolic link");
  }
  const sourceEvidence = assertSnarkjsRuntimeHash({ root, expectedSha256 });
  fs.mkdirSync(resolvedDestination, { mode: 0o700 });
  const destinationNodeModules = path.join(resolvedDestination, "node_modules");
  fs.mkdirSync(destinationNodeModules, { mode: 0o700 });
  try {
    for (const instance of sourceEvidence.instances) {
      copyPackageContent({
        sourceRoot: instance.sourcePath,
        destinationRoot: path.join(destinationNodeModules, ...instance.relativePath.split("/")),
      });
    }
    const snapshotEvidence = assertSnarkjsRuntimeHash({
      root: resolvedDestination,
      expectedSha256,
    });
    if (platform !== "win32") {
      for (const instance of snapshotEvidence.instances) {
        for (const file of listPackageFiles(instance.sourcePath)) {
          fs.chmodSync(file.absolutePath, 0o400);
        }
      }
    }
    return Object.freeze({
      root: resolvedDestination,
      sha256: snapshotEvidence.sha256,
      packages: snapshotEvidence.packages,
    });
  } catch (error) {
    fs.rmSync(resolvedDestination, { recursive: true, force: true });
    throw error;
  }
};

export const resolveSnarkjsCliPath = ({ root = process.cwd() } = {}) =>
  path.join(path.resolve(root), ...SNARKJS_CLI_PATH.split("/"));

export const buildSnarkjsCommand = ({
  root = process.cwd(),
  args,
  cwd = path.resolve(root),
} = {}) => {
  if (!Array.isArray(args)) {
    throw new TypeError("snarkjs command args must be an array");
  }
  return Object.freeze({
    executable: process.execPath,
    args: Object.freeze([resolveSnarkjsCliPath({ root }), ...args]),
    cwd,
  });
};
