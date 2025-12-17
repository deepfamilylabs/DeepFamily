import '../hardhat-test-setup.mjs'
import { expect } from 'chai'
import hre from 'hardhat'
import namePoseidon from '../lib/namePoseidon.js'
import { deployIntegratedFixture } from './fixtures/integrated.mjs'

const { buildBasicInfo } = namePoseidon

// Additional negative & edge-case tests for story sharding (add/seal)
// Covers: non-owner, index mismatch, oversize, hash mismatch, seal rules, zero-chunk seal

describe('Story Sharding - Error & Edge Cases', function () {
  this.timeout(90_000);

  async function deployAndMint() {
    const { deepFamily } = await hre.networkHelpers.loadFixture(deployIntegratedFixture)
    const [signer, other] = await hre.ethers.getSigners();
    const deepFamilyWithSigner = deepFamily.connect(signer)

    const FULLNAME = 'Edge Person';
    const BIRTH_YEAR = '1970';
    const GENDER = '1';

    await hre.run('add-person', {
      fullname: FULLNAME,
      birthyear: BIRTH_YEAR,
      gender: GENDER,
      tag: 'edge',
      ipfs: 'QmEdgeMeta'
    });
    const basicInfo = buildBasicInfo({
      fullName: FULLNAME,
      birthYear: parseInt(BIRTH_YEAR, 10),
      birthMonth: 0,
      birthDay: 0,
      gender: parseInt(GENDER, 10),
    });
    const personHash = await deepFamilyWithSigner.getPersonHash(basicInfo);
    await hre.run('endorse', { person: personHash, vindex: '1' });
    await hre.run('mint-nft', {
      person: personHash,
      vindex: '1',
      tokenuri: 'ipfs://edgeNFT',
      fullname: FULLNAME,
      birthyear: BIRTH_YEAR,
      gender: GENDER,
      birthplace: 'City',
      story: 'Edge summary'
    });
    return { deepFamily: deepFamilyWithSigner, signer, other, tokenId: 1n, personHash };
  }

  it('reverts when non-owner adds chunk', async () => {
    const { deepFamily, other, tokenId } = await deployAndMint();
    await expect(
      deepFamily
        .connect(other)
        .addStoryChunk(tokenId, 0, 0, 'content', '', hre.ethers.ZeroHash)
    ).to.be.revertedWithCustomError(deepFamily, 'MustBeNFTHolder');
  });

  it('reverts on index mismatch (skipping index)', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    await deepFamily.addStoryChunk(tokenId, 0, 0, 'c0', '', hre.ethers.ZeroHash);
    await expect(
      deepFamily.addStoryChunk(tokenId, 2, 0, 'c2', '', hre.ethers.ZeroHash)
    ).to.be.revertedWithCustomError(deepFamily, 'ChunkIndexOutOfRange');
  });

  it('reverts on oversize content', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    const longStr = 'a'.repeat(2049); // > 2048
    await expect(
      deepFamily.addStoryChunk(tokenId, 0, 0, longStr, '', hre.ethers.ZeroHash)
    ).to.be.revertedWithCustomError(deepFamily, 'InvalidChunkContent');
  });

  it('reverts on hash mismatch', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    const wrongHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes('DIFFERENT'));
    await expect(
      deepFamily.addStoryChunk(tokenId, 0, 0, 'Real Content', '', wrongHash)
    ).to.be.revertedWithCustomError(deepFamily, 'ChunkHashMismatch');
  });

  it('cannot append after sealing', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    await deepFamily.addStoryChunk(tokenId, 0, 0, 'c0', '', hre.ethers.ZeroHash);
    await deepFamily.sealStory(tokenId);
    await expect(
      deepFamily.addStoryChunk(tokenId, 1, 0, 'c1', '', hre.ethers.ZeroHash)
    ).to.be.revertedWithCustomError(deepFamily, 'StoryAlreadySealed');
  });

  it('reverts sealing with zero chunks', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    await expect(deepFamily.sealStory(tokenId)).to.be.revertedWithCustomError(
      deepFamily,
      'StoryNotFound'
    );
  });

  it('updates fullStoryHash correctly as chunks append', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    const c0 = 'Chunk Zero';
    const c1 = 'Chunk One';
    await deepFamily.addStoryChunk(tokenId, 0, 0, c0, '', hre.ethers.ZeroHash);
    await deepFamily.addStoryChunk(tokenId, 1, 0, c1, '', hre.ethers.ZeroHash);
    // Compute expected combined hash
    const h0 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(c0));
    const h1 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(c1));
    let expected = hre.ethers.ZeroHash;
    expected = hre.ethers.keccak256(
      hre.ethers.solidityPacked(['bytes32', 'uint256', 'bytes32'], [expected, 0n, h0])
    );
    expected = hre.ethers.keccak256(
      hre.ethers.solidityPacked(['bytes32', 'uint256', 'bytes32'], [expected, 1n, h1])
    );
    let meta = await deepFamily.storyMetadata(tokenId);
    expect(meta.fullStoryHash).to.equal(expected);

    // Append chunk 2 and confirm hash expands deterministically
    const c2 = 'Chunk Two';
    await deepFamily.addStoryChunk(tokenId, 2, 0, c2, '', hre.ethers.ZeroHash);
    const h2 = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(c2));
    expected = hre.ethers.keccak256(
      hre.ethers.solidityPacked(['bytes32', 'uint256', 'bytes32'], [expected, 2n, h2])
    );
    meta = await deepFamily.storyMetadata(tokenId);
    expect(meta.fullStoryHash).to.equal(expected);
  });

  it('records chunkType and attachment CID when provided', async () => {
    const { deepFamily, tokenId } = await deployAndMint();
    const attachment = 'ipfs://exampleAttachmentCID';
    await deepFamily.addStoryChunk(tokenId, 0, 3, 'Source citation entry', attachment, hre.ethers.ZeroHash);
    const chunk = await deepFamily.getStoryChunk(tokenId, 0);
    expect(chunk.chunkType).to.equal(3);
    expect(chunk.attachmentCID).to.equal(attachment);
  });
});
