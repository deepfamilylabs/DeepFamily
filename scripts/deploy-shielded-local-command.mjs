import hre from "hardhat";
import { deployShieldedDevelopmentSystem } from "./deploy-shielded-local.mjs";

const connection = await hre.network.connect();
const result = await deployShieldedDevelopmentSystem(connection);
console.log(
  JSON.stringify({
    developmentOnly: true,
    reused: result.reused,
    pool: result.pool.address,
    keyRegistry: result.registry.address,
    poolDeploymentBlock: result.pool.deploymentBlock,
    keyRegistryDeploymentBlock: result.registry.deploymentBlock,
  }),
);
