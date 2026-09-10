import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { appendDfsStoryRecord } from "../lib/archiveOperations.js";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { archive } = await ensureIntegratedSystem(connection, { artifacts: hre.artifacts });
  const signer = (await connection.ethers.getSigners())[0];
  return appendDfsStoryRecord({
    archive: archive.connect(signer),
    tokenId: BigInt(args.tokenid),
    expectedIndex: BigInt(args.chunkindex),
    content: args.content,
    chunkType: Number(args.type ?? 1),
    attachmentCID: args.attachment ?? "",
    expectedPayloadHash: args.exphash || undefined,
  });
};

export default task("add-story-chunk", "Add a story chunk to an NFT (story sharding)")
  .addOption({
    name: "tokenid",
    description: "NFT tokenId (uint256)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "chunkindex",
    description: "Chunk index to add (must equal current totalRecords, starts at 0)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "content",
    description: "Exact story text (capacity depends on network gas)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "type",
    description: "Chunk classification (1–255, default 1; 0 is reserved for mint biography)",
    type: ArgumentType.STRING,
    defaultValue: "1",
  })
  .addOption({
    name: "attachment",
    description: "Attachment CID (optional)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "exphash",
    description: "Expected keccak256 of the compressed story envelope (optional)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
