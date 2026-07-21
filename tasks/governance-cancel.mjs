/**
 * Usage (operationId is printed by the corresponding schedule task):
 *   npx hardhat --config hardhat.config.mjs governance-cancel --network confluxTestnet \
 *     --target main --operation-id 0x<32-byte-operation-id>
 *
 * Required: --operation-id (a 32-byte hex value).
 * This can cancel any still-active operation on the current DeepFamily Timelock. If the local
 * signer is not the canceller, it prints the to/value/data transaction that the governance
 * multisig must submit. After an owner migration, this task resolves the new Timelock and cannot
 * be used to cancel an operation that remains on the old Timelock.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs governance-cancel --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { resolveTarget, sendOrPrint } from "./lib/timelockUpgrade.mjs";

export const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();

  if (!ethers.isHexString(args.operationId, 32)) {
    throw new Error("--operation-id must be a 32-byte timelock operation ID");
  }

  const { spec, proxyAddress, timelock, timelockAddress } = await resolveTarget(
    connection,
    ethers,
    args.target,
  );
  const operationId = args.operationId;

  console.log("governance cancellation plan:");
  console.log(`  target:      ${args.target} (${spec.contract} @ ${proxyAddress})`);
  console.log(`  timelock:    ${timelockAddress}`);
  console.log(`  operationId: ${operationId}`);

  if (await timelock.isOperationDone(operationId)) {
    throw new Error(`operation ${operationId} is already executed and cannot be cancelled`);
  }
  if (!(await timelock.isOperation(operationId))) {
    throw new Error(
      `operation ${operationId} is not active (it was never scheduled or is already cancelled)`,
    );
  }

  const cancellerRole = await timelock.CANCELLER_ROLE();
  const result = await sendOrPrint({
    timelock,
    timelockAddress,
    signer,
    role: cancellerRole,
    method: "cancel",
    callArgs: [operationId],
  });

  if (!result.sent) {
    console.log(
      "  cancellation NOT executed: submit the governance multisig transaction printed above.",
    );
    return { operationId, cancelled: false };
  }
  if (await timelock.isOperation(operationId)) {
    throw new Error(`operation ${operationId} cancellation was sent but remains active on-chain`);
  }
  console.log("  cancellation confirmed on-chain.");
  return { operationId, cancelled: true };
};

export default task("governance-cancel", "Cancel an active DeepFamily timelock operation")
  .addOption({
    name: "target",
    description: "Governed contract whose owner identifies the timelock: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "operationId",
    description: "Operation ID printed by governance-schedule or upgrade-schedule",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
