import hre from "hardhat";
import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

const main = async () => {
  const connection = await hre.network.connect();
  const networkName = connection.networkName || "unknown";
  const { deployerAddress, deepFamily } = await deployIntegratedSystem(hre, {
    writeDeployments: true,
  });
  const deepFamilyAddress = await deepFamily.getAddress();
  console.log(
    `[deploy-integrated] network=${networkName} deployer=${deployerAddress} DeepFamily=${deepFamilyAddress}`,
  );
};

main().catch((e) => {
  console.error("[deploy-integrated] failed", e);
  process.exit(1);
});
