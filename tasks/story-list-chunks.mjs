import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

// Helper query task for debugging story chunks with pagination

// listStoryChunks(tokenId, offset, limit)
// getStoryMetadata(tokenId) for summary

// Usage example:
// npx hardhat list-story-chunks --tokenid 1 --offset 0 --limit 10 --network localhost

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { deepFamily } = await ensureIntegratedSystem(connection);
  const tokenId = BigInt(args.tokenid);
  const offset = Number(args.offset);
  const limit = Number(args.limit);

  await deepFamily.getStoryMetadata(tokenId);

  await deepFamily.listStoryChunks(tokenId, offset, limit);
};

export default task("list-story-chunks", "List story chunks for an NFT with pagination")
  .addOption({
    name: "tokenid",
    description: "NFT tokenId",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "offset",
    description: "Pagination offset",
    type: ArgumentType.STRING,
    defaultValue: "0",
  })
  .addOption({
    name: "limit",
    description: "Pagination limit (<=100)",
    type: ArgumentType.STRING,
    defaultValue: "20",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
