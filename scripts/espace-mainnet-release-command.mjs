/**
 * Conflux eSpace Mainnet protocol release wrapper:
 *   npm run espace:mainnet:release
 *
 * Plan is the default. Execute/resume requires the reviewed digest and exact confirmation in
 * docs/espace-mainnet-release.md. Any command-line argument is rejected.
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { runMainnetReleaseCommand } from "./lib/mainnetCommandWrapper.mjs";

runMainnetReleaseCommand({
  chainProfile: ESPACE_CHAIN_PROFILE,
  entryScript: "scripts/espace-mainnet-release.mjs",
}).catch((error) => {
  console.error(`[espace-mainnet-release-command] ${error.message}`);
  process.exitCode = 1;
});
