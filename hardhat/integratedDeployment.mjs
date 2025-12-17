import fs from 'node:fs/promises'
import path from 'node:path'

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

  const PoseidonT4 = await ethers.getContractFactory('PoseidonT4', deployer)
  const poseidonT4 = await PoseidonT4.deploy()
  await poseidonT4.waitForDeployment()

  const PersonHashVerifier = await ethers.getContractFactory('PersonHashVerifier', deployer)
  const personHashVerifier = await PersonHashVerifier.deploy()
  await personHashVerifier.waitForDeployment()

  const NamePoseidonVerifier = await ethers.getContractFactory('NamePoseidonVerifier', deployer)
  const namePoseidonVerifier = await NamePoseidonVerifier.deploy()
  await namePoseidonVerifier.waitForDeployment()

  const tokenAddress = await token.getAddress()
  const poseidonT4Address = await poseidonT4.getAddress()
  const personHashVerifierAddress = await personHashVerifier.getAddress()
  const namePoseidonVerifierAddress = await namePoseidonVerifier.getAddress()

  const DeepFamily = await ethers.getContractFactory('DeepFamily', {
    signer: deployer,
    libraries: { PoseidonT4: poseidonT4Address },
  })
  const deepFamily = await DeepFamily.deploy(tokenAddress, personHashVerifierAddress, namePoseidonVerifierAddress)
  await deepFamily.waitForDeployment()

  const deepFamilyAddress = await deepFamily.getAddress()

  const bound = await token.deepFamilyContract().catch(() => ethers.ZeroAddress)
  if (bound === ethers.ZeroAddress) {
    const tx = await token.initialize(deepFamilyAddress)
    await tx.wait()
  }

  if (writeDeployments) {
    const artifacts = hreOrConnection?.artifacts ?? null

    if (!artifacts?.readArtifact) {
      throw new Error('writeDeployments=true requires passing Hardhat hre (with artifacts) to deployIntegratedSystem')
    }

    const tokenArtifact = await artifacts.readArtifact('DeepFamilyToken')
    const deepArtifact = await artifacts.readArtifact('DeepFamily')
    const poseidonArtifact = await artifacts.readArtifact('PoseidonT4')
    const verifierArtifact = await artifacts.readArtifact('PersonHashVerifier')
    const nameVerifierArtifact = await artifacts.readArtifact('NamePoseidonVerifier')

    await writeDeployment(connection, 'DeepFamilyToken', tokenAddress, tokenArtifact.abi)
    await writeDeployment(connection, 'PoseidonT4', poseidonT4Address, poseidonArtifact.abi)
    await writeDeployment(connection, 'PersonHashVerifier', personHashVerifierAddress, verifierArtifact.abi)
    await writeDeployment(connection, 'NamePoseidonVerifier', namePoseidonVerifierAddress, nameVerifierArtifact.abi)
    await writeDeployment(connection, 'DeepFamily', deepFamilyAddress, deepArtifact.abi)
  }

  return {
    deployerAddress,
    token,
    poseidonT4,
    personHashVerifier,
    namePoseidonVerifier,
    deepFamily,
  }
}

export const ensureIntegratedSystem = async (hreOrConnection, { writeDeployments = false } = {}) => {
  const connection = await resolveConnection(hreOrConnection)
  if (connection.__deepfamilyIntegrated?.deepFamily) return connection.__deepfamilyIntegrated

  const { ethers } = connection
  const [defaultSigner] = await ethers.getSigners()

  // Try filesystem deployments first (for localhost/dev flows)
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
