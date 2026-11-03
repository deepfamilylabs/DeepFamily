import fs from "node:fs";
import path from "node:path";

const candidatesForHost = (platform) =>
  platform === "win32"
    ? [...new Set([path.parse(process.execPath).root, "C:\\"])]
        .filter((driveRoot) => driveRoot !== "")
        .map((driveRoot) => path.join(driveRoot, "Program Files", "Git", "cmd", "git.exe"))
    : ["/usr/bin/git", "/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"];

const assertProtectedDirectory = (directory, label) => {
  if (process.platform === "win32") return;
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  for (let ancestor = directory; ; ancestor = path.dirname(ancestor)) {
    const state = fs.lstatSync(ancestor);
    if (!state.isDirectory() || state.isSymbolicLink()) {
      throw new Error(label + " must not traverse a symbolic-link directory: " + ancestor);
    }
    if ((state.mode & 0o022) !== 0) {
      throw new Error(label + " directory must not be group- or other-writable: " + ancestor);
    }
    if (currentUid !== null && state.uid !== 0 && state.uid !== currentUid) {
      throw new Error(label + " directory has an untrusted owner: " + ancestor);
    }
    if (path.dirname(ancestor) === ancestor) return;
  }
};

/**
 * Resolve Git without PATH, using the same protected system locations for both synchronous
 * source checks and asynchronous setup/source-build orchestration. No executable is run here.
 */
export function resolveTrustedGitExecutable({ platform = process.platform } = {}) {
  const label = "Trusted Circom source-build git";
  for (const candidate of candidatesForHost(platform)) {
    if (!path.isAbsolute(candidate)) throw new Error(label + " path must be absolute");
    let canonical;
    try {
      canonical = fs.realpathSync(candidate);
      const state = fs.statSync(canonical);
      if (!state.isFile() || (process.platform !== "win32" && (state.mode & 0o022) !== 0)) {
        throw new Error("not a protected regular file: " + candidate);
      }
      fs.accessSync(candidate, fs.constants.X_OK);
      assertProtectedDirectory(fs.realpathSync(path.dirname(candidate)), label);
      assertProtectedDirectory(path.dirname(canonical), label + " target");
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "EACCES") continue;
      throw error;
    }
    if (
      path
        .basename(canonical)
        .replace(/\.exe$/iu, "")
        .toLowerCase() !== "git"
    ) {
      throw new Error(label + " resolves to unexpected executable " + canonical);
    }
    return canonical;
  }
  throw new Error(
    "Unable to find a trusted absolute git executable for the Circom source build; " +
      "install it in a protected system directory",
  );
}
