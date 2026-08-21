import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import { buildMainnetReleaseIntents } from "../scripts/lib/mainnetReleaseIntents.mjs";
import { createCheckpointedTransactionExecutor } from "../scripts/lib/mainnetReleaseState.mjs";

describe("eSpace Mainnet resumable deployment integration", function () {
  this.timeout(120_000);

  it("reconstructs the integrated deployment from its transaction journal without a second broadcast", async function () {
    const connection = await hre.network.connect();
    const { ethers } = connection;
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const checkpoint = { transactions: {} };
    const transactionExecutor = createCheckpointedTransactionExecutor({
      provider: ethers.provider,
      signer: deployer,
      checkpoint,
      saveCheckpoint: async () => {},
      maxCostWei: ethers.parseEther("1000"),
    });

    const first = await deployIntegratedSystem(connection, {
      signer: deployer,
      transactionExecutor,
      transactionTimeoutMs: 30_000,
    });
    const nonceAfterFirst = await ethers.provider.getTransactionCount(deployerAddress, "pending");
    expect(Object.keys(checkpoint.transactions)).to.have.length(14);
    expect(
      Object.values(checkpoint.transactions).every((transaction) =>
        ["confirmed", "finalized"].includes(transaction.status),
      ),
    ).to.equal(true);

    const second = await deployIntegratedSystem(connection, {
      signer: deployer,
      transactionExecutor,
      transactionTimeoutMs: 30_000,
    });
    const nonceAfterSecond = await ethers.provider.getTransactionCount(deployerAddress, "pending");

    expect(nonceAfterSecond).to.equal(nonceAfterFirst);
    expect(await second.token.getAddress()).to.equal(await first.token.getAddress());
    expect(await second.deepFamily.getAddress()).to.equal(await first.deepFamily.getAddress());
    expect(await second.metadataArchive.getAddress()).to.equal(
      await first.metadataArchive.getAddress(),
    );
    expect(await second.deepFamilyReader.getAddress()).to.equal(
      await first.deepFamilyReader.getAddress(),
    );
  });

  it("matches all generated intents to the Hardhat factories used by the live release", async function () {
    const connection = await hre.network.connect();
    const { ethers } = connection;
    const [deployer] = await ethers.getSigners();
    const deployerAddress = await deployer.getAddress();
    const multisig = "0x2000000000000000000000000000000000000002";
    const startingNonce = 50;
    const intents = await buildMainnetReleaseIntents({
      ethers,
      artifacts: hre.artifacts,
      deployer: deployerAddress,
      startingNonce,
      chainId: 1030n,
      minDelaySeconds: 86_400,
      governanceMultisig: multisig,
    });
    const byLabel = Object.fromEntries(intents.map((intent) => [intent.label, intent]));
    const address = (label) => byLabel[label].predictedAddress;

    const Timelock = await ethers.getContractFactory("GovernanceTimelock", deployer);
    const Token = await ethers.getContractFactory("DeepFamilyToken", deployer);
    const PoseidonT5 = await ethers.getContractFactory("PoseidonT5", deployer);
    const AdultAgeGate = await ethers.getContractFactory("AdultAgeGate", deployer);
    const PersonVerifier = await ethers.getContractFactory("PersonCommitmentVerifier", deployer);
    const DisclosureVerifier = await ethers.getContractFactory(
      "DisclosureBindingVerifier",
      deployer,
    );
    const Adapter = await ethers.getContractFactory("Groth16VerifierAdapter", deployer);
    const DeepFamily = await ethers.getContractFactory("DeepFamily", {
      signer: deployer,
      libraries: {
        PoseidonT5: address("poseidonT5"),
        AdultAgeGate: address("adultAgeGate"),
      },
    });
    const Proxy = await ethers.getContractFactory("UUPSProxy", deployer);
    const Archive = await ethers.getContractFactory("MetadataArchiveV1", deployer);
    const Reader = await ethers.getContractFactory("DeepFamilyReader", deployer);
    const initializeData = DeepFamily.interface.encodeFunctionData("initialize", [
      address("deepFamilyToken"),
      deployerAddress,
    ]);
    const requests = {
      governanceTimelock: await Timelock.getDeployTransaction(86_400, multisig),
      deepFamilyToken: await Token.getDeployTransaction(),
      poseidonT5: await PoseidonT5.getDeployTransaction(),
      adultAgeGate: await AdultAgeGate.getDeployTransaction(),
      personCommitmentVerifier: await PersonVerifier.getDeployTransaction(),
      disclosureBindingVerifier: await DisclosureVerifier.getDeployTransaction(),
      groth16VerifierAdapter: await Adapter.getDeployTransaction(
        address("personCommitmentVerifier"),
        address("disclosureBindingVerifier"),
      ),
      deepFamilyImplementation: await DeepFamily.getDeployTransaction(),
      deepFamilyProxy: await Proxy.getDeployTransaction(
        address("deepFamilyImplementation"),
        initializeData,
      ),
      metadataArchiveV1: await Archive.getDeployTransaction(address("deepFamilyProxy")),
      deepFamilyReader: await Reader.getDeployTransaction(address("deepFamilyProxy")),
      tokenInitialize: {
        to: address("deepFamilyToken"),
        data: Token.interface.encodeFunctionData("initialize", [address("deepFamilyProxy")]),
      },
      setMetadataArchive: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("setMetadataArchive", [
          address("metadataArchiveV1"),
        ]),
      },
      setPersonRelationVerifier: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("setCircuitVerifier", [
          0,
          1,
          address("groth16VerifierAdapter"),
        ]),
      },
      setDisclosureBindingVerifier: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("setCircuitVerifier", [
          1,
          1,
          address("groth16VerifierAdapter"),
        ]),
      },
      transferDeepFamilyOwnership: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("transferOwnership", [
          address("governanceTimelock"),
        ]),
      },
    };

    for (const intent of intents) {
      const request = requests[intent.label];
      expect(request, intent.label).to.be.an("object");
      expect(request.to ?? null, `${intent.label} target`).to.equal(intent.to);
      expect(ethers.hexlify(request.data ?? "0x"), `${intent.label} calldata`).to.equal(
        intent.data,
      );
      expect(BigInt(request.value ?? 0n), `${intent.label} value`).to.equal(BigInt(intent.value));
    }
  });
});
