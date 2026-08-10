/**
 * Conflux eSpace Mainnet Safe:
 *   npm run espace:mainnet:safe:plan
 *   npm run espace:mainnet:safe:execute -- --digest 0x...
 *   npm run espace:mainnet:safe:status
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main } from "./evm-mainnet-safe.mjs";
import { publicSafeCreatorError } from "./lib/mainnetSafeEvidence.mjs";

main(ESPACE_CHAIN_PROFILE).catch((error) => {
  console.error(`[espace-mainnet-safe] ${publicSafeCreatorError(error)}`);
  process.exitCode = 1;
});
