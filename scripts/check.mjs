import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePortableCommand } from "./lib/portableCommand.mjs";
import { verificationPaths } from "./lib/verificationPaths.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const npm = (script) => ["npm", "run", script];
const node = (script, ...args) => [process.execPath, script, ...args];

// Local commands and CI invoke these same profiles. Full checks include every
// independent CI suite; the fast profile needs neither proving files nor Python.
export const CHECK_PROFILES = {
  "frontend-static": [
    npm("frontend:lint"),
    npm("frontend:source-rules"),
    npm("frontend:typecheck"),
    ["npm", "run", "locales:check", "--workspace", "deepfamily-frontend"],
    npm("security:xss-scan"),
  ],
  fast: [
    node("scripts/check-snarkjs-runtime.mjs"),
    npm("lint"),
    node("scripts/check-solidity-security.mjs", "--baseline-only"),
    "frontend-static",
    node("scripts/check-chain-client-boundaries.mjs"),
    node("scripts/generate-shielded-signal-layout.mjs", "--check"),
    node("--test", "frontend/scripts/test/*.test.mjs", "scripts/test/*.test.mjs"),
  ],
  frontend: ["frontend-static", npm("frontend:build"), npm("frontend:test")],
  integration: [
    ["npm", "run", "test:receive-security", "--workspace", "@deepfamily/protocol-core"],
    npm("contracts:check"),
    npm("frontend:build"),
    npm("frontend:test"),
    npm("zk:check"),
    ["npm", "run", "csp:scan", "--workspace", "deepfamily-frontend"],
    ["npm", "run", "browser:check", "--workspace", "deepfamily-frontend"],
    ["git", "diff", "--exit-code", "--", "frontend/src/abi"],
  ],
  solidity: [npm("build").concat("--", "--force"), node("scripts/check-solidity-security.mjs")],
  all: ["fast", npm("test:circuits"), "integration", "solidity"],
};

export function checkPlan(profile) {
  if (!Object.hasOwn(CHECK_PROFILES, profile)) throw new Error(`Unknown check profile: ${profile}`);
  return CHECK_PROFILES[profile].flatMap((step) =>
    typeof step === "string" ? checkPlan(step) : [step],
  );
}

function execute(command, env) {
  const portable = normalizePortableCommand({
    executable: command[0],
    args: command.slice(1),
    env,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(portable.executable, portable.args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code: code ?? 1, ...(signal ? { signal } : {}) }),
    );
  });
}

export async function runCheckProfile(profile, { run = execute, env = process.env, save } = {}) {
  const commands = checkPlan(profile);
  const report = {
    schema: "deepfamily/development-checks@1",
    profile,
    startedAt: new Date().toISOString(),
    status: "running",
    checks: [],
  };
  let exitCode = 0;
  for (const command of commands) {
    console.log(`[check:${profile}] ${command.join(" ")}`);
    const started = Date.now();
    let outcome;
    try {
      outcome = await run(command, {
        ...env,
        CSP_SCAN_FAIL_ON_REPORT: "1",
        CSP_SCAN_WORKERS: "1",
        CSP_SCAN_MODE: "preview",
        CSP_SCAN_SKIP_BUILD: "0",
      });
    } catch {
      outcome = { code: 1 };
    }
    report.checks.push({ command, durationMs: Date.now() - started, ...outcome });
    if (outcome.code !== 0) {
      exitCode = outcome.code;
      break;
    }
  }
  report.status = exitCode === 0 ? "passed" : "failed";
  report.finishedAt = new Date().toISOString();
  report.completed = report.checks.length;
  report.total = commands.length;
  await save?.(report);
  return { exitCode, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv[2] ?? "all";
  const directory = verificationPaths(root).checks;
  let revision;
  try {
    revision = {
      commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() !==
        "",
    };
  } catch {
    revision = { commit: null, dirty: true };
  }
  try {
    const { exitCode } = await runCheckProfile(profile, {
      save: async (report) => {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(
          path.join(directory, `${profile}.json`),
          JSON.stringify({ ...report, ...revision }, null, 2),
        );
      },
    });
    process.exitCode = exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
