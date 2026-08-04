/**
 * Conflux eSpace Mainnet protocol release:
 *   npm run espace:mainnet:release
 *   EVM_MAINNET_PLAN_DIGEST=0x... \
 *   EVM_MAINNET_CONFIRM=conflux-mainnet-chain-1030 \
 *     npm run espace:mainnet:release
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main, publicError } from "./evm-mainnet-release.mjs";

main(ESPACE_CHAIN_PROFILE).catch((error) => {
  console.error(`[espace-mainnet-release] ${publicError(error)}`);
  process.exitCode = 1;
});
