import { appendDfsStoryRecord, sealArchiveStory } from "./lib/archiveOperations.js";
import { readStoryRecord } from "@deepfamily/protocol-core";
import hre from "hardhat";
import seedHelpers from "./lib/seedHelpers.js";
import { ensureIntegratedSystem } from "./hardhat/integratedDeployment.mjs";

// A developer's production .env must not silently turn local mock-wallet tests into Conflux Safe
// integration tests. Individual profile tests opt in explicitly and restore the value themselves.
const originalGovernanceSafeProfile = process.env.GOVERNANCE_SAFE_PROFILE;
delete process.env.GOVERNANCE_SAFE_PROFILE;

// Tests and task integrations can create additional Hardhat 3 connections. Track every connection
// created through the shared HRE so the root teardown closes all EDR workers instead of relying on
// a forced process.exit(), which would hide Mocha's eventual non-zero failure status.
const originalNetworkConnect = hre.network.connect.bind(hre.network);
const trackedTestConnections = new Set();
hre.network.connect = async (...args) => {
  const testConnection = await originalNetworkConnect(...args);
  trackedTestConnections.add(testConnection);
  return testConnection;
};

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
let cleanupPromise;
const cleanupConnection = async () => {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const connections = [...trackedTestConnections];
      trackedTestConnections.clear();
      globalThis.__deepfamilyTestConnectionPromise = null;

      await Promise.allSettled(
        connections.map(async (testConnection) => {
          await testConnection?.close?.();
        }),
      );
    })();
  }

  await cleanupPromise;
};

// Register cleanup for test completion
if (typeof after === "function") {
  after(async function () {
    if (originalGovernanceSafeProfile === undefined) {
      delete process.env.GOVERNANCE_SAFE_PROFILE;
    } else {
      process.env.GOVERNANCE_SAFE_PROFILE = originalGovernanceSafeProfile;
    }
    await cleanupConnection();
  });
}

// Process-level cleanup hooks
if (typeof process !== "undefined" && process.on) {
  process.once("beforeExit", cleanupConnection);
  process.on("SIGINT", async () => {
    await cleanupConnection();
    process.exit(130);
  });
  process.on("SIGTERM", async () => {
    await cleanupConnection();
    process.exit(143);
  });
}

hre.run = async (taskName, args = {}) => {
  const { ethers } = hre;
  const [signer] = await ethers.getSigners();
  const { deepFamily, deepFamilyReader, archive, token } = await ensureIntegratedSystem(connection);

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
        versionContent: {
          tag: String(args.tag ?? ""),
          biography: String(args.biography ?? ""),
        },
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
      return seedHelpers.mintPersonVersionNFT({
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

    case "add-story-chunk":
      return appendDfsStoryRecord({
        archive: archive.connect(signer),
        tokenId: BigInt(args.tokenid),
        expectedIndex: BigInt(args.chunkindex),
        content: String(args.content),
        chunkType: Number(args.type ?? 0),
        attachmentCID: String(args.attachment ?? ""),
        expectedPayloadHash: args.exphash || undefined,
      });
    case "list-story-chunks": {
      const [refs, totalRecords, hasMore, nextOffset] = await deepFamilyReader.listStoryRecords(
        BigInt(args.tokenid),
        BigInt(args.offset ?? 0),
        BigInt(args.limit ?? 20),
      );
      const records = await Promise.all(
        refs.map((recordRef) =>
          readStoryRecord({ recordRef, getCode: (a, b) => ethers.provider.getCode(a, b) }),
        ),
      );
      return [records, totalRecords, hasMore, nextOffset];
    }
    case "seal-story":
      return sealArchiveStory({ archive: archive.connect(signer), tokenId: BigInt(args.tokenid) });

    default: {
      // Fall back to Hardhat v3 task runner if needed.
      return hre.tasks.getTask(taskName).run(args);
    }
  }
};
