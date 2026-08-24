import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const hardenPrivateWindowsPath = ({
  targetPath,
  entryType,
  powershellRunner = execFileSync,
} = {}) => {
  if (typeof targetPath !== "string" || !path.isAbsolute(targetPath)) {
    throw new Error("Windows private ACL target must be an absolute path");
  }
  if (!["directory", "file"].includes(entryType) || typeof powershellRunner !== "function") {
    throw new Error("Windows private ACL entry type or runner is invalid");
  }
  const targetEnvironmentName = "DEEPFAMILY_PRIVATE_ACL_TARGET";
  const powershellEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== targetEnvironmentName),
  );
  powershellEnvironment[targetEnvironmentName] = targetPath;
  const entryClass = entryType === "directory" ? "DirectoryInfo" : "FileInfo";
  const securityClass = entryType === "directory" ? "DirectorySecurity" : "FileSecurity";
  const inheritanceExpression =
    entryType === "directory"
      ? "[System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'"
      : "[System.Security.AccessControl.InheritanceFlags]::None";
  const script = `
$ErrorActionPreference = 'Stop'
$target = [System.Environment]::GetEnvironmentVariable('${targetEnvironmentName}', 'Process')
if ([string]::IsNullOrEmpty($target)) {
  throw 'Private ACL target environment is unavailable'
}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$entry = [System.IO.${entryClass}]::new($target)
$acl = [System.Security.AccessControl.${securityClass}]::new()
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner($sid)
$inheritance = ${inheritanceExpression}
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$rights = [System.Security.AccessControl.FileSystemRights]::FullControl
$type = [System.Security.AccessControl.AccessControlType]::Allow
$privateRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $sid, $rights, $inheritance, $propagation, $type
)
[void]$acl.AddAccessRule($privateRule)
$entry.SetAccessControl($acl)
$verified = $entry.GetAccessControl([System.Security.AccessControl.AccessControlSections]::All)
$owner = $verified.GetOwner([System.Security.Principal.SecurityIdentifier])
$allow = @($verified.Access | Where-Object { $_.AccessControlType -eq 'Allow' })
$deny = @($verified.Access | Where-Object { $_.AccessControlType -eq 'Deny' })
if (
  $owner.Value -ne $sid.Value -or
  -not $verified.AreAccessRulesProtected -or
  $allow.Count -ne 1 -or
  $deny.Count -ne 0
) {
  throw 'Private temporary directory ACL owner or allow-list is invalid'
}
$rule = $allow[0]
$ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])
if (
  $ruleSid.Value -ne $sid.Value -or
  $rule.IsInherited -or
  $rule.InheritanceFlags -ne $inheritance -or
  $rule.PropagationFlags -ne $propagation -or
  (($rule.FileSystemRights -band $rights) -ne $rights)
) {
  throw 'Private path ACL is not exclusive to the current user'
}
`;
  powershellRunner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: powershellEnvironment,
    windowsHide: true,
  });
};

const defaultWindowsAclRunner = ({ directory }) =>
  hardenPrivateWindowsPath({ targetPath: directory, entryType: "directory" });

export const createPrivateTemporaryDirectory = async ({
  prefix,
  baseDirectory = os.tmpdir(),
  platform = process.platform,
  windowsAclRunner = defaultWindowsAclRunner,
} = {}) => {
  if (
    typeof prefix !== "string" ||
    prefix.length < 3 ||
    path.basename(prefix) !== prefix ||
    prefix.includes(path.sep)
  ) {
    throw new Error("Private temporary directory prefix must be a safe basename");
  }
  if (platform === "win32" && typeof windowsAclRunner !== "function") {
    throw new Error("Windows private temporary directory ACL runner must be a function");
  }
  const canonicalBase = await fs.realpath(path.resolve(baseDirectory));
  const directory = await fs.mkdtemp(path.join(canonicalBase, prefix));
  try {
    if ((await fs.realpath(directory)) !== path.resolve(directory)) {
      throw new Error("Private temporary directory must not traverse a symbolic link");
    }
    await fs.chmod(directory, 0o700);
    if (platform === "win32") {
      await windowsAclRunner({ directory });
    } else {
      const state = await fs.lstat(directory);
      if (!state.isDirectory() || state.isSymbolicLink() || (state.mode & 0o777) !== 0o700) {
        throw new Error("Private temporary directory POSIX permissions are invalid");
      }
      if (typeof process.getuid === "function" && state.uid !== process.getuid()) {
        throw new Error("Private temporary directory is not owned by the current user");
      }
    }
    return directory;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
};
