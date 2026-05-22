import fs from 'node:fs/promises'
import path from 'node:path'

const GROTH16_PROOF_SYSTEM_ID = 1
const PROOF_PURPOSE_PERSON_COMMITMENT = 0
const PROOF_PURPOSE_DISCLOSURE_BINDING = 1
const ATTESTATION_REF_VERSION_V1 = 1
const SUBJECT_TYPE_ACTION = 6
const ACTION_TYPE_VERIFIER_UPDATE = 4
const SIG_SUITE_ECDSA_SECP256K1_V1 = 1
const REVOCATION_TYPE_NONE = 0
const DOMAIN_ATTESTATION_ACTION = 'DeepFamily.AttestationAction.V1'
let attestationNonce = 1n

const resolveConnection = async (hreOrConnection) => {
  if (hreOrConnection?.ethers?.getSigners) {
    return hreOrConnection
  }

  if (hreOrConnection?.network?.connect) {
    return hreOrConnection.network.connect()
  }

  throw new Error('Expected a Hardhat 3 connection or an hre with network.connect()')
}

const getNetworkDeploymentsDir = (connection) => {
  const networkName =
    connection.networkName || connection.network?.name || connection.network?.networkName || 'unknown'
  return path.join(process.cwd(), 'deployments', networkName)
}

const readJson = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

const sameAddress = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase()

const safeReadDeployment = async (connection, contractName) => {
  try {
    const dir = getNetworkDeploymentsDir(connection)
    const filePath = path.join(dir, `${contractName}.json`)
    const deployment = await readJson(filePath)
    if (deployment?.address && typeof deployment.address === 'string') return deployment
    return null
  } catch {
    return null
  }
}

const writeDeployment = async (connection, contractName, address, abi) => {
  const dir = getNetworkDeploymentsDir(connection)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${contractName}.json`)
  const payload = { address, abi }
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2))
}

const assertExistingIntegratedWiring = async ({
  ethers,
  deepFamily,
  token,
  deepFamilyAttestationRegistry,
  deepFamilyReader,
  expectedGroth16Adapter,
}) => {
  const deepFamilyAddress = await deepFamily.getAddress()
  const registryAddress = await deepFamilyAttestationRegistry.getAddress()

  const deepFamilyRegistry = await deepFamily.ATTESTATION_REGISTRY()
  if (!sameAddress(deepFamilyRegistry, registryAddress)) {
    throw new Error(
      `Deployment wiring mismatch: DeepFamily.ATTESTATION_REGISTRY=${deepFamilyRegistry}, ` +
        `expected ${registryAddress}`,
    )
  }

  const boundRegistryMain = await deepFamilyAttestationRegistry.deepFamily()
  if (!sameAddress(boundRegistryMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: registry.deepFamily=${boundRegistryMain}, ` +
        `expected ${deepFamilyAddress}`,
    )
  }

  const readerMain = await deepFamilyReader.DEEP_FAMILY()
  if (!sameAddress(readerMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: reader.DEEP_FAMILY=${readerMain}, expected ${deepFamilyAddress}`,
    )
  }

  const tokenMain = await token.deepFamilyContract()
  if (!sameAddress(tokenMain, deepFamilyAddress)) {
    throw new Error(
      `Deployment wiring mismatch: token.deepFamilyContract=${tokenMain}, ` +
        `expected ${deepFamilyAddress}`,
    )
  }

  const personVerifier = await deepFamily.verifierRegistry(
    GROTH16_PROOF_SYSTEM_ID,
    PROOF_PURPOSE_PERSON_COMMITMENT,
  )
  const disclosureVerifier = await deepFamily.verifierRegistry(
    GROTH16_PROOF_SYSTEM_ID,
    PROOF_PURPOSE_DISCLOSURE_BINDING,
  )
  if (personVerifier === ethers.ZeroAddress || disclosureVerifier === ethers.ZeroAddress) {
    throw new Error('Deployment wiring mismatch: Groth16 verifier routes are not registered')
  }
  if (expectedGroth16Adapter?.address) {
    if (
      !sameAddress(personVerifier, expectedGroth16Adapter.address) ||
      !sameAddress(disclosureVerifier, expectedGroth16Adapter.address)
    ) {
      throw new Error(
        `Deployment wiring mismatch: verifier routes are ${personVerifier}/${disclosureVerifier}, ` +
          `expected ${expectedGroth16Adapter.address}`,
      )
    }
  }
}

const makeSetVerifierAttestationRef = async (
  ethers,
  deepFamily,
  signer,
  proofSystemId,
  purpose,
  verifier,
) => {
  const network = await ethers.provider.getNetwork()
  const contractAddress = await deepFamily.getAddress()
  const actor = await signer.getAddress()
  const actionDigest = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'uint256', 'address', 'uint16', 'address', 'uint16', 'uint8', 'address'],
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
  )
  const latestBlock = await ethers.provider.getBlock('latest')
  const nonce = attestationNonce++
  return {
    attestationRefVersion: ATTESTATION_REF_VERSION_V1,
    subjectType: SUBJECT_TYPE_ACTION,
    subjectHash: actionDigest,
    actionType: ACTION_TYPE_VERIFIER_UPDATE,
    actionDigest,
    attestationPayloadDigest: ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'address', 'uint256'],
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
  }
}

export const deployIntegratedSystem = async (
  hreOrConnection,
  { writeDeployments = false, signer } = {},
) => {
  const connection = await resolveConnection(hreOrConnection)
  const { ethers } = connection
  const [defaultSigner] = await ethers.getSigners()
  const deployer = signer ?? defaultSigner
  const deployerAddress = await deployer.getAddress()

  const Token = await ethers.getContractFactory('DeepFamilyToken', deployer)
  const token = await Token.deploy()
  await token.waitForDeployment()

  const PoseidonT5 = await ethers.getContractFactory('PoseidonT5', deployer)
  const poseidonT5 = await PoseidonT5.deploy()
  await poseidonT5.waitForDeployment()

  const AdultAgeGate = await ethers.getContractFactory('AdultAgeGate', deployer)
  const adultAgeGate = await AdultAgeGate.deploy()
  await adultAgeGate.waitForDeployment()

  const PersonCommitmentVerifier = await ethers.getContractFactory('PersonCommitmentVerifier', deployer)
  const personCommitmentVerifier = await PersonCommitmentVerifier.deploy()
  await personCommitmentVerifier.waitForDeployment()

  const DisclosureBindingVerifier = await ethers.getContractFactory('DisclosureBindingVerifier', deployer)
  const nameDisclosureVerifier = await DisclosureBindingVerifier.deploy()
  await nameDisclosureVerifier.waitForDeployment()

  const tokenAddress = await token.getAddress()
  const poseidonT5Address = await poseidonT5.getAddress()
  const adultAgeGateAddress = await adultAgeGate.getAddress()
  const personCommitmentVerifierAddress = await personCommitmentVerifier.getAddress()
  const nameDisclosureVerifierAddress = await nameDisclosureVerifier.getAddress()

  const Groth16VerifierAdapter = await ethers.getContractFactory('Groth16VerifierAdapter', deployer)
  const groth16VerifierAdapter = await Groth16VerifierAdapter.deploy(
    personCommitmentVerifierAddress,
    nameDisclosureVerifierAddress,
  )
  await groth16VerifierAdapter.waitForDeployment()
  const groth16VerifierAdapterAddress = await groth16VerifierAdapter.getAddress()

  const DeepFamilyAttestationRegistry = await ethers.getContractFactory(
    'DeepFamilyAttestationRegistry',
    deployer,
  )
  const deepFamilyAttestationRegistry = await DeepFamilyAttestationRegistry.deploy()
  await deepFamilyAttestationRegistry.waitForDeployment()
  const deepFamilyAttestationRegistryAddress = await deepFamilyAttestationRegistry.getAddress()

  const DeepFamily = await ethers.getContractFactory('DeepFamily', {
    signer: deployer,
    libraries: {
      PoseidonT5: poseidonT5Address,
      AdultAgeGate: adultAgeGateAddress,
    },
  })
  const deepFamily = await DeepFamily.deploy(tokenAddress, deepFamilyAttestationRegistryAddress)
  await deepFamily.waitForDeployment()

  const deepFamilyAddress = await deepFamily.getAddress()
  await (await deepFamilyAttestationRegistry.bindDeepFamily(deepFamilyAddress)).wait()

  const DeepFamilyReader = await ethers.getContractFactory('DeepFamilyReader', deployer)
  const deepFamilyReader = await DeepFamilyReader.deploy(deepFamilyAddress)
  await deepFamilyReader.waitForDeployment()
  const deepFamilyReaderAddress = await deepFamilyReader.getAddress()

  const bound = await token.deepFamilyContract().catch(() => ethers.ZeroAddress)
  if (bound === ethers.ZeroAddress) {
    const tx = await token.initialize(deepFamilyAddress)
    await tx.wait()
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
  ).wait()
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
  ).wait()

  if (writeDeployments) {
    const artifacts = hreOrConnection?.artifacts ?? null

    if (!artifacts?.readArtifact) {
      throw new Error('writeDeployments=true requires passing Hardhat hre (with artifacts) to deployIntegratedSystem')
    }

    const tokenArtifact = await artifacts.readArtifact('DeepFamilyToken')
    const deepArtifact = await artifacts.readArtifact('DeepFamily')
    const attestationRegistryArtifact = await artifacts.readArtifact('DeepFamilyAttestationRegistry')
    const readerArtifact = await artifacts.readArtifact('DeepFamilyReader')
    const poseidonT5Artifact = await artifacts.readArtifact('PoseidonT5')
    const adultAgeGateArtifact = await artifacts.readArtifact('AdultAgeGate')
    const personVerifierArtifact = await artifacts.readArtifact('PersonCommitmentVerifier')
    const nameVerifierArtifact = await artifacts.readArtifact('DisclosureBindingVerifier')
    const groth16AdapterArtifact = await artifacts.readArtifact('Groth16VerifierAdapter')

    await writeDeployment(connection, 'DeepFamilyToken', tokenAddress, tokenArtifact.abi)
    await writeDeployment(connection, 'PoseidonT5', poseidonT5Address, poseidonT5Artifact.abi)
    await writeDeployment(connection, 'AdultAgeGate', adultAgeGateAddress, adultAgeGateArtifact.abi)
    await writeDeployment(connection, 'PersonCommitmentVerifier', personCommitmentVerifierAddress, personVerifierArtifact.abi)
    await writeDeployment(connection, 'DisclosureBindingVerifier', nameDisclosureVerifierAddress, nameVerifierArtifact.abi)
    await writeDeployment(connection, 'Groth16VerifierAdapter', groth16VerifierAdapterAddress, groth16AdapterArtifact.abi)
    await writeDeployment(connection, 'DeepFamilyAttestationRegistry', deepFamilyAttestationRegistryAddress, attestationRegistryArtifact.abi)
    await writeDeployment(connection, 'DeepFamily', deepFamilyAddress, deepArtifact.abi)
    await writeDeployment(connection, 'DeepFamilyReader', deepFamilyReaderAddress, readerArtifact.abi)
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
  }
}

export const ensureIntegratedSystem = async (hreOrConnection, { writeDeployments = false } = {}) => {
  const connection = await resolveConnection(hreOrConnection)
  if (connection.__deepfamilyIntegrated?.deepFamily) return connection.__deepfamilyIntegrated

  const { ethers } = connection
  const [defaultSigner] = await ethers.getSigners()

  const existingDeep = await safeReadDeployment(connection, 'DeepFamily')
  const existingToken = await safeReadDeployment(connection, 'DeepFamilyToken')
  const existingRegistry = await safeReadDeployment(connection, 'DeepFamilyAttestationRegistry')
  const existingReader = await safeReadDeployment(connection, 'DeepFamilyReader')
  const existingGroth16Adapter = await safeReadDeployment(connection, 'Groth16VerifierAdapter')
  if (
    existingDeep?.address &&
    existingToken?.address &&
    existingRegistry?.address &&
    existingReader?.address
  ) {
    const deepFamily = await ethers.getContractAt('DeepFamily', existingDeep.address, defaultSigner)
    const token = await ethers.getContractAt('DeepFamilyToken', existingToken.address, defaultSigner)
    const deepFamilyAttestationRegistry = await ethers.getContractAt(
      'DeepFamilyAttestationRegistry',
      existingRegistry.address,
      defaultSigner,
    )
    const deepFamilyReader = await ethers.getContractAt(
      'DeepFamilyReader',
      existingReader.address,
      defaultSigner,
    )
    await assertExistingIntegratedWiring({
      ethers,
      deepFamily,
      token,
      deepFamilyAttestationRegistry,
      deepFamilyReader,
      expectedGroth16Adapter: existingGroth16Adapter,
    })
    connection.__deepfamilyIntegrated = {
      deepFamily,
      token,
      deepFamilyAttestationRegistry,
      deepFamilyReader,
    }
    return connection.__deepfamilyIntegrated
  }

  const deployed = await deployIntegratedSystem(connection, { writeDeployments, signer: defaultSigner })
  connection.__deepfamilyIntegrated = {
    deepFamily: deployed.deepFamily,
    token: deployed.token,
    deepFamilyAttestationRegistry: deployed.deepFamilyAttestationRegistry,
    deepFamilyReader: deployed.deepFamilyReader,
  }
  return connection.__deepfamilyIntegrated
}
