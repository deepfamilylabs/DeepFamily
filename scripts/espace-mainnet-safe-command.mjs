/**
 * Conflux eSpace Mainnet Safe wrapper:
 *   npm run espace:mainnet:safe
 *   npm run espace:mainnet:safe:status
 *
 * Plan is the default. Execute requires the reviewed digest documented in
 * docs/espace-mainnet-release.md. This wrapper does not accept a caller-selected network.
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { runMainnetSafeCommand } from "./lib/mainnetCommandWrapper.mjs";

runMainnetSafeCommand({
  chainProfile: ESPACE_CHAIN_PROFILE,
  entryScript: "scripts/espace-mainnet-safe.mjs",
}).catch((error) => {
  console.error(`[espace-mainnet-safe-command] ${error.message}`);
  process.exitCode = 1;
});
