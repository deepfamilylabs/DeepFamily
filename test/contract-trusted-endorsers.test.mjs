import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import {
  addPerson,
  computeProfileIdentityCommitment,
  makeEndorseAttestationRef,
  makeTestPerson,
  mintPerson,
  setupStubVerifiers,
} from "./helpers/testHelper.mjs";

const commitmentOf = (person) => computeProfileIdentityCommitment(hre.ethers, person);

describe("Trusted Endorser Sources", function () {
  this.timeout(60_000);

  async function setupPerson() {
    const { deepFamily, deepFamilyReader, token } =
      await hre.networkHelpers.loadFixture(deployIntegratedFixture);
    const signers = await hre.ethers.getSigners();
    await setupStubVerifiers(hre.ethers, deepFamily);
    const person = makeTestPerson("Trusted Source Person");
    const personHash = await addPerson(hre.ethers, deepFamily, signers[0], commitmentOf(person), {
      person,
      tag: "trusted-root",
    });
    return { deepFamily, reader: deepFamilyReader, signers, personHash, token };
  }

  it("automatically adds the version contributor without endorsing the version", async () => {
    const { deepFamily, reader, signers, personHash } = await setupPerson();
    const contributor = await signers[0].getAddress();

    expect(await deepFamily.trustedEndorserOf(personHash, 1, contributor)).to.equal(true);
    expect(await deepFamily.trustedEndorsersCount(personHash, 1)).to.equal(1n);
    expect(await deepFamily.trustedEndorserAt(personHash, 1, 0)).to.equal(contributor);
    expect(await deepFamily.endorsedVersionIndex(personHash, contributor)).to.equal(0n);

    const [accounts, totalCount, hasMore, nextOffset] = await reader.listTrustedEndorsers(
      personHash,
      1,
      0,
      10,
    );
    expect(accounts).to.deep.equal([contributor]);
    expect(totalCount).to.equal(1n);
    expect(hasMore).to.equal(false);
    expect(nextOffset).to.equal(1n);
  });

  it("allows only the version contributor to add and remove sources", async () => {
    const { deepFamily, signers, personHash } = await setupPerson();
    const [, source, outsider] = signers;
    const sourceAddress = await source.getAddress();

    await expect(
      deepFamily.connect(outsider).addTrustedEndorser(personHash, 1, sourceAddress),
    ).to.be.revertedWithCustomError(deepFamily, "MustBeTrustedEndorserManager");

    await expect(deepFamily.addTrustedEndorser(personHash, 1, sourceAddress))
      .to.emit(deepFamily, "TrustedEndorserAdded")
      .withArgs(personHash, 1, sourceAddress);
    expect(await deepFamily.trustedEndorserOf(personHash, 1, sourceAddress)).to.equal(true);

    await expect(
      deepFamily.connect(outsider).removeTrustedEndorser(personHash, 1, sourceAddress),
    ).to.be.revertedWithCustomError(deepFamily, "MustBeTrustedEndorserManager");

    await expect(deepFamily.removeTrustedEndorser(personHash, 1, sourceAddress))
      .to.emit(deepFamily, "TrustedEndorserRemoved")
      .withArgs(personHash, 1, sourceAddress);
    expect(await deepFamily.trustedEndorserOf(personHash, 1, sourceAddress)).to.equal(false);
  });

  it("moves source management to the current NFT holder after mint and transfer", async () => {
    const { deepFamily, signers } = await setupPerson();
    const [contributor, firstHolder, secondHolder, source] = signers;
    const contributorAddress = await contributor.getAddress();
    const firstHolderAddress = await firstHolder.getAddress();
    const secondHolderAddress = await secondHolder.getAddress();
    const sourceAddress = await source.getAddress();
    const minted = await mintPerson(
      hre.ethers,
      deepFamily,
      contributor,
      undefined,
      "Minted Trusted Source Person",
      { tokenURI: "ipfs://trusted-manager" },
    );
    const tokenId = await deepFamily.versionToTokenId(minted.personHash, 1);

    await deepFamily
      .connect(contributor)
      .transferFrom(contributorAddress, firstHolderAddress, tokenId);

    await expect(
      deepFamily.connect(contributor).addTrustedEndorser(minted.personHash, 1, sourceAddress),
    ).to.be.revertedWithCustomError(deepFamily, "MustBeTrustedEndorserManager");

    await expect(
      deepFamily.connect(firstHolder).addTrustedEndorser(minted.personHash, 1, sourceAddress),
    )
      .to.emit(deepFamily, "TrustedEndorserAdded")
      .withArgs(minted.personHash, 1, sourceAddress);

    await deepFamily
      .connect(firstHolder)
      .transferFrom(firstHolderAddress, secondHolderAddress, tokenId);

    await expect(
      deepFamily.connect(firstHolder).removeTrustedEndorser(minted.personHash, 1, sourceAddress),
    ).to.be.revertedWithCustomError(deepFamily, "MustBeTrustedEndorserManager");

    await expect(
      deepFamily.connect(secondHolder).removeTrustedEndorser(minted.personHash, 1, sourceAddress),
    )
      .to.emit(deepFamily, "TrustedEndorserRemoved")
      .withArgs(minted.personHash, 1, sourceAddress);
  });

  it("rejects zero, duplicate, and missing source updates", async () => {
    const { deepFamily, signers, personHash } = await setupPerson();
    const contributor = await signers[0].getAddress();

    await expect(
      deepFamily.addTrustedEndorser(personHash, 1, hre.ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidTrustedEndorser");
    await expect(
      deepFamily.addTrustedEndorser(personHash, 1, contributor),
    ).to.be.revertedWithCustomError(deepFamily, "TrustedEndorserAlreadyAdded");
    await expect(
      deepFamily.removeTrustedEndorser(personHash, 1, hre.ethers.ZeroAddress),
    ).to.be.revertedWithCustomError(deepFamily, "InvalidTrustedEndorser");
    await expect(
      deepFamily.removeTrustedEndorser(personHash, 1, await signers[2].getAddress()),
    ).to.be.revertedWithCustomError(deepFamily, "TrustedEndorserNotFound");
  });

  it("supports removing the contributor and paginating remaining sources", async () => {
    const { deepFamily, reader, signers, personHash, token } = await setupPerson();
    const contributor = await signers[0].getAddress();
    const accountsToAdd = await Promise.all(
      signers.slice(1, 4).map((signer) => signer.getAddress()),
    );

    for (const account of accountsToAdd) {
      await deepFamily.addTrustedEndorser(personHash, 1, account);
    }

    await deepFamily.removeTrustedEndorser(personHash, 1, contributor);
    expect(await deepFamily.trustedEndorserOf(personHash, 1, contributor)).to.equal(false);
    expect(await deepFamily.trustedEndorsersCount(personHash, 1)).to.equal(3n);

    const first = await reader.listTrustedEndorsers(personHash, 1, 0, 2);
    expect(first[0]).to.have.lengthOf(2);
    expect(first[1]).to.equal(3n);
    expect(first[2]).to.equal(true);
    expect(first[3]).to.equal(2n);

    const second = await reader.listTrustedEndorsers(personHash, 1, 2, 2);
    expect(second[0]).to.have.lengthOf(1);
    expect(second[1]).to.equal(3n);
    expect(second[2]).to.equal(false);
    expect(second[3]).to.equal(3n);
  });

  it("treats trusted sources as visible only after they endorse the version", async () => {
    const { deepFamily, reader, signers, personHash, token } = await setupPerson();
    const contributor = await signers[0].getAddress();
    const outsider = await signers[1].getAddress();

    expect(await reader.isVersionEndorsedByAny(personHash, 1, [contributor])).to.equal(false);
    expect(await reader.isVersionEndorsedByAny(personHash, 1, [outsider])).to.equal(false);

    const fee = await token.recentReward();
    if (fee > 0n) await token.connect(signers[0]).approve(deepFamily.target, fee);
    await deepFamily
      .connect(signers[0])
      .endorseVersion(
        personHash,
        1,
        await makeEndorseAttestationRef(hre.ethers, deepFamily, signers[0], personHash, 1),
      );

    expect(await reader.isVersionEndorsedByAny(personHash, 1, [contributor])).to.equal(true);
    expect(await reader.isVersionEndorsedByAny(personHash, 1, [outsider])).to.equal(false);
    expect(await reader.isVersionEndorsedByAny(personHash, 1, [outsider, contributor])).to.equal(
      true,
    );
  });
});
