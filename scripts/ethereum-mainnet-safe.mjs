/**
 * Ethereum Mainnet Safe:
 *   npm run ethereum:mainnet:safe
 *   EVM_MAINNET_SAFE_PLAN_DIGEST=0x... \
 *   EVM_MAINNET_SAFE_CONFIRM=ethereum-mainnet-safe-chain-1 \
 *     npm run ethereum:mainnet:safe
 *   npm run ethereum:mainnet:safe:status
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main } from "./evm-mainnet-safe.mjs";
import { publicSafeCreatorError } from "./lib/mainnetSafeEvidence.mjs";

main(ETHEREUM_CHAIN_PROFILE).catch((error) => {
  console.error(`[ethereum-mainnet-safe] ${publicSafeCreatorError(error)}`);
  process.exitCode = 1;
});
