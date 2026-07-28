import { ESPACE_CHAIN_PROFILE } from "./lib/chainProfiles.mjs";
import { runAcceptanceCommand } from "./lib/acceptanceCommandWrapper.mjs";

runAcceptanceCommand({
  chainProfile: ESPACE_CHAIN_PROFILE,
  entryScript: "scripts/espace-acceptance.mjs",
}).catch((error) => {
  console.error(`[espace-acceptance-command] ${error.message}`);
  process.exitCode = 1;
});
