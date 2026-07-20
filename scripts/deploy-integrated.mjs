import hre from "hardhat";
import {
  deployIntegratedSystem,
  ensureIntegratedSystem,
} from "../hardhat/integratedDeployment.mjs";

const main = async () => {
  const connection = await hre.network.connect();
  const networkName = connection.networkName || "unknown";
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const forceNew = process.argv.includes("--force-new") || process.env.FORCE_NEW_DEPLOYMENT === "1";

  const deployed = forceNew
    ? await deployIntegratedSystem(connection, {
        writeDeployments: true,
        signer: deployer,
        artifacts: hre.artifacts,
      })
    : await ensureIntegratedSystem(connection, {
        writeDeployments: true,
        artifacts: hre.artifacts,
        allowNewDeployment: true,
      });
  const { deepFamily } = deployed;
  const deepFamilyAddress = await deepFamily.getAddress();
  console.log(
    `[deploy-integrated] network=${networkName} mode=${forceNew ? "force-new" : "ensure"} ` +
      `deployer=${deployerAddress} DeepFamily=${deepFamilyAddress}`,
  );
};

main().catch((e) => {
  console.error("[deploy-integrated] failed", e);
  process.exit(1);
});
