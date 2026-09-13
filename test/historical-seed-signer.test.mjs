import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { Wallet } from "ethers";
import { resolveHistoricalSeedSigner } from "../scripts/lib/seedSigner.mjs";
import seedHelpers from "../lib/seedHelpers.js";
import { appendDfsStoryRecord } from "../lib/archiveOperations.js";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { setupStubVerifiers } from "./helpers/testHelper.mjs";

// Public, deterministic test key, unrelated to the developer's .env.
const TEST_KEY = `0x${"11".repeat(32)}`;
const TEST_ADDRESS = new Wallet(TEST_KEY).address;

function signerConnection({ balance = 1n, networkName = "localhost" } = {}) {
  return {
    networkName,
    networkConfig: { type: "http" },
    ethers: {
      Wallet,
      getSigners() {
        throw new Error("Seeding must not select an unlocked node account");
      },
      provider: {
        async getBalance(address) {
          expect(address).to.equal(TEST_ADDRESS);
          return balance;
        },
      },
    },
  };
}

describe("Historical seed signer", function () {
  this.timeout(240_000);

  it("uses PRIVATE_KEY on localhost without consulting unlocked node accounts", async function () {
    const connection = signerConnection();
    const signer = await resolveHistoricalSeedSigner(connection, { PRIVATE_KEY: TEST_KEY });
    expect(await signer.getAddress()).to.equal(TEST_ADDRESS);
    expect(signer.provider).to.equal(connection.ethers.provider);
  });

  it("accepts the same unprefixed and whitespace-padded key as dev:fund", async function () {
    const signer = await resolveHistoricalSeedSigner(signerConnection(), {
      PRIVATE_KEY: ` ${TEST_KEY.slice(2)}\n`,
    });
    expect(await signer.getAddress()).to.equal(TEST_ADDRESS);
  });

  it("rejects missing and invalid keys without exposing their values", async function () {
    for (const value of [undefined, "", "   "]) {
      await expect(
        resolveHistoricalSeedSigner(signerConnection(), { PRIVATE_KEY: value }),
      ).to.be.rejectedWith("Historical seeding requires PRIVATE_KEY");
    }
    for (const value of ["sensitive-invalid-key", `0x${"00".repeat(32)}`]) {
      await expect(
        resolveHistoricalSeedSigner(signerConnection(), { PRIVATE_KEY: value }),
      ).to.be.rejectedWith("PRIVATE_KEY is not a valid private key for historical seeding");
    }
  });

  it("requires funding and gives the correct local or remote next step", async function () {
    await expect(
      resolveHistoricalSeedSigner(signerConnection({ balance: 0n }), { PRIVATE_KEY: TEST_KEY }),
    ).to.be.rejectedWith("Run npm run dev:fund before npm run dev:seed.");
    await expect(
      resolveHistoricalSeedSigner(signerConnection({ balance: 0n, networkName: "sepolia" }), {
        PRIVATE_KEY: TEST_KEY,
      }),
    ).to.be.rejectedWith("Fund this address with the network's native currency before seeding.");
  });

  it("creates, endorses, mints and appends as the env wallet instead of the deployer", async function () {
    const { ethers } = hre;
    const { deepFamily, deepFamilyReader, archive, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    await setupStubVerifiers(ethers, deepFamily);
    await hre.networkHelpers.setBalance(TEST_ADDRESS, ethers.parseEther("10"));
    const signer = await resolveHistoricalSeedSigner(
      { ethers, networkConfig: { type: "edr-simulated" } },
      { PRIVATE_KEY: TEST_KEY },
    );
    const [deployer] = await ethers.getSigners();
    expect(signer.address).not.to.equal(deployer.address);

    const personData = {
      fullName: "Env Seed Wallet Example",
      passphrase: "historical seed signer test passphrase",
      birthYear: 1880,
      birthMonth: 1,
      birthDay: 1,
      isBirthBC: false,
      gender: 1,
    };
    const added = await seedHelpers.addPersonVersion({
      deepFamily: deepFamily.connect(signer),
      signer,
      personData,
      versionContent: { tag: "seed", biography: "Created by the configured wallet" },
    });
    const [version] = await deepFamilyReader.getVersionDetails(added.personHash, 1);
    expect(version.addedBy).to.equal(TEST_ADDRESS);

    await seedHelpers.endorseVersion({
      deepFamily,
      token,
      signer,
      personHash: added.personHash,
      versionIndex: 1,
    });
    expect(await deepFamily.endorsedVersionIndex(added.personHash, TEST_ADDRESS)).to.equal(1n);
    expect(await deepFamily.endorsedVersionIndex(added.personHash, deployer.address)).to.equal(0n);

    const minted = await seedHelpers.mintPersonVersionNFT({
      deepFamily,
      signer,
      personHash: added.personHash,
      versionIndex: 1,
      tokenURI: "",
      basicInfo: personData,
      supplementInfo: { storyTitle: "Biography", story: "Minted by the configured wallet" },
    });
    expect(await deepFamily.ownerOf(minted.tokenId)).to.equal(TEST_ADDRESS);

    const appended = await appendDfsStoryRecord({
      archive: archive.connect(signer),
      tokenId: minted.tokenId,
      title: "First journey",
      content: "Written by the configured wallet",
    });
    expect(appended.recordRef.author).to.equal(TEST_ADDRESS);
  });
});
