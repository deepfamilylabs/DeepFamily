import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { ethers } from "ethers";
import { ensureIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

// sealStory(tokenId) -> emits StorySealed

const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const signer = (await ethers.getSigners())[0];
  const { deepFamily } = await ensureIntegratedSystem(connection);
  const deepFamilyWithSigner = deepFamily.connect(signer);

  const tokenId = BigInt(args.tokenid);

  // Check metadata to surface user-friendly errors
  let metadata;
  try {
    metadata = await deepFamilyWithSigner.getStoryMetadata(tokenId);
  } catch (e) {
    throw new Error(`Failed to fetch story metadata. ${e.message || e}`);
  }

  if (metadata.isSealed) {
    throw new Error("Story already sealed");
  }
  if (Number(metadata.totalChunks) === 0) {
    throw new Error("Cannot seal empty story (no chunks)");
  }

  const tx = await deepFamilyWithSigner.sealStory(tokenId);
  const receipt = await tx.wait();

  try {
    const iface = new ethers.Interface([
      "event StorySealed(uint256 indexed tokenId, uint256 totalChunks, bytes32 fullStoryHash, address indexed sealer)",
    ]);
    const deepAddr = (await deepFamily.getAddress()).toLowerCase();
    for (const log of receipt.logs || []) {
      if ((log.address || "").toLowerCase() !== deepAddr) continue;
      try {
        const parsed = iface.parseLog(log);
        if (parsed && parsed.name === "StorySealed") {
          break;
        }
      } catch (_) {
        /* ignore */
      }
    }
  } catch (e) {}
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
