import { MAINNET_TRANSACTION_LABELS } from "./mainnetReleaseSafety.mjs";

const PERSON_RELATION_CIRCUIT_ID = 1;
const DISCLOSURE_BINDING_CIRCUIT_ID = 1;
const PROOF_PURPOSE_PERSON_RELATION = 0;
const PROOF_PURPOSE_DISCLOSURE_BINDING = 1;

const requiredAddress = (ethers, name, value) => {
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a nonzero EVM address`);
  }
  return ethers.getAddress(value);
};

const requiredSafeInteger = (name, value) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

const linkBytecode = ({ ethers, artifact, libraries }) => {
  let bytecode = String(artifact.bytecode ?? "");
  if (!bytecode.startsWith("0x")) {
    throw new Error(`${artifact.contractName} artifact has no deployable bytecode`);
  }
  bytecode = bytecode.slice(2);

  for (const [sourceName, sourceReferences] of Object.entries(artifact.linkReferences ?? {})) {
    for (const [libraryName, references] of Object.entries(sourceReferences)) {
      const configured = libraries[`${sourceName}:${libraryName}`] ?? libraries[libraryName];
      const address = requiredAddress(
        ethers,
        `${artifact.contractName} library ${sourceName}:${libraryName}`,
        configured,
      )
        .slice(2)
        .toLowerCase();
      for (const reference of references) {
        if (reference.length !== 20) {
          throw new Error(
            `${artifact.contractName} library ${libraryName} has an unexpected link width`,
          );
        }
        const start = reference.start * 2;
        const end = start + reference.length * 2;
        if (start < 0 || end > bytecode.length) {
          throw new Error(`${artifact.contractName} library ${libraryName} link is out of bounds`);
        }
        bytecode = `${bytecode.slice(0, start)}${address}${bytecode.slice(end)}`;
      }
    }
  }

  const linked = `0x${bytecode}`;
  if (!ethers.isHexString(linked)) {
    throw new Error(`${artifact.contractName} bytecode still contains unresolved libraries`);
  }
  return linked;
};

const normalizeIntent = ({ ethers, label, kind, nonce, from, chainId, to, value, data }) => {
  const normalizedData = ethers.hexlify(data ?? "0x");
  return Object.freeze({
    label,
    kind,
    nonce: requiredSafeInteger(`${label} nonce`, nonce),
    from: ethers.getAddress(from),
    chainId: BigInt(chainId).toString(),
    to: to == null ? null : ethers.getAddress(to),
    value: BigInt(value ?? 0n).toString(),
    data: normalizedData,
    dataHash: ethers.keccak256(normalizedData),
    predictedAddress: kind === "deployment" ? ethers.getCreateAddress({ from, nonce }) : null,
  });
};

/**
 * Rebuilds the exact eighteen-transaction EVM mainnet release intent without a signer or RPC.
 * The returned order is the approved deployer-nonce order; callers should include its digest in
 * the reviewed plan and pass the intents to the checkpointed transaction executor.
 */
export const buildMainnetReleaseIntents = async ({
  ethers,
  artifacts,
  deployer,
  startingNonce,
  chainId,
  minDelaySeconds,
  governanceMultisig,
}) => {
  if (!ethers || typeof artifacts?.readArtifact !== "function") {
    throw new Error("Mainnet release intents require ethers and a Hardhat artifact reader");
  }
  const normalizedDeployer = requiredAddress(ethers, "deployer", deployer);
  const normalizedMultisig = requiredAddress(ethers, "governanceMultisig", governanceMultisig);
  const nonceBase = requiredSafeInteger("startingNonce", startingNonce);
  const normalizedChainId = BigInt(chainId);
  if (normalizedChainId <= 0n) throw new Error("chainId must be positive");
  const delay = BigInt(minDelaySeconds);
  if (delay <= 0n) throw new Error("minDelaySeconds must be positive");

  const names = [
    "GovernanceTimelock",
    "DeepFamilyToken",
    "PoseidonT5",
    "AdultAgeGate",
    "PersonCommitmentVerifier",
    "DisclosureBindingVerifier",
    "Groth16VerifierAdapter",
    "DeepFamily",
    "UUPSProxy",
    "MetadataArchiveV1",
    "StoryArchiveV1",
    "DeepFamilyReader",
  ];
  const artifactList = await Promise.all(names.map((name) => artifacts.readArtifact(name)));
  const artifact = Object.fromEntries(names.map((name, index) => [name, artifactList[index]]));

  const addressAt = (offset) =>
    ethers.getCreateAddress({ from: normalizedDeployer, nonce: nonceBase + offset });
  const addresses = Object.freeze({
    governanceTimelock: addressAt(0),
    deepFamilyToken: addressAt(1),
    poseidonT5: addressAt(2),
    adultAgeGate: addressAt(3),
    personCommitmentVerifier: addressAt(4),
    disclosureBindingVerifier: addressAt(5),
    groth16VerifierAdapter: addressAt(6),
    deepFamilyImplementation: addressAt(7),
    deepFamilyProxy: addressAt(8),
    // nonce 9 is the tokenInitialize call.
    metadataArchiveV1: addressAt(10),
    // nonce 11 is the one-time setMetadataArchive call.
    storyArchiveV1: addressAt(12),
    // nonce 13 is the one-time setStoryArchive call.
    deepFamilyReader: addressAt(14),
  });

  const deployData = async (name, args = [], bytecode = artifact[name].bytecode) => {
    const factory = new ethers.ContractFactory(artifact[name].abi, bytecode);
    const request = await factory.getDeployTransaction(...args);
    return ethers.hexlify(request.data);
  };
  const deepFamilyBytecode = linkBytecode({
    ethers,
    artifact: artifact.DeepFamily,
    libraries: {
      PoseidonT5: addresses.poseidonT5,
      AdultAgeGate: addresses.adultAgeGate,
    },
  });
  const deepFamilyInterface = new ethers.Interface(artifact.DeepFamily.abi);
  const tokenInterface = new ethers.Interface(artifact.DeepFamilyToken.abi);
  const proxyInitializeData = deepFamilyInterface.encodeFunctionData("initialize", [
    addresses.deepFamilyToken,
    normalizedDeployer,
  ]);

  const initialDeploymentSpecs = [
    ["governanceTimelock", "GovernanceTimelock", [delay, normalizedMultisig]],
    ["deepFamilyToken", "DeepFamilyToken", []],
    ["poseidonT5", "PoseidonT5", []],
    ["adultAgeGate", "AdultAgeGate", []],
    ["personCommitmentVerifier", "PersonCommitmentVerifier", []],
    ["disclosureBindingVerifier", "DisclosureBindingVerifier", []],
    [
      "groth16VerifierAdapter",
      "Groth16VerifierAdapter",
      [addresses.personCommitmentVerifier, addresses.disclosureBindingVerifier],
    ],
    ["deepFamilyImplementation", "DeepFamily", [], deepFamilyBytecode],
    ["deepFamilyProxy", "UUPSProxy", [addresses.deepFamilyImplementation, proxyInitializeData]],
  ];

  const intents = [];
  const pushDeployment = async (label, contractName, args = [], bytecode) => {
    const nonce = nonceBase + intents.length;
    intents.push(
      normalizeIntent({
        ethers,
        label,
        kind: "deployment",
        nonce,
        from: normalizedDeployer,
        chainId: normalizedChainId,
        to: null,
        value: 0n,
        data: await deployData(contractName, args, bytecode),
      }),
    );
  };
  const pushCall = (label, to, data) => {
    const nonce = nonceBase + intents.length;
    intents.push(
      normalizeIntent({
        ethers,
        label,
        kind: "call",
        nonce,
        from: normalizedDeployer,
        chainId: normalizedChainId,
        to,
        value: 0n,
        data,
      }),
    );
  };

  for (const [label, contractName, args, bytecode] of initialDeploymentSpecs) {
    await pushDeployment(label, contractName, args, bytecode);
  }

  pushCall(
    "tokenInitialize",
    addresses.deepFamilyToken,
    tokenInterface.encodeFunctionData("initialize", [addresses.deepFamilyProxy]),
  );
  await pushDeployment("metadataArchiveV1", "MetadataArchiveV1", [addresses.deepFamilyProxy]);
  pushCall(
    "setMetadataArchive",
    addresses.deepFamilyProxy,
    deepFamilyInterface.encodeFunctionData("setMetadataArchive", [addresses.metadataArchiveV1]),
  );
  await pushDeployment("storyArchiveV1", "StoryArchiveV1", [addresses.deepFamilyProxy]);
  pushCall(
    "setStoryArchive",
    addresses.deepFamilyProxy,
    deepFamilyInterface.encodeFunctionData("setStoryArchive", [addresses.storyArchiveV1]),
  );
  await pushDeployment("deepFamilyReader", "DeepFamilyReader", [addresses.deepFamilyProxy]);
  pushCall(
    "setPersonRelationVerifier",
    addresses.deepFamilyProxy,
    deepFamilyInterface.encodeFunctionData("setCircuitVerifier", [
      PROOF_PURPOSE_PERSON_RELATION,
      PERSON_RELATION_CIRCUIT_ID,
      addresses.groth16VerifierAdapter,
    ]),
  );
  pushCall(
    "setDisclosureBindingVerifier",
    addresses.deepFamilyProxy,
    deepFamilyInterface.encodeFunctionData("setCircuitVerifier", [
      PROOF_PURPOSE_DISCLOSURE_BINDING,
      DISCLOSURE_BINDING_CIRCUIT_ID,
      addresses.groth16VerifierAdapter,
    ]),
  );
  pushCall(
    "transferDeepFamilyOwnership",
    addresses.deepFamilyProxy,
    deepFamilyInterface.encodeFunctionData("transferOwnership", [addresses.governanceTimelock]),
  );

  if (
    intents.length !== MAINNET_TRANSACTION_LABELS.length ||
    intents.some((intent, index) => intent.label !== MAINNET_TRANSACTION_LABELS[index])
  ) {
    throw new Error("Generated mainnet release intents differ from the approved transaction order");
  }
  return Object.freeze(intents);
};

const INTENT_DIGEST_FIELDS = Object.freeze([
  "label",
  "kind",
  "nonce",
  "from",
  "chainId",
  "to",
  "value",
  "data",
  "dataHash",
  "predictedAddress",
]);

export const deriveMainnetReleaseIntentsDigest = (ethers, intents) => {
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new Error("Mainnet release intents must be a non-empty array");
  }
  const canonical = intents.map((intent) =>
    Object.fromEntries(INTENT_DIGEST_FIELDS.map((field) => [field, intent[field] ?? null])),
  );
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(canonical)));
};
