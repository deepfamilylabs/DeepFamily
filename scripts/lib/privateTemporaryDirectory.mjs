import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const defaultWindowsAclRunner = ({ directory }) => {
  const quotedPath = directory.replaceAll("'", "''");
  const script = `
$ErrorActionPreference = 'Stop'
$target = '${quotedPath}'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$acl = Get-Acl -LiteralPath $target
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) {
  [void]$acl.RemoveAccessRuleAll($rule)
}
$acl.SetOwner($sid)
$inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagation = [System.Security.AccessControl.PropagationFlags]::None
$rights = [System.Security.AccessControl.FileSystemRights]::FullControl
$type = [System.Security.AccessControl.AccessControlType]::Allow
$privateRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $sid, $rights, $inheritance, $propagation, $type
)
[void]$acl.AddAccessRule($privateRule)
Set-Acl -LiteralPath $target -AclObject $acl
$verified = Get-Acl -LiteralPath $target
$owner = $verified.GetOwner([System.Security.Principal.SecurityIdentifier])
$allow = @($verified.Access | Where-Object { $_.AccessControlType -eq 'Allow' })
if ($owner.Value -ne $sid.Value -or $allow.Count -ne 1) {
  throw 'Private temporary directory ACL owner or allow-list is invalid'
}
$rule = $allow[0]
$ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier])
if (
  $ruleSid.Value -ne $sid.Value -or
  $rule.IsInherited -or
  (($rule.FileSystemRights -band $rights) -ne $rights)
) {
  throw 'Private temporary directory ACL is not exclusive to the current user'
}
`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });
};

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
