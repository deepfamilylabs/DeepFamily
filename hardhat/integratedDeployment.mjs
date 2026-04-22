import fs from 'node:fs/promises'
import path from 'node:path'

const GROTH16_PROOF_SYSTEM_ID = 1
const PROOF_PURPOSE_PERSON_COMMITMENT = 0
const PROOF_PURPOSE_DISCLOSURE_BINDING = 1

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

  const PersonCommitmentVerifier = await ethers.getContractFactory('PersonCommitmentVerifier', deployer)
  const personCommitmentVerifier = await PersonCommitmentVerifier.deploy()
  await personCommitmentVerifier.waitForDeployment()

  const DisclosureBindingVerifier = await ethers.getContractFactory('DisclosureBindingVerifier', deployer)
  const nameDisclosureVerifier = await DisclosureBindingVerifier.deploy()
  await nameDisclosureVerifier.waitForDeployment()

  const tokenAddress = await token.getAddress()
  const poseidonT5Address = await poseidonT5.getAddress()
  const personCommitmentVerifierAddress = await personCommitmentVerifier.getAddress()
  const nameDisclosureVerifierAddress = await nameDisclosureVerifier.getAddress()

  const Groth16VerifierAdapter = await ethers.getContractFactory('Groth16VerifierAdapter', deployer)
  const groth16VerifierAdapter = await Groth16VerifierAdapter.deploy(
    personCommitmentVerifierAddress,
    nameDisclosureVerifierAddress,
  )
  await groth16VerifierAdapter.waitForDeployment()
  const groth16VerifierAdapterAddress = await groth16VerifierAdapter.getAddress()

  const DeepFamily = await ethers.getContractFactory('DeepFamily', {
    signer: deployer,
    libraries: {
      PoseidonT5: poseidonT5Address,
    },
  })
  const deepFamily = await DeepFamily.deploy(tokenAddress)
  await deepFamily.waitForDeployment()

  const deepFamilyAddress = await deepFamily.getAddress()

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
    )
  ).wait()
  await (
    await deepFamily.setVerifier(
      GROTH16_PROOF_SYSTEM_ID,
      PROOF_PURPOSE_DISCLOSURE_BINDING,
      groth16VerifierAdapterAddress,
    )
  ).wait()

  if (writeDeployments) {
    const artifacts = hreOrConnection?.artifacts ?? null

    if (!artifacts?.readArtifact) {
      throw new Error('writeDeployments=true requires passing Hardhat hre (with artifacts) to deployIntegratedSystem')
    }

    const tokenArtifact = await artifacts.readArtifact('DeepFamilyToken')
    const deepArtifact = await artifacts.readArtifact('DeepFamily')
    const poseidonT5Artifact = await artifacts.readArtifact('PoseidonT5')
    const personVerifierArtifact = await artifacts.readArtifact('PersonCommitmentVerifier')
    const nameVerifierArtifact = await artifacts.readArtifact('DisclosureBindingVerifier')
    const groth16AdapterArtifact = await artifacts.readArtifact('Groth16VerifierAdapter')

    await writeDeployment(connection, 'DeepFamilyToken', tokenAddress, tokenArtifact.abi)
    await writeDeployment(connection, 'PoseidonT5', poseidonT5Address, poseidonT5Artifact.abi)
    await writeDeployment(connection, 'PersonCommitmentVerifier', personCommitmentVerifierAddress, personVerifierArtifact.abi)
    await writeDeployment(connection, 'DisclosureBindingVerifier', nameDisclosureVerifierAddress, nameVerifierArtifact.abi)
    await writeDeployment(connection, 'Groth16VerifierAdapter', groth16VerifierAdapterAddress, groth16AdapterArtifact.abi)
    await writeDeployment(connection, 'DeepFamily', deepFamilyAddress, deepArtifact.abi)
  }

  return {
    deployerAddress,
    token,
    poseidonT5,
    personCommitmentVerifier,
    nameDisclosureVerifier,
    groth16VerifierAdapter,
    deepFamily,
  }
}

export const ensureIntegratedSystem = async (hreOrConnection, { writeDeployments = false } = {}) => {
  const connection = await resolveConnection(hreOrConnection)
  if (connection.__deepfamilyIntegrated?.deepFamily) return connection.__deepfamilyIntegrated

  const { ethers } = connection
  const [defaultSigner] = await ethers.getSigners()

  const existingDeep = await safeReadDeployment(connection, 'DeepFamily')
  const existingToken = await safeReadDeployment(connection, 'DeepFamilyToken')
  if (existingDeep?.address && existingToken?.address) {
    const deepFamily = await ethers.getContractAt('DeepFamily', existingDeep.address, defaultSigner)
    const token = await ethers.getContractAt('DeepFamilyToken', existingToken.address, defaultSigner)
    connection.__deepfamilyIntegrated = { deepFamily, token }
    return connection.__deepfamilyIntegrated
  }

  const deployed = await deployIntegratedSystem(connection, { writeDeployments, signer: defaultSigner })
  connection.__deepfamilyIntegrated = { deepFamily: deployed.deepFamily, token: deployed.token }
  return connection.__deepfamilyIntegrated
}
