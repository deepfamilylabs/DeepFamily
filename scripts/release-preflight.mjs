#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { inspectProtocolProductionArtifacts } from "./lib/protocolProductionArtifacts.mjs";
import { inspectProtocolReleaseManifest } from "./lib/protocolReleaseManifest.mjs";
import { inspectZkReleaseArtifacts } from "./lib/zkArtifactTrust.mjs";
import { assertLocalCircomInstallation, buildPinnedCircomFromSource, resolveTrustedSourceBuildTool } from "./fetch-circom.mjs";
import { assertReleaseRuntimeCompatibility, normalizePortableCommand, sanitizeReleaseEnvironment } from "./lib/portableCommand.mjs";
import { buildCircomOverrideEnvironment, withoutCircomOverrideEnvironment } from "./lib/circomCompilerOverride.mjs";
import { resolveLocalCircomTarget } from "./lib/circomToolchain.mjs";
import { createPrivateTemporaryDirectory } from "./lib/privateTemporaryDirectory.mjs";
import { buildProductionCompilerEvidence, preparePrivateProductionCompiler } from "./lib/productionCompiler.mjs";

export const RELEASE_PREFLIGHT_COMMANDS = Object.freeze([
  Object.freeze(["npm", ["run", "clean"]]),
  Object.freeze(["npm", ["run", "contracts:check"]]),
  Object.freeze(["npm", ["run", "frontend:check"]]),
  Object.freeze(["npm", ["run", "zk:check"]]),
  Object.freeze(["npm", ["run", "security:audit"]]),
]);
export const defaultRunner = ({ executable, args, cwd, env = process.env, capture = false, platform = process.platform }) => {
  const command=normalizePortableCommand({executable,args,platform,env});
  return execFileSync(command.executable,command.args,{cwd,env,encoding:capture?"utf8":undefined,stdio:capture?["ignore","pipe","pipe"]:"inherit"});
};
function cleanGitState({root,runner,env,gitExecutable}) {
  const run=args=>String(runner({executable:gitExecutable,args,cwd:root,env,capture:true})).trim();
  const commit=run(["rev-parse","HEAD"]), status=run(["status","--porcelain=v1","--untracked-files=all"]);
  if(!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("Release preflight Git commit is unavailable");
  if(status!=="") throw new Error("Release preflight requires a clean Git working tree");
  return commit;
}
/** Public release validation authenticates keys before running any release command. */
export async function runReleaseChecks({root=process.cwd(),env=process.env,platform=process.platform,arch=process.arch,libc,report,runner=defaultRunner}={}) {
  if(typeof runner!=="function") throw new Error("runner must be a function");
  // No development manifest can substitute for the reviewed complete relation graph.
  const production=inspectProtocolProductionArtifacts({root});
  assertReleaseRuntimeCompatibility({platform,arch,env,operation:"Release preflight"});
  const baseEnvironment=withoutCircomOverrideEnvironment(sanitizeReleaseEnvironment(env));
  const gitExecutable=await resolveTrustedSourceBuildTool({name:"git"});
  const releaseCommit=cleanGitState({root,runner,env:baseEnvironment,gitExecutable});
  const protocol=inspectProtocolReleaseManifest({root,requireProduction:true});
  const identity=inspectZkReleaseArtifacts({root,requireProduction:true,requireBuiltR1cs:false});
  const target=resolveLocalCircomTarget({platform,arch,libc,report});
  let stage;
  try {
    let compiler;
    if(target.strategy==="pinned-source") {
      stage=await createPrivateTemporaryDirectory({prefix:"deepfamily-preflight-compiler-"});
      compiler=await preparePrivateProductionCompiler({target,stageRoot:stage,sourceBuilder:buildPinnedCircomFromSource,sourceEnvironment:baseEnvironment});
    } else compiler=await assertLocalCircomInstallation({root,platform,arch,libc,report});
    buildProductionCompilerEvidence({compiler,platform,arch});
    const commandEnvironment=target.strategy==="pinned-source"?buildCircomOverrideEnvironment({env:baseEnvironment,compiler}):baseEnvironment;
    for(const[executable,args]of RELEASE_PREFLIGHT_COMMANDS)
      await runner({executable,args,cwd:root,env:commandEnvironment,capture:false,platform});
    const finalProduction=inspectProtocolProductionArtifacts({root});
    const finalProtocol=inspectProtocolReleaseManifest({root,requireProduction:true});
    const finalIdentity=inspectZkReleaseArtifacts({root,requireProduction:true,requireBuiltR1cs:true});
    if(JSON.stringify(finalProduction)!==JSON.stringify(production)||finalProtocol.manifestSha256!==protocol.manifestSha256||finalIdentity.manifestSha256!==identity.manifestSha256)
      throw new Error("Proof or protocol manifests changed while release preflight was running");
    if(cleanGitState({root,runner,env:baseEnvironment,gitExecutable})!==releaseCommit)
      throw new Error("Release commit changed while preflight was running");
    return Object.freeze({status:"checks-passed",releaseCommit,circuitCount:13,protocolManifestSha256:protocol.manifestSha256});
  } finally { if(stage!==undefined) await fs.rm(stage,{recursive:true,force:true}); }
}
export async function runReleasePreflight(options = {}) { return runReleaseChecks(options); }
export async function main() { return runReleasePreflight(); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(`[release-preflight] ${error.message}`); process.exitCode = 1; });
