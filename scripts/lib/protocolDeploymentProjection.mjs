import {
  inspectProtocolDeploymentArtifacts,
  protocolCanonicalJson,
  protocolDeploymentEvidenceFromManifest,
  protocolDeploymentEvidenceSha256,
  shieldedDeploymentBindingsFromAddresses,
  groth16VerifierAdapterBindingsFromAddresses,
} from "./protocolReleaseManifest.mjs";
import {
  INTEGRATED_DEPLOYMENT_RECORDS,
  SHIELDED_DEPLOYMENT_CIRCUITS,
} from "./zkDeploymentCatalog.mjs";
import { MAINNET_TRANSACTION_LABELS } from "./mainnetReleaseSafety.mjs";

const MAINNET_DEPLOYMENT_ADDRESS_LABELS = Object.freeze({
  timelock: "governanceTimelock",
  deepFamilyImplementation: "deepFamilyImplementation",
  ...Object.fromEntries(
    INTEGRATED_DEPLOYMENT_RECORDS.map((record) => [
      record.transactionLabel === "deepFamilyToken"
        ? "token"
        : record.transactionLabel === "deepFamilyProxy"
          ? "deepFamily"
          : record.transactionLabel,
      record.transactionLabel,
    ]),
  ),
});

export const MAINNET_DEPLOYMENT_NONCE_OFFSETS = Object.freeze(
  Object.fromEntries(
    Object.entries(MAINNET_DEPLOYMENT_ADDRESS_LABELS).map(([address, label]) => {
      const offset = MAINNET_TRANSACTION_LABELS.indexOf(label);
      if (offset < 0) throw new Error(`Mainnet deployment ${label} has no transaction label`);
      return [address, offset];
    }),
  ),
);

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
    ...shieldedDeploymentBindingsFromAddresses(plannedAddresses),
    groth16VerifierAdapter: groth16VerifierAdapterBindingsFromAddresses(plannedAddresses),
    deepFamilyArchive: { deepFamilyImmutable: plannedAddresses?.deepFamily },
    deepFamilyReader: {
      deepFamilyImmutable: plannedAddresses?.deepFamily,
      archiveImmutable: plannedAddresses?.deepFamilyArchive,
    },
  };
  const artifacts = deploymentArtifactInspector({ root, deployments: deploymentBindings });
  const withHashes = (record, artifact) =>
    Object.freeze({
      ...record,
      artifactSha256: artifact?.artifactSha256,
      runtimeSha256: artifact?.runtimeSha256,
    });
  const deployments = Object.freeze({
    token: deploymentBindings.token,
    poseidonT3: deploymentBindings.poseidonT3,
    poseidonT6: deploymentBindings.poseidonT6,
    deepFamilyLineageIndex: deploymentBindings.deepFamilyLineageIndex,
    shieldedVerifiers: Object.freeze(
      Object.fromEntries(
        Object.keys(SHIELDED_DEPLOYMENT_CIRCUITS).map((action) => [
          action,
          withHashes(
            deploymentBindings.shieldedVerifiers[action],
            artifacts?.shieldedVerifiers?.[action],
          ),
        ]),
      ),
    ),
    shieldedHeirKeyRegistry: withHashes(
      deploymentBindings.shieldedHeirKeyRegistry,
      artifacts?.shieldedHeirKeyRegistry,
    ),
    shieldedDeepPool: withHashes(deploymentBindings.shieldedDeepPool, artifacts?.shieldedDeepPool),
    status: "production",
    chainId: normalizeChainId(chainId),
    deepFamilyProxy: plannedAddresses?.deepFamily,
    deepFamilyImplementation: plannedAddresses?.deepFamilyImplementation,
    groth16VerifierAdapter: Object.freeze({
      ...deploymentBindings.groth16VerifierAdapter,
      artifactSha256: artifacts?.groth16VerifierAdapter?.artifactSha256,
      runtimeSha256: artifacts?.groth16VerifierAdapter?.runtimeSha256,
    }),
    deepFamilyArchive: Object.freeze({
      address: plannedAddresses?.deepFamilyArchive,
      deepFamilyImmutable: plannedAddresses?.deepFamily,
      artifactSha256: artifacts?.deepFamilyArchive?.artifactSha256,
      runtimeSha256: artifacts?.deepFamilyArchive?.runtimeSha256,
    }),
    deepFamilyReader: Object.freeze({
      address: plannedAddresses?.deepFamilyReader,
      deepFamilyImmutable: plannedAddresses?.deepFamily,
      archiveImmutable: plannedAddresses?.deepFamilyArchive,
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
      "DeepFamilyArchive",
      plannedAddresses?.deepFamilyArchive,
      deploymentArtifacts?.deepFamilyArchive,
    ],
    ["DeepFamilyReader", plannedAddresses?.deepFamilyReader, deploymentArtifacts?.deepFamilyReader],
    ...Object.entries(SHIELDED_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [
      spec.verifierContractName,
      plannedAddresses?.[spec.verifierLabel],
      deploymentArtifacts?.shieldedVerifiers?.[action],
    ]),
    [
      "ShieldedHeirKeyRegistry",
      plannedAddresses?.shieldedHeirKeyRegistry,
      deploymentArtifacts?.shieldedHeirKeyRegistry,
    ],
    ["ShieldedDeepPool", plannedAddresses?.shieldedDeepPool, deploymentArtifacts?.shieldedDeepPool],
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
