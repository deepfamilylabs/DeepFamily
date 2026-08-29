import fs from "node:fs/promises";
import path from "node:path";
import { assertImplementationMatchesArtifact } from "../tasks/lib/timelockUpgrade.mjs";
import {
  assertNoRemovedGovernanceEnvironmentVariables,
  assertGovernanceMultisigWithProfile,
  isLocalDevelopmentConnection,
} from "../scripts/lib/governanceSafety.mjs";

const PERSON_RELATION_CIRCUIT_ID = 1;
const DISCLOSURE_BINDING_CIRCUIT_ID = 1;
const PROOF_PURPOSE_PERSON_RELATION = 0;
const PROOF_PURPOSE_DISCLOSURE_BINDING = 1;

const resolveConnection = async (hreOrConnection) => {
  if (hreOrConnection?.ethers?.getSigners) {
    return hreOrConnection;
  }

  if (hreOrConnection?.network?.connect) {
    return hreOrConnection.network.connect();
  }

  throw new Error("Expected a Hardhat 3 connection or an hre with network.connect()");
};

const getNetworkDeploymentsDir = (connection, deploymentDirectory) => {
  if (deploymentDirectory !== undefined) {
    if (typeof deploymentDirectory !== "string" || deploymentDirectory.trim() === "") {
      throw new Error("deploymentDirectory must be a non-empty path when provided");
    }
    return path.resolve(deploymentDirectory);
  }
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

// Local development networks: in-process simulation and the explicitly named localhost dev node.
// These are dev fixtures, so they keep ownership on the deployer for owner-only test/dev flows.
// A remote HTTP endpoint is never trusted merely because it reports a familiar development chain ID.
const isLocalDevNetwork = (connection) => isLocalDevelopmentConnection(connection);

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
  return implAddress;
};

// A deployment file is an address book, not proof that those addresses run the code from the
// current checkout. When current Hardhat artifacts are available (deploy/seed/check-root paths),
// compare every protocol module that affects identity/proof semantics before reusing it. Local
// development can then redeploy a coherent module set; live networks must use the explicit upgrade
// workflow instead of silently pairing new clients/ABIs with old bytecode.
const assertCurrentArtifactSet = async ({
  connection,
  ethers,
  artifacts,
  deepFamilyImplementation,
  deployments,
}) => {
  const hreLike = { artifacts };
  const checks = [
    {
      contractName: "DeepFamily",
      implementation: deepFamilyImplementation,
      spec: { needsLibraries: true },
    },
    ...deployments.map(({ contractName, deployment }) => ({
      contractName,
      implementation: deployment.address,
      spec: {
        needsLibraries: false,
        librarySelfAddress: contractName === "PoseidonT5",
      },
    })),
  ];

  for (const check of checks) {
    await assertImplementationMatchesArtifact({
      connection,
      ethers,
      hre: hreLike,
      ...check,
    });
  }
};

const writeDeployment = async (
  connection,
  contractName,
  address,
  abi,
  extra = {},
  deploymentDirectory,
) => {
  const dir = getNetworkDeploymentsDir(connection, deploymentDirectory);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${contractName}.json`);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const payload = { address, ...extra, abi };
  await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
};

// Validate that the configured protocol-owner address is the production GovernanceTimelock.
// `_authorizeUpgrade` is `onlyOwner`, so anything we hand the owner role can replace the proxy
// implementation. Requiring the exact GovernanceTimelock runtime blocks both EOA owners and
// contracts that merely imitate `getMinDelay()`; reading the delay then confirms that the genuine
// timelock was configured with a real governance window. A multisig should hold the timelock's
// proposer/canceller/executor roles rather than own the protocol directly, so live deployments
// intentionally have no non-timelock bypass.
const assertGovernanceOwnerInvariants = async ({
  connection,
  ethers,
  artifacts,
  address,
  governanceMultisig = process.env.GOVERNANCE_SAFE_ADDRESS,
  governanceMultisigProfile = process.env.GOVERNANCE_SAFE_PROFILE,
}) => {
  if (!artifacts?.readArtifact) {
    throw new Error(
      "Validating GOVERNANCE_TIMELOCK_ADDRESS on a live network requires current Hardhat " +
        "artifacts so " +
        "the GovernanceTimelock runtime bytecode can be verified",
    );
  }
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(
      `GovernanceTimelock ${address} has no code on this network; refusing to grant UUPS ` +
        `upgrade authority to an EOA. Configure GOVERNANCE_TIMELOCK_ADDRESS to a deployed ` +
        `GovernanceTimelock before deploying.`,
    );
  }
  let timelock;
  let minDelay;
  try {
    await assertImplementationMatchesArtifact({
      connection,
      ethers,
      hre: { artifacts },
      contractName: "GovernanceTimelock",
      implementation: address,
      spec: { needsLibraries: false },
    });
    timelock = await ethers.getContractAt("GovernanceTimelock", address);
    minDelay = await timelock.getMinDelay();
    if (minDelay <= 0n) {
      throw new Error(
        `GovernanceTimelock ${address} has minDelay=${minDelay}; ` +
          `a non-zero delay is required so upgrades pass through the intended governance window.`,
      );
    }
  } catch (error) {
    throw new Error(
      `GOVERNANCE_TIMELOCK_ADDRESS ${address} does not behave like a TimelockController ` +
        `with a non-zero delay (${error.message}). Configure the multisig as the timelock's ` +
        `proposer/canceller/executor instead of making it the protocol owner directly.`,
    );
  }

  const configuredMultisig = governanceMultisig;
  const hasConfiguredMultisig =
    Boolean(configuredMultisig) &&
    ethers.isAddress(configuredMultisig) &&
    configuredMultisig !== ethers.ZeroAddress;
  if (!hasConfiguredMultisig) {
    throw new Error(
      `GOVERNANCE_SAFE_ADDRESS must be set to a valid nonzero Safe Proxy address before using ` +
        `GovernanceTimelock ${address} on a live network (got ${configuredMultisig ?? "unset"})`,
    );
  }

  const multisig = ethers.getAddress(configuredMultisig);
  const multisigPolicy = await assertGovernanceMultisigWithProfile({
    ethers,
    provider: ethers.provider,
    address: multisig,
    label: "GOVERNANCE_SAFE_ADDRESS",
    profile: governanceMultisigProfile,
  });

  const roleEntries = [
    ["PROPOSER_ROLE", await timelock.PROPOSER_ROLE()],
    ["CANCELLER_ROLE", await timelock.CANCELLER_ROLE()],
    ["EXECUTOR_ROLE", await timelock.EXECUTOR_ROLE()],
  ];
  const roleGrants = await Promise.all(
    roleEntries.map(([, role]) => timelock.hasRole(role, multisig)),
  );
  const missingRoles = roleEntries.filter((_, index) => !roleGrants[index]).map(([name]) => name);
  if (missingRoles.length > 0) {
    throw new Error(
      `GOVERNANCE_SAFE_ADDRESS ${multisig} is missing ${missingRoles.join(", ")} on ` +
        `GovernanceTimelock ${address}; all proposer/canceller/executor roles must be assigned ` +
        `to the multisig`,
    );
  }

  const defaultAdminRole = await timelock.DEFAULT_ADMIN_ROLE();
  const exactRoleEntries = [
    ["DEFAULT_ADMIN_ROLE", defaultAdminRole, address],
    ...roleEntries.map(([name, role]) => [name, role, multisig]),
  ];
  const invalidMembership = [];
  for (const [name, role, expectedMember] of exactRoleEntries) {
    const count = await timelock.getRoleMemberCount(role);
    const member = count === 1n ? await timelock.getRoleMember(role, 0) : null;
    if (count !== 1n || !member || ethers.getAddress(member) !== expectedMember) {
      invalidMembership.push(
        `${name} expected sole member ${expectedMember}, got count=${count}` +
          (member ? ` member=${member}` : ""),
      );
    }
  }
  if (invalidMembership.length > 0) {
    throw new Error(
      `GovernanceTimelock ${address} has unsafe role membership: ` + invalidMembership.join("; "),
    );
  }

  console.log(
    `governance-timelock: ${address} minDelay=${minDelay}s; ` +
      `Safe=${multisig} threshold=${multisigPolicy.threshold} roles exclusive OK`,
  );
};

// On live networks, refuse to reuse a deployment whose administrative ownership is not the
// intended GovernanceTimelock. Without this, an existing JSON pointing at contracts that still
// belong to a deployer EOA would silently be accepted and downstream tasks would proceed as if
// the system were under timelock/multisig control. Local dev networks intentionally keep
// deployer-as-owner and are exempt.
const assertExistingGovernanceOwner = async (connection, ethers, artifacts, contracts) => {
  if (isLocalDevNetwork(connection)) return;
  const governanceOwner = process.env.GOVERNANCE_TIMELOCK_ADDRESS;
  const hasGovernanceOwner =
    Boolean(governanceOwner) &&
    ethers.isAddress(governanceOwner) &&
    governanceOwner !== ethers.ZeroAddress;
  if (!hasGovernanceOwner) {
    throw new Error(
      `Reusing an existing deployment on a live network requires GOVERNANCE_TIMELOCK_ADDRESS ` +
        `to be set so ` +
        `upgrade authority can be verified (got ${governanceOwner ?? "unset"}).`,
    );
  }
  const expected = ethers.getAddress(governanceOwner);
  for (const { contractName, contract } of contracts) {
    const actual = ethers.getAddress(await contract.owner());
    if (actual !== expected) {
      throw new Error(
        `Deployment ${contractName} owner=${actual} does not match ` +
          `GOVERNANCE_TIMELOCK_ADDRESS=${expected}; refusing to reuse a deployment whose ` +
          `ownership is not assigned to the intended GovernanceTimelock.`,
      );
    }
  }
  await assertGovernanceOwnerInvariants({
    connection,
    ethers,
    artifacts,
    address: expected,
  });
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
  { contractName, contract, isProxy = false, extra = {} },
) => {
  const artifact = await artifacts.readArtifact(contractName);
  const address = await contract.getAddress();
  const refreshedExtra = { ...extra };
  if (isProxy) {
    const raw = await ethers.provider.getStorage(address, ERC1967_IMPLEMENTATION_SLOT);
    refreshedExtra.implementationAddress = ethers.getAddress(ethers.dataSlice(raw, 12));
  }
  await writeDeployment(connection, contractName, address, artifact.abi, refreshedExtra);
};

const assertExistingIntegratedWiring = async ({
  ethers,
  deepFamily,
  token,
  metadataArchive,
  storyArchive,
  deepFamilyReader,
  expectedGroth16Adapter,
}) => {
  const deepFamilyAddress = await deepFamily.getAddress();
  const tokenAddress = await token.getAddress();
  const metadataArchiveAddress = await metadataArchive.getAddress();
  const storyArchiveAddress = await storyArchive.getAddress();

  const readerMain = await deepFamilyReader.DEEP_FAMILY();
  if (!sameAddress(readerMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: reader.DEEP_FAMILY=${readerMain}, expected ${deepFamilyAddress}`,
    );
  }

  const [configuredArchive, archiveMain, readerArchive] = await Promise.all([
    deepFamily.metadataArchive(),
    metadataArchive.DEEP_FAMILY(),
    deepFamilyReader.METADATA_ARCHIVE(),
  ]);
  if (
    !sameAddress(configuredArchive, metadataArchiveAddress) ||
    !sameAddress(archiveMain, deepFamilyAddress) ||
    !sameAddress(readerArchive, metadataArchiveAddress)
  ) {
    throw new Error(
      `Deployment wiring mismatch: DeepFamily archive=${configuredArchive}, ` +
        `archive.DEEP_FAMILY=${archiveMain}, reader archive=${readerArchive}; expected ` +
        `${metadataArchiveAddress}/${deepFamilyAddress}/${metadataArchiveAddress}`,
    );
  }

  const [configuredStoryArchive, storyArchiveMain, readerStoryArchive] = await Promise.all([
    deepFamily.storyArchive(),
    storyArchive.DEEP_FAMILY(),
    deepFamilyReader.STORY_ARCHIVE(),
  ]);
  if (
    !sameAddress(configuredStoryArchive, storyArchiveAddress) ||
    !sameAddress(storyArchiveMain, deepFamilyAddress) ||
    !sameAddress(readerStoryArchive, storyArchiveAddress)
  ) {
    throw new Error(
      `Deployment wiring mismatch: DeepFamily story archive=${configuredStoryArchive}, ` +
        `story archive.DEEP_FAMILY=${storyArchiveMain}, reader story archive=${readerStoryArchive}; ` +
        `expected ${storyArchiveAddress}/${deepFamilyAddress}/${storyArchiveAddress}`,
    );
  }

  const tokenMain = await token.deepFamilyContract();
  if (!sameAddress(tokenMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: token.deepFamilyContract=${tokenMain}, ` +
        `expected ${deepFamilyAddress}`,
    );
  }

  const mainToken = await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT();
  if (!sameAddress(mainToken, tokenAddress)) {
    throw new Error(
      `Deployment wiring mismatch: DeepFamily.DEEP_FAMILY_TOKEN_CONTRACT=${mainToken}, ` +
        `expected ${tokenAddress}`,
    );
  }

  const tokenOwner = await token.owner();
  if (!sameAddress(tokenOwner, ethers.ZeroAddress)) {
    throw new Error(
      `Deployment lifecycle mismatch: DeepFamilyToken owner=${tokenOwner}, expected ` +
        `${ethers.ZeroAddress} after its one-time binding`,
    );
  }

  const personVerifier = await deepFamily.verifierRegistry(
    PROOF_PURPOSE_PERSON_RELATION,
    PERSON_RELATION_CIRCUIT_ID,
  );
  const disclosureVerifier = await deepFamily.verifierRegistry(
    PROOF_PURPOSE_DISCLOSURE_BINDING,
    DISCLOSURE_BINDING_CIRCUIT_ID,
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

// Deploy a UUPS proxy: deploy the implementation, then an ERC1967 proxy (UUPSProxy)
// pointing at it with the encoded initialize() calldata. `deployContract` is deliberately
// injected so live release tooling can journal the nonce before each transaction is broadcast.
const deployUUPSProxy = async (ethers, deployer, factory, initArgs, deployContract) => {
  const impl = await deployContract("deepFamilyImplementation", factory);
  const implAddress = await impl.getAddress();
  const initData = factory.interface.encodeFunctionData("initialize", initArgs);
  const Proxy = await ethers.getContractFactory("UUPSProxy", deployer);
  const proxy = await deployContract("deepFamilyProxy", Proxy, [implAddress, initData]);
  const proxyAddress = await proxy.getAddress();
  return { implAddress, proxyAddress };
};

export const deployIntegratedSystem = async (
  hreOrConnection,
  {
    writeDeployments = false,
    signer,
    artifacts: artifactReader,
    transactionConfirmations = 1,
    transactionTimeoutMs = 0,
    transactionExecutor,
    onTransactionSubmitted,
    onTransactionReceipt,
    deploymentDirectory,
    governanceOwner: configuredGovernanceOwner,
    governanceMultisig = process.env.GOVERNANCE_SAFE_ADDRESS,
    governanceMultisigProfile = process.env.GOVERNANCE_SAFE_PROFILE,
  } = {},
) => {
  assertNoRemovedGovernanceEnvironmentVariables(process.env);
  const connection = await resolveConnection(hreOrConnection);
  const { ethers } = connection;
  const currentArtifacts = artifactReader ?? hreOrConnection?.artifacts ?? null;
  const [defaultSigner] = await ethers.getSigners();
  const deployer = signer ?? defaultSigner;
  const deployerAddress = await deployer.getAddress();
  if (!Number.isSafeInteger(transactionConfirmations) || transactionConfirmations < 1) {
    throw new Error("transactionConfirmations must be a positive safe integer");
  }
  if (!Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 0) {
    throw new Error("transactionTimeoutMs must be a non-negative safe integer");
  }
  if (transactionExecutor !== undefined && typeof transactionExecutor !== "function") {
    throw new Error("transactionExecutor must be a function when provided");
  }
  if (onTransactionSubmitted !== undefined && typeof onTransactionSubmitted !== "function") {
    throw new Error("onTransactionSubmitted must be a function when provided");
  }
  if (onTransactionReceipt !== undefined && typeof onTransactionReceipt !== "function") {
    throw new Error("onTransactionReceipt must be a function when provided");
  }
  if (deploymentDirectory !== undefined && writeDeployments !== true) {
    throw new Error("deploymentDirectory requires writeDeployments=true");
  }
  const transactionReceipts = {};
  const executeTransaction = async (label, transactionRequest, kind = "call") => {
    let receipt;
    if (transactionExecutor) {
      receipt = await transactionExecutor({
        label,
        kind,
        transactionRequest,
        signer: deployer,
        transactionConfirmations,
        transactionTimeoutMs,
      });
    } else {
      const transaction = await deployer.sendTransaction(transactionRequest);
      if (!transaction?.hash) throw new Error(`${label} transaction hash is unavailable`);
      await onTransactionSubmitted?.(label, transaction, { kind });
      // ethers v6 removes its transaction/block listeners when this native timeout fires. A
      // Promise.race wrapper would return control but leave the underlying wait running.
      receipt = await transaction.wait(transactionConfirmations, transactionTimeoutMs);
    }
    if (!receipt) throw new Error(`${label} transaction was not confirmed`);
    if (Number(receipt.status) !== 1) throw new Error(`${label} transaction reverted`);
    transactionReceipts[label] = receipt;
    await onTransactionReceipt?.(label, receipt);
    return receipt;
  };
  const deployContract = async (label, factory, args = []) => {
    const transactionRequest = await factory.getDeployTransaction(...args);
    const receipt = await executeTransaction(label, transactionRequest, "deployment");
    if (!receipt.contractAddress || !ethers.isAddress(receipt.contractAddress)) {
      throw new Error(`${label} receipt does not contain a deployment address`);
    }
    const address = ethers.getAddress(receipt.contractAddress);
    if ((await ethers.provider.getCode(address)) === "0x") {
      throw new Error(`${label} has no runtime code at ${address}`);
    }
    return factory.attach(address);
  };

  // Validate the GovernanceTimelock up front so a misconfigured live deployment fails before any
  // contracts are created, rather than leaving orphaned modules after a late-stage throw. Local
  // dev networks (edr-simulated / localhost) are exempt and keep the deployer as owner.
  const isLocalDev = isLocalDevNetwork(connection);
  const governanceOwner = configuredGovernanceOwner ?? process.env.GOVERNANCE_TIMELOCK_ADDRESS;
  const hasGovernanceOwner =
    Boolean(governanceOwner) &&
    ethers.isAddress(governanceOwner) &&
    governanceOwner !== ethers.ZeroAddress;
  if (!hasGovernanceOwner && !isLocalDev) {
    throw new Error(
      `GOVERNANCE_TIMELOCK_ADDRESS must be set to a valid nonzero address before deploying a ` +
        `UUPS proxy to ` +
        `a live network (got ${governanceOwner ?? "unset"}); otherwise unilateral upgrade ` +
        `authority would remain on the deployer key.`,
    );
  }
  if (hasGovernanceOwner && !isLocalDev) {
    await assertGovernanceOwnerInvariants({
      connection,
      ethers,
      artifacts: currentArtifacts,
      address: ethers.getAddress(governanceOwner),
      governanceMultisig,
      governanceMultisigProfile,
    });
  }

  const Token = await ethers.getContractFactory("DeepFamilyToken", deployer);
  const token = await deployContract("deepFamilyToken", Token);

  const PoseidonT5 = await ethers.getContractFactory("PoseidonT5", deployer);
  const poseidonT5 = await deployContract("poseidonT5", PoseidonT5);

  const AdultAgeGate = await ethers.getContractFactory("AdultAgeGate", deployer);
  const adultAgeGate = await deployContract("adultAgeGate", AdultAgeGate);

  const PersonCommitmentVerifier = await ethers.getContractFactory(
    "PersonCommitmentVerifier",
    deployer,
  );
  const personCommitmentVerifier = await deployContract(
    "personCommitmentVerifier",
    PersonCommitmentVerifier,
  );

  const DisclosureBindingVerifier = await ethers.getContractFactory(
    "DisclosureBindingVerifier",
    deployer,
  );
  const nameDisclosureVerifier = await deployContract(
    "disclosureBindingVerifier",
    DisclosureBindingVerifier,
  );

  const tokenAddress = await token.getAddress();
  const poseidonT5Address = await poseidonT5.getAddress();
  const adultAgeGateAddress = await adultAgeGate.getAddress();
  const personCommitmentVerifierAddress = await personCommitmentVerifier.getAddress();
  const nameDisclosureVerifierAddress = await nameDisclosureVerifier.getAddress();

  const Groth16VerifierAdapter = await ethers.getContractFactory(
    "Groth16VerifierAdapter",
    deployer,
  );
  const groth16VerifierAdapter = await deployContract(
    "groth16VerifierAdapter",
    Groth16VerifierAdapter,
    [personCommitmentVerifierAddress, nameDisclosureVerifierAddress],
  );
  const groth16VerifierAdapterAddress = await groth16VerifierAdapter.getAddress();

  // Main contract behind a UUPS proxy. initialize() wires the token address.
  const DeepFamily = await ethers.getContractFactory("DeepFamily", {
    signer: deployer,
    libraries: {
      PoseidonT5: poseidonT5Address,
      AdultAgeGate: adultAgeGateAddress,
    },
  });
  const { implAddress: deepFamilyImplementationAddress, proxyAddress: deepFamilyAddress } =
    await deployUUPSProxy(
      ethers,
      deployer,
      DeepFamily,
      [tokenAddress, deployerAddress],
      deployContract,
    );
  const deepFamily = await ethers.getContractAt("DeepFamily", deepFamilyAddress, deployer);

  const bound = await token.deepFamilyContract().catch(() => ethers.ZeroAddress);
  if (bound === ethers.ZeroAddress) {
    await executeTransaction(
      "tokenInitialize",
      await token.initialize.populateTransaction(deepFamilyAddress),
    );
  }
  const configuredMain = await token.deepFamilyContract();
  const tokenOwner = await token.owner();
  if (
    !sameAddress(configuredMain, deepFamilyAddress) ||
    !sameAddress(tokenOwner, ethers.ZeroAddress)
  ) {
    throw new Error(
      `DeepFamilyToken initialization invariant failed: main=${configuredMain}, owner=${tokenOwner}; ` +
        `expected main=${deepFamilyAddress}, owner=${ethers.ZeroAddress}`,
    );
  }

  const MetadataArchiveV1 = await ethers.getContractFactory("MetadataArchiveV1", deployer);
  const metadataArchive = await deployContract("metadataArchiveV1", MetadataArchiveV1, [
    deepFamilyAddress,
  ]);
  const metadataArchiveAddress = await metadataArchive.getAddress();

  await executeTransaction(
    "setMetadataArchive",
    await deepFamily.setMetadataArchive.populateTransaction(metadataArchiveAddress),
  );
  const [configuredArchive, archiveMain] = await Promise.all([
    deepFamily.metadataArchive(),
    metadataArchive.DEEP_FAMILY(),
  ]);
  if (
    !sameAddress(configuredArchive, metadataArchiveAddress) ||
    !sameAddress(archiveMain, deepFamilyAddress)
  ) {
    throw new Error(
      `MetadataArchiveV1 binding invariant failed: DeepFamily archive=${configuredArchive}, ` +
        `archive.DEEP_FAMILY=${archiveMain}; expected ${metadataArchiveAddress}/${deepFamilyAddress}`,
    );
  }

  const StoryArchiveV1 = await ethers.getContractFactory("StoryArchiveV1", deployer);
  const storyArchive = await deployContract("storyArchiveV1", StoryArchiveV1, [deepFamilyAddress]);
  const storyArchiveAddress = await storyArchive.getAddress();

  await executeTransaction(
    "setStoryArchive",
    await deepFamily.setStoryArchive.populateTransaction(storyArchiveAddress),
  );
  const [configuredStoryArchive, storyArchiveMain] = await Promise.all([
    deepFamily.storyArchive(),
    storyArchive.DEEP_FAMILY(),
  ]);
  if (
    !sameAddress(configuredStoryArchive, storyArchiveAddress) ||
    !sameAddress(storyArchiveMain, deepFamilyAddress)
  ) {
    throw new Error(
      `StoryArchiveV1 binding invariant failed: DeepFamily archive=${configuredStoryArchive}, ` +
        `archive.DEEP_FAMILY=${storyArchiveMain}; expected ${storyArchiveAddress}/${deepFamilyAddress}`,
    );
  }

  const DeepFamilyReader = await ethers.getContractFactory("DeepFamilyReader", deployer);
  const deepFamilyReader = await deployContract("deepFamilyReader", DeepFamilyReader, [
    deepFamilyAddress,
  ]);
  const deepFamilyReaderAddress = await deepFamilyReader.getAddress();

  // Register each immutable (purpose, circuitId) route. Purpose namespaces are independent.
  const ensureVerifierRoute = async (label, purpose, circuitId) => {
    const current = await deepFamily.verifierRegistry(purpose, circuitId);
    if (sameAddress(current, groth16VerifierAdapterAddress)) return;
    if (!sameAddress(current, ethers.ZeroAddress)) {
      throw new Error(
        `${label} route already points at ${current}, expected ${groth16VerifierAdapterAddress}`,
      );
    }
    await executeTransaction(
      label,
      await deepFamily.setCircuitVerifier.populateTransaction(
        purpose,
        circuitId,
        groth16VerifierAdapterAddress,
      ),
    );
  };
  await ensureVerifierRoute(
    "setPersonRelationVerifier",
    PROOF_PURPOSE_PERSON_RELATION,
    PERSON_RELATION_CIRCUIT_ID,
  );
  await ensureVerifierRoute(
    "setDisclosureBindingVerifier",
    PROOF_PURPOSE_DISCLOSURE_BINDING,
    DISCLOSURE_BINDING_CIRCUIT_ID,
  );

  // Hand DeepFamily upgrade/configuration ownership to governance (intended: timelock + multisig).
  // DeepFamilyToken already retired its bootstrap owner during initialize(), so it intentionally
  // remains ownerless. Must run after verifier registration, which requires the deployer to still
  // be the DeepFamily owner.
  // With UUPS the owner can replace the entire implementation, so on live networks a governance
  // GovernanceTimelock is mandatory (validated up front). Local dev networks always keep the
  // deployer as owner so owner-only test/dev flows keep working even if
  // GOVERNANCE_TIMELOCK_ADDRESS leaks in from .env.
  if (hasGovernanceOwner && !isLocalDev) {
    const currentOwner = await deepFamily.owner();
    if (!sameAddress(currentOwner, governanceOwner)) {
      if (!sameAddress(currentOwner, deployerAddress)) {
        throw new Error(
          `DeepFamily owner=${currentOwner}; expected deployer ${deployerAddress} or governance ` +
            `owner ${governanceOwner}`,
        );
      }
      await executeTransaction(
        "transferDeepFamilyOwnership",
        await deepFamily.transferOwnership.populateTransaction(governanceOwner),
      );
    }
  }

  if (writeDeployments) {
    const artifacts = currentArtifacts;

    if (!artifacts?.readArtifact) {
      throw new Error(
        "writeDeployments=true requires passing Hardhat hre (with artifacts) to deployIntegratedSystem",
      );
    }

    const tokenArtifact = await artifacts.readArtifact("DeepFamilyToken");
    const deepArtifact = await artifacts.readArtifact("DeepFamily");
    const metadataArchiveArtifact = await artifacts.readArtifact("MetadataArchiveV1");
    const storyArchiveArtifact = await artifacts.readArtifact("StoryArchiveV1");
    const readerArtifact = await artifacts.readArtifact("DeepFamilyReader");
    const poseidonT5Artifact = await artifacts.readArtifact("PoseidonT5");
    const adultAgeGateArtifact = await artifacts.readArtifact("AdultAgeGate");
    const personVerifierArtifact = await artifacts.readArtifact("PersonCommitmentVerifier");
    const nameVerifierArtifact = await artifacts.readArtifact("DisclosureBindingVerifier");
    const groth16AdapterArtifact = await artifacts.readArtifact("Groth16VerifierAdapter");

    await writeDeployment(
      connection,
      "DeepFamilyToken",
      tokenAddress,
      tokenArtifact.abi,
      {},
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "PoseidonT5",
      poseidonT5Address,
      poseidonT5Artifact.abi,
      {},
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "AdultAgeGate",
      adultAgeGateAddress,
      adultAgeGateArtifact.abi,
      {},
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "PersonCommitmentVerifier",
      personCommitmentVerifierAddress,
      personVerifierArtifact.abi,
      {},
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "DisclosureBindingVerifier",
      nameDisclosureVerifierAddress,
      nameVerifierArtifact.abi,
      {},
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "Groth16VerifierAdapter",
      groth16VerifierAdapterAddress,
      groth16AdapterArtifact.abi,
      {},
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "DeepFamily",
      deepFamilyAddress,
      deepArtifact.abi,
      {
        implementationAddress: deepFamilyImplementationAddress,
      },
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "MetadataArchiveV1",
      metadataArchiveAddress,
      metadataArchiveArtifact.abi,
      { deepFamilyAddress },
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "StoryArchiveV1",
      storyArchiveAddress,
      storyArchiveArtifact.abi,
      { deepFamilyAddress },
      deploymentDirectory,
    );
    await writeDeployment(
      connection,
      "DeepFamilyReader",
      deepFamilyReaderAddress,
      readerArtifact.abi,
      {},
      deploymentDirectory,
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
    deepFamily,
    metadataArchive,
    storyArchive,
    deepFamilyReader,
    deepFamilyImplementationAddress,
    transactionReceipts,
  };
};

export const ensureIntegratedSystem = async (
  hreOrConnection,
  { writeDeployments, artifacts: artifactReader, allowNewDeployment = false } = {},
) => {
  assertNoRemovedGovernanceEnvironmentVariables(process.env);
  const connection = await resolveConnection(hreOrConnection);
  if (
    connection.__deepfamilyIntegrated?.deepFamily &&
    connection.__deepfamilyIntegrated?.storyArchive
  ) {
    return connection.__deepfamilyIntegrated;
  }

  const { ethers } = connection;
  const [defaultSigner] = await ethers.getSigners();
  const currentArtifacts = artifactReader ?? hreOrConnection?.artifacts ?? null;
  // Operational tasks run as separate processes. On a persistent localhost node, a stale
  // address book must therefore be replaced on disk together with the freshly deployed module
  // set; otherwise every subsequent task would deploy yet another isolated system. In-process
  // Hardhat networks remain ephemeral and keep their existing no-write default. Callers may
  // still explicitly override either behavior.
  const shouldWriteDeployments =
    writeDeployments ??
    (isLocalDevNetwork(connection) &&
      !isEphemeralNetwork(connection) &&
      Boolean(currentArtifacts?.readArtifact));

  const existingDeep = await safeReadDeployment(connection, "DeepFamily");
  const existingToken = await safeReadDeployment(connection, "DeepFamilyToken");
  const existingMetadataArchive = await safeReadDeployment(connection, "MetadataArchiveV1");
  const existingStoryArchive = await safeReadDeployment(connection, "StoryArchiveV1");
  const existingReader = await safeReadDeployment(connection, "DeepFamilyReader");
  const existingGroth16Adapter = await safeReadDeployment(connection, "Groth16VerifierAdapter");
  const existingPoseidonT5 = await safeReadDeployment(connection, "PoseidonT5");
  const existingAdultAgeGate = await safeReadDeployment(connection, "AdultAgeGate");
  const existingPersonVerifier = await safeReadDeployment(connection, "PersonCommitmentVerifier");
  const existingDisclosureVerifier = await safeReadDeployment(
    connection,
    "DisclosureBindingVerifier",
  );
  const recordedDeployments = [
    ["DeepFamily", existingDeep],
    ["DeepFamilyToken", existingToken],
    ["MetadataArchiveV1", existingMetadataArchive],
    ["StoryArchiveV1", existingStoryArchive],
    ["DeepFamilyReader", existingReader],
    ["Groth16VerifierAdapter", existingGroth16Adapter],
    ["PoseidonT5", existingPoseidonT5],
    ["AdultAgeGate", existingAdultAgeGate],
    ["PersonCommitmentVerifier", existingPersonVerifier],
    ["DisclosureBindingVerifier", existingDisclosureVerifier],
  ];
  const recordedNames = recordedDeployments
    .filter(([, deployment]) => deployment?.address)
    .map(([contractName]) => contractName);
  const hasCompleteCoreDeployment =
    existingDeep?.address &&
    existingToken?.address &&
    existingMetadataArchive?.address &&
    existingStoryArchive?.address &&
    existingReader?.address;

  if (recordedNames.length === 0 && !isLocalDevNetwork(connection)) {
    if (!allowNewDeployment) {
      throw new Error(
        "No deployment metadata exists for this live network; refusing to deploy a new system " +
          "from an operational task. Run the explicit integrated deployment command first.",
      );
    }
    if (writeDeployments !== true || !currentArtifacts?.readArtifact) {
      throw new Error(
        "A new live-network deployment must persist its complete current artifact metadata; " +
          "set writeDeployments=true and pass Hardhat artifacts.",
      );
    }
  }

  if (!hasCompleteCoreDeployment && recordedNames.length > 0) {
    const message =
      `Deployment metadata is partial (${recordedNames.join(", ")}); refusing to treat this ` +
      "network as a fresh deployment";
    if (!isLocalDevNetwork(connection)) throw new Error(message);
    console.warn(`[deployment] ${message}; deploying a fresh local module set`);
  }
  if (hasCompleteCoreDeployment) {
    try {
      await assertDeploymentCode(ethers, [
        ["DeepFamily", existingDeep],
        ["DeepFamilyToken", existingToken],
        ["MetadataArchiveV1", existingMetadataArchive],
        ["StoryArchiveV1", existingStoryArchive],
        ["DeepFamilyReader", existingReader],
      ]);

      // DeepFamily must be a UUPS proxy; a legacy direct deployment would
      // pass the code/wiring checks above yet be silently non-upgradeable.
      const deepFamilyImplementation = await assertErc1967Proxy(ethers, "DeepFamily", existingDeep);

      if (currentArtifacts?.readArtifact) {
        const artifactBoundDeployments = [
          ["MetadataArchiveV1", existingMetadataArchive],
          ["StoryArchiveV1", existingStoryArchive],
          ["PoseidonT5", existingPoseidonT5],
          ["AdultAgeGate", existingAdultAgeGate],
          ["PersonCommitmentVerifier", existingPersonVerifier],
          ["DisclosureBindingVerifier", existingDisclosureVerifier],
          ["Groth16VerifierAdapter", existingGroth16Adapter],
        ];
        const missing = artifactBoundDeployments
          .filter(([, deployment]) => !deployment?.address)
          .map(([contractName]) => contractName);
        if (missing.length > 0) {
          throw new Error(
            `Deployment metadata is missing ${missing.join(", ")}; refusing to reuse a ` +
              "deployment whose verifier/library version cannot be checked",
          );
        }

        await assertDeploymentCode(ethers, artifactBoundDeployments);

        const groth16Adapter = await ethers.getContractAt(
          "Groth16VerifierAdapter",
          existingGroth16Adapter.address,
          defaultSigner,
        );
        const [personVerifierBackend, disclosureVerifierBackend] = await Promise.all([
          groth16Adapter.personVerifier(),
          groth16Adapter.disclosureBindingVerifier(),
        ]);
        if (
          !sameAddress(personVerifierBackend, existingPersonVerifier.address) ||
          !sameAddress(disclosureVerifierBackend, existingDisclosureVerifier.address)
        ) {
          throw new Error(
            "Deployment wiring mismatch: Groth16 adapter backend verifiers do not match the " +
              "recorded PersonCommitmentVerifier/DisclosureBindingVerifier deployments",
          );
        }

        await assertCurrentArtifactSet({
          connection,
          ethers,
          artifacts: currentArtifacts,
          deepFamilyImplementation,
          deployments: [
            { contractName: "DeepFamilyToken", deployment: existingToken },
            { contractName: "DeepFamilyReader", deployment: existingReader },
            ...artifactBoundDeployments.map(([contractName, deployment]) => ({
              contractName,
              deployment,
            })),
          ],
        });
      }

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
      const metadataArchive = await ethers.getContractAt(
        "MetadataArchiveV1",
        existingMetadataArchive.address,
        defaultSigner,
      );
      const storyArchive = await ethers.getContractAt(
        "StoryArchiveV1",
        existingStoryArchive.address,
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
        metadataArchive,
        storyArchive,
        deepFamilyReader,
        expectedGroth16Adapter: existingGroth16Adapter,
      });
      await assertExistingGovernanceOwner(connection, ethers, currentArtifacts, [
        { contractName: "DeepFamily", contract: deepFamily },
      ]);
      if (shouldWriteDeployments) {
        const artifacts = currentArtifacts;
        if (!artifacts?.readArtifact) {
          throw new Error(
            "Persisting deployments requires passing Hardhat hre (with artifacts) to ensureIntegratedSystem",
          );
        }
        const refreshTargets = [
          { contractName: "DeepFamily", contract: deepFamily, isProxy: true },
          { contractName: "DeepFamilyToken", contract: token },
          {
            contractName: "MetadataArchiveV1",
            contract: metadataArchive,
            extra: { deepFamilyAddress: await deepFamily.getAddress() },
          },
          {
            contractName: "StoryArchiveV1",
            contract: storyArchive,
            extra: { deepFamilyAddress: await deepFamily.getAddress() },
          },
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
        metadataArchive,
        storyArchive,
        deepFamilyReader,
      };
      return connection.__deepfamilyIntegrated;
    } catch (error) {
      // Local dev networks (in-process simulated or explicitly named localhost) commonly restart with
      // a clean chain while deployment files remain on disk. Fall through and deploy a current
      // UUPS module set. On live networks, surface validation failures instead of silently
      // creating a second, orphaned module set.
      if (!isLocalDevNetwork(connection)) throw error;
      console.warn(
        `[deployment] Existing local module set is stale or inconsistent; deploying a fresh set: ` +
          `${error?.message || error}`,
      );
    }
  }

  const deployed = await deployIntegratedSystem(connection, {
    writeDeployments: shouldWriteDeployments,
    signer: defaultSigner,
    artifacts: artifactReader ?? hreOrConnection?.artifacts,
  });
  connection.__deepfamilyIntegrated = {
    deepFamily: deployed.deepFamily,
    token: deployed.token,
    metadataArchive: deployed.metadataArchive,
    storyArchive: deployed.storyArchive,
    deepFamilyReader: deployed.deepFamilyReader,
  };
  return connection.__deepfamilyIntegrated;
};
