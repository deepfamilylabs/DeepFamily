/**
 * Conflux eSpace Mainnet Safe:
 *   npm run espace:mainnet:safe
 *   EVM_MAINNET_SAFE_PLAN_DIGEST=0x... \
 *   EVM_MAINNET_SAFE_CONFIRM=conflux-mainnet-safe-chain-1030 \
 *     npm run espace:mainnet:safe
 *   npm run espace:mainnet:safe:status
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main } from "./evm-mainnet-safe.mjs";
import { publicSafeCreatorError } from "./lib/mainnetSafeEvidence.mjs";

main(ESPACE_CHAIN_PROFILE).catch((error) => {
  console.error(`[espace-mainnet-safe] ${publicSafeCreatorError(error)}`);
  process.exitCode = 1;
});
