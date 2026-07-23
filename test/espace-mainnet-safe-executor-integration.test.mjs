import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

import { createCheckpointedTransactionExecutor } from "../scripts/lib/espaceMainnetReleaseState.mjs";

describe("eSpace Mainnet Safe factory-call journal integration", function () {
  it("checkpoints one CALL and revalidates it without a second broadcast", async function () {
    const connection = await hre.network.connect();
    const { ethers } = connection;
    const [deployer, target] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const targetAddress = await target.getAddress();
    const network = await ethers.provider.getNetwork();
    const startingNonce = await ethers.provider.getTransactionCount(deployerAddress, "pending");
    const request = { to: targetAddress, value: 0n, data: "0x" };
    const intent = {
      label: "createGovernanceSafe",
      kind: "call",
      nonce: startingNonce,
      from: deployerAddress,
      chainId: network.chainId.toString(),
      to: targetAddress,
      value: "0",
      data: "0x",
      dataHash: ethers.keccak256("0x"),
      predictedAddress: null,
    };
    const checkpoint = {
      transactions: {},
    };
    let saves = 0;
    const executor = createCheckpointedTransactionExecutor({
      provider: ethers.provider,
      signer: deployer,
      checkpoint,
      saveCheckpoint: async () => {
        saves += 1;
      },
      maxCostWei: ethers.parseEther("1"),
      expectedNonces: { createGovernanceSafe: startingNonce },
      expectedIntents: [intent],
      budgetEnvironmentName: "ESPACE_MAINNET_SAFE_MAX_CFX",
      recoveryEnvironmentName: "ESPACE_MAINNET_SAFE_RECOVERY_TX",
    });

    const firstReceipt = await executor({
      label: "createGovernanceSafe",
      kind: "call",
      transactionRequest: request,
      transactionConfirmations: 1,
      transactionTimeoutMs: 30_000,
    });
    const nonceAfterFirst = await ethers.provider.getTransactionCount(deployerAddress, "pending");
    const firstHash = checkpoint.transactions.createGovernanceSafe.hash;

    expect(firstReceipt.status).to.equal(1);
    expect(checkpoint.transactions.createGovernanceSafe.kind).to.equal("call");
    expect(checkpoint.transactions.createGovernanceSafe.predictedAddress).to.equal(null);
    expect(checkpoint.transactions.createGovernanceSafe.status).to.equal("confirmed");
    expect(nonceAfterFirst).to.equal(startingNonce + 1);
    expect(saves).to.be.greaterThanOrEqual(2);

    const secondReceipt = await executor({
      label: "createGovernanceSafe",
      kind: "call",
      transactionRequest: request,
      transactionConfirmations: 1,
      transactionTimeoutMs: 30_000,
    });
    const nonceAfterSecond = await ethers.provider.getTransactionCount(deployerAddress, "pending");

    expect(secondReceipt.hash).to.equal(firstHash);
    expect(checkpoint.transactions.createGovernanceSafe.hash).to.equal(firstHash);
    expect(nonceAfterSecond).to.equal(nonceAfterFirst);
  });
});
