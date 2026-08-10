/**
 * Ethereum Mainnet Safe wrapper:
 *   npm run ethereum:mainnet:safe:plan
 *   npm run ethereum:mainnet:safe:execute -- --digest 0x...
 *   npm run ethereum:mainnet:safe:status
 *
 * Plan and execute are explicit. Execute requires the reviewed digest documented in
 * docs/ethereum-mainnet-release.md. This wrapper does not accept a caller-selected network.
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { runMainnetSafeCommand } from "./lib/mainnetCommandWrapper.mjs";

runMainnetSafeCommand({
  chainProfile: ETHEREUM_CHAIN_PROFILE,
  entryScript: "scripts/ethereum-mainnet-safe.mjs",
}).catch((error) => {
  console.error(`[ethereum-mainnet-safe-command] ${error.message}`);
  process.exitCode = 1;
});
