import fs from "node:fs/promises";
import path from "node:path";

const GROTH16_PROOF_SYSTEM_ID = 1;
const PROOF_PURPOSE_PERSON_COMMITMENT = 0;
const PROOF_PURPOSE_DISCLOSURE_BINDING = 1;
const ATTESTATION_REF_VERSION_V1 = 1;
const SUBJECT_TYPE_ACTION = 6;
const ACTION_TYPE_VERIFIER_UPDATE = 4;
const SIG_SUITE_ECDSA_SECP256K1_V1 = 1;
const REVOCATION_TYPE_NONE = 0;
const DOMAIN_ATTESTATION_ACTION = "DeepFamily.AttestationAction.V1";
let attestationNonce = 1n;

const resolveConnection = async (hreOrConnection) => {
  if (hreOrConnection?.ethers?.getSigners) {
    return hreOrConnection;
  }

  if (hreOrConnection?.network?.connect) {
    return hreOrConnection.network.connect();
  }

  throw new Error("Expected a Hardhat 3 connection or an hre with network.connect()");
};

const getNetworkDeploymentsDir = (connection) => {
  const networkName =
    connection.networkName ||
    connection.network?.name ||
    connection.network?.networkName ||
    "unknown";
  return path.join(process.cwd(), "deployments", networkName);
};

// In-process simulated networks (Hardhat's edr-simulated) start from a clean state on
// every run, so previously written deployment files won't correspond to on-chain code.
// Persistent networks (http: localhost/testnet/mainnet) hold real, reusable deployments.
const isEphemeralNetwork = (connection) => connection?.networkConfig?.type === "edr-simulated";

// Local development networks: the in-process simulated network and the localhost dev node
// (both chainId 31337). These are dev fixtures, not live deployments, so they must not require
// a governance owner and must keep ownership on the deployer for owner-only test/dev flows.
// Real testnets/mainnets use distinct chainIds and are treated as live deployments.
const isLocalDevNetwork = (connection) =>
  isEphemeralNetwork(connection) || Number(connection?.networkConfig?.chainId) === 31337;

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const sameAddress = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

const safeReadDeployment = async (connection, contractName) => {
  try {
    const dir = getNetworkDeploymentsDir(connection);
    const filePath = path.join(dir, `${contractName}.json`);
    const deployment = await readJson(filePath);
    if (deployment?.address && typeof deployment.address === "string") return deployment;
    return null;
  } catch {
    return null;
  }
};

const assertDeploymentCode = async (ethers, deployments) => {
  for (const [contractName, deployment] of deployments) {
    const code = await ethers.provider.getCode(deployment.address);
    if (code === "0x") {
      throw new Error(
        `Deployment ${contractName} at ${deployment.address} has no code on this network`,
      );
    }
  }
};

// ERC-1967 implementation slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// Confirm a recorded deployment is genuinely an ERC-1967 proxy whose implementation slot points
// at deployed code. A legacy non-proxy deployment satisfies the plain code/wiring checks, so
// reusing it would silently leave the system non-upgradeable and skip the governance handover.
// On persistent networks we refuse anything that is not a real proxy instead of failing later
// when an upgrade or recovery is actually needed.
// The recorded `implementationAddress` is metadata captured at first deploy and may legitimately
// diverge after a UUPS upgrade — especially multisig-executed ones that never touch the local
// deployment file — so we don't compare it; the slot itself is the source of truth.
const assertErc1967Proxy = async (ethers, contractName, deployment) => {
  const { address } = deployment;
  const raw = await ethers.provider.getStorage(address, ERC1967_IMPLEMENTATION_SLOT);
  const implAddress = ethers.getAddress(ethers.dataSlice(raw, 12));
  if (implAddress === ethers.ZeroAddress) {
    throw new Error(
      `Deployment ${contractName} at ${address} is not an ERC-1967 proxy ` +
        "(empty implementation slot); refusing to reuse a non-upgradeable deployment",
    );
  }
  const implCode = await ethers.provider.getCode(implAddress);
  if (implCode === "0x") {
    throw new Error(
      `Deployment ${contractName} at ${address} points at implementation ${implAddress} ` +
        "which has no code on this network",
    );
  }
};

const writeDeployment = async (connection, contractName, address, abi, extra = {}) => {
  const dir = getNetworkDeploymentsDir(connection);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${contractName}.json`);
  const payload = { address, ...extra, abi };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
};

// Validate the governance-owner address itself satisfies the production-safety invariants.
// `_authorizeUpgrade` is `onlyOwner`, so anything we hand the owner role can replace the proxy
// implementation. Requiring code at the address blocks EOA owners (single-key upgrade authority);
// probing `getMinDelay()` confirms the address behaves like a TimelockController with a real
// delay window. Non-timelock governance contracts (e.g., a raw multisig used directly) require an
// explicit GOVERNANCE_OWNER_ALLOW_NON_TIMELOCK=1 acknowledgement so the bypass is deliberate.
const assertGovernanceOwnerInvariants = async (ethers, address) => {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(
      `Governance owner ${address} has no code on this network; refusing to grant UUPS upgrade ` +
        `authority to an EOA. Configure GOVERNANCE_OWNER to a TimelockController (or another ` +
        `governance contract) before deploying.`,
    );
  }
  const allowNonTimelock = process.env.GOVERNANCE_OWNER_ALLOW_NON_TIMELOCK === "1";
  try {
    const timelock = await ethers.getContractAt("GovernanceTimelock", address);
    const minDelay = await timelock.getMinDelay();
    if (minDelay <= 0n) {
      throw new Error(
        `Governance owner ${address} is a TimelockController but minDelay=${minDelay}; ` +
          `a non-zero delay is required so upgrades pass through the intended governance window.`,
      );
    }
    console.log(`governance-owner: ${address} TimelockController minDelay=${minDelay}s OK`);
  } catch (error) {
    if (allowNonTimelock) {
      console.warn(
        `WARNING: governance owner ${address} does not expose TimelockController.getMinDelay ` +
          `(${error.message}); proceeding because GOVERNANCE_OWNER_ALLOW_NON_TIMELOCK=1 is set. ` +
          `Make sure the upgrade authority is gated by a multisig with an appropriate threshold.`,
      );
      return;
    }
    throw new Error(
      `Governance owner ${address} does not behave like a TimelockController ` +
        `(getMinDelay call failed: ${error.message}). Set GOVERNANCE_OWNER_ALLOW_NON_TIMELOCK=1 ` +
        `to acknowledge a non-timelock governance contract (e.g., a multisig used directly).`,
    );
  }
};

// On live networks, refuse to reuse a deployment whose upgrade authority is not the intended
// governance owner. Without this, an existing JSON pointing at proxies that still belong to a
// deployer EOA would silently be accepted and downstream tasks would proceed as if the system
// were under timelock/multisig control. Local dev networks intentionally keep deployer-as-owner
// and are exempt.
const assertExistingGovernanceOwner = async (connection, ethers, contracts) => {
  if (isLocalDevNetwork(connection)) return;
  const governanceOwner = process.env.GOVERNANCE_OWNER;
  const hasGovernanceOwner =
    Boolean(governanceOwner) &&
    ethers.isAddress(governanceOwner) &&
    governanceOwner !== ethers.ZeroAddress;
  if (!hasGovernanceOwner) {
    throw new Error(
      `Reusing an existing deployment on a live network requires GOVERNANCE_OWNER to be set so ` +
        `upgrade authority can be verified (got ${governanceOwner ?? "unset"}).`,
    );
  }
  const expected = ethers.getAddress(governanceOwner);
  for (const { contractName, contract } of contracts) {
    const actual = ethers.getAddress(await contract.owner());
    if (actual !== expected) {
      throw new Error(
        `Deployment ${contractName} owner=${actual} does not match GOVERNANCE_OWNER=${expected}; ` +
          `refusing to reuse a deployment whose upgrade authority is not the intended governance owner.`,
      );
    }
  }
  await assertGovernanceOwnerInvariants(ethers, expected);
};

// Refresh deployment JSON metadata for a contract we just validated and reused. ABIs may have
// changed since the original deploy (e.g., after a release/recompile) and proxy implementations
// may have moved (e.g., after a multisig-driven upgrade), so writing back the live ABI and the
// current ERC-1967 implementation slot keeps the on-disk metadata aligned with what callers will
// see at runtime.
const refreshExistingDeployment = async (
  connection,
  artifacts,
  ethers,
  { contractName, contract, isProxy = false },
) => {
  const artifact = await artifacts.readArtifact(contractName);
  const address = await contract.getAddress();
  const extra = {};
  if (isProxy) {
    const raw = await ethers.provider.getStorage(address, ERC1967_IMPLEMENTATION_SLOT);
    extra.implementationAddress = ethers.getAddress(ethers.dataSlice(raw, 12));
  }
  await writeDeployment(connection, contractName, address, artifact.abi, extra);
};

const assertExistingIntegratedWiring = async ({
  ethers,
  deepFamily,
  token,
  deepFamilyAttestationRegistry,
  deepFamilyReader,
  expectedGroth16Adapter,
}) => {
  const deepFamilyAddress = await deepFamily.getAddress();
  const registryAddress = await deepFamilyAttestationRegistry.getAddress();

  const deepFamilyRegistry = await deepFamily.ATTESTATION_REGISTRY();
  if (!sameAddress(deepFamilyRegistry, registryAddress)) {
    throw new Error(
      `Deployment wiring mismatch: DeepFamily.ATTESTATION_REGISTRY=${deepFamilyRegistry}, ` +
        `expected ${registryAddress}`,
    );
  }

  const boundRegistryMain = await deepFamilyAttestationRegistry.deepFamily();
  if (!sameAddress(boundRegistryMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: registry.deepFamily=${boundRegistryMain}, ` +
        `expected ${deepFamilyAddress}`,
    );
  }

  const readerMain = await deepFamilyReader.DEEP_FAMILY();
  if (!sameAddress(readerMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: reader.DEEP_FAMILY=${readerMain}, expected ${deepFamilyAddress}`,
    );
  }

  const tokenMain = await token.deepFamilyContract();
  if (!sameAddress(tokenMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: token.deepFamilyContract=${tokenMain}, ` +
        `expected ${deepFamilyAddress}`,
    );
  }

  const personVerifier = await deepFamily.verifierRegistry(
    GROTH16_PROOF_SYSTEM_ID,
    PROOF_PURPOSE_PERSON_COMMITMENT,
  );
  const disclosureVerifier = await deepFamily.verifierRegistry(
    GROTH16_PROOF_SYSTEM_ID,
    PROOF_PURPOSE_DISCLOSURE_BINDING,
  );
  if (personVerifier === ethers.ZeroAddress || disclosureVerifier === ethers.ZeroAddress) {
    throw new Error("Deployment wiring mismatch: Groth16 verifier routes are not registered");
  }
  if (expectedGroth16Adapter?.address) {
    if (
      !sameAddress(personVerifier, expectedGroth16Adapter.address) ||
      !sameAddress(disclosureVerifier, expectedGroth16Adapter.address)
    ) {
      throw new Error(
        `Deployment wiring mismatch: verifier routes are ${personVerifier}/${disclosureVerifier}, ` +
          `expected ${expectedGroth16Adapter.address}`,
      );
    }
  }
};

const makeSetVerifierAttestationRef = async (
  ethers,
  deepFamily,
  signer,
  proofSystemId,
  purpose,
  verifier,
) => {
  const network = await ethers.provider.getNetwork();
  const contractAddress = await deepFamily.getAddress();
  const actor = await signer.getAddress();
  const actionDigest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "uint256", "address", "uint16", "address", "uint16", "uint8", "address"],
      [
        DOMAIN_ATTESTATION_ACTION,
        network.chainId,
        contractAddress,
        ACTION_TYPE_VERIFIER_UPDATE,
        actor,
        proofSystemId,
        purpose,
        verifier,
      ],
    ),
  );
  const latestBlock = await ethers.provider.getBlock("latest");
  const nonce = attestationNonce++;
  return {
    attestationRefVersion: ATTESTATION_REF_VERSION_V1,
    subjectType: SUBJECT_TYPE_ACTION,
    subjectHash: actionDigest,
    actionType: ACTION_TYPE_VERIFIER_UPDATE,
    actionDigest,
    attestationPayloadDigest: ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "uint256"],
        [actionDigest, actor, nonce],
      ),
    ),
    signatureSuiteId: SIG_SUITE_ECDSA_SECP256K1_V1,
    signerKeyId: ethers.zeroPadValue(actor, 32),
    uri: `ipfs://deploy-attestation-${nonce.toString()}`,
    issuedAt: Number(latestBlock.timestamp),
    expiresAt: Number(latestBlock.timestamp) + 3600,
    revocationType: REVOCATION_TYPE_NONE,
    revocationRef: ethers.ZeroHash,
  };
};

// Deploy a UUPS proxy: deploy the implementation, then an ERC1967 proxy (UUPSProxy)
// pointing at it with the encoded initialize() calldata.
const deployUUPSProxy = async (ethers, deployer, factory, initArgs) => {
  const impl = await factory.deploy();
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  const initData = factory.interface.encodeFunctionData("initialize", initArgs);
  const Proxy = await ethers.getContractFactory("UUPSProxy", deployer);
  const proxy = await Proxy.deploy(implAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  return { implAddress, proxyAddress };
};

export const deployIntegratedSystem = async (
  hreOrConnection,
  { writeDeployments = false, signer, artifacts: artifactReader } = {},
) => {
  const connection = await resolveConnection(hreOrConnection);
  const { ethers } = connection;
  const [defaultSigner] = await ethers.getSigners();
  const deployer = signer ?? defaultSigner;
  const deployerAddress = await deployer.getAddress();

  // Validate the governance owner up front so a misconfigured live deployment fails before any
  // contracts are created, rather than leaving orphaned modules after a late-stage throw. Local
  // dev networks (edr-simulated / localhost) are exempt and keep the deployer as owner.
  const isLocalDev = isLocalDevNetwork(connection);
  const governanceOwner = process.env.GOVERNANCE_OWNER;
  const hasGovernanceOwner =
    Boolean(governanceOwner) &&
    ethers.isAddress(governanceOwner) &&
    governanceOwner !== ethers.ZeroAddress;
  if (!hasGovernanceOwner && !isLocalDev) {
    throw new Error(
      `GOVERNANCE_OWNER must be set to a valid nonzero address before deploying UUPS proxies to ` +
        `a live network (got ${governanceOwner ?? "unset"}); otherwise unilateral upgrade ` +
        `authority would remain on the deployer key.`,
    );
  }
  if (hasGovernanceOwner && !isLocalDev) {
    await assertGovernanceOwnerInvariants(ethers, ethers.getAddress(governanceOwner));
  }

  const Token = await ethers.getContractFactory("DeepFamilyToken", deployer);
  const token = await Token.deploy();
  await token.waitForDeployment();

  const PoseidonT5 = await ethers.getContractFactory("PoseidonT5", deployer);
  const poseidonT5 = await PoseidonT5.deploy();
  await poseidonT5.waitForDeployment();

  const AdultAgeGate = await ethers.getContractFactory("AdultAgeGate", deployer);
  const adultAgeGate = await AdultAgeGate.deploy();
  await adultAgeGate.waitForDeployment();

  const PersonCommitmentVerifier = await ethers.getContractFactory(
    "PersonCommitmentVerifier",
    deployer,
  );
  const personCommitmentVerifier = await PersonCommitmentVerifier.deploy();
  await personCommitmentVerifier.waitForDeployment();

  const DisclosureBindingVerifier = await ethers.getContractFactory(
    "DisclosureBindingVerifier",
    deployer,
  );
  const nameDisclosureVerifier = await DisclosureBindingVerifier.deploy();
  await nameDisclosureVerifier.waitForDeployment();

  const tokenAddress = await token.getAddress();
  const poseidonT5Address = await poseidonT5.getAddress();
  const adultAgeGateAddress = await adultAgeGate.getAddress();
  const personCommitmentVerifierAddress = await personCommitmentVerifier.getAddress();
  const nameDisclosureVerifierAddress = await nameDisclosureVerifier.getAddress();

  const Groth16VerifierAdapter = await ethers.getContractFactory(
    "Groth16VerifierAdapter",
    deployer,
  );
  const groth16VerifierAdapter = await Groth16VerifierAdapter.deploy(
    personCommitmentVerifierAddress,
    nameDisclosureVerifierAddress,
  );
  await groth16VerifierAdapter.waitForDeployment();
  const groth16VerifierAdapterAddress = await groth16VerifierAdapter.getAddress();

  // Registry behind a UUPS proxy (stable address survives logic upgrades).
  const DeepFamilyAttestationRegistry = await ethers.getContractFactory(
    "DeepFamilyAttestationRegistry",
    deployer,
  );
  const {
    implAddress: deepFamilyAttestationRegistryImplementationAddress,
    proxyAddress: deepFamilyAttestationRegistryAddress,
  } = await deployUUPSProxy(ethers, deployer, DeepFamilyAttestationRegistry, [deployerAddress]);
  const deepFamilyAttestationRegistry = await ethers.getContractAt(
    "DeepFamilyAttestationRegistry",
    deepFamilyAttestationRegistryAddress,
    deployer,
  );

  // Main contract behind a UUPS proxy. initialize() wires token + registry (proxy) addresses.
  const DeepFamily = await ethers.getContractFactory("DeepFamily", {
    signer: deployer,
    libraries: {
      PoseidonT5: poseidonT5Address,
      AdultAgeGate: adultAgeGateAddress,
    },
  });
  const { implAddress: deepFamilyImplementationAddress, proxyAddress: deepFamilyAddress } =
    await deployUUPSProxy(ethers, deployer, DeepFamily, [
      tokenAddress,
      deepFamilyAttestationRegistryAddress,
      deployerAddress,
    ]);
  const deepFamily = await ethers.getContractAt("DeepFamily", deepFamilyAddress, deployer);

  await (await deepFamilyAttestationRegistry.bindDeepFamily(deepFamilyAddress)).wait();

  const DeepFamilyReader = await ethers.getContractFactory("DeepFamilyReader", deployer);
  const deepFamilyReader = await DeepFamilyReader.deploy(deepFamilyAddress);
  await deepFamilyReader.waitForDeployment();
  const deepFamilyReaderAddress = await deepFamilyReader.getAddress();

  const bound = await token.deepFamilyContract().catch(() => ethers.ZeroAddress);
  if (bound === ethers.ZeroAddress) {
    const tx = await token.initialize(deepFamilyAddress);
    await tx.wait();
  }

  // Register the Groth16 adapter under PROOF_SYSTEM_ID_GROTH16_BN254_V1 = 1
  // for both purposes (PersonCommitment = 0, DisclosureBinding = 1). The adapter internally
  // dispatches to the backend verifiers.
  await (
    await deepFamily.setVerifier(
      GROTH16_PROOF_SYSTEM_ID,
      PROOF_PURPOSE_PERSON_COMMITMENT,
      groth16VerifierAdapterAddress,
      await makeSetVerifierAttestationRef(
        ethers,
        deepFamily,
        deployer,
        GROTH16_PROOF_SYSTEM_ID,
        PROOF_PURPOSE_PERSON_COMMITMENT,
        groth16VerifierAdapterAddress,
      ),
    )
  ).wait();
  await (
    await deepFamily.setVerifier(
      GROTH16_PROOF_SYSTEM_ID,
      PROOF_PURPOSE_DISCLOSURE_BINDING,
      groth16VerifierAdapterAddress,
      await makeSetVerifierAttestationRef(
        ethers,
        deepFamily,
        deployer,
        GROTH16_PROOF_SYSTEM_ID,
        PROOF_PURPOSE_DISCLOSURE_BINDING,
        groth16VerifierAdapterAddress,
      ),
    )
  ).wait();

  // Hand upgrade authority to governance (intended: timelock + multisig).
  // Must run after bindDeepFamily / setVerifier, which require the deployer to still be owner.
  // With UUPS the owner can replace the entire implementation, so on live networks a governance
  // owner is mandatory (validated up front). Local dev networks always keep the deployer as owner
  // so owner-only test/dev flows keep working even if GOVERNANCE_OWNER leaks in from .env.
  if (hasGovernanceOwner && !isLocalDev) {
    await (await deepFamily.transferOwnership(governanceOwner)).wait();
    await (await deepFamilyAttestationRegistry.transferOwnership(governanceOwner)).wait();
  }

  if (writeDeployments) {
    const artifacts = artifactReader ?? hreOrConnection?.artifacts ?? null;

    if (!artifacts?.readArtifact) {
      throw new Error(
        "writeDeployments=true requires passing Hardhat hre (with artifacts) to deployIntegratedSystem",
      );
    }

    const tokenArtifact = await artifacts.readArtifact("DeepFamilyToken");
    const deepArtifact = await artifacts.readArtifact("DeepFamily");
    const attestationRegistryArtifact = await artifacts.readArtifact(
      "DeepFamilyAttestationRegistry",
    );
    const readerArtifact = await artifacts.readArtifact("DeepFamilyReader");
    const poseidonT5Artifact = await artifacts.readArtifact("PoseidonT5");
    const adultAgeGateArtifact = await artifacts.readArtifact("AdultAgeGate");
    const personVerifierArtifact = await artifacts.readArtifact("PersonCommitmentVerifier");
    const nameVerifierArtifact = await artifacts.readArtifact("DisclosureBindingVerifier");
    const groth16AdapterArtifact = await artifacts.readArtifact("Groth16VerifierAdapter");

    await writeDeployment(connection, "DeepFamilyToken", tokenAddress, tokenArtifact.abi);
    await writeDeployment(connection, "PoseidonT5", poseidonT5Address, poseidonT5Artifact.abi);
    await writeDeployment(
      connection,
      "AdultAgeGate",
      adultAgeGateAddress,
      adultAgeGateArtifact.abi,
    );
    await writeDeployment(
      connection,
      "PersonCommitmentVerifier",
      personCommitmentVerifierAddress,
      personVerifierArtifact.abi,
    );
    await writeDeployment(
      connection,
      "DisclosureBindingVerifier",
      nameDisclosureVerifierAddress,
      nameVerifierArtifact.abi,
    );
    await writeDeployment(
      connection,
      "Groth16VerifierAdapter",
      groth16VerifierAdapterAddress,
      groth16AdapterArtifact.abi,
    );
    await writeDeployment(
      connection,
      "DeepFamilyAttestationRegistry",
      deepFamilyAttestationRegistryAddress,
      attestationRegistryArtifact.abi,
      { implementationAddress: deepFamilyAttestationRegistryImplementationAddress },
    );
    await writeDeployment(connection, "DeepFamily", deepFamilyAddress, deepArtifact.abi, {
      implementationAddress: deepFamilyImplementationAddress,
    });
    await writeDeployment(
      connection,
      "DeepFamilyReader",
      deepFamilyReaderAddress,
      readerArtifact.abi,
    );
  }

  return {
    deployerAddress,
    token,
    poseidonT5,
    adultAgeGate,
    personCommitmentVerifier,
    nameDisclosureVerifier,
    groth16VerifierAdapter,
    deepFamilyAttestationRegistry,
    deepFamily,
    deepFamilyReader,
    deepFamilyAttestationRegistryImplementationAddress,
    deepFamilyImplementationAddress,
  };
};

export const ensureIntegratedSystem = async (
  hreOrConnection,
  { writeDeployments = false, artifacts: artifactReader } = {},
) => {
  const connection = await resolveConnection(hreOrConnection);
  if (connection.__deepfamilyIntegrated?.deepFamily) return connection.__deepfamilyIntegrated;

  const { ethers } = connection;
  const [defaultSigner] = await ethers.getSigners();

  const existingDeep = await safeReadDeployment(connection, "DeepFamily");
  const existingToken = await safeReadDeployment(connection, "DeepFamilyToken");
  const existingRegistry = await safeReadDeployment(connection, "DeepFamilyAttestationRegistry");
  const existingReader = await safeReadDeployment(connection, "DeepFamilyReader");
  const existingGroth16Adapter = await safeReadDeployment(connection, "Groth16VerifierAdapter");
  if (
    existingDeep?.address &&
    existingToken?.address &&
    existingRegistry?.address &&
    existingReader?.address
  ) {
    try {
      await assertDeploymentCode(ethers, [
        ["DeepFamily", existingDeep],
        ["DeepFamilyToken", existingToken],
        ["DeepFamilyAttestationRegistry", existingRegistry],
        ["DeepFamilyReader", existingReader],
      ]);

      // DeepFamily and the registry must be UUPS proxies; a legacy direct deployment would
      // pass the code/wiring checks above yet be silently non-upgradeable.
      await assertErc1967Proxy(ethers, "DeepFamily", existingDeep);
      await assertErc1967Proxy(ethers, "DeepFamilyAttestationRegistry", existingRegistry);

      const deepFamily = await ethers.getContractAt(
        "DeepFamily",
        existingDeep.address,
        defaultSigner,
      );
      const token = await ethers.getContractAt(
        "DeepFamilyToken",
        existingToken.address,
        defaultSigner,
      );
      const deepFamilyAttestationRegistry = await ethers.getContractAt(
        "DeepFamilyAttestationRegistry",
        existingRegistry.address,
        defaultSigner,
      );
      const deepFamilyReader = await ethers.getContractAt(
        "DeepFamilyReader",
        existingReader.address,
        defaultSigner,
      );
      await assertExistingIntegratedWiring({
        ethers,
        deepFamily,
        token,
        deepFamilyAttestationRegistry,
        deepFamilyReader,
        expectedGroth16Adapter: existingGroth16Adapter,
      });
      await assertExistingGovernanceOwner(connection, ethers, [
        { contractName: "DeepFamily", contract: deepFamily },
        {
          contractName: "DeepFamilyAttestationRegistry",
          contract: deepFamilyAttestationRegistry,
        },
      ]);
      if (writeDeployments) {
        const artifacts = artifactReader ?? hreOrConnection?.artifacts ?? null;
        if (!artifacts?.readArtifact) {
          throw new Error(
            "writeDeployments=true requires passing Hardhat hre (with artifacts) to ensureIntegratedSystem",
          );
        }
        const refreshTargets = [
          { contractName: "DeepFamily", contract: deepFamily, isProxy: true },
          {
            contractName: "DeepFamilyAttestationRegistry",
            contract: deepFamilyAttestationRegistry,
            isProxy: true,
          },
          { contractName: "DeepFamilyToken", contract: token },
          { contractName: "DeepFamilyReader", contract: deepFamilyReader },
        ];
        if (existingGroth16Adapter?.address) {
          const groth16Adapter = await ethers.getContractAt(
            "Groth16VerifierAdapter",
            existingGroth16Adapter.address,
            defaultSigner,
          );
          refreshTargets.push({
            contractName: "Groth16VerifierAdapter",
            contract: groth16Adapter,
          });
        }
        for (const target of refreshTargets) {
          await refreshExistingDeployment(connection, artifacts, ethers, target);
        }
      }
      connection.__deepfamilyIntegrated = {
        deepFamily,
        token,
        deepFamilyAttestationRegistry,
        deepFamilyReader,
      };
      return connection.__deepfamilyIntegrated;
    } catch (error) {
      // Local dev networks (in-process simulated or localhost:31337) commonly restart with
      // a clean chain while deployment files remain on disk. Fall through and deploy a current
      // UUPS module set. On live networks, surface validation failures instead of silently
      // creating a second, orphaned module set.
      if (!isLocalDevNetwork(connection)) throw error;
    }
  }

  const deployed = await deployIntegratedSystem(connection, {
    writeDeployments,
    signer: defaultSigner,
    artifacts: artifactReader ?? hreOrConnection?.artifacts,
  });
  connection.__deepfamilyIntegrated = {
    deepFamily: deployed.deepFamily,
    token: deployed.token,
    deepFamilyAttestationRegistry: deployed.deepFamilyAttestationRegistry,
    deepFamilyReader: deployed.deepFamilyReader,
  };
  return connection.__deepfamilyIntegrated;
};
