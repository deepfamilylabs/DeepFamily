/**
 * Usage (repeat the same arguments with --phase execute after the delay):
 *   npx hardhat --config hardhat.config.mjs timelock-migrate-owner \
 *     --network confluxTestnet --phase schedule \
 *     --old-timelock 0xOldTimelock --new-timelock 0xNewTimelock \
 *     --old-multisig 0xOldMultisig --new-multisig 0xNewMultisig \
 *     --old-contract-name GovernanceTimelock --new-contract-name GovernanceTimelock \
 *     --proxy-contract-name UUPSProxy --deep-family-contract-name DeepFamily \
 *     --token-contract-name DeepFamilyToken
 *
 * Required: --phase, both Timelock addresses, both multisig addresses, and all five artifact-name
 * options shown above. Only --salt is optional.
 * This atomically transfers DeepFamily ownership and sweeps the old Timelock's complete DEEP
 * balance to the new Timelock. Both Timelocks and multisigs must already be deployed; each artifact
 * must match its runtime, the old version must expose sweepERC20, and the new delay cannot be
 * shorter than the old one. Keep every argument, including optional --salt, identical for execute.
 * The old multisig submits both phases.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs timelock-migrate-owner --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { assertGovernanceMultisig } from "../scripts/lib/governanceSafety.mjs";
import { parseArtifactName } from "./lib/timelockArtifacts.mjs";
import { buildOwnerMigrationOperation } from "./lib/timelockOwnerMigration.mjs";
import {
  assertImplementationMatchesArtifact,
  readDeploymentAddress,
  sendOrPrint,
} from "./lib/timelockUpgrade.mjs";

const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const parsePhase = (rawPhase) => {
  const phase = String(rawPhase ?? "")
    .trim()
    .toLowerCase();
  if (phase !== "schedule" && phase !== "execute") {
    throw new Error('--phase must be explicitly set to "schedule" or "execute"');
  }
  return phase;
};

const parseAddress = (ethers, rawAddress, name) => {
  const address = String(rawAddress ?? "").trim();
  if (!ethers.isAddress(address)) throw new Error(`--${name} must be a valid address`);
  const normalized = ethers.getAddress(address);
  if (normalized === ethers.ZeroAddress) throw new Error(`--${name} must not be zero`);
  return normalized;
};

export const inspectExclusiveTimelockPolicy = async ({
  ethers,
  timelock,
  timelockAddress,
  label,
}) => {
  const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
  const roleEntries = [
    ["PROPOSER_ROLE", await timelock.PROPOSER_ROLE()],
    ["CANCELLER_ROLE", await timelock.CANCELLER_ROLE()],
    ["EXECUTOR_ROLE", await timelock.EXECUTOR_ROLE()],
  ];

  const adminCount = await timelock.getRoleMemberCount(adminRole);
  const adminMember = adminCount === 1n ? await timelock.getRoleMember(adminRole, 0) : null;
  if (adminCount !== 1n || !adminMember || ethers.getAddress(adminMember) !== timelockAddress) {
    throw new Error(
      `${label} must have itself as the sole DEFAULT_ADMIN_ROLE member (count=${adminCount})`,
    );
  }

  const holders = [];
  for (const [name, role] of roleEntries) {
    const count = await timelock.getRoleMemberCount(role);
    if (count !== 1n) {
      throw new Error(`${label} ${name} must have exactly one member (count=${count})`);
    }
    holders.push(ethers.getAddress(await timelock.getRoleMember(role, 0)));
  }
  if (!holders.every((holder) => holder === holders[0])) {
    throw new Error(`${label} proposer/canceller/executor must have the same exclusive holder`);
  }
  if (holders[0] === ethers.ZeroAddress) {
    throw new Error(`${label} executor role must not be open`);
  }

  return {
    roleHolder: holders[0],
    roles: roleEntries.map(([name, role]) => ({ name, role })),
  };
};

const assertProxy = async (ethers, address) => {
  const raw = await ethers.provider.getStorage(address, ERC1967_IMPLEMENTATION_SLOT);
  const implementation = ethers.getAddress(ethers.dataSlice(raw, 12));
  if (implementation === ethers.ZeroAddress) {
    throw new Error(`DeepFamily ${address} is not an ERC-1967 proxy`);
  }
  if ((await ethers.provider.getCode(implementation)) === "0x") {
    throw new Error(`DeepFamily implementation ${implementation} has no code`);
  }
  return implementation;
};

export const resolveOwnerMigrationOperation = async ({ hre, connection, ethers, args }) => {
  const phase = parsePhase(args.phase);
  const oldTimelockAddress = parseAddress(ethers, args.oldTimelock, "old-timelock");
  const newTimelockAddress = parseAddress(ethers, args.newTimelock, "new-timelock");
  const oldMultisig = parseAddress(ethers, args.oldMultisig, "old-multisig");
  const newMultisig = parseAddress(ethers, args.newMultisig, "new-multisig");
  const oldContractName = parseArtifactName(args.oldContractName, "old-contract-name");
  const newContractName = parseArtifactName(args.newContractName, "new-contract-name");
  const proxyContractName = parseArtifactName(args.proxyContractName, "proxy-contract-name");
  const deepFamilyContractName = parseArtifactName(
    args.deepFamilyContractName,
    "deep-family-contract-name",
  );
  const tokenContractName = parseArtifactName(args.tokenContractName, "token-contract-name");
  if (oldTimelockAddress === newTimelockAddress) {
    throw new Error("old and new timelock addresses must be different");
  }

  const deepFamilyAddress = ethers.getAddress(
    await readDeploymentAddress(connection, "DeepFamily"),
  );
  const tokenAddress = ethers.getAddress(
    await readDeploymentAddress(connection, "DeepFamilyToken"),
  );
  const deepFamily = await ethers.getContractAt(deepFamilyContractName, deepFamilyAddress);
  const token = await ethers.getContractAt(tokenContractName, tokenAddress);
  const oldTimelock = await ethers.getContractAt(oldContractName, oldTimelockAddress);
  const newTimelock = await ethers.getContractAt(newContractName, newTimelockAddress);

  const deepFamilyImplementation = await assertProxy(ethers, deepFamilyAddress);
  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName: proxyContractName,
    implementation: deepFamilyAddress,
    spec: { needsLibraries: false },
  });
  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName: deepFamilyContractName,
    implementation: deepFamilyImplementation,
    spec: { needsLibraries: true },
  });
  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName: tokenContractName,
    implementation: tokenAddress,
    spec: { needsLibraries: false },
  });
  for (const [label, implementation, contractName] of [
    ["old timelock", oldTimelockAddress, oldContractName],
    ["new timelock", newTimelockAddress, newContractName],
  ]) {
    try {
      await assertImplementationMatchesArtifact({
        connection,
        ethers,
        hre,
        contractName,
        implementation,
        spec: { needsLibraries: false },
      });
    } catch (error) {
      throw new Error(`${label} validation failed: ${error.message}`);
    }
  }

  const oldPolicy = await inspectExclusiveTimelockPolicy({
    ethers,
    timelock: oldTimelock,
    timelockAddress: oldTimelockAddress,
    label: "old timelock",
  });
  const newPolicy = await inspectExclusiveTimelockPolicy({
    ethers,
    timelock: newTimelock,
    timelockAddress: newTimelockAddress,
    label: "new timelock",
  });
  if (oldPolicy.roleHolder !== oldMultisig) {
    throw new Error(
      `old timelock role holder ${oldPolicy.roleHolder} does not match ` +
        `--old-multisig ${oldMultisig}`,
    );
  }
  if (newPolicy.roleHolder !== newMultisig) {
    throw new Error(
      `new timelock role holder ${newPolicy.roleHolder} does not match ` +
        `--new-multisig ${newMultisig}`,
    );
  }
  const oldMultisigPolicy = await assertGovernanceMultisig({
    ethers,
    provider: ethers.provider,
    address: oldMultisig,
    label: "old timelock governance multisig",
  });
  const newMultisigPolicy = await assertGovernanceMultisig({
    ethers,
    provider: ethers.provider,
    address: newMultisig,
    label: "new timelock governance multisig",
  });

  const oldDelay = await oldTimelock.getMinDelay();
  const newDelay = await newTimelock.getMinDelay();
  if (oldDelay <= 0n || newDelay <= 0n) {
    throw new Error(`both timelocks require non-zero delays (old=${oldDelay}, new=${newDelay})`);
  }
  if (newDelay < oldDelay) {
    throw new Error(
      `new timelock delay ${newDelay} is shorter than current delay ${oldDelay}; ` +
        "update the old delay through timelock-update-delay first if this reduction is intentional",
    );
  }

  const configuredToken = ethers.getAddress(await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT());
  const configuredDeepFamily = ethers.getAddress(await token.deepFamilyContract());
  if (configuredToken !== tokenAddress || configuredDeepFamily !== deepFamilyAddress) {
    throw new Error(
      `deployment wiring mismatch: DeepFamily token=${configuredToken}, token main=${configuredDeepFamily}`,
    );
  }

  const deepFamilyOwner = ethers.getAddress(await deepFamily.owner());
  const tokenOwner = ethers.getAddress(await token.owner());
  if (tokenOwner !== ethers.ZeroAddress) {
    throw new Error(
      `DeepFamilyToken bootstrap owner ${tokenOwner} is still active; expected ` +
        `${ethers.ZeroAddress} after its one-time binding`,
    );
  }
  if (deepFamilyOwner !== oldTimelockAddress && deepFamilyOwner !== newTimelockAddress) {
    throw new Error(
      `DeepFamily is owned by ${deepFamilyOwner}, expected old ${oldTimelockAddress} ` +
        `or new ${newTimelockAddress}`,
    );
  }
  if (phase === "schedule" && deepFamilyOwner !== oldTimelockAddress) {
    throw new Error("ownership migration is already complete; the old timelock is no longer owner");
  }

  const migration = await buildOwnerMigrationOperation({
    ethers,
    oldTimelock,
    oldTimelockAddress,
    deepFamily,
    deepFamilyAddress,
    tokenAddress,
    newTimelockAddress,
    saltOverride: args.salt,
  });
  const oldTreasuryBalance = await token.balanceOf(oldTimelockAddress);
  const newTreasuryBalance = await token.balanceOf(newTimelockAddress);

  return {
    phase,
    oldTimelock,
    newTimelock,
    oldTimelockAddress,
    newTimelockAddress,
    oldMultisig,
    newMultisig,
    oldMultisigPolicy,
    newMultisigPolicy,
    oldContractName,
    newContractName,
    proxyContractName,
    deepFamilyContractName,
    tokenContractName,
    deepFamilyImplementation,
    oldDelay,
    newDelay,
    deepFamily,
    token,
    deepFamilyAddress,
    tokenAddress,
    currentOwner: deepFamilyOwner,
    tokenOwner,
    oldTreasuryBalance,
    newTreasuryBalance,
    ...migration,
  };
};

const assertOwnershipPostconditions = async (ethers, operation, expectedOwner) => {
  const deepFamilyOwner = ethers.getAddress(await operation.deepFamily.owner());
  const tokenOwner = ethers.getAddress(await operation.token.owner());
  if (deepFamilyOwner !== expectedOwner || tokenOwner !== ethers.ZeroAddress) {
    throw new Error(
      `ownership confirmation failed: DeepFamily=${deepFamilyOwner}, token=${tokenOwner}, ` +
        `expected DeepFamily=${expectedOwner} and retired token owner=${ethers.ZeroAddress}`,
    );
  }
};

const confirmCompletedPostconditions = async (ethers, operation) => {
  await assertOwnershipPostconditions(ethers, operation, operation.newTimelockAddress);
  const oldBalance = await operation.token.balanceOf(operation.oldTimelockAddress);
  const newBalance = await operation.token.balanceOf(operation.newTimelockAddress);
  if (oldBalance !== 0n) {
    console.warn(
      `  WARNING: old timelock currently holds ${oldBalance} DEEP base units. The completed ` +
        "atomic operation swept its execution-time balance; this is a post-migration transfer " +
        "or residual deposit and does not invalidate the ownership migration.",
    );
  }
  return { oldBalance, newBalance };
};

const assertImmediateTreasuryPostconditions = async (ethers, operation) => {
  await assertOwnershipPostconditions(ethers, operation, operation.newTimelockAddress);
  const oldBalance = await operation.token.balanceOf(operation.oldTimelockAddress);
  const newBalance = await operation.token.balanceOf(operation.newTimelockAddress);
  if (oldBalance !== 0n) {
    throw new Error(
      `treasury migration confirmation failed: old timelock retains ${oldBalance} DEEP base units`,
    );
  }
  const expectedNewBalance = operation.newTreasuryBalance + operation.oldTreasuryBalance;
  if (newBalance !== expectedNewBalance) {
    throw new Error(
      `treasury migration confirmation failed: new timelock balance=${newBalance}, ` +
        `expected=${expectedNewBalance}`,
    );
  }
  return { oldBalance, newBalance };
};

export const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();
  const operation = await resolveOwnerMigrationOperation({ hre, connection, ethers, args });
  const {
    phase,
    oldTimelock,
    oldTimelockAddress,
    newTimelockAddress,
    oldMultisig,
    newMultisig,
    oldMultisigPolicy,
    newMultisigPolicy,
    oldContractName,
    newContractName,
    proxyContractName,
    deepFamilyContractName,
    tokenContractName,
    deepFamilyImplementation,
    oldDelay,
    newDelay,
    deepFamilyAddress,
    tokenAddress,
    currentOwner,
    tokenOwner,
    oldTreasuryBalance,
    newTreasuryBalance,
    targets,
    values,
    payloads,
    predecessor,
    salt,
    operationId,
  } = operation;

  console.log("DeepFamily timelock ownership migration plan:");
  console.log(`  phase:          ${phase}`);
  console.log(`  old timelock:   ${oldTimelockAddress} (delay=${oldDelay})`);
  console.log(`  old artifact:   ${oldContractName}`);
  console.log(
    `  old multisig:   ${oldMultisig} ` +
      `(threshold=${oldMultisigPolicy.threshold}/${oldMultisigPolicy.owners.length})`,
  );
  console.log(`  new timelock:   ${newTimelockAddress} (delay=${newDelay})`);
  console.log(`  new artifact:   ${newContractName}`);
  console.log(
    `  new multisig:   ${newMultisig} ` +
      `(threshold=${newMultisigPolicy.threshold}/${newMultisigPolicy.owners.length})`,
  );
  console.log(`  DeepFamily:     ${deepFamilyAddress}`);
  console.log(`  proxy artifact: ${proxyContractName}`);
  console.log(`  implementation: ${deepFamilyImplementation} (${deepFamilyContractName})`);
  console.log(`  token:          ${tokenAddress}`);
  console.log(`  token artifact: ${tokenContractName}`);
  console.log(`  token owner:    ${tokenOwner} (retired)`);
  console.log(`  old treasury:   ${oldTreasuryBalance} DEEP base units`);
  console.log(`  new treasury:   ${newTreasuryBalance} DEEP base units`);
  console.log(`  current owner:  ${currentOwner} (DeepFamily)`);
  console.log("  batch:          transfer ownership, then sweep all DEEP to the new timelock");
  console.log(`  salt:           ${salt}`);
  console.log(`  operationId:    ${operationId}`);

  if (phase === "schedule") {
    if (await oldTimelock.isOperation(operationId)) {
      throw new Error(
        `operation ${operationId} is already scheduled or executed; use --phase execute or ` +
          "choose a different --salt",
      );
    }
    for (const [index, label] of [
      "DeepFamily ownership transfer",
      "DEEP treasury sweep",
    ].entries()) {
      try {
        await ethers.provider.call({
          to: targets[index],
          from: oldTimelockAddress,
          data: payloads[index],
          value: values[index],
        });
      } catch (error) {
        const detail = error.shortMessage || error.reason || error.message;
        throw new Error(`${label} simulation failed: ${detail}`);
      }
    }

    const proposerRole = await oldTimelock.PROPOSER_ROLE();
    const result = await sendOrPrint({
      timelock: oldTimelock,
      timelockAddress: oldTimelockAddress,
      signer,
      role: proposerRole,
      method: "scheduleBatch",
      callArgs: [targets, values, payloads, predecessor, salt, oldDelay],
    });
    if (!result.sent) {
      console.log(
        "  ownership and treasury migration NOT scheduled: submit the governance multisig " +
          "transaction above; " +
          "then retain both " +
          "timelock addresses and this operationId for execution.",
      );
    }
    return { operationId, salt, phase, scheduled: result.sent, calldata: result.calldata };
  }

  if (await oldTimelock.isOperationDone(operationId)) {
    const balances = await confirmCompletedPostconditions(ethers, operation);
    console.log("  DeepFamily ownership and execution-time treasury sweep confirmed on-chain.");
    return {
      operationId,
      salt,
      phase,
      executed: true,
      alreadyDone: true,
      oldTreasuryBalance: balances.oldBalance,
      newTreasuryBalance: balances.newBalance,
    };
  }
  if (currentOwner !== oldTimelockAddress) {
    throw new Error(
      `operation is not marked done but DeepFamily is no longer owned by old timelock ` +
        oldTimelockAddress,
    );
  }
  if (!(await oldTimelock.isOperation(operationId))) {
    throw new Error(
      `operation ${operationId} is not scheduled; run this task with --phase schedule first`,
    );
  }
  if (!(await oldTimelock.isOperationReady(operationId))) {
    const readyAt = await oldTimelock.getTimestamp(operationId);
    throw new Error(`operation not ready yet; the old timelock delay elapses at unix ${readyAt}`);
  }

  const executorRole = await oldTimelock.EXECUTOR_ROLE();
  const result = await sendOrPrint({
    timelock: oldTimelock,
    timelockAddress: oldTimelockAddress,
    signer,
    role: executorRole,
    method: "executeBatch",
    callArgs: [targets, values, payloads, predecessor, salt],
  });
  if (!result.sent) {
    console.log(
      "  ownership and treasury migration NOT executed: submit the governance multisig " +
        "transaction above.",
    );
    return { operationId, salt, phase, executed: false, calldata: result.calldata };
  }

  const balances = await assertImmediateTreasuryPostconditions(ethers, operation);
  console.log(
    "  DeepFamily ownership migration and complete execution-time DEEP treasury sweep confirmed; " +
      "DeepFamilyToken remains ownerless.",
  );
  return {
    operationId,
    salt,
    phase,
    executed: true,
    sweptAmount: oldTreasuryBalance,
    oldTreasuryBalance: balances.oldBalance,
    newTreasuryBalance: balances.newBalance,
  };
};

export default task(
  "timelock-migrate-owner",
  "Atomically migrate DeepFamily ownership and its DEEP treasury to a new timelock",
)
  .addOption({
    name: "phase",
    description: "Required operation phase: schedule or execute",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "oldMultisig",
    description: "Expected sole governance multisig controlling the old Timelock",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "newMultisig",
    description: "Expected sole governance multisig controlling the new Timelock",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "oldContractName",
    description: "Required versioned artifact deployed at --old-timelock",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "newContractName",
    description: "Required versioned artifact deployed at --new-timelock",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "proxyContractName",
    description: "Required versioned artifact deployed at the DeepFamily proxy address",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "deepFamilyContractName",
    description: "Required versioned artifact for the current DeepFamily implementation",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "tokenContractName",
    description: "Required versioned artifact deployed at DeepFamilyToken",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "oldTimelock",
    description: "Current GovernanceTimelock owner address",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "newTimelock",
    description: "Pre-deployed replacement GovernanceTimelock address",
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
