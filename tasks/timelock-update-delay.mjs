/**
 * Usage (new delay is expressed in seconds):
 *   npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
 *     --phase schedule --new-delay 259200 --contract-name GovernanceTimelock
 *   # After the schedule transaction is mined and the current delay has elapsed:
 *   npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
 *     --phase execute --new-delay 259200 --contract-name GovernanceTimelock
 *
 * Required: --phase and a positive integer --new-delay in seconds.
 * Keep --new-delay, --contract-name, and optional --salt identical in both phases. The update is a
 * delayed Timelock self-call; zero and a newly scheduled no-op are rejected. Repeating execute may
 * be used to confirm a completed update. Increasing the delay does not extend operations that were
 * already scheduled.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs timelock-update-delay --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import {
  assertImplementationMatchesArtifact,
  resolveTarget,
  sendOrPrint,
} from "./lib/timelockUpgrade.mjs";
import { readExactTimelockRoleState } from "./lib/timelockMultisigMigration.mjs";
import { assertConfiguredTimelockGovernanceProfile } from "./lib/timelockGovernancePolicy.mjs";
import { DEFAULT_TIMELOCK_ARTIFACT, parseArtifactName } from "./lib/timelockArtifacts.mjs";

const VALID_PHASES = new Set(["schedule", "execute"]);
const MAX_UINT256 = (1n << 256n) - 1n;

export const parseRequiredPositiveInteger = (rawValue, name) => {
  const normalized = String(rawValue ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`--${name} must be a positive integer`);
  }
  const parsed = BigInt(normalized);
  if (parsed <= 0n) throw new Error(`--${name} must be greater than zero`);
  if (parsed > MAX_UINT256) throw new Error(`--${name} must fit in an unsigned 256-bit integer`);
  return parsed;
};

export const parseTimelockPhase = (rawPhase) => {
  const phase = String(rawPhase ?? "")
    .trim()
    .toLowerCase();
  if (!VALID_PHASES.has(phase)) {
    throw new Error('--phase must be explicitly set to "schedule" or "execute"');
  }
  return phase;
};

export const deriveDelayUpdateSalt = (ethers, { timelockAddress, newDelay, override }) => {
  if (override) {
    if (!ethers.isHexString(override, 32)) {
      throw new Error("--salt must be a 32-byte hex value");
    }
    return override;
  }
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "address", "uint256"],
      ["deepfamily-timelock-update-delay", timelockAddress, newDelay],
    ),
  );
};

const assertSelfAdmin = async (ethers, timelock, timelockAddress) => {
  const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
  const count = await timelock.getRoleMemberCount(adminRole);
  const member = count === 1n ? await timelock.getRoleMember(adminRole, 0) : null;
  if (count !== 1n || !member || ethers.getAddress(member) !== ethers.getAddress(timelockAddress)) {
    throw new Error(
      `Timelock ${timelockAddress} is not self-administered exclusively; ` +
        `expected DEFAULT_ADMIN_ROLE sole member ${timelockAddress}`,
    );
  }
};

export const resolveDelayUpdateOperation = async ({ hre, connection, ethers, args }) => {
  const phase = parseTimelockPhase(args.phase);
  const newDelay = parseRequiredPositiveInteger(args.newDelay, "new-delay");
  const contractName = parseArtifactName(
    args.contractName,
    "contract-name",
    DEFAULT_TIMELOCK_ARTIFACT,
  );
  const resolved = await resolveTarget(connection, ethers, "main", contractName);
  const { timelock, timelockAddress } = resolved;

  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName,
    implementation: timelockAddress,
    spec: { needsLibraries: false },
  });
  await assertSelfAdmin(ethers, timelock, timelockAddress);
  const roleState = await readExactTimelockRoleState({ ethers, timelock, timelockAddress });
  await assertConfiguredTimelockGovernanceProfile({
    ethers,
    timelock,
    timelockAddress,
    roleState,
  });

  const currentDelay = await timelock.getMinDelay();
  const target = timelockAddress;
  const value = 0n;
  const predecessor = ethers.ZeroHash;
  const payload = timelock.interface.encodeFunctionData("updateDelay", [newDelay]);
  const salt = deriveDelayUpdateSalt(ethers, {
    timelockAddress,
    newDelay,
    override: args.salt,
  });
  const operationId = await timelock.hashOperation(target, value, payload, predecessor, salt);
  // A repeated execute is a useful, read-only confirmation after the operation has changed the
  // delay. Do not reject that idempotent path merely because the current value now equals the
  // requested value; all other no-op requests remain operator errors.
  const alreadyDone = phase === "execute" && (await timelock.isOperationDone(operationId));
  if (newDelay === currentDelay && !alreadyDone) {
    throw new Error(`new delay ${newDelay} equals the current delay`);
  }

  return {
    ...resolved,
    phase,
    currentDelay,
    newDelay,
    target,
    value,
    payload,
    predecessor,
    salt,
    operationId,
  };
};

export const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();
  const operation = await resolveDelayUpdateOperation({ hre, connection, ethers, args });
  const {
    phase,
    timelock,
    timelockAddress,
    currentDelay,
    newDelay,
    target,
    value,
    payload,
    predecessor,
    salt,
    operationId,
  } = operation;

  console.log("timelock delay update plan:");
  console.log(`  phase:        ${phase}`);
  console.log(`  timelock:     ${timelockAddress}`);
  console.log(`  currentDelay: ${currentDelay}`);
  console.log(`  newDelay:     ${newDelay}`);
  console.log(`  salt:         ${salt}`);
  console.log(`  operationId:  ${operationId}`);

  if (phase === "schedule") {
    if (await timelock.isOperation(operationId)) {
      throw new Error(
        `operation ${operationId} is already scheduled or executed; use --phase execute or ` +
          "choose a different --salt",
      );
    }

    try {
      await ethers.provider.call({
        to: timelockAddress,
        from: timelockAddress,
        data: payload,
        value,
      });
    } catch (error) {
      const detail = error.shortMessage || error.reason || error.message;
      throw new Error(`timelock self-call simulation reverted: ${detail}`);
    }

    const proposerRole = await timelock.PROPOSER_ROLE();
    const result = await sendOrPrint({
      timelock,
      timelockAddress,
      signer,
      role: proposerRole,
      method: "schedule",
      callArgs: [target, value, payload, predecessor, salt, currentDelay],
    });
    if (!result.sent) {
      console.log(
        "  delay update NOT scheduled: submit the governance multisig transaction above; " +
          "the current delay " +
          "starts when it is mined.",
      );
    }
    if (newDelay > currentDelay) {
      console.warn(
        "  NOTE: increasing the delay does not extend operations that were already scheduled.",
      );
    }
    return {
      operationId,
      salt,
      phase,
      scheduled: result.sent,
      calldata: result.calldata,
    };
  }

  if (await timelock.isOperationDone(operationId)) {
    const actualDelay = await timelock.getMinDelay();
    if (actualDelay !== newDelay) {
      throw new Error(
        `operation ${operationId} is done but getMinDelay()=${actualDelay}, expected ${newDelay}`,
      );
    }
    console.log("  delay update already executed and confirmed on-chain.");
    return { operationId, salt, phase, executed: true, alreadyDone: true };
  }
  if (!(await timelock.isOperation(operationId))) {
    throw new Error(
      `operation ${operationId} is not scheduled; run this task with --phase schedule first`,
    );
  }
  if (!(await timelock.isOperationReady(operationId))) {
    const readyAt = await timelock.getTimestamp(operationId);
    throw new Error(`operation not ready yet; the current delay elapses at unix ${readyAt}`);
  }

  const executorRole = await timelock.EXECUTOR_ROLE();
  const result = await sendOrPrint({
    timelock,
    timelockAddress,
    signer,
    role: executorRole,
    method: "execute",
    callArgs: [target, value, payload, predecessor, salt],
  });
  if (!result.sent) {
    console.log("  delay update NOT executed: submit the governance multisig transaction above.");
    return { operationId, salt, phase, executed: false, calldata: result.calldata };
  }

  const actualDelay = await timelock.getMinDelay();
  if (actualDelay !== newDelay) {
    throw new Error(`delay update transaction mined but getMinDelay()=${actualDelay}`);
  }
  console.log(`  delay update confirmed on-chain: ${actualDelay}s.`);
  return { operationId, salt, phase, executed: true };
};

export default task(
  "timelock-update-delay",
  "Schedule or execute a delayed GovernanceTimelock delay update",
)
  .addOption({
    name: "contractName",
    description: "Versioned artifact expected at the current Timelock address",
    type: ArgumentType.STRING,
    defaultValue: DEFAULT_TIMELOCK_ARTIFACT,
  })
  .addOption({
    name: "phase",
    description: "Required operation phase: schedule or execute",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "newDelay",
    description: "New non-zero minimum delay in seconds",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "salt",
    description: "Override the deterministic operation salt (bytes32)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
