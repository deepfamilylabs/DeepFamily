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
    expectedIndex: BigInt(args.recordindex),
    title: args.title ?? "",
    content: args.content,
    recordType: Number(args.type ?? 1),
    attachmentURI: args.attachment ?? "",
    expectedPayloadHash: args.exphash || undefined,
  });
};

export default task("add-story-record", "Append a story record to an NFT archive")
  .addOption({
    name: "tokenid",
    description: "NFT tokenId (uint256)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "recordindex",
    description: "Record index to add (must equal current totalRecords, starts at 0)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "title",
    description: "Exact story title (optional)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "content",
    description: "Exact story text (capacity depends on network gas)",
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
    defaultValue: undefined,
  })
  .addOption({
    name: "type",
    description: "Record classification (1–255, default 1; 0 is reserved for mint biography)",
    type: ArgumentType.STRING,
    defaultValue: "1",
  })
  .addOption({
    name: "attachment",
    description: "Attachment URI (optional)",
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
