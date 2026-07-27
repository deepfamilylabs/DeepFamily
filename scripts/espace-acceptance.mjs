/**
 * Destructive Conflux eSpace Testnet acceptance (fixed network confluxTestnet / chain ID 71):
 *   ESPACE_E2E_CONFIRM=conflux-testnet-chain-71 npm run espace:acceptance
 *
 * See docs/espace-testnet-acceptance.local.md for diagnostic, release-rehearsal and recovery use.
 */
import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { main, safeErrorMessage } from "./evm-acceptance.mjs";

main(ESPACE_CHAIN_PROFILE).then(
  () => process.exit(0),
  (error) => {
    console.error(
      `[espace-acceptance] ${safeErrorMessage(error, [String(process.env.PRIVATE_KEY || "")])}`,
    );
    process.exit(1);
  },
);
