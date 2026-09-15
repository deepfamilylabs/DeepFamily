import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

describe("DeepFamilyToken", function () {
  this.timeout(120_000);

  const expectedCycleLengths = [
    1n,
    10n,
    100n,
    1_000n,
    10_000n,
    100_000n,
    1_000_000n,
    10_000_000n,
    100_000_000n,
  ];

  async function deployToken(contractName = "DeepFamilyToken") {
    const Token = await hre.ethers.getContractFactory(contractName);
    const token = await Token.deploy();
    await token.waitForDeployment();
    return token;
  }

  async function deployMinter(tokenAddress) {
    const Minter = await hre.ethers.getContractFactory("DeepFamilyTokenMinterMock");
    const minter = await Minter.deploy(tokenAddress);
    await minter.waitForDeployment();
    return minter;
  }

  async function deployBoundToken(contractName = "DeepFamilyToken") {
    const token = await deployToken(contractName);
    const minter = await deployMinter(await token.getAddress());
    await token.initialize(await minter.getAddress());
    return { token, minter };
  }

  it("rejects zero, EOA, incompatible-contract, and mismatched token bindings", async () => {
    const [owner, eoa] = await hre.ethers.getSigners();

    const zeroTargetToken = await deployToken();
    await expect(zeroTargetToken.initialize(hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      zeroTargetToken,
      "ZeroAddress",
    );

    const eoaTargetToken = await deployToken();
    await expect(eoaTargetToken.initialize(await eoa.getAddress())).to.be.revertedWithCustomError(
      eoaTargetToken,
      "InvalidDeepFamilyContract",
    );

    const incompatibleTargetToken = await deployToken();
    await expect(
      incompatibleTargetToken.initialize(await incompatibleTargetToken.getAddress()),
    ).to.be.revertedWithCustomError(incompatibleTargetToken, "InvalidDeepFamilyContract");

    const token = await deployToken();
    const otherToken = await deployToken();
    const mismatchedMinter = await deployMinter(await otherToken.getAddress());
    await expect(
      token.initialize(await mismatchedMinter.getAddress()),
    ).to.be.revertedWithCustomError(token, "InvalidTokenBinding");

    const unauthorizedToken = await deployToken();
    const validMinter = await deployMinter(await unauthorizedToken.getAddress());
    await expect(unauthorizedToken.connect(eoa).initialize(await validMinter.getAddress()))
      .to.be.revertedWithCustomError(unauthorizedToken, "OwnableUnauthorizedAccount")
      .withArgs(await eoa.getAddress());

    expect(await token.owner()).to.equal(await owner.getAddress());
  });

  it("binds exactly once to a contract that points back to this token", async () => {
    const [owner] = await hre.ethers.getSigners();
    const token = await deployToken();
    const minter = await deployMinter(await token.getAddress());
    const minterAddress = await minter.getAddress();

    await expect(token.initialize(minterAddress))
      .to.emit(token, "DeepFamilyContractInitialized")
      .withArgs(minterAddress)
      .and.to.emit(token, "OwnershipTransferred")
      .withArgs(await owner.getAddress(), hre.ethers.ZeroAddress);

    expect(await token.deepFamilyContract()).to.equal(minterAddress);
    expect(await token.owner()).to.equal(hre.ethers.ZeroAddress);
    await expect(token.initialize(minterAddress)).to.be.revertedWithCustomError(
      token,
      "AlreadyInitialized",
    );
    await expect(token.transferOwnership(await owner.getAddress())).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount",
    );
    await expect(token.renounceOwnership()).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount",
    );
  });

  it("allows only the bound contract to mint", async () => {
    const [owner, miner, outsider] = await hre.ethers.getSigners();
    const uninitializedToken = await deployToken();
    await expect(
      uninitializedToken.connect(outsider).mint(await miner.getAddress()),
    ).to.be.revertedWithCustomError(uninitializedToken, "NotInitialized");

    const { token, minter } = await deployBoundToken();
    const minerAddress = await miner.getAddress();
    const initialReward = await token.INITIAL_REWARD();

    await expect(token.connect(outsider).mint(minerAddress)).to.be.revertedWithCustomError(
      token,
      "OnlyDeepFamilyContract",
    );
    await expect(minter.mint(hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
      token,
      "ZeroAddress",
    );

    await expect(minter.connect(owner).mint(minerAddress))
      .to.emit(token, "MiningReward")
      .withArgs(minerAddress, initialReward, 1n);

    expect(await token.balanceOf(minerAddress)).to.equal(initialReward);
    expect(await token.totalSupply()).to.equal(initialReward);
    expect(await token.totalAdditions()).to.equal(1n);
    expect(await token.recentReward()).to.equal(initialReward);
  });

  it("returns the expected rewards at every cycle boundary through reward exhaustion", async () => {
    const token = await deployToken();

    await expect(token.getReward(0)).to.be.revertedWithCustomError(token, "InvalidRecordCount");

    let firstRecord = 1n;
    let expectedReward = 113_777n * 10n ** 18n;
    for (let cycleIndex = 0; ; cycleIndex++) {
      const length = expectedCycleLengths[cycleIndex] ?? 100_000_000n;
      const lastRecord = firstRecord + length - 1n;
      for (const recordCount of [firstRecord, lastRecord]) {
        expect(await token.getReward(recordCount), `recordCount=${recordCount}`).to.equal(
          expectedReward,
        );
      }
      if (expectedReward === 0n) break;
      firstRecord = lastRecord + 1n;
      expectedReward /= 2n;
    }

    expect(await token.getReward(hre.ethers.MaxUint256)).to.equal(0n);
  });

  it("has an exact theoretical issuance below the hard cap when rewards round to zero", async () => {
    const token = await deployToken();
    const initialReward = await token.INITIAL_REWARD();
    const maxSupply = await token.MAX_SUPPLY();

    let theoreticalIssuance = 0n;
    for (let cycleIndex = 0; cycleIndex < expectedCycleLengths.length; cycleIndex++) {
      theoreticalIssuance +=
        expectedCycleLengths[cycleIndex] * (initialReward >> BigInt(cycleIndex));
    }
    for (let cycleIndex = expectedCycleLengths.length; ; cycleIndex++) {
      const reward = initialReward >> BigInt(cycleIndex);
      if (reward === 0n) break;
      theoreticalIssuance += 100_000_000n * reward;
    }

    expect(theoreticalIssuance).to.equal(99_999_287_961_999_999_997_100_000_000n);
    expect(maxSupply - theoreticalIssuance).to.equal(712_038_000_000_002_900_000_000n);
  });

  it("mints the last scheduled reward and cannot restart exhausted rewards after a burn", async () => {
    const [, miner] = await hre.ethers.getSigners();
    const { token, minter } = await deployBoundToken("DeepFamilyTokenHarness");
    const minerAddress = await miner.getAddress();
    const lastRewardedRecord = 6_911_111_111n;

    await token.setTotalAdditionsForTest(lastRewardedRecord - 1n);

    expect(await minter.mint.staticCall(minerAddress)).to.equal(1n);
    await expect(minter.mint(minerAddress))
      .to.emit(token, "MiningReward")
      .withArgs(minerAddress, 1n, lastRewardedRecord)
      .and.to.emit(token, "Transfer")
      .withArgs(hre.ethers.ZeroAddress, minerAddress, 1n);
    expect(await token.totalAdditions()).to.equal(lastRewardedRecord);
    expect(await token.totalSupply()).to.equal(1n);
    expect(await token.balanceOf(minerAddress)).to.equal(1n);
    expect(await token.recentReward()).to.equal(1n);

    async function expectExhaustedMint(expectedSupply) {
      expect(await minter.mint.staticCall(minerAddress)).to.equal(0n);
      const transaction = await minter.mint(minerAddress);
      await expect(transaction).to.not.emit(token, "MiningReward");
      await expect(transaction).to.not.emit(token, "Transfer");
      expect(await token.totalAdditions()).to.equal(lastRewardedRecord);
      expect(await token.totalSupply()).to.equal(expectedSupply);
      expect(await token.balanceOf(minerAddress)).to.equal(expectedSupply);
      expect(await token.recentReward()).to.equal(0n);
    }

    await expectExhaustedMint(1n);
    await expectExhaustedMint(1n);
    await token.connect(miner).burn(1n);
    await expectExhaustedMint(0n);
  });

  it("truncates the final reward at the live supply cap and stops until supply is burned", async () => {
    const [holder, miner] = await hre.ethers.getSigners();
    const { token, minter } = await deployBoundToken("DeepFamilyTokenHarness");
    const maxSupply = await token.MAX_SUPPLY();
    const holderAddress = await holder.getAddress();
    const minerAddress = await miner.getAddress();

    await token.seedSupply(holderAddress, maxSupply - 1n);

    await expect(minter.mint(minerAddress))
      .to.emit(token, "MiningReward")
      .withArgs(minerAddress, 1n, 1n);
    expect(await token.totalSupply()).to.equal(maxSupply);
    expect(await token.recentReward()).to.equal(1n);

    await expect(minter.mint(minerAddress)).to.not.emit(token, "MiningReward");
    expect(await token.totalSupply()).to.equal(maxSupply);
    expect(await token.totalAdditions()).to.equal(1n);
    expect(await token.recentReward()).to.equal(0n);

    await token.connect(holder).burn(10n);
    await expect(minter.mint(minerAddress))
      .to.emit(token, "MiningReward")
      .withArgs(minerAddress, 10n, 2n);
    expect(await token.totalSupply()).to.equal(maxSupply);
  });

  it("supports standard approvals and holder or approved burns", async () => {
    const [holder, spender] = await hre.ethers.getSigners();
    const { token, minter } = await deployBoundToken();
    const holderAddress = await holder.getAddress();
    const spenderAddress = await spender.getAddress();

    await minter.mint(holderAddress);
    const supplyBefore = await token.totalSupply();

    await token.approve(spenderAddress, 15n);
    expect(await token.allowance(holderAddress, spenderAddress)).to.equal(15n);

    await token.connect(spender).burnFrom(holderAddress, 10n);
    await token.burn(7n);

    expect(await token.allowance(holderAddress, spenderAddress)).to.equal(5n);
    expect(await token.totalSupply()).to.equal(supplyBefore - 17n);
  });
});
