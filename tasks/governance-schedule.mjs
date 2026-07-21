/**
 * Usage:
 *   npx hardhat --config hardhat.config.mjs governance-schedule --network confluxTestnet \
 *     --target main --function updateEndorsementFee --args '[750]'
 *
 * Required: --function. Pass function arguments as a JSON array in --args; quote integers that
 * exceed JavaScript's safe range as JSON strings.
 * Optional: add --delay <seconds> or --salt 0x<32-bytes>. Keep --target, --function, --args,
 * and --salt identical when running governance-execute. If the local signer is not the proposer,
 * this task prints the to/value/data transaction that the governance multisig must submit.
 * The Timelock delay starts only when that schedule transaction is mined.
 * Upgrades and ownership changes are blocked here and must use their dedicated audited flows.
 * --skip-simulation is a diagnostic escape hatch, not the normal production path.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs governance-schedule --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { sendOrPrint } from "./lib/timelockUpgrade.mjs";
import {
  parseGovernanceDelay,
  resolveGovernanceOperation,
  simulateGovernanceCall,
} from "./lib/timelockGovernance.mjs";

export const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();
  const operation = await resolveGovernanceOperation({ connection, ethers, args });
  const {
    spec,
    proxyAddress,
    timelock,
    timelockAddress,
    signature,
    callArgs,
    calldata,
    predecessor,
    value,
    salt,
    operationId,
  } = operation;

  const minDelay = await timelock.getMinDelay();
  const delay = parseGovernanceDelay(args.delay, minDelay);

  if (await timelock.isOperation(operationId)) {
    throw new Error(
      `operation ${operationId} is already scheduled or executed; use a different --salt to ` +
        "schedule the same call again",
    );
  }

  if (!args.skipSimulation) {
    await simulateGovernanceCall({
      ethers,
      targetAddress: proxyAddress,
      timelockAddress,
      calldata,
    });
    console.log("governance call simulation from timelock: OK");
  } else {
    console.warn("WARNING: governance call simulation skipped by --skip-simulation");
  }

  console.log("governance schedule plan:");
  console.log(`  target:      ${args.target} (${spec.contract} @ ${proxyAddress})`);
  console.log(`  timelock:    ${timelockAddress}`);
  console.log(`  function:    ${signature}`);
  console.log(`  args:        ${JSON.stringify(callArgs)}`);
  console.log(`  calldata:    ${calldata}`);
  console.log(`  value:       ${value}`);
  console.log(`  salt:        ${salt}`);
  console.log(`  delay:       ${delay} (minDelay ${minDelay})`);
  console.log(`  operationId: ${operationId}`);

  const proposerRole = await timelock.PROPOSER_ROLE();
  const result = await sendOrPrint({
    timelock,
    timelockAddress,
    signer,
    role: proposerRole,
    method: "schedule",
    callArgs: [proxyAddress, value, calldata, predecessor, salt, delay],
  });

  if (result.sent) {
    console.log(
      "\nNext: after the delay elapses, run governance-execute with the same " +
        "--target/--function/--args/--salt.",
    );
  } else {
    console.log(
      "\nNext: submit the calldata above from a proposer/multisig. The timelock delay starts " +
        "only after that schedule transaction is mined; then run governance-execute with the " +
        "same --target/--function/--args/--salt.",
    );
  }

  return { operationId, salt, scheduled: result.sent };
};

export default task("governance-schedule", "Schedule a DeepFamily owner call through the timelock")
  .addOption({
    name: "target",
    description: "Governed contract to call: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "function",
    description: "DeepFamily ABI function name or full signature",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "args",
    description: "Function arguments as a JSON array; quote large integers as strings",
    type: ArgumentType.STRING,
    defaultValue: "[]",
  })
  .addOption({
    name: "delay",
    description: "Timelock delay in seconds (defaults to the timelock minDelay)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "salt",
    description: "Override the deterministic operation salt (bytes32)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addFlag({
    name: "skipSimulation",
    description: "Skip the pre-flight eth_call from the timelock address",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
