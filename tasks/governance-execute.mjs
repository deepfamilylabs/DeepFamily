/**
 * Usage (after governance-schedule has been mined and the Timelock delay has elapsed):
 *   npx hardhat --config hardhat.config.mjs governance-execute --network confluxTestnet \
 *     --target main --function updateEndorsementFee --args '[750]'
 *
 * Required: --function and the same encoded --args used for scheduling.
 * Use exactly the same --target, --function, --args, and optional --salt as the schedule command.
 * If the local signer is not the executor, submit the printed to/value/data transaction through
 * the governance multisig. Re-running the same command confirms an already executed operation.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs governance-execute --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { sendOrPrint } from "./lib/timelockUpgrade.mjs";
import { resolveGovernanceOperation } from "./lib/timelockGovernance.mjs";

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

  console.log("governance execute plan:");
  console.log(`  target:      ${args.target} (${spec.contract} @ ${proxyAddress})`);
  console.log(`  timelock:    ${timelockAddress}`);
  console.log(`  function:    ${signature}`);
  console.log(`  args:        ${JSON.stringify(callArgs)}`);
  console.log(`  calldata:    ${calldata}`);
  console.log(`  value:       ${value}`);
  console.log(`  salt:        ${salt}`);
  console.log(`  operationId: ${operationId}`);

  if (await timelock.isOperationDone(operationId)) {
    console.log("  operation already executed");
    return { operationId, executed: true, alreadyDone: true };
  }

  if (!(await timelock.isOperation(operationId))) {
    throw new Error(
      "operation is not scheduled; run governance-schedule first and check that " +
        "--target/--function/--args/--salt match",
    );
  }

  if (!(await timelock.isOperationReady(operationId))) {
    const readyAt = await timelock.getTimestamp(operationId);
    throw new Error(`operation not ready yet; the timelock delay elapses at unix ${readyAt}`);
  }

  const executorRole = await timelock.EXECUTOR_ROLE();
  const openExecutor = await timelock.hasRole(executorRole, ethers.ZeroAddress);
  let executed = false;
  if (openExecutor && signer) {
    console.log("  executor role is open (address(0)); executing directly");
    const tx = await timelock
      .connect(signer)
      .execute(proxyAddress, value, calldata, predecessor, salt);
    await tx.wait();
    console.log(`  executed: tx ${tx.hash}`);
    executed = true;
  } else {
    if (openExecutor) {
      console.log("  executor role is open, but no signer is configured; printing calldata");
    }
    const result = await sendOrPrint({
      timelock,
      timelockAddress,
      signer,
      role: executorRole,
      method: "execute",
      callArgs: [proxyAddress, value, calldata, predecessor, salt],
    });
    executed = result.sent === true;
  }

  if (!executed) {
    console.log(
      "  governance call NOT executed: submit the calldata above from an EXECUTOR_ROLE holder " +
        "(typically the multisig), then re-run this task to confirm completion.",
    );
    return { operationId, executed: false };
  }

  if (!(await timelock.isOperationDone(operationId))) {
    throw new Error(`operation ${operationId} was sent but is not marked done on-chain`);
  }
  console.log("  governance call confirmed on-chain.");
  return { operationId, executed: true };
};

export default task("governance-execute", "Execute a scheduled DeepFamily timelock owner call")
  .addOption({
    name: "target",
    description: "Governed contract to call: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "function",
    description: "DeepFamily ABI function name or full signature used when scheduling",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "args",
    description: "Function arguments as the same JSON array used when scheduling",
    type: ArgumentType.STRING,
    defaultValue: "[]",
  })
  .addOption({
    name: "salt",
    description: "Override salt (must match the value used when scheduling)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
