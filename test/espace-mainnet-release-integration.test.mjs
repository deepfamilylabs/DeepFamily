import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";

import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";
import { buildMainnetReleaseIntents } from "../scripts/lib/mainnetReleaseIntents.mjs";
import { createCheckpointedTransactionExecutor } from "../scripts/lib/mainnetReleaseState.mjs";
import { assertOnChainProtocolDeploymentRuntimes } from "../scripts/lib/protocolDeploymentProjection.mjs";
import {
  groth16VerifierAdapterBindingsFromAddresses,
  inspectProtocolDeploymentArtifacts,
  shieldedDeploymentBindingsFromAddresses,
} from "../scripts/lib/protocolReleaseManifest.mjs";
import {
  SHIELDED_DEPLOYMENT_CIRCUITS,
  PROTOCOL_DEPLOYMENT_CIRCUITS,
  RECEIVE_DEPLOYMENT_CONTRACTS,
  receiveDeploymentConstructorArgs,
  receiveDeploymentLibraries,
  integratedDeploymentAddresses,
} from "../scripts/lib/zkDeploymentCatalog.mjs";

describe("eSpace Mainnet resumable deployment integration", function () {
  this.timeout(120_000);

  it("reconstructs the integrated deployment from its transaction journal without a second broadcast", async function () {
    const connection = await hre.network.create();
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
    expect(Object.keys(checkpoint.transactions)).to.have.length(
      Object.keys(first.transactionReceipts).length,
    );
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
    expect(await second.archive.getAddress()).to.equal(await first.archive.getAddress());
    expect(await second.deepFamilyReader.getAddress()).to.equal(
      await first.deepFamilyReader.getAddress(),
    );

    const addresses = await integratedDeploymentAddresses(first);
    const deploymentArtifacts = inspectProtocolDeploymentArtifacts({
      root: process.cwd(),
      deployments: {
        ...shieldedDeploymentBindingsFromAddresses(addresses),
        groth16VerifierAdapter: groth16VerifierAdapterBindingsFromAddresses(addresses),
        deepFamilyArchive: { deepFamilyImmutable: addresses.deepFamily },
        deepFamilyReader: {
          deepFamilyImmutable: addresses.deepFamily,
          archiveImmutable: addresses.deepFamilyArchive,
        },
      },
    });
    await assertOnChainProtocolDeploymentRuntimes({
      provider: ethers.provider,
      plannedAddresses: addresses,
      deploymentArtifacts,
    });
  });

  it("matches all generated intents to the Hardhat factories used by the live release", async function () {
    const connection = await hre.network.create();
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
      minDelaySeconds: 604_800,
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
    const Archive = await ethers.getContractFactory("DeepFamilyArchive", deployer);
    const Reader = await ethers.getContractFactory("DeepFamilyReader", deployer);
    const PoseidonT3 = await ethers.getContractFactory("PoseidonT3", deployer);
    const PoseidonT4 = await ethers.getContractFactory("PoseidonT4", deployer);
    const PoseidonT6 = await ethers.getContractFactory("PoseidonT6", deployer);
    const LineageIndex = await ethers.getContractFactory("DeepFamilyLineageIndex", {
      signer: deployer,
      libraries: {
        PoseidonT3: address("poseidonT3"),
        PoseidonT4: address("poseidonT4"),
        PoseidonT5: address("poseidonT5"),
        PoseidonT6: address("poseidonT6"),
      },
    });
    const initializeData = DeepFamily.interface.encodeFunctionData("initialize", [
      address("deepFamilyToken"),
      deployerAddress,
    ]);
    const requests = {
      governanceTimelock: await Timelock.getDeployTransaction(604_800, multisig),
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
      deepFamilyArchive: await Archive.getDeployTransaction(address("deepFamilyProxy")),
      deepFamilyReader: await Reader.getDeployTransaction(address("deepFamilyProxy")),
      tokenInitialize: {
        to: address("deepFamilyToken"),
        data: Token.interface.encodeFunctionData("initialize", [address("deepFamilyProxy")]),
      },
      setArchive: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("setArchive", [address("deepFamilyArchive")]),
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
      poseidonT3: await PoseidonT3.getDeployTransaction(),
      poseidonT4: await PoseidonT4.getDeployTransaction(),
      poseidonT6: await PoseidonT6.getDeployTransaction(),
      deepFamilyLineageIndex: await LineageIndex.getDeployTransaction(address("deepFamilyProxy")),
      setLineageIndex: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("setLineageIndex", [
          address("deepFamilyLineageIndex"),
        ]),
      },
      transferDeepFamilyOwnership: {
        to: address("deepFamilyProxy"),
        data: DeepFamily.interface.encodeFunctionData("transferOwnership", [
          address("governanceTimelock"),
        ]),
      },
    };
    for (const spec of Object.values(SHIELDED_DEPLOYMENT_CIRCUITS)) {
      requests[spec.verifierLabel] = await (
        await ethers.getContractFactory(spec.verifierContractName, deployer)
      ).getDeployTransaction();
    }
    requests.shieldedBoundaryVerifierAdapter = await (
      await ethers.getContractFactory("ShieldedBoundaryVerifierAdapter", deployer)
    ).getDeployTransaction(
      address("shieldedShieldVerifier"),
      address("shieldedUnshieldVerifier"),
      address("shieldedUnshield4Verifier"),
    );
    for (const spec of Object.values(PROTOCOL_DEPLOYMENT_CIRCUITS)) {
      requests[spec.generatedLabel] = await (
        await ethers.getContractFactory(spec.contract, deployer)
      ).getDeployTransaction();
      requests[spec.adapterLabel] = await (
        await ethers.getContractFactory("FixedGroth16Verifier", deployer)
      ).getDeployTransaction(address(spec.generatedLabel), spec.publicSignals);
    }
    const receiveAddresses = Object.fromEntries(
      intents
        .filter((intent) => intent.kind === "deployment")
        .map(({ label, predictedAddress }) => [label, predictedAddress]),
    );
    receiveAddresses.deepFamily = address("deepFamilyProxy");
    receiveAddresses.lineageIndex = address("deepFamilyLineageIndex");
    for (const { contractName, property } of RECEIVE_DEPLOYMENT_CONTRACTS) {
      requests[property] = await (
        await ethers.getContractFactory(contractName, {
          signer: deployer,
          libraries: receiveDeploymentLibraries(property, receiveAddresses),
        })
      ).getDeployTransaction(...receiveDeploymentConstructorArgs(property, receiveAddresses));
    }
    const nativePool = await ethers.getContractFactory("ShieldedNativePool", {
      signer: deployer,
      libraries: { PoseidonT3: address("poseidonT3") },
    });
    requests.shieldedNativePool = await nativePool.getDeployTransaction(
      address("shieldedBoundaryVerifierAdapter"),
      address("receiveRegistry"),
      address("protocolFundVerifier"),
      address("protocolClaimVerifier"),
      address("protocolTransferVerifier"),
    );
    const poolFactory = await ethers.getContractFactory("ShieldedPoolFactory", {
      signer: deployer,
      libraries: { PoseidonT3: address("poseidonT3") },
    });
    requests.shieldedPoolFactory = await poolFactory.getDeployTransaction(
      address("deepFamilyToken"),
      address("shieldedBoundaryVerifierAdapter"),
      address("shieldedNativePool"),
      address("receiveRegistry"),
      address("protocolFundVerifier"),
      address("protocolClaimVerifier"),
      address("protocolTransferVerifier"),
    );
    requests.setEligibilitySource = {
      to: address("deepFamilyProxy"),
      data: DeepFamily.interface.encodeFunctionData("setEligibilitySource", [
        address("eligibilitySource"),
      ]),
    };
    expect(Object.keys(requests)).to.have.length(intents.length);

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
