/**
 * Conflux eSpace Mainnet protocol release:
 *   npm run espace:mainnet:release:plan
 *   npm run espace:mainnet:release:execute -- --approval-file <path>
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main, publicError } from "./evm-mainnet-release.mjs";

main(ESPACE_CHAIN_PROFILE).catch((error) => {
  console.error(`[espace-mainnet-release] ${publicError(error)}`);
  process.exitCode = 1;
});
