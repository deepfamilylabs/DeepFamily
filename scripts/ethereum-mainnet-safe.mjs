/**
 * Ethereum Mainnet Safe:
 *   npm run ethereum:mainnet:safe:plan
 *   npm run ethereum:mainnet:safe:execute -- --digest 0x...
 *   npm run ethereum:mainnet:safe:status
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main } from "./evm-mainnet-safe.mjs";
import { publicSafeCreatorError } from "./lib/mainnetSafeEvidence.mjs";

main(ETHEREUM_CHAIN_PROFILE).catch((error) => {
  console.error(`[ethereum-mainnet-safe] ${publicSafeCreatorError(error)}`);
  process.exitCode = 1;
});
