import { ETHEREUM_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { runAcceptanceCommand } from "./lib/acceptanceCommandWrapper.mjs";

runAcceptanceCommand({
  chainProfile: ETHEREUM_CHAIN_PROFILE,
  entryScript: "scripts/ethereum-acceptance.mjs",
}).catch((error) => {
  console.error(`[ethereum-acceptance-command] ${error.message}`);
  process.exitCode = 1;
});
