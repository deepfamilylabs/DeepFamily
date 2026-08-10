/**
 * Ethereum Mainnet protocol release:
 *   npm run ethereum:mainnet:release:plan
 *   npm run ethereum:mainnet:release:execute -- --approval-file <path>
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main, publicError } from "./evm-mainnet-release.mjs";

main(ETHEREUM_CHAIN_PROFILE).catch((error) => {
  console.error(`[ethereum-mainnet-release] ${publicError(error)}`);
  process.exitCode = 1;
});
