/**
 * Destructive Ethereum Sepolia acceptance (fixed network sepolia / chain ID 11155111):
 *   npm run ethereum:acceptance
 *
 * See docs/ethereum-sepolia-acceptance.local.md for diagnostic, release-rehearsal and recovery use.
 */
import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main, safeErrorMessage } from "./evm-acceptance.mjs";

main(ETHEREUM_CHAIN_PROFILE).then(
  () => process.exit(0),
  (error) => {
    console.error(
      `[ethereum-acceptance] ${safeErrorMessage(error, [String(process.env.PRIVATE_KEY || "")])}`,
    );
    process.exit(1);
  },
);
