/**
 * Conflux eSpace Mainnet protocol release wrapper:
 *   npm run espace:mainnet:release:plan
 *   npm run espace:mainnet:release:execute -- --approval-file <path>
 *
 * Plan and execute are explicit. Execute/resume requires the reviewed approval file documented in
 * docs/espace-mainnet-release.md.
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
