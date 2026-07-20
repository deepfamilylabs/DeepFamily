import hre from "hardhat";

// Deploy a TimelockController (via the GovernanceTimelock artifact) to own the UUPS proxy.
//
// Usage:
//   MIN_DELAY=120 PROPOSERS=0x.. EXECUTORS=0x.. \
//     hardhat --config hardhat.config.mjs run scripts/deploy-timelock.mjs --network <network>
//
// Defaults are tuned for a TESTNET REHEARSAL: a short delay and the deployer EOA as both
// proposer and executor, so the upgrade-schedule/upgrade-execute tasks can run end-to-end from
// the CLI. For production, set MIN_DELAY=172800 (48h) and point PROPOSERS/EXECUTORS at a multisig.
// `admin` is always address(0) so roles are locked at construction.
const parseAddressList = (value, fallback) => {
  if (!value || value.trim() === "") return fallback;
  return value
    .split(/[\s,]+/)
    .map((a) => a.trim())
    .filter(Boolean);
};

const main = async () => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();

  const minDelay = Number(process.env.MIN_DELAY || 120); // rehearsal default; production: 172800
  const proposers = parseAddressList(process.env.PROPOSERS, [me]);
  const executors = parseAddressList(process.env.EXECUTORS, [me]);

  if (!Number.isFinite(minDelay) || minDelay <= 0) {
    throw new Error(`MIN_DELAY must be a positive number of seconds (got ${process.env.MIN_DELAY})`);
  }

  const Timelock = await ethers.getContractFactory("GovernanceTimelock", deployer);
  const timelock = await Timelock.deploy(minDelay, proposers, executors, ethers.ZeroAddress);
  await timelock.waitForDeployment();
  const address = await timelock.getAddress();

  console.log("GovernanceTimelock deployed:");
  console.log(`  address:   ${address}`);
  console.log(`  minDelay:  ${minDelay}s`);
  console.log(`  proposers: ${proposers.join(", ")}`);
  console.log(`  executors: ${executors.join(", ")}`);
  console.log(`  admin:     ${ethers.ZeroAddress} (roles locked at construction)`);
  console.log(`\nNext: GOVERNANCE_OWNER=${address} npm run deploy:net --net=<network>`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
