import { createHash } from "node:crypto";
import { expect } from "chai";
import { ethers } from "ethers";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE } from "../scripts/lib/chainProfiles.mjs";
import { SHIELDED_DEPLOYMENT_CIRCUITS } from "../scripts/lib/zkDeploymentCatalog.mjs";
import {
  MAINNET_DEPLOYMENT_NONCE_OFFSETS,
  assertOnChainProtocolDeploymentRuntimes,
  assertPlannedProtocolDeploymentMatchesManifest,
  buildPlannedProtocolDeploymentEvidence,
  deriveMainnetPlannedAddresses,
} from "../scripts/lib/protocolDeploymentProjection.mjs";
import {
  buildProtocolDeploymentProjectionPlan,
  parseProtocolDeploymentProjectionArguments,
} from "../scripts/protocol-deployment-projection.mjs";
import {
  GROTH16_ADAPTER_IMMUTABLE_FIELDS,
  PROTOCOL_DEPLOYMENT_ARTIFACTS,
  inspectProtocolDeploymentArtifact,
} from "../scripts/lib/protocolReleaseManifest.mjs";

const DEPLOYER = "0x1000000000000000000000000000000000000001";
const STARTING_NONCE = 41;
const PROOF_ROUTES = Object.freeze([
  Object.freeze({
    purpose: "PersonRelation",
    purposeOrdinal: 0,
    circuitId: 1,
    proofEncodingId: 1,
  }),
  Object.freeze({
    purpose: "DisclosureBinding",
    purposeOrdinal: 1,
    circuitId: 1,
    proofEncodingId: 1,
  }),
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const fakeDeploymentArtifactInspector = ({ deployments }) => {
  const artifact = (label, immutables) => {
    const runtimeBytecode = `0x${sha256(`${label}:${JSON.stringify(immutables)}`)}`;
    return Object.freeze({
      path: `artifacts/${label}.json`,
      artifactSha256: sha256(`artifact:${label}`),
      runtimeSha256: sha256(Buffer.from(runtimeBytecode.slice(2), "hex")),
      runtimeBytecode,
    });
  };
  return Object.freeze({
    shieldedVerifiers: Object.fromEntries(
      Object.entries(deployments.shieldedVerifiers).map(([action, record]) => [
        action,
        artifact(SHIELDED_DEPLOYMENT_CIRCUITS[action].verifierContractName, record),
      ]),
    ),
    shieldedErc20Pool: artifact("ShieldedErc20Pool", deployments.shieldedErc20Pool),
    shieldedNativePool: artifact("ShieldedNativePool", deployments.shieldedNativePool),
    shieldedPoolFactory: artifact("ShieldedPoolFactory", deployments.shieldedPoolFactory),
    groth16VerifierAdapter: artifact("Groth16VerifierAdapter", deployments.groth16VerifierAdapter),
    deepFamilyArchive: artifact("DeepFamilyArchive", {
      deepFamily: deployments.deepFamilyArchive.deepFamilyImmutable,
    }),
    deepFamilyReader: artifact("DeepFamilyReader", {
      deepFamily: deployments.deepFamilyReader.deepFamilyImmutable,
      archive: deployments.deepFamilyReader.archiveImmutable,
    }),
  });
};

const baseManifest = () => ({
  protocol: "deepfamily/onchain-biography-unified-passphrase-v1",
  protocolGeneration: "df-onchain-biography-v1",
  proofRoutes: PROOF_ROUTES.map((route) => ({ ...route })),
});

const fixtureFor = (chainProfile) => {
  const plannedAddresses = deriveMainnetPlannedAddresses({
    ethers,
    deployer: DEPLOYER,
    startingNonce: STARTING_NONCE,
  });
  const planned = buildPlannedProtocolDeploymentEvidence({
    chainId: chainProfile.mainnet.chainId,
    plannedAddresses,
    manifest: baseManifest(),
    deploymentArtifactInspector: fakeDeploymentArtifactInspector,
  });
  return {
    plannedAddresses,
    planned,
    manifest: { ...baseManifest(), deployments: structuredClone(planned.deployments) },
  };
};

const expectProjectionMismatch = (operation, message = /do not match|must bind/iu) => {
  expect(operation).to.throw(message);
};

describe("planned production protocol deployment projection", function () {
  it("derives every release address from the reviewed deployer nonce offsets", function () {
    const addresses = deriveMainnetPlannedAddresses({
      ethers,
      deployer: DEPLOYER,
      startingNonce: STARTING_NONCE,
    });
    expect(Object.keys(addresses)).to.deep.equal([
      ...Object.keys(MAINNET_DEPLOYMENT_NONCE_OFFSETS),
      "shieldedErc20Pool",
    ]);
    expect(addresses.shieldedErc20Pool).to.equal(
      ethers.getCreateAddress({ from: addresses.shieldedPoolFactory, nonce: 1 }),
    );
    for (const [label, offset] of Object.entries(MAINNET_DEPLOYMENT_NONCE_OFFSETS)) {
      expect(addresses[label]).to.equal(
        ethers.getCreateAddress({ from: DEPLOYER, nonce: STARTING_NONCE + offset }),
      );
    }
    expect(Object.isFrozen(addresses)).to.equal(true);
    expect(() =>
      deriveMainnetPlannedAddresses({
        ethers,
        deployer: DEPLOYER,
        startingNonce: Number.MAX_SAFE_INTEGER,
      }),
    ).to.throw("non-negative safe integer");
  });

  it("includes all five shielded verifiers behind the common seven-route adapter", function () {
    const fixture = fixtureFor(ESPACE_CHAIN_PROFILE);
    const contracts = fixture.planned.projection.contracts;
    expect(Object.keys(contracts.shieldedVerifiers)).to.deep.equal(
      Object.keys(SHIELDED_DEPLOYMENT_CIRCUITS),
    );
    expect(contracts.shieldedErc20Pool.tokenImmutable).to.equal(contracts.token);
    expect(contracts.shieldedPoolFactory.deepPool).to.equal(contracts.shieldedErc20Pool.address);
    expect(contracts.shieldedPoolFactory.nativePoolImmutable).to.equal(
      contracts.shieldedNativePool.address,
    );
    expect(contracts.shieldedErc20Pool.verifierAdapterImmutable).to.equal(
      contracts.groth16VerifierAdapter.address,
    );
    for (const action of Object.keys(SHIELDED_DEPLOYMENT_CIRCUITS)) {
      expect(contracts.groth16VerifierAdapter[`${action}VerifierImmutable`]).to.equal(
        contracts.shieldedVerifiers[action].address,
      );
    }
  });

  it("reconstructs the linked pool runtime and pins every adapter verifier", function () {
    const plannedAddresses = deriveMainnetPlannedAddresses({
      ethers,
      deployer: DEPLOYER,
      startingNonce: STARTING_NONCE,
    });
    const inspected = buildPlannedProtocolDeploymentEvidence({
      chainId: 1030,
      plannedAddresses,
      manifest: baseManifest(),
    });
    expect(Object.keys(inspected.artifacts.shieldedVerifiers)).to.have.length(5);
    expect(inspected.artifacts.shieldedErc20Pool.runtimeBytecode).to.include(
      plannedAddresses.poseidonT3.slice(2).toLowerCase(),
    );
    expect(PROTOCOL_DEPLOYMENT_ARTIFACTS.shieldedErc20Pool.libraryFields).to.deep.equal([
      "PoseidonT3",
    ]);
    expect(PROTOCOL_DEPLOYMENT_ARTIFACTS.shieldedErc20Pool.immutableFields).to.deep.equal([
      "TOKEN",
      "LINEAGE_INDEX",
      "VERIFIER",
    ]);
    const immutableValues = Object.fromEntries(
      GROTH16_ADAPTER_IMMUTABLE_FIELDS.map((getter) => [
        getter,
        inspected.deployments.groth16VerifierAdapter[`${getter}Immutable`],
      ]),
    );
    immutableValues.fundVerifier = plannedAddresses.shieldedClaimVerifier;
    const wrongRoute = inspectProtocolDeploymentArtifact({
      artifactName: "groth16VerifierAdapter",
      immutableValues,
    });
    expect(wrongRoute.runtimeSha256).not.to.equal(
      inspected.artifacts.groth16VerifierAdapter.runtimeSha256,
    );
  });

  for (const [profile, oppositeProfile] of [
    [ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE],
    [ETHEREUM_CHAIN_PROFILE, ESPACE_CHAIN_PROFILE],
  ]) {
    it(`accepts the exact ${profile.id} projection and rejects the opposite chain`, function () {
      const fixture = fixtureFor(profile);
      const matched = assertPlannedProtocolDeploymentMatchesManifest({
        chainId: profile.mainnet.chainId,
        plannedAddresses: fixture.plannedAddresses,
        manifest: fixture.manifest,
        deploymentArtifactInspector: fakeDeploymentArtifactInspector,
      });
      expect(matched.sha256).to.equal(fixture.planned.sha256);
      expect(matched.manifestProjectionSha256).to.equal(fixture.planned.sha256);

      const crossChainManifest = structuredClone(fixture.manifest);
      crossChainManifest.deployments.chainId = Number(oppositeProfile.mainnet.chainId);
      expectProjectionMismatch(
        () =>
          assertPlannedProtocolDeploymentMatchesManifest({
            chainId: profile.mainnet.chainId,
            plannedAddresses: fixture.plannedAddresses,
            manifest: crossChainManifest,
            deploymentArtifactInspector: fakeDeploymentArtifactInspector,
          }),
        new RegExp(
          `targets chainId ${oppositeProfile.mainnet.chainId}.*chainId ${profile.mainnet.chainId}`,
          "iu",
        ),
      );
    });

    it(`rejects every ${profile.id} manifest address, immutable, and artifact/runtime drift`, function () {
      const fixture = fixtureFor(profile);
      const mutations = [
        (manifest) => (manifest.deployments.deepFamilyProxy = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyImplementation = DEPLOYER),
        (manifest) => (manifest.deployments.groth16VerifierAdapter.address = DEPLOYER),
        (manifest) =>
          (manifest.deployments.groth16VerifierAdapter.personVerifierImmutable = DEPLOYER),
        (manifest) =>
          (manifest.deployments.groth16VerifierAdapter.disclosureBindingVerifierImmutable =
            DEPLOYER),
        ...Object.keys(SHIELDED_DEPLOYMENT_CIRCUITS).map(
          (action) => (manifest) =>
            (manifest.deployments.groth16VerifierAdapter[`${action}VerifierImmutable`] = DEPLOYER),
        ),
        (manifest) => (manifest.deployments.shieldedErc20Pool.verifierAdapterImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyArchive.address = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyArchive.deepFamilyImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.address = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.deepFamilyImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.archiveImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.groth16VerifierAdapter.artifactSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.groth16VerifierAdapter.runtimeSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.deepFamilyArchive.artifactSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.deepFamilyArchive.runtimeSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.deepFamilyReader.artifactSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.deepFamilyReader.runtimeSha256 = "f".repeat(64)),
      ];
      for (const mutate of mutations) {
        const changed = structuredClone(fixture.manifest);
        mutate(changed);
        expectProjectionMismatch(() =>
          assertPlannedProtocolDeploymentMatchesManifest({
            chainId: profile.mainnet.chainId,
            plannedAddresses: fixture.plannedAddresses,
            manifest: changed,
            deploymentArtifactInspector: fakeDeploymentArtifactInspector,
          }),
        );
      }
    });
  }

  it("checks immutable-linked deployed runtime bytes without masking", async function () {
    const fixture = fixtureFor(ESPACE_CHAIN_PROFILE);
    const codeByAddress = new Map([
      ...Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [
        fixture.plannedAddresses[spec.verifierLabel].toLowerCase(),
        fixture.planned.artifacts.shieldedVerifiers[action].runtimeBytecode,
      ]),
      [
        fixture.plannedAddresses.shieldedErc20Pool.toLowerCase(),
        fixture.planned.artifacts.shieldedErc20Pool.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.shieldedNativePool.toLowerCase(),
        fixture.planned.artifacts.shieldedNativePool.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.shieldedPoolFactory.toLowerCase(),
        fixture.planned.artifacts.shieldedPoolFactory.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.groth16VerifierAdapter.toLowerCase(),
        fixture.planned.artifacts.groth16VerifierAdapter.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.deepFamilyArchive.toLowerCase(),
        fixture.planned.artifacts.deepFamilyArchive.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.deepFamilyReader.toLowerCase(),
        fixture.planned.artifacts.deepFamilyReader.runtimeBytecode,
      ],
    ]);
    const provider = {
      getCode: async (address) => codeByAddress.get(address.toLowerCase()) ?? "0x",
    };
    await assertOnChainProtocolDeploymentRuntimes({
      provider,
      plannedAddresses: fixture.plannedAddresses,
      deploymentArtifacts: fixture.planned.artifacts,
    });
    codeByAddress.set(fixture.plannedAddresses.deepFamilyReader.toLowerCase(), "0x00");
    let error;
    try {
      await assertOnChainProtocolDeploymentRuntimes({
        provider,
        plannedAddresses: fixture.plannedAddresses,
        deploymentArtifacts: fixture.planned.artifacts,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).to.match(/DeepFamilyReader.*exactly match/iu);
  });

  it("parses a fail-closed, explicit read-only projection command", function () {
    const options = parseProtocolDeploymentProjectionArguments([
      "--nonce",
      String(STARTING_NONCE),
      "--chain",
      "espace",
      "--deployer",
      DEPLOYER,
    ]);
    expect(options).to.include({
      chainProfile: ESPACE_CHAIN_PROFILE,
      deployer: ethers.getAddress(DEPLOYER),
      startingNonce: STARTING_NONCE,
    });
    for (const argv of [
      ["--chain", "espace", "--deployer", DEPLOYER],
      ["--chain", "espace", "--chain", "ethereum", "--nonce", "1"],
      ["--chain", "espace", "--deployer", DEPLOYER, "--nonce", "01"],
      ["--chain", "unknown", "--deployer", DEPLOYER, "--nonce", "1"],
    ]) {
      expect(() => parseProtocolDeploymentProjectionArguments(argv)).to.throw();
    }
  });

  it("emits a deterministic manifest-ready deployments fragment without requiring production", function () {
    const fixture = fixtureFor(ETHEREUM_CHAIN_PROFILE);
    const manifestEvidence = {
      manifestPath: "/fixture/protocol-release-manifest.json",
      manifestSha256: "a".repeat(64),
      manifest: baseManifest(),
    };
    const first = buildProtocolDeploymentProjectionPlan({
      chainProfile: ETHEREUM_CHAIN_PROFILE,
      deployer: DEPLOYER,
      startingNonce: STARTING_NONCE,
      root: "/fixture",
      manifestInspector: ({ requireProduction }) => {
        expect(requireProduction).to.equal(false);
        return manifestEvidence;
      },
      deploymentArtifactInspector: fakeDeploymentArtifactInspector,
    });
    const second = buildProtocolDeploymentProjectionPlan({
      chainProfile: ETHEREUM_CHAIN_PROFILE,
      deployer: DEPLOYER,
      startingNonce: STARTING_NONCE,
      root: "/fixture",
      manifestInspector: () => manifestEvidence,
      deploymentArtifactInspector: fakeDeploymentArtifactInspector,
    });
    expect(JSON.stringify(first)).to.equal(JSON.stringify(second));
    expect(first.mode).to.equal("read-only-planned-deployment-projection");
    expect(first.deployments).to.deep.equal(fixture.planned.deployments);
    expect(first.stableProjectionSha256).to.equal(fixture.planned.sha256);
  });
});
