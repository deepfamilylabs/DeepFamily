/**
 * Ethereum Mainnet protocol release:
 *   npm run ethereum:mainnet:release
 *   EVM_MAINNET_PLAN_DIGEST=0x... \
 *     npm run ethereum:mainnet:release
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main, publicError } from "./evm-mainnet-release.mjs";

main(ETHEREUM_CHAIN_PROFILE).catch((error) => {
  console.error(`[ethereum-mainnet-release] ${publicError(error)}`);
  process.exitCode = 1;
});
