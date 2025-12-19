import hre from "hardhat";
import seedHelpers from "./lib/seedHelpers.js";
import { ensureIntegratedSystem } from "./hardhat/integratedDeployment.mjs";

const getOrCreateTestConnection = async () => {
  if (!globalThis.__deepfamilyTestConnectionPromise) {
    globalThis.__deepfamilyTestConnectionPromise = hre.network.connect();
  }
  return globalThis.__deepfamilyTestConnectionPromise;
};

const connection = await getOrCreateTestConnection();

// Make legacy Hardhat v2-style helpers available to existing tests.
hre.ethers = connection.ethers;
hre.networkHelpers = connection.networkHelpers;

// Global cleanup function
const cleanupConnection = async () => {
  if (globalThis.__deepfamilyTestConnectionPromise) {
    try {
      const conn = await globalThis.__deepfamilyTestConnectionPromise;
      await conn?.close?.();
    } catch {}
    globalThis.__deepfamilyTestConnectionPromise = null;
  }
};

// Register cleanup for test completion
if (typeof after === 'function') {
  after(async function () {
    await cleanupConnection();
    // Force exit to prevent hanging
    setTimeout(() => process.exit(0), 50);
  });
}

// Process-level cleanup hooks
if (typeof process !== 'undefined' && process.on) {
  process.on('beforeExit', cleanupConnection);
  process.on('SIGINT', async () => {
    await cleanupConnection();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await cleanupConnection();
    process.exit(0);
  });
}

hre.run = async (taskName, args = {}) => {
  const { ethers } = hre;
  const [signer] = await ethers.getSigners();
  const { deepFamily, token } = await ensureIntegratedSystem(connection);

  switch (taskName) {
    case "add-person": {
      const fullName = String(args.fullname ?? "");
      if (fullName.trim().length === 0) {
        throw new Error("InvalidFullName");
      }

      const personData = {
        fullName,
        passphrase: String(args.passphrase ?? ""),
        isBirthBC: String(args.birthbc ?? "false").toLowerCase() === "true",
        birthYear: Number(args.birthyear ?? 0),
        birthMonth: Number(args.birthmonth ?? 0),
        birthDay: Number(args.birthday ?? 0),
        gender: Number(args.gender ?? 0),
      };

      const fatherData =
        args.fathername && String(args.fathername).trim().length > 0
          ? {
              fullName: String(args.fathername),
              passphrase: String(args.fatherpassphrase ?? ""),
              isBirthBC: String(args.fatherbirthbc ?? "false").toLowerCase() === "true",
              birthYear: Number(args.fatherbirthyear ?? 0),
              birthMonth: Number(args.fatherbirthmonth ?? 0),
              birthDay: Number(args.fatherbirthday ?? 0),
              gender: Number(args.fathergender ?? 1),
            }
          : null;

      const motherData =
        args.mothername && String(args.mothername).trim().length > 0
          ? {
              fullName: String(args.mothername),
              passphrase: String(args.motherpassphrase ?? ""),
              isBirthBC: String(args.motherbirthbc ?? "false").toLowerCase() === "true",
              birthYear: Number(args.motherbirthyear ?? 0),
              birthMonth: Number(args.motherbirthmonth ?? 0),
              birthDay: Number(args.motherbirthday ?? 0),
              gender: Number(args.mothergender ?? 2),
            }
          : null;

      return seedHelpers.addPersonVersion({
        deepFamily,
        signer,
        personData,
        fatherData,
        motherData,
        fatherVersion: Number(args.fatherversion ?? 0),
        motherVersion: Number(args.motherversion ?? 0),
        tag: String(args.tag ?? ""),
        ipfs: String(args.ipfs ?? ""),
      });
    }

    case "endorse": {
      return seedHelpers.endorseVersion({
        deepFamily,
        token,
        signer,
        personHash: String(args.person),
        versionIndex: Number(args.vindex),
        autoApprove: String(args.autoapprove ?? "true").toLowerCase() === "true",
      });
    }

    case "mint-nft": {
      return seedHelpers.mintPersonNFT({
        deepFamily,
        signer,
        personHash: String(args.person),
        versionIndex: Number(args.vindex),
        tokenURI: String(args.tokenuri),
        basicInfo: {
          fullName: String(args.fullname),
          passphrase: String(args.passphrase ?? ""),
          isBirthBC: String(args.birthbc ?? "false").toLowerCase() === "true",
          birthYear: Number(args.birthyear ?? 0),
          birthMonth: Number(args.birthmonth ?? 0),
          birthDay: Number(args.birthday ?? 0),
          gender: Number(args.gender ?? 0),
        },
        supplementInfo: {
          fullName: String(args.fullname),
          birthPlace: String(args.birthplace ?? ""),
          isDeathBC: String(args.deathbc ?? "false").toLowerCase() === "true",
          deathYear: Number(args.deathyear ?? 0),
          deathMonth: Number(args.deathmonth ?? 0),
          deathDay: Number(args.deathday ?? 0),
          deathPlace: String(args.deathplace ?? ""),
          story: String(args.story ?? ""),
        },
      });
    }

    case "add-story-chunk": {
      const tokenId = BigInt(String(args.tokenid));
      const chunkIndex = Number(args.chunkindex);
      const chunkType = Number(args.type ?? 0);
      const content = String(args.content);
      const attachmentCID = String(args.attachment ?? "");
      const expectedHash = String(args.exphash ?? ethers.ZeroHash);

      const tx = await deepFamily
        .connect(signer)
        .addStoryChunk(tokenId, chunkIndex, chunkType, content, attachmentCID, expectedHash);
      return tx.wait();
    }

    case "list-story-chunks": {
      const tokenId = BigInt(String(args.tokenid));
      const offset = Number(args.offset ?? 0);
      const limit = Number(args.limit ?? 20);
      return deepFamily.listStoryChunks(tokenId, offset, limit);
    }

    case "seal-story": {
      const tokenId = BigInt(String(args.tokenid));
      const tx = await deepFamily.connect(signer).sealStory(tokenId);
      return tx.wait();
    }

    default: {
      // Fall back to Hardhat v3 task runner if needed.
      return hre.tasks.getTask(taskName).run(args);
    }
  }
};

