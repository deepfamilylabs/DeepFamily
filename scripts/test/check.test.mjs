import assert from "node:assert/strict";
import test from "node:test";
import { checkPlan, runCheckProfile } from "../check.mjs";

test("fast checks do not need downloaded proving artifacts or the Solidity analyzer", () => {
  assert.deepEqual(checkPlan("fast")[0], [process.execPath, "scripts/check-snarkjs-runtime.mjs"]);
  const fast = checkPlan("fast")
    .map((command) => command.join(" "))
    .join("\n");
  assert.match(fast, /frontend:typecheck/);
  assert.match(fast, /check-chain-client-boundaries/);
  assert.match(fast, /generate-shielded-signal-layout.mjs --check/);
  assert.match(fast, /test:guards/);
  assert.match(fast, /check-solidity-security.mjs --baseline-only/);
  assert.doesNotMatch(fast, /zk:check|contracts:check|browser:check/);
});

test("a failed check stops the profile, preserves its exit code and records incomplete coverage", async () => {
  const calls = [];
  let saved;
  const result = await runCheckProfile("fast", {
    run: async (command, env) => {
      calls.push(command);
      assert.equal(env.CSP_SCAN_FAIL_ON_REPORT, "1");
      assert.equal(env.CSP_SCAN_WORKERS, "1");
      assert.equal(env.CSP_SCAN_MODE, "preview");
      assert.equal(env.CSP_SCAN_SKIP_BUILD, "0");
      return { code: calls.length === 2 ? 7 : 0 };
    },
    save: async (report) => {
      saved = report;
    },
  });
  assert.equal(result.exitCode, 7);
  assert.equal(calls.length, 2);
  assert.equal(saved.status, "failed");
  assert.equal(saved.completed, 2);
  assert(saved.total > saved.completed);
});

test("complete checks include fast, circuits, browser, real proofs and static contract security", () => {
  const all = checkPlan("all")
    .map((command) => command.join(" "))
    .join("\n");
  for (const required of [
    "frontend:lint",
    "test:circuits",
    "contracts:check",
    "zk:check",
    "csp:scan",
    "browser:check",
    "check-solidity-security",
    "git diff --exit-code -- frontend/src/abi",
  ])
    assert(all.includes(required), required);
  assert(
    checkPlan("all").some(
      (command) => command[1] === "scripts/check-solidity-security.mjs" && command.length === 2,
    ),
  );
  assert.throws(() => checkPlan("unknown"), /Unknown check profile/);
});
