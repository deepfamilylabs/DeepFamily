/**
 * Ethereum Mainnet protocol release wrapper:
 *   npm run ethereum:mainnet:release:plan
 *   npm run ethereum:mainnet:release:execute -- --approval-file <path>
 *
 * Plan and execute are explicit. Execute/resume requires the reviewed approval file documented in
 * docs/ethereum-mainnet-release.md.
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
