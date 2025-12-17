import { deployIntegratedSystem } from '../../hardhat/integratedDeployment.mjs'

export const deployIntegratedFixture = async (connection) => {
  const deployed = await deployIntegratedSystem(connection, { writeDeployments: false })
  connection.__deepfamilyIntegrated = { deepFamily: deployed.deepFamily, token: deployed.token }
  return deployed
}
