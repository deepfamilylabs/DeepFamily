import { readStoryRecord } from "@deepfamily/protocol-core";
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { deepFamilyReader } = await ensureIntegratedSystem(connection, {
    artifacts: hre.artifacts,
  });
  const tokenId = BigInt(args.tokenid);
  const [refs, totalRecords, hasMore, nextOffset] = await deepFamilyReader.listStoryRecords(
    tokenId,
    BigInt(args.offset),
    BigInt(args.limit),
  );
  const records = await Promise.all(
    refs.map((recordRef) =>
      readStoryRecord({
        recordRef,
        getCode: (address, blockTag) => connection.ethers.provider.getCode(address, blockTag),
      }),
    ),
  );
  return [records, totalRecords, hasMore, nextOffset];
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
