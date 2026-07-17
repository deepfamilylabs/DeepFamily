import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

describe("DeepFamilyToken", function () {
  this.timeout(120_000);

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

    expect(await token.owner()).to.equal(await owner.getAddress());
  });

  it("binds exactly once to a contract that points back to this token", async () => {
    const token = await deployToken();
    const minter = await deployMinter(await token.getAddress());
    const minterAddress = await minter.getAddress();

    await expect(token.initialize(minterAddress))
      .to.emit(token, "DeepFamilyContractInitialized")
      .withArgs(minterAddress);

    expect(await token.deepFamilyContract()).to.equal(minterAddress);
    await expect(token.initialize(minterAddress)).to.be.revertedWithCustomError(
      token,
      "AlreadyInitialized",
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

  it("returns the expected rewards at every important cycle boundary", async () => {
    const token = await deployToken();
    const initialReward = await token.INITIAL_REWARD();

    await expect(token.getReward(0)).to.be.revertedWithCustomError(token, "InvalidRecordCount");

    const cases = [
      [1n, initialReward],
      [2n, initialReward >> 1n],
      [11n, initialReward >> 1n],
      [12n, initialReward >> 2n],
      [111n, initialReward >> 2n],
      [112n, initialReward >> 3n],
      [111_111_111n, initialReward >> 8n],
      [111_111_112n, initialReward >> 9n],
      [211_111_111n, initialReward >> 9n],
      [211_111_112n, initialReward >> 10n],
      [6_911_111_111n, 1n],
      [6_911_111_112n, 0n],
    ];

    for (const [recordCount, expectedReward] of cases) {
      expect(await token.getReward(recordCount), `recordCount=${recordCount}`).to.equal(
        expectedReward,
      );
    }
  });

  it("has an exact theoretical issuance below the hard cap when rewards round to zero", async () => {
    const token = await deployToken();
    const initialReward = await token.INITIAL_REWARD();
    const maxSupply = await token.MAX_SUPPLY();
    const cycleLengths = [
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

    let theoreticalIssuance = 0n;
    for (let cycleIndex = 0; cycleIndex < cycleLengths.length; cycleIndex++) {
      theoreticalIssuance += cycleLengths[cycleIndex] * (initialReward >> BigInt(cycleIndex));
    }
    for (let cycleIndex = cycleLengths.length; ; cycleIndex++) {
      const reward = initialReward >> BigInt(cycleIndex);
      if (reward === 0n) break;
      theoreticalIssuance += 100_000_000n * reward;
    }

    expect(theoreticalIssuance).to.equal(99_999_287_961_999_999_997_100_000_000n);
    expect(maxSupply - theoreticalIssuance).to.equal(712_038_000_000_002_900_000_000n);
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

  it("supports allowance adjustments and holder or approved burns", async () => {
    const [holder, spender] = await hre.ethers.getSigners();
    const { token, minter } = await deployBoundToken();
    const holderAddress = await holder.getAddress();
    const spenderAddress = await spender.getAddress();

    await minter.mint(holderAddress);
    const supplyBefore = await token.totalSupply();

    await token.increaseAllowance(spenderAddress, 20n);
    expect(await token.allowance(holderAddress, spenderAddress)).to.equal(20n);
    await token.decreaseAllowance(spenderAddress, 5n);
    expect(await token.allowance(holderAddress, spenderAddress)).to.equal(15n);
    await expect(token.decreaseAllowance(spenderAddress, 16n)).to.be.revertedWithCustomError(
      token,
      "AllowanceBelowZero",
    );

    await token.connect(spender).burnFrom(holderAddress, 10n);
    await token.burn(7n);

    expect(await token.allowance(holderAddress, spenderAddress)).to.equal(5n);
    expect(await token.totalSupply()).to.equal(supplyBefore - 17n);
  });
});
