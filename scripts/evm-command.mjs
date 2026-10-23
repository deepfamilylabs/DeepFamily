import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseChainArguments } from "./lib/chainProfiles.mjs";
import { runAcceptanceCommand } from "./lib/acceptanceCommandWrapper.mjs";
import { runMainnetSafeCommand, runMainnetReleaseCommand } from "./lib/mainnetCommandWrapper.mjs";

export const runEvmCommand = async (argv, runners = {}) => {
  const actions = {
    acceptance: {
      runner: runners.acceptance ?? runAcceptanceCommand,
      entryScript: "scripts/evm-acceptance.mjs",
    },
    safe: {
      runner: runners.safe ?? runMainnetSafeCommand,
      entryScript: "scripts/evm-mainnet-safe.mjs",
    },
    release: {
      runner: runners.release ?? runMainnetReleaseCommand,
      entryScript: "scripts/evm-mainnet-release.mjs",
    },
  };
  const selected = actions[argv[0]];
  if (!selected || !Object.hasOwn(actions, argv[0]))
    throw new Error(
      "Usage: evm-command.mjs <acceptance|safe|release> --chain <espace|ethereum> [operation options]",
    );
  const options = parseChainArguments(argv.slice(1));
  return selected.runner({ ...options, entryScript: selected.entryScript });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEvmCommand(process.argv.slice(2)).catch((error) => {
    console.error(`[evm-command] ${error.message}`);
    process.exitCode = 1;
  });
}
