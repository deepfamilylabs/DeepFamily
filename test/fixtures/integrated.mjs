import { deployIntegratedSystem } from "../../hardhat/integratedDeployment.mjs";

export const deployIntegratedFixture = async (connection) => {
  try {
    await connection.networkHelpers?.mine?.();
  } catch {}
  const deployed = await deployIntegratedSystem(connection, { writeDeployments: false });
  connection.__deepfamilyIntegrated = {
    deepFamily: deployed.deepFamily,
    token: deployed.token,
    metadataArchive: deployed.metadataArchive,
    storyArchive: deployed.storyArchive,
    deepFamilyReader: deployed.deepFamilyReader,
  };
  return deployed;
};
