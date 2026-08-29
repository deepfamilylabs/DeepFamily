import { createHash } from "node:crypto";
import { expect } from "chai";
import { ethers } from "ethers";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE } from "../scripts/lib/chainProfiles.mjs";
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
    groth16VerifierAdapter: artifact("Groth16VerifierAdapter", {
      personVerifier: deployments.groth16VerifierAdapter.personVerifierImmutable,
      disclosureBindingVerifier:
        deployments.groth16VerifierAdapter.disclosureBindingVerifierImmutable,
    }),
    metadataArchiveV1: artifact("MetadataArchiveV1", {
      deepFamily: deployments.metadataArchiveV1.deepFamilyImmutable,
    }),
    storyArchiveV1: artifact("StoryArchiveV1", {
      deepFamily: deployments.storyArchiveV1.deepFamilyImmutable,
    }),
    deepFamilyReader: artifact("DeepFamilyReader", {
      deepFamily: deployments.deepFamilyReader.deepFamilyImmutable,
      metadataArchive: deployments.deepFamilyReader.metadataArchiveImmutable,
      storyArchive: deployments.deepFamilyReader.storyArchiveImmutable,
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

const expectProjectionMismatch = (operation, message = /do not match/iu) => {
  expect(operation).to.throw(message);
};

describe("planned production protocol deployment projection", function () {
  it("derives every release address from the reviewed deployer nonce offsets", function () {
    const addresses = deriveMainnetPlannedAddresses({
      ethers,
      deployer: DEPLOYER,
      startingNonce: STARTING_NONCE,
    });
    expect(Object.keys(addresses)).to.deep.equal(Object.keys(MAINNET_DEPLOYMENT_NONCE_OFFSETS));
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
        (manifest) => (manifest.deployments.metadataArchiveV1.address = DEPLOYER),
        (manifest) => (manifest.deployments.metadataArchiveV1.deepFamilyImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.storyArchiveV1.address = DEPLOYER),
        (manifest) => (manifest.deployments.storyArchiveV1.deepFamilyImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.address = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.deepFamilyImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.metadataArchiveImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.deepFamilyReader.storyArchiveImmutable = DEPLOYER),
        (manifest) => (manifest.deployments.groth16VerifierAdapter.artifactSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.groth16VerifierAdapter.runtimeSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.metadataArchiveV1.artifactSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.metadataArchiveV1.runtimeSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.storyArchiveV1.artifactSha256 = "f".repeat(64)),
        (manifest) => (manifest.deployments.storyArchiveV1.runtimeSha256 = "f".repeat(64)),
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
      [
        fixture.plannedAddresses.groth16VerifierAdapter.toLowerCase(),
        fixture.planned.artifacts.groth16VerifierAdapter.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.metadataArchiveV1.toLowerCase(),
        fixture.planned.artifacts.metadataArchiveV1.runtimeBytecode,
      ],
      [
        fixture.plannedAddresses.storyArchiveV1.toLowerCase(),
        fixture.planned.artifacts.storyArchiveV1.runtimeBytecode,
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
