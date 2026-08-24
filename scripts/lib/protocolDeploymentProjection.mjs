import {
  inspectProtocolDeploymentArtifacts,
  protocolCanonicalJson,
  protocolDeploymentEvidenceFromManifest,
  protocolDeploymentEvidenceSha256,
} from "./protocolReleaseManifest.mjs";

export const MAINNET_DEPLOYMENT_NONCE_OFFSETS = Object.freeze({
  timelock: 0,
  token: 1,
  poseidonT5: 2,
  adultAgeGate: 3,
  personCommitmentVerifier: 4,
  disclosureBindingVerifier: 5,
  groth16VerifierAdapter: 6,
  deepFamilyImplementation: 7,
  deepFamily: 8,
  metadataArchiveV1: 10,
  deepFamilyReader: 12,
});

const normalizeChainId = (value) => {
  const normalized = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new Error("planned deployment chainId must be a positive safe integer");
  }
  return normalized;
};

export const deriveMainnetPlannedAddresses = ({ ethers, deployer, startingNonce }) => {
  if (typeof ethers?.getAddress !== "function" || typeof ethers?.getCreateAddress !== "function") {
    throw new Error("ethers.getAddress and ethers.getCreateAddress are required");
  }
  const maximumOffset = Math.max(...Object.values(MAINNET_DEPLOYMENT_NONCE_OFFSETS));
  if (
    !Number.isSafeInteger(startingNonce) ||
    startingNonce < 0 ||
    startingNonce > Number.MAX_SAFE_INTEGER - maximumOffset
  ) {
    throw new Error("planned deployment starting nonce must be a non-negative safe integer");
  }
  const normalizedDeployer = ethers.getAddress(deployer);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(MAINNET_DEPLOYMENT_NONCE_OFFSETS).map(([label, offset]) => [
        label,
        ethers.getCreateAddress({ from: normalizedDeployer, nonce: startingNonce + offset }),
      ]),
    ),
  );
};

export const buildPlannedProtocolDeploymentEvidence = ({
  root = process.cwd(),
  chainId,
  plannedAddresses,
  manifest,
  deploymentArtifactInspector = inspectProtocolDeploymentArtifacts,
} = {}) => {
  if (typeof deploymentArtifactInspector !== "function") {
    throw new Error("deploymentArtifactInspector must be a function");
  }
  const deploymentBindings = {
    groth16VerifierAdapter: {
      personVerifierImmutable: plannedAddresses?.personCommitmentVerifier,
      disclosureBindingVerifierImmutable: plannedAddresses?.disclosureBindingVerifier,
    },
    metadataArchiveV1: { deepFamilyImmutable: plannedAddresses?.deepFamily },
    deepFamilyReader: {
      deepFamilyImmutable: plannedAddresses?.deepFamily,
      metadataArchiveImmutable: plannedAddresses?.metadataArchiveV1,
    },
  };
  const artifacts = deploymentArtifactInspector({ root, deployments: deploymentBindings });
  const deployments = Object.freeze({
    status: "production",
    chainId: normalizeChainId(chainId),
    deepFamilyProxy: plannedAddresses?.deepFamily,
    deepFamilyImplementation: plannedAddresses?.deepFamilyImplementation,
    groth16VerifierAdapter: Object.freeze({
      address: plannedAddresses?.groth16VerifierAdapter,
      personVerifierImmutable: plannedAddresses?.personCommitmentVerifier,
      disclosureBindingVerifierImmutable: plannedAddresses?.disclosureBindingVerifier,
      artifactSha256: artifacts?.groth16VerifierAdapter?.artifactSha256,
      runtimeSha256: artifacts?.groth16VerifierAdapter?.runtimeSha256,
    }),
    metadataArchiveV1: Object.freeze({
      address: plannedAddresses?.metadataArchiveV1,
      deepFamilyImmutable: plannedAddresses?.deepFamily,
      artifactSha256: artifacts?.metadataArchiveV1?.artifactSha256,
      runtimeSha256: artifacts?.metadataArchiveV1?.runtimeSha256,
    }),
    deepFamilyReader: Object.freeze({
      address: plannedAddresses?.deepFamilyReader,
      deepFamilyImmutable: plannedAddresses?.deepFamily,
      metadataArchiveImmutable: plannedAddresses?.metadataArchiveV1,
      artifactSha256: artifacts?.deepFamilyReader?.artifactSha256,
      runtimeSha256: artifacts?.deepFamilyReader?.runtimeSha256,
    }),
  });
  const projection = protocolDeploymentEvidenceFromManifest({ ...manifest, deployments });
  return Object.freeze({
    deployments,
    artifacts,
    projection,
    sha256: protocolDeploymentEvidenceSha256(projection),
  });
};

export const assertPlannedProtocolDeploymentMatchesManifest = (options = {}) => {
  const planned = buildPlannedProtocolDeploymentEvidence(options);
  const expectedProjection = protocolDeploymentEvidenceFromManifest(options.manifest);
  if (planned.projection.chainId !== expectedProjection.chainId) {
    throw new Error(
      `Production protocol manifest targets chainId ${expectedProjection.chainId}; ` +
        `the selected mainnet is chainId ${planned.projection.chainId}`,
    );
  }
  if (protocolCanonicalJson(planned.projection) !== protocolCanonicalJson(expectedProjection)) {
    throw new Error(
      "Planned mainnet deployment addresses, immutables, artifacts, or runtimes do not match " +
        "the production protocol manifest",
    );
  }
  return Object.freeze({
    ...planned,
    manifestProjectionSha256: protocolDeploymentEvidenceSha256(expectedProjection),
  });
};

export const assertOnChainProtocolDeploymentRuntimes = async ({
  provider,
  plannedAddresses,
  deploymentArtifacts,
} = {}) => {
  if (typeof provider?.getCode !== "function") {
    throw new Error("provider.getCode is required for protocol runtime validation");
  }
  const checks = [
    [
      "Groth16VerifierAdapter",
      plannedAddresses?.groth16VerifierAdapter,
      deploymentArtifacts?.groth16VerifierAdapter,
    ],
    [
      "MetadataArchiveV1",
      plannedAddresses?.metadataArchiveV1,
      deploymentArtifacts?.metadataArchiveV1,
    ],
    ["DeepFamilyReader", plannedAddresses?.deepFamilyReader, deploymentArtifacts?.deepFamilyReader],
  ];
  for (const [label, address, artifact] of checks) {
    const onChain = await provider.getCode(address);
    if (
      typeof artifact?.runtimeBytecode !== "string" ||
      onChain.toLowerCase() !== artifact.runtimeBytecode.toLowerCase()
    ) {
      throw new Error(
        `${label} on-chain runtime does not exactly match the immutable-linked production artifact`,
      );
    }
  }
};
