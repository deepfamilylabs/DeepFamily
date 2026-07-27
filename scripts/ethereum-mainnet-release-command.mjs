/**
 * Ethereum Mainnet protocol release wrapper:
 *   npm run ethereum:mainnet:release
 *
 * Plan is the default. Execute/resume requires the reviewed digest and exact confirmation in
 * docs/ethereum-mainnet-release.md. Any command-line argument is rejected.
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { runMainnetReleaseCommand } from "./lib/mainnetCommandWrapper.mjs";

runMainnetReleaseCommand({
  chainProfile: ETHEREUM_CHAIN_PROFILE,
  entryScript: "scripts/ethereum-mainnet-release.mjs",
}).catch((error) => {
  console.error(`[ethereum-mainnet-release-command] ${error.message}`);
  process.exitCode = 1;
});
