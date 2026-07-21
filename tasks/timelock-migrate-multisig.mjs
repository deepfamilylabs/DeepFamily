/**
 * Usage:
 *   npx hardhat --config hardhat.config.mjs timelock-migrate-multisig \
 *     --network confluxTestnet --phase schedule --old-multisig 0xOldMultisig \
 *     --new-multisig 0xNewMultisig --contract-name GovernanceTimelock
 *   # After the schedule transaction is mined and the delay has elapsed:
 *   npx hardhat --config hardhat.config.mjs timelock-migrate-multisig \
 *     --network confluxTestnet --phase execute --old-multisig 0xOldMultisig \
 *     --new-multisig 0xNewMultisig --contract-name GovernanceTimelock
 *
 * Required: --phase, --old-multisig, and --new-multisig. The new multisig must already be deployed,
 * expose getOwners()/getThreshold(), and report a threshold of at least 2.
 * Keep both multisig addresses, --contract-name, and optional --salt identical in both phases.
 * The old multisig submits schedule and execute; the role replacement occurs atomically only when
 * execute completes. Use --delay only while scheduling (it defaults to the current minimum).
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { parseGovernanceDelay } from "./lib/timelockGovernance.mjs";
import {
  assertImplementationMatchesArtifact,
  resolveTarget,
  sendOrPrint,
} from "./lib/timelockUpgrade.mjs";
import {
  assertCurrentMultisig,
  assertNewMultisigForMigration,
  buildMultisigMigrationOperation,
  parseRequiredAddress,
  parseMultisigMigrationPhase,
  readExactTimelockRoleState,
} from "./lib/timelockMultisigMigration.mjs";
import { DEFAULT_TIMELOCK_ARTIFACT, parseArtifactName } from "./lib/timelockArtifacts.mjs";

const printPlan = ({
  phase,
  timelockAddress,
  oldMultisig,
  newMultisig,
  inspection,
  operation,
  delay,
  minDelay,
}) => {
  console.log(`timelock multisig migration ${phase} plan:`);
  console.log(`  timelock:    ${timelockAddress}`);
  console.log(`  old multisig: ${oldMultisig}`);
  console.log(`  new multisig: ${newMultisig}`);
  console.log(`  new owners:  ${inspection.owners.join(", ")}`);
  console.log(`  threshold:   ${inspection.threshold}`);
  console.log("  batch:       grant new multisig P/C/E, then revoke old multisig P/C/E");
  console.log(`  salt:        ${operation.salt}`);
  if (delay !== undefined) console.log(`  delay:       ${delay} (minDelay ${minDelay})`);
  console.log(`  operationId: ${operation.operationId}`);
};

const verifyExecutedRoleState = async ({ ethers, timelock, timelockAddress, newMultisig }) => {
  const finalState = await readExactTimelockRoleState({ ethers, timelock, timelockAddress });
  assertCurrentMultisig(finalState.currentMultisig, newMultisig, "migration postcondition failed");
};

export const action = async (args, hre) => {
  const phase = parseMultisigMigrationPhase(args.phase);
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();
  const contractName = parseArtifactName(
    args.contractName,
    "contract-name",
    DEFAULT_TIMELOCK_ARTIFACT,
  );
  const oldMultisig = parseRequiredAddress(ethers, args.oldMultisig, "old-multisig");
  const newMultisig = parseRequiredAddress(ethers, args.newMultisig, "new-multisig");
  if (oldMultisig.toLowerCase() === newMultisig.toLowerCase()) {
    throw new Error("--new-multisig must be different from --old-multisig");
  }

  const { timelock, timelockAddress } = await resolveTarget(
    connection,
    ethers,
    args.target,
    contractName,
  );
  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName,
    implementation: timelockAddress,
    spec: { needsLibraries: false },
  });
  const roleState = await readExactTimelockRoleState({ ethers, timelock, timelockAddress });
  const inspection = await assertNewMultisigForMigration({ ethers, address: newMultisig });
  const operation = await buildMultisigMigrationOperation({
    ethers,
    timelock,
    timelockAddress,
    roles: roleState.roles,
    oldMultisig,
    newMultisig,
    saltOverride: args.salt,
  });

  if (phase === "schedule") {
    assertCurrentMultisig(
      roleState.currentMultisig,
      oldMultisig,
      "cannot schedule multisig migration",
    );
    const minDelay = await timelock.getMinDelay();
    const delay = parseGovernanceDelay(args.delay, minDelay);
    printPlan({
      phase,
      timelockAddress,
      oldMultisig,
      newMultisig,
      inspection,
      operation,
      delay,
      minDelay,
    });

    if (await timelock.isOperation(operation.operationId)) {
      throw new Error(
        `migration operation ${operation.operationId} is already scheduled or executed; ` +
          "do not schedule it twice",
      );
    }

    for (const payload of operation.payloads) {
      try {
        await ethers.provider.call({
          to: timelockAddress,
          from: timelockAddress,
          data: payload,
          value: 0n,
        });
      } catch (error) {
        const detail = error.shortMessage || error.reason || error.message;
        throw new Error(`timelock role-migration self-call simulation reverted: ${detail}`);
      }
    }

    const result = await sendOrPrint({
      timelock,
      timelockAddress,
      signer,
      role: roleState.roles.PROPOSER_ROLE,
      method: "scheduleBatch",
      callArgs: [
        operation.targets,
        operation.values,
        operation.payloads,
        operation.predecessor,
        operation.salt,
        delay,
      ],
    });
    console.log(
      result.sent
        ? "\nNext: after the delay, run this task with --phase execute and the same arguments."
        : "\nNext: submit the multisig transaction above; after the delay, run this task with " +
            "--phase execute and the same arguments.",
    );
    return {
      operationId: operation.operationId,
      salt: operation.salt,
      scheduled: result.sent,
      calldata: result.calldata,
    };
  }

  printPlan({ phase, timelockAddress, oldMultisig, newMultisig, inspection, operation });
  if (await timelock.isOperationDone(operation.operationId)) {
    assertCurrentMultisig(
      roleState.currentMultisig,
      newMultisig,
      "completed migration has invalid roles",
    );
    console.log("  migration already executed and the new multisig has all governance roles");
    return {
      operationId: operation.operationId,
      executed: true,
      alreadyDone: true,
    };
  }

  assertCurrentMultisig(
    roleState.currentMultisig,
    oldMultisig,
    "cannot execute multisig migration",
  );
  if (!(await timelock.isOperation(operation.operationId))) {
    throw new Error(
      "migration operation is not scheduled; run this task with --phase schedule first and " +
        "use the same --old-multisig/--new-multisig/--salt values",
    );
  }
  if (!(await timelock.isOperationReady(operation.operationId))) {
    const readyAt = await timelock.getTimestamp(operation.operationId);
    throw new Error(`migration operation not ready; the delay elapses at unix ${readyAt}`);
  }

  const result = await sendOrPrint({
    timelock,
    timelockAddress,
    signer,
    role: roleState.roles.EXECUTOR_ROLE,
    method: "executeBatch",
    callArgs: [
      operation.targets,
      operation.values,
      operation.payloads,
      operation.predecessor,
      operation.salt,
    ],
  });
  if (!result.sent) {
    console.log(
      "  migration NOT executed: submit the multisig transaction above, then re-run this task to " +
        "confirm the final role state.",
    );
    return {
      operationId: operation.operationId,
      executed: false,
      calldata: result.calldata,
    };
  }

  if (!(await timelock.isOperationDone(operation.operationId))) {
    throw new Error(`migration ${operation.operationId} was sent but is not marked done on-chain`);
  }
  await verifyExecutedRoleState({ ethers, timelock, timelockAddress, newMultisig });
  console.log("  migration confirmed: the new multisig is the sole proposer/canceller/executor");
  return { operationId: operation.operationId, executed: true };
};

export default task(
  "timelock-migrate-multisig",
  "Atomically replace the Timelock proposer/canceller/executor governance multisig",
)
  .addOption({
    name: "contractName",
    description: "Versioned artifact expected at the current Timelock address",
    type: ArgumentType.STRING,
    defaultValue: DEFAULT_TIMELOCK_ARTIFACT,
  })
  .addOption({
    name: "phase",
    description: "Migration phase: schedule or execute",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "target",
    description: "Governed contract used to locate its Timelock owner: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "oldMultisig",
    description: "Expected current multisig (required as an optimistic-lock safety check)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "newMultisig",
    description: "New multisig contract address (threshold must be at least 2)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "delay",
    description: "Schedule delay in seconds (defaults to Timelock minDelay)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "salt",
    description: "Override the deterministic migration salt (bytes32; reuse for execute)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
