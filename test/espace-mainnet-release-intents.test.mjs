import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";

import {
  buildMainnetReleaseIntents,
  deriveMainnetReleaseIntentsDigest,
} from "../scripts/lib/espaceMainnetReleaseIntents.mjs";
import { ESPACE_MAINNET_TRANSACTION_LABELS } from "../scripts/lib/espaceMainnetReleaseSafety.mjs";

const DEPLOYER = "0x1000000000000000000000000000000000000001";
const MULTISIG = "0x2000000000000000000000000000000000000002";
const STARTING_NONCE = 41;
const CHAIN_ID = 1030n;
const MIN_DELAY = 86_400;

const artifactPaths = {
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
  DeepFamilyReader: "artifacts/contracts/DeepFamilyReader.sol/DeepFamilyReader.json",
};

const artifacts = {
  readArtifact: async (name) =>
    JSON.parse(await fs.readFile(path.join(process.cwd(), artifactPaths[name]), "utf8")),
};

const build = () =>
  buildMainnetReleaseIntents({
    ethers,
    artifacts,
    deployer: DEPLOYER,
    startingNonce: STARTING_NONCE,
    chainId: CHAIN_ID,
    minDelaySeconds: MIN_DELAY,
    governanceMultisig: MULTISIG,
  });

const constructorData = (intent, artifact) =>
  `0x${intent.data.slice(String(artifact.bytecode).length)}`;

describe("eSpace Mainnet release transaction intents", function () {
  it("reconstructs the exact ten deployments and four calls in nonce order", async function () {
    const intents = await build();
    expect(intents.map(({ label }) => label)).to.deep.equal(ESPACE_MAINNET_TRANSACTION_LABELS);
    expect(intents).to.have.length(14);
    for (const [index, intent] of intents.entries()) {
      expect(intent.nonce).to.equal(STARTING_NONCE + index);
      expect(intent.from).to.equal(ethers.getAddress(DEPLOYER));
      expect(intent.chainId).to.equal("1030");
      expect(intent.value).to.equal("0");
      expect(intent.dataHash).to.equal(ethers.keccak256(intent.data));
      if (index < 10) {
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

    const tokenInitialize = tokenInterface.decodeFunctionData(
      "initialize",
      byLabel.tokenInitialize.data,
    );
    expect(byLabel.tokenInitialize.to).to.equal(byLabel.deepFamilyToken.predictedAddress);
    expect(tokenInitialize[0]).to.equal(byLabel.deepFamilyProxy.predictedAddress);

    for (const [label, purpose] of [
      ["setPersonCommitmentVerifier", 0n],
      ["setDisclosureBindingVerifier", 1n],
    ]) {
      const args = deepInterface.decodeFunctionData("setVerifier", byLabel[label].data);
      expect(byLabel[label].to).to.equal(byLabel.deepFamilyProxy.predictedAddress);
      expect(args[0]).to.equal(1n);
      expect(args[1]).to.equal(purpose);
      expect(args[2]).to.equal(byLabel.groth16VerifierAdapter.predictedAddress);
    }
    const ownership = deepInterface.decodeFunctionData(
      "transferOwnership",
      byLabel.transferDeepFamilyOwnership.data,
    );
    expect(byLabel.transferDeepFamilyOwnership.to).to.equal(
      byLabel.deepFamilyProxy.predictedAddress,
    );
    expect(ownership[0]).to.equal(byLabel.governanceTimelock.predictedAddress);
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
