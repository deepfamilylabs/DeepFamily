import hre from "hardhat";
import { executeChainTransaction, getChainErrorDetails } from "@deepfamily/chain-client";
import { resolveTimelockDeploymentConfig } from "./lib/timelockDeployment.mjs";

// Deploy a TimelockController (via the GovernanceTimelock artifact) to own the UUPS proxy.
//
// Usage:
//   MIN_DELAY=604800 GOVERNANCE_SAFE_ADDRESS=0xSafeProxy.. \
//     hardhat --config hardhat.config.mjs run scripts/deploy-timelock.mjs --network <network>
//
// Deployer defaults (120 seconds) exist only on edr-simulated and non-Mainnet localhost networks.
// Live networks require both variables explicitly. The governance address must expose a valid
// inspectable threshold/owner configuration with threshold >= 2. GovernanceTimelock assigns that
// one multisig all proposer/canceller/executor roles and has no external admin.
// Ethereum and Conflux eSpace Mainnet deployments require at least seven days.

const main = async () => {
  const connection = await hre.network.create();
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
  const request = await Timelock.getDeployTransaction(minDelay, governanceMultisig);
  const { receipt } = await executeChainTransaction({
    provider: deployer.provider,
    send: () => deployer.sendTransaction(request),
    replacementPolicy: "reject",
    label: "deploy-governance-timelock",
  });
  if (!receipt.contractAddress || !ethers.isAddress(receipt.contractAddress))
    throw new Error("GovernanceTimelock receipt does not contain a deployment address");
  const address = ethers.getAddress(receipt.contractAddress);

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
    `\nNext: GOVERNANCE_TIMELOCK_ADDRESS=${address} ` +
      `GOVERNANCE_SAFE_ADDRESS=${governanceMultisig} ` +
      "npm run deploy:net --net=<network>",
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Timelock deployment failed", getChainErrorDetails(error));
  process.exit(1);
});
