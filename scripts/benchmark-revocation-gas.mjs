#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

export function parseRevocationGasArguments(argv) {
  const options = {
    counts: [0, 32, 64, 128, 256],
    gasLimit: 15_000_000,
    headroomBps: 2000,
    output: "tmp/receive-revocation-bounded-gas.json",
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index],
      value = argv[index + 1];
    if (
      !["--counts", "--gas-limit", "--headroom-bps", "--output"].includes(name) ||
      !value ||
      seen.has(name)
    )
      throw new Error(`Invalid or duplicate argument: ${name}`);
    seen.add(name);
    if (name === "--counts") {
      if (!/^(?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*$/u.test(value))
        throw new Error("--counts must be comma-separated non-negative integers");
      options.counts = value.split(",").map(Number);
      if (
        options.counts.some(
          (count, offset) =>
            !Number.isSafeInteger(count) ||
            count > 10_000 ||
            (offset > 0 && count <= options.counts[offset - 1]),
        ) ||
        options.counts[0] !== 0
      )
        throw new Error(
          "--counts must start at zero, increase strictly and stay at or below 10000",
        );
    } else if (name === "--output") options.output = value;
    else {
      if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${name} must be a positive integer`);
      const number = Number(value);
      if (!Number.isSafeInteger(number)) throw new Error(`${name} exceeds safe integer range`);
      if (name === "--gas-limit") options.gasLimit = number;
      else options.headroomBps = number;
    }
  }
  if (options.gasLimit > 15_000_000 || options.gasLimit < 100_000)
    throw new Error("--gas-limit must be between 100000 and the local 15000000 test budget");
  if (options.headroomBps > 10_000) throw new Error("--headroom-bps must not exceed 10000");
  return options;
}

export function runRevocationGasBenchmark(argv = process.argv.slice(2)) {
  const options = parseRevocationGasArguments(argv);
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules/hardhat/dist/src/cli.js"),
      "--config",
      "hardhat.config.mjs",
      "test",
      "mocha",
      "test/receive-revocation-gas.test.mjs",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        RECEIVE_REVOCATION_GAS_BENCHMARK: "1",
        RECEIVE_REVOCATION_GAS_COUNTS: options.counts.join(","),
        RECEIVE_REVOCATION_GAS_LIMIT: String(options.gasLimit),
        RECEIVE_REVOCATION_GAS_HEADROOM_BPS: String(options.headroomBps),
        RECEIVE_REVOCATION_GAS_REPORT: path.resolve(ROOT, options.output),
      },
    },
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runRevocationGasBenchmark();
  } catch (error) {
    console.error(`[revocation-gas] ${error.message}`);
    process.exitCode = 1;
  }
}
