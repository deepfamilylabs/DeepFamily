import hre from "hardhat";
import { resolveTimelockDeploymentConfig } from "./lib/timelockDeployment.mjs";

// Deploy a TimelockController (via the GovernanceTimelock artifact) to own the UUPS proxy.
//
// Usage:
//   MIN_DELAY=172800 GOVERNANCE_MULTISIG=0xMultisig.. \
//     hardhat --config hardhat.config.mjs run scripts/deploy-timelock.mjs --network <network>
//
// Deployer defaults (120 seconds) exist only on edr-simulated and named localhost networks.
// Live networks require both variables explicitly. The governance address must expose a valid
// inspectable threshold/owner configuration with threshold >= 2. GovernanceTimelock assigns that
// one multisig all proposer/canceller/executor roles and has no external admin.

const main = async () => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer is configured; set PRIVATE_KEY before deploying");
  }
  const me = await deployer.getAddress();

  const { isLocal, minDelay, governanceMultisig } = await resolveTimelockDeploymentConfig({
    connection,
    ethers,
    env: process.env,
    deployerAddress: me,
  });

  const Timelock = await ethers.getContractFactory("GovernanceTimelock", deployer);
  const timelock = await Timelock.deploy(minDelay, governanceMultisig);
  await timelock.waitForDeployment();
  const address = await timelock.getAddress();

  console.log("GovernanceTimelock deployed:");
  console.log(`  address:   ${address}`);
  console.log(`  minDelay:  ${minDelay}s`);
  console.log(`  multisig:  ${governanceMultisig}`);
  console.log("  roles:     proposer, canceller, executor (exclusive initial holder)");
  console.log(
    `  mode:      ${isLocal ? "local development" : "live (multisig inspection interface checked)"}`,
  );
  console.log(`  external admin: ${ethers.ZeroAddress} (timelock self-admin only)`);
  console.log("  role admin: timelock itself; role changes require a scheduled, delayed operation");
  console.log(
    `\nNext: GOVERNANCE_OWNER=${address} GOVERNANCE_MULTISIG=${governanceMultisig} ` +
      "npm run deploy:net --net=<network>",
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
