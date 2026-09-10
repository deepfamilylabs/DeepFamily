import { sealArchiveStory } from "../lib/archiveOperations.js";
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { archive } = await ensureIntegratedSystem(connection, { artifacts: hre.artifacts });
  const signer = (await connection.ethers.getSigners())[0];
  return sealArchiveStory({ archive: archive.connect(signer), tokenId: BigInt(args.tokenid) });
};

export default task("seal-story", "Seal the story for an NFT (no further chunk modifications)")
  .addOption({
    name: "tokenid",
    description: "NFT tokenId",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
