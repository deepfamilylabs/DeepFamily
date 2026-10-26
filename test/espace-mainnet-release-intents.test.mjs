import { expect } from "chai";
import { rejects } from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";

import {
  buildMainnetReleaseIntents,
  deriveMainnetReleaseIntentsDigest,
} from "../scripts/lib/mainnetReleaseIntents.mjs";
import {
  MAINNET_TRANSACTION_LABELS,
  assertCompleteMainnetSourceVerification,
} from "../scripts/lib/mainnetReleaseSafety.mjs";
import { deriveMainnetPlannedAddresses } from "../scripts/lib/protocolDeploymentProjection.mjs";
import {
  INTEGRATED_DEPLOYMENT_RECORDS,
  SHIELDED_DEPLOYMENT_CIRCUITS,
  RECEIVE_DEPLOYMENT_CONTRACTS,
  PROTOCOL_DEPLOYMENT_CIRCUITS,
} from "../scripts/lib/zkDeploymentCatalog.mjs";

const DEPLOYER = "0x1000000000000000000000000000000000000001";
const MULTISIG = "0x2000000000000000000000000000000000000002";
const STARTING_NONCE = 41;
const CHAIN_ID = 1030n;
const MIN_DELAY = 604_800;

const artifactPaths = {
  FixedGroth16Verifier: "artifacts/contracts/FixedGroth16Verifier.sol/FixedGroth16Verifier.json",
  ShieldedBoundaryVerifierAdapter:
    "artifacts/contracts/adapters/ShieldedBoundaryVerifierAdapter.sol/ShieldedBoundaryVerifierAdapter.json",
  ...Object.fromEntries(
    Object.values(PROTOCOL_DEPLOYMENT_CIRCUITS).map((spec) => [
      spec.contract,
      `artifacts/contracts/generated/protocol/${spec.contract}.sol/${spec.contract}.json`,
    ]),
  ),
  ...Object.fromEntries(
    RECEIVE_DEPLOYMENT_CONTRACTS.map(({ contractName }) => [
      contractName,
      `artifacts/contracts/${contractName}.sol/${contractName}.json`,
    ]),
  ),
  ...Object.fromEntries(
    Object.values(SHIELDED_DEPLOYMENT_CIRCUITS).map((spec) => [
      spec.verifierContractName,
      `artifacts/contracts/${spec.verifierContractName}.sol/${spec.verifierContractName}.json`,
    ]),
  ),
  ShieldedNativePool: "artifacts/contracts/ShieldedNativePool.sol/ShieldedNativePool.json",
  ShieldedPoolFactory: "artifacts/contracts/ShieldedPoolFactory.sol/ShieldedPoolFactory.json",
  ShieldedErc20Pool: "artifacts/contracts/ShieldedErc20Pool.sol/ShieldedErc20Pool.json",
  GovernanceTimelock:
    "artifacts/contracts/governance/GovernanceTimelock.sol/GovernanceTimelock.json",
  DeepFamilyToken: "artifacts/contracts/DeepFamilyToken.sol/DeepFamilyToken.json",
  PoseidonT5: "artifacts/poseidon-solidity/PoseidonT5.sol/PoseidonT5.json",
  AdultAgeGate: "artifacts/contracts/libraries/AdultAgeGate.sol/AdultAgeGate.json",
  PersonCommitmentVerifier:
    "artifacts/contracts/PersonCommitmentVerifier.sol/PersonCommitmentVerifier.json",
  DisclosureBindingVerifier:
    "artifacts/contracts/DisclosureBindingVerifier.sol/DisclosureBindingVerifier.json",
  Groth16VerifierAdapter:
    "artifacts/contracts/adapters/Groth16VerifierAdapter.sol/Groth16VerifierAdapter.json",
  DeepFamily: "artifacts/contracts/DeepFamily.sol/DeepFamily.json",
  UUPSProxy: "artifacts/contracts/proxy/UUPSProxy.sol/UUPSProxy.json",
  DeepFamilyArchive: "artifacts/contracts/DeepFamilyArchive.sol/DeepFamilyArchive.json",
  DeepFamilyReader: "artifacts/contracts/DeepFamilyReader.sol/DeepFamilyReader.json",
  PoseidonT3: "artifacts/poseidon-solidity/PoseidonT3.sol/PoseidonT3.json",
  PoseidonT4: "artifacts/poseidon-solidity/PoseidonT4.sol/PoseidonT4.json",
  PoseidonT6: "artifacts/poseidon-solidity/PoseidonT6.sol/PoseidonT6.json",
  DeepFamilyLineageIndex:
    "artifacts/contracts/DeepFamilyLineageIndex.sol/DeepFamilyLineageIndex.json",
};

const artifacts = {
  readArtifact: async (name) =>
    JSON.parse(await fs.readFile(path.join(process.cwd(), artifactPaths[name]), "utf8")),
};

const build = (overrides = {}) =>
  buildMainnetReleaseIntents({
    ethers,
    artifacts,
    deployer: DEPLOYER,
    startingNonce: STARTING_NONCE,
    chainId: CHAIN_ID,
    minDelaySeconds: MIN_DELAY,
    governanceMultisig: MULTISIG,
    ...overrides,
  });

const constructorData = (intent, artifact) =>
  `0x${intent.data.slice(String(artifact.bytecode).length)}`;

describe("eSpace Mainnet release transaction intents", function () {
  it("rejects deployment intents below seven days when called without the configuration parser", async function () {
    for (const minDelaySeconds of [0, 86_400, 172_800, 604_799]) {
      await rejects(
        () => build({ minDelaySeconds }),
        /minDelaySeconds must be at least 604800 seconds \(7 days\)/,
      );
    }
  });

  it("requires source verification for every deployed instance", function () {
    const addresses = deriveMainnetPlannedAddresses({
      ethers,
      deployer: DEPLOYER,
      startingNonce: STARTING_NONCE,
    });
    const contracts = [
      ["GovernanceTimelock", addresses.timelock],
      ["DeepFamily", addresses.deepFamilyImplementation],
      ["UUPSProxy", addresses.deepFamily],
      ...INTEGRATED_DEPLOYMENT_RECORDS.filter(
        (record) => record.deploymentName !== "DeepFamily",
      ).map((record) => [
        record.deploymentName,
        addresses[
          record.property === "shieldedErc20Pool"
            ? "shieldedErc20Pool"
            : record.transactionLabel === "deepFamilyToken"
              ? "token"
              : record.transactionLabel
        ],
      ]),
    ].map(([label, address]) => ({ label, address, status: "passed" }));
    expect(contracts).to.have.length(INTEGRATED_DEPLOYMENT_RECORDS.length + 2);
    expect(() => assertCompleteMainnetSourceVerification({ contracts, addresses })).not.to.throw();

    const wrongAdapter = contracts.map((contract) => ({ ...contract }));
    wrongAdapter.find((contract) => contract.label === "Groth16VerifierAdapter").address =
      addresses.protocolFundVerifier;
    expect(() =>
      assertCompleteMainnetSourceVerification({ contracts: wrongAdapter, addresses }),
    ).to.throw(/incomplete source verification/);
    const duplicate = contracts.map((contract) => ({ ...contract }));
    duplicate[duplicate.length - 1] = { ...duplicate[0] };
    expect(() =>
      assertCompleteMainnetSourceVerification({ contracts: duplicate, addresses }),
    ).to.throw(/incomplete source verification/);
  });

  it("reconstructs the complete current deployment graph and calls in nonce order", async function () {
    const intents = await build();
    expect(intents.map(({ label }) => label)).to.deep.equal(MAINNET_TRANSACTION_LABELS);
    expect(intents).to.have.length(MAINNET_TRANSACTION_LABELS.length);
    expect(intents.filter(({ kind }) => kind === "deployment")).to.have.length(
      INTEGRATED_DEPLOYMENT_RECORDS.length + 1,
    );
    for (const [index, intent] of intents.entries()) {
      expect(intent.nonce).to.equal(STARTING_NONCE + index);
      expect(intent.from).to.equal(ethers.getAddress(DEPLOYER));
      expect(intent.chainId).to.equal("1030");
      expect(intent.value).to.equal("0");
      expect(intent.dataHash).to.equal(ethers.keccak256(intent.data));
      if (intent.kind === "deployment") {
        expect(intent.kind).to.equal("deployment");
        expect(intent.to).to.equal(null);
        expect(intent.predictedAddress).to.equal(
          ethers.getCreateAddress({ from: DEPLOYER, nonce: STARTING_NONCE + index }),
        );
      } else {
        expect(intent.kind).to.equal("call");
        expect(intent.predictedAddress).to.equal(null);
      }
    }
  });

  it("binds constructor relationships, linked libraries, initializer and governance calls", async function () {
    const intents = await build();
    const byLabel = Object.fromEntries(intents.map((intent) => [intent.label, intent]));
    const loaded = Object.fromEntries(
      await Promise.all(
        Object.keys(artifactPaths).map(async (name) => [name, await artifacts.readArtifact(name)]),
      ),
    );
    const decodeConstructor = (label, contractName, types) =>
      ethers.AbiCoder.defaultAbiCoder().decode(
        types,
        constructorData(byLabel[label], loaded[contractName]),
      );

    const timelockArgs = decodeConstructor("governanceTimelock", "GovernanceTimelock", [
      "uint256",
      "address",
    ]);
    expect(timelockArgs[0]).to.equal(BigInt(MIN_DELAY));
    expect(timelockArgs[1]).to.equal(ethers.getAddress(MULTISIG));

    const adapterArgs = decodeConstructor("groth16VerifierAdapter", "Groth16VerifierAdapter", [
      "address",
      "address",
    ]);
    expect(adapterArgs[0]).to.equal(byLabel.personCommitmentVerifier.predictedAddress);
    expect(adapterArgs[1]).to.equal(byLabel.disclosureBindingVerifier.predictedAddress);
    const boundaryArgs = decodeConstructor(
      "shieldedBoundaryVerifierAdapter",
      "ShieldedBoundaryVerifierAdapter",
      Array(3).fill("address"),
    );
    expect([...boundaryArgs]).to.deep.equal(
      ["shieldedShieldVerifier", "shieldedUnshieldVerifier", "shieldedUnshield4Verifier"].map(
        (label) => byLabel[label].predictedAddress,
      ),
    );
    for (const spec of Object.values(PROTOCOL_DEPLOYMENT_CIRCUITS)) {
      const args = decodeConstructor(spec.adapterLabel, "FixedGroth16Verifier", [
        "address",
        "uint256",
      ]);
      expect(args[0]).to.equal(byLabel[spec.generatedLabel].predictedAddress);
      expect(args[1]).to.equal(BigInt(spec.publicSignals));
    }
    const poolArgs = decodeConstructor(
      "shieldedPoolFactory",
      "ShieldedPoolFactory",
      Array(7).fill("address"),
    );
    expect([...poolArgs]).to.deep.equal(
      [
        "deepFamilyToken",
        "shieldedBoundaryVerifierAdapter",
        "shieldedNativePool",
        "receiveRegistry",
        "protocolFundVerifier",
        "protocolClaimVerifier",
        "protocolTransferVerifier",
      ].map((label) => byLabel[label].predictedAddress),
    );
    const nativeArgs = decodeConstructor(
      "shieldedNativePool",
      "ShieldedNativePool",
      Array(5).fill("address"),
    );
    expect([...nativeArgs]).to.deep.equal(
      [
        "shieldedBoundaryVerifierAdapter",
        "receiveRegistry",
        "protocolFundVerifier",
        "protocolClaimVerifier",
        "protocolTransferVerifier",
      ].map((label) => byLabel[label].predictedAddress),
    );
    const sourceArgs = decodeConstructor(
      "eligibilitySource",
      "EligibilitySource",
      Array(3).fill("address"),
    );
    expect([...sourceArgs]).to.deep.equal(
      ["deepFamilyLineageIndex", "protocolSourceFactVerifier", "protocolSourceTrustVerifier"].map(
        (label) => byLabel[label].predictedAddress,
      ),
    );
    const registryArgs = decodeConstructor(
      "receiveRegistry",
      "ReceiveRegistry",
      Array(4).fill("address"),
    );
    expect([...registryArgs]).to.deep.equal(
      [
        "eligibilitySource",
        "protocolIssueVerifier",
        "protocolCodeVerifier",
        "protocolCapabilityVerifier",
      ].map((label) => byLabel[label].predictedAddress),
    );
    const letterArgs = decodeConstructor(
      "letterArchive",
      "LetterArchive",
      Array(2).fill("address"),
    );
    expect([...letterArgs]).to.deep.equal(
      ["deepFamilyProxy", "receiveRegistry"].map((label) => byLabel[label].predictedAddress),
    );

    const deepData = byLabel.deepFamilyImplementation.data.slice(2);
    for (const [sourceName, libraries] of Object.entries(loaded.DeepFamily.linkReferences)) {
      for (const [libraryName, references] of Object.entries(libraries)) {
        const expected =
          libraryName === "PoseidonT5"
            ? byLabel.poseidonT5.predictedAddress
            : byLabel.adultAgeGate.predictedAddress;
        expect(sourceName).to.be.a("string").and.not.empty;
        for (const { start, length } of references) {
          expect(deepData.slice(start * 2, (start + length) * 2)).to.equal(
            expected.slice(2).toLowerCase(),
          );
        }
      }
    }

    const deepInterface = new ethers.Interface(loaded.DeepFamily.abi);
    const tokenInterface = new ethers.Interface(loaded.DeepFamilyToken.abi);
    const proxyArgs = decodeConstructor("deepFamilyProxy", "UUPSProxy", ["address", "bytes"]);
    expect(proxyArgs[0]).to.equal(byLabel.deepFamilyImplementation.predictedAddress);
    const initialize = deepInterface.decodeFunctionData("initialize", proxyArgs[1]);
    expect(initialize[0]).to.equal(byLabel.deepFamilyToken.predictedAddress);
    expect(initialize[1]).to.equal(ethers.getAddress(DEPLOYER));

    const readerArgs = decodeConstructor("deepFamilyReader", "DeepFamilyReader", ["address"]);
    expect(readerArgs[0]).to.equal(byLabel.deepFamilyProxy.predictedAddress);
    const archiveArgs = decodeConstructor("deepFamilyArchive", "DeepFamilyArchive", ["address"]);
    expect(archiveArgs[0]).to.equal(byLabel.deepFamilyProxy.predictedAddress);

    const tokenInitialize = tokenInterface.decodeFunctionData(
      "initialize",
      byLabel.tokenInitialize.data,
    );
    expect(byLabel.tokenInitialize.to).to.equal(byLabel.deepFamilyToken.predictedAddress);
    expect(tokenInitialize[0]).to.equal(byLabel.deepFamilyProxy.predictedAddress);

    const setArchive = deepInterface.decodeFunctionData("setArchive", byLabel.setArchive.data);
    expect(byLabel.setArchive.to).to.equal(byLabel.deepFamilyProxy.predictedAddress);
    expect(setArchive[0]).to.equal(byLabel.deepFamilyArchive.predictedAddress);

    for (const [label, purpose] of [
      ["setPersonRelationVerifier", 0n],
      ["setDisclosureBindingVerifier", 1n],
    ]) {
      const args = deepInterface.decodeFunctionData("setCircuitVerifier", byLabel[label].data);
      expect(byLabel[label].to).to.equal(byLabel.deepFamilyProxy.predictedAddress);
      expect(args[0]).to.equal(purpose);
      expect(args[1]).to.equal(1n);
      expect(args[2]).to.equal(byLabel.groth16VerifierAdapter.predictedAddress);
    }
    const setSource = deepInterface.decodeFunctionData(
      "setEligibilitySource",
      byLabel.setEligibilitySource.data,
    );
    expect(byLabel.setEligibilitySource.to).to.equal(byLabel.deepFamilyProxy.predictedAddress);
    expect(setSource[0]).to.equal(byLabel.eligibilitySource.predictedAddress);
    expect(byLabel.setEligibilitySource.nonce).to.be.lessThan(
      byLabel.transferDeepFamilyOwnership.nonce,
    );
    const ownership = deepInterface.decodeFunctionData(
      "transferOwnership",
      byLabel.transferDeepFamilyOwnership.data,
    );
    expect(byLabel.transferDeepFamilyOwnership.to).to.equal(
      byLabel.deepFamilyProxy.predictedAddress,
    );
    expect(ownership[0]).to.equal(byLabel.governanceTimelock.predictedAddress);

    // The lineage index links all four Poseidon libraries and binds the proxy exactly once
    // before governance takes ownership.
    const indexData = byLabel.deepFamilyLineageIndex.data.slice(2);
    for (const libraries of Object.values(loaded.DeepFamilyLineageIndex.linkReferences)) {
      for (const [libraryName, references] of Object.entries(libraries)) {
        const expected =
          byLabel[`poseidon${libraryName.slice("Poseidon".length)}`].predictedAddress;
        for (const { start, length } of references) {
          expect(indexData.slice(start * 2, (start + length) * 2), libraryName).to.equal(
            expected.slice(2).toLowerCase(),
          );
        }
      }
    }
    const indexArgs = decodeConstructor("deepFamilyLineageIndex", "DeepFamilyLineageIndex", [
      "address",
    ]);
    expect(indexArgs[0]).to.equal(byLabel.deepFamilyProxy.predictedAddress);
    const setLineageIndex = deepInterface.decodeFunctionData(
      "setLineageIndex",
      byLabel.setLineageIndex.data,
    );
    expect(byLabel.setLineageIndex.to).to.equal(byLabel.deepFamilyProxy.predictedAddress);
    expect(setLineageIndex[0]).to.equal(byLabel.deepFamilyLineageIndex.predictedAddress);
    expect(byLabel.setLineageIndex.nonce).to.be.lessThan(byLabel.transferDeepFamilyOwnership.nonce);
  });

  it("changes the plan digest when any core intent field changes", async function () {
    const intents = await build();
    const digest = deriveMainnetReleaseIntentsDigest(ethers, intents);
    const replacements = {
      label: "changedLabel",
      kind: "changedKind",
      nonce: intents[0].nonce + 1,
      from: MULTISIG,
      chainId: "1",
      to: MULTISIG,
      value: "1",
      data: "0x01",
      dataHash: `0x${"11".repeat(32)}`,
      predictedAddress: MULTISIG,
    };
    for (const [field, replacement] of Object.entries(replacements)) {
      const changed = intents.map((intent) => ({ ...intent }));
      changed[0][field] = replacement;
      expect(deriveMainnetReleaseIntentsDigest(ethers, changed), field).to.not.equal(digest);
    }
  });
});
