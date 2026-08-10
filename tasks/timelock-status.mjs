/**
 * Usage:
 *   npx hardhat --config hardhat.config.mjs timelock-status --network confluxTestnet
 *
 * Inspect one scheduled operation as well:
 *   npx hardhat --config hardhat.config.mjs timelock-status --network confluxTestnet \
 *     --contract-name GovernanceTimelock --operation-id 0x<32-byte-operation-id>
 *
 * Required: none. --operation-id is optional and must already be known.
 * This is read-only. It verifies the Timelock runtime, delay, exact role membership, multisig
 * threshold/owners, DeepFamily ownership, Token owner retirement, and deployment wiring.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs timelock-status --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import {
  assertImplementationMatchesArtifact,
  readDeploymentAddress,
  resolveTarget,
} from "./lib/timelockUpgrade.mjs";
import { DEFAULT_TIMELOCK_ARTIFACT, parseArtifactName } from "./lib/timelockArtifacts.mjs";
import {
  assertGovernanceMultisigProfile,
  assertNoRemovedGovernanceEnvironmentVariables,
} from "../scripts/lib/governanceSafety.mjs";

const MULTISIG_INSPECTION_ABI = [
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
];

const hasContractCode = (code) => Boolean(code) && !/^0x0*$/i.test(code);
const sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase();

const readRoleMembers = async (timelock, role) => {
  const count = await timelock.getRoleMemberCount(role);
  const members = [];
  for (let index = 0n; index < count; index += 1n) {
    members.push(await timelock.getRoleMember(role, index));
  }
  return members;
};

const isExactSingleton = (members, expected) =>
  members.length === 1 && sameAddress(members[0], expected);

const inspectOperation = async ({ ethers, timelock, operationId }) => {
  if (!operationId) return null;
  if (!ethers.isHexString(operationId, 32)) {
    throw new Error("--operation-id must be a 32-byte timelock operation ID");
  }

  const [registered, waiting, ready, done, timestamp, latestBlock] = await Promise.all([
    timelock.isOperation(operationId),
    timelock.isOperationPending(operationId),
    timelock.isOperationReady(operationId),
    timelock.isOperationDone(operationId),
    timelock.getTimestamp(operationId),
    ethers.provider.getBlock("latest"),
  ]);
  const now = BigInt(latestBlock.timestamp);
  const remainingSeconds = waiting && timestamp > now ? timestamp - now : 0n;
  const state = done ? "done" : ready ? "ready" : waiting ? "waiting" : "unset";

  return {
    id: operationId,
    registered,
    pending: waiting,
    ready,
    done,
    state,
    timestamp,
    remainingSeconds,
  };
};

const inspectMultisig = async ({ ethers, address, issues }) => {
  const result = {
    address,
    hasCode: false,
    threshold: null,
    owners: [],
    inspectionError: null,
    profile: null,
  };
  const code = await ethers.provider.getCode(address);
  result.hasCode = hasContractCode(code);
  if (!result.hasCode) {
    const message =
      `governance role holder ${address} has no contract code; ` +
      "expected an inspectable multisig";
    result.inspectionError = message;
    issues.push(message);
    return result;
  }

  try {
    const multisig = new ethers.Contract(address, MULTISIG_INSPECTION_ABI, ethers.provider);
    const [threshold, rawOwners] = await Promise.all([
      multisig.getThreshold(),
      multisig.getOwners(),
    ]);
    const owners = rawOwners.map((owner) => ethers.getAddress(owner));
    result.threshold = threshold;
    result.owners = owners;

    if (threshold < 2n) {
      issues.push(
        `multisig ${address} threshold=${threshold}; production governance requires at least 2`,
      );
    }
    if (threshold > BigInt(owners.length)) {
      issues.push(
        `multisig ${address} has ${owners.length} owners but threshold=${threshold}; ` +
          "the policy is invalid",
      );
    }
    const normalizedOwners = owners.map((owner) => owner.toLowerCase());
    if (owners.some((owner) => sameAddress(owner, ethers.ZeroAddress))) {
      issues.push(`multisig ${address} contains the zero address as an owner`);
    }
    if (new Set(normalizedOwners).size !== normalizedOwners.length) {
      issues.push(`multisig ${address} returned duplicate owners`);
    }
    try {
      const profiled = await assertGovernanceMultisigProfile({
        provider: ethers.provider,
        address,
        owners,
      });
      result.profile = profiled?.profile ?? null;
    } catch (error) {
      issues.push(`multisig ${address} does not match the configured profile: ${error.message}`);
    }
  } catch (error) {
    const detail = error.shortMessage || error.reason || error.message;
    const message =
      `governance role holder ${address} does not expose the required ` +
      `getThreshold/getOwners inspection interface (${detail})`;
    result.inspectionError = message;
    issues.push(message);
  }

  return result;
};

const printMembers = (label, members) => {
  console.log(`  ${label} (${members.length}):`);
  if (members.length === 0) console.log("    (none)");
  for (const member of members) console.log(`    ${member}`);
};

export const action = async (args, hre) => {
  assertNoRemovedGovernanceEnvironmentVariables(process.env);
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const contractName = parseArtifactName(
    args.contractName,
    "contract-name",
    DEFAULT_TIMELOCK_ARTIFACT,
  );

  const { spec, proxyAddress, timelock, timelockAddress } = await resolveTarget(
    connection,
    ethers,
    args.target,
    contractName,
  );
  const timelockCode = await ethers.provider.getCode(timelockAddress);
  if (!hasContractCode(timelockCode)) {
    throw new Error(
      `${spec.contract}.owner() is ${timelockAddress}, which has no contract code; ` +
        "expected GovernanceTimelock",
    );
  }

  const issues = [];
  let runtimeMatchesArtifact = true;
  try {
    await assertImplementationMatchesArtifact({
      connection,
      ethers,
      hre,
      contractName,
      implementation: timelockAddress,
      spec: { needsLibraries: false },
    });
  } catch (error) {
    runtimeMatchesArtifact = false;
    issues.push(`owner runtime does not match ${contractName} artifact: ${error.message}`);
  }

  let minDelay;
  let roleIds;
  let roles;
  try {
    minDelay = await timelock.getMinDelay();
    roleIds = {
      admin: await timelock.DEFAULT_ADMIN_ROLE(),
      proposer: await timelock.PROPOSER_ROLE(),
      canceller: await timelock.CANCELLER_ROLE(),
      executor: await timelock.EXECUTOR_ROLE(),
    };
    const [admin, proposer, canceller, executor] = await Promise.all([
      readRoleMembers(timelock, roleIds.admin),
      readRoleMembers(timelock, roleIds.proposer),
      readRoleMembers(timelock, roleIds.canceller),
      readRoleMembers(timelock, roleIds.executor),
    ]);
    roles = {
      admin: { id: roleIds.admin, members: admin },
      proposer: { id: roleIds.proposer, members: proposer },
      canceller: { id: roleIds.canceller, members: canceller },
      executor: { id: roleIds.executor, members: executor },
    };
  } catch (error) {
    const detail = error.shortMessage || error.reason || error.message;
    throw new Error(
      `${spec.contract}.owner() ${timelockAddress} does not expose the required ` +
        `GovernanceTimelock inspection interface (${detail})`,
    );
  }

  if (minDelay === 0n) issues.push("timelock minDelay is zero");
  if (!isExactSingleton(roles.admin.members, timelockAddress)) {
    issues.push("DEFAULT_ADMIN_ROLE must have exactly one member: the timelock itself");
  }

  const proposer = roles.proposer.members;
  let multisigAddress = null;
  if (proposer.length !== 1 || sameAddress(proposer[0], ethers.ZeroAddress)) {
    issues.push("PROPOSER_ROLE must have exactly one nonzero multisig member");
  } else {
    multisigAddress = proposer[0];
  }
  if (!multisigAddress || !isExactSingleton(roles.canceller.members, multisigAddress)) {
    issues.push("CANCELLER_ROLE must have exactly the same sole multisig member as PROPOSER_ROLE");
  }
  if (!multisigAddress || !isExactSingleton(roles.executor.members, multisigAddress)) {
    issues.push("EXECUTOR_ROLE must have exactly the same sole multisig member as PROPOSER_ROLE");
  }
  if (roles.executor.members.some((member) => sameAddress(member, ethers.ZeroAddress))) {
    issues.push("EXECUTOR_ROLE is open to address(0)");
  }

  const multisig = multisigAddress
    ? await inspectMultisig({ ethers, address: multisigAddress, issues })
    : null;

  let token = null;
  try {
    const tokenAddress = ethers.getAddress(
      await readDeploymentAddress(connection, "DeepFamilyToken"),
    );
    const deepFamily = await ethers.getContractAt("DeepFamily", proxyAddress);
    const tokenContract = await ethers.getContractAt("DeepFamilyToken", tokenAddress);
    const tokenOwner = ethers.getAddress(await tokenContract.owner());
    const configuredToken = ethers.getAddress(await deepFamily.DEEP_FAMILY_TOKEN_CONTRACT());
    const configuredMain = ethers.getAddress(await tokenContract.deepFamilyContract());
    token = {
      address: tokenAddress,
      owner: tokenOwner,
      configuredToken,
      configuredMain,
      ownerRetired: sameAddress(tokenOwner, ethers.ZeroAddress),
      wiringAligned:
        sameAddress(configuredToken, tokenAddress) && sameAddress(configuredMain, proxyAddress),
    };
    if (!token.ownerRetired) {
      issues.push(
        `DeepFamilyToken bootstrap owner ${tokenOwner} is still active; expected ` +
          `${ethers.ZeroAddress} after its one-time binding`,
      );
    }
    if (!token.wiringAligned) {
      issues.push(
        `DeepFamily/Token wiring mismatch: main token=${configuredToken}, token main=${configuredMain}`,
      );
    }
  } catch (error) {
    const detail = error.shortMessage || error.reason || error.message;
    issues.push(`cannot verify DeepFamilyToken retired owner and wiring: ${detail}`);
  }

  const operation = await inspectOperation({
    ethers,
    timelock,
    operationId: args.operationId,
  });
  const healthy = issues.length === 0;

  console.log("DeepFamily timelock governance status:");
  console.log(`  target:      ${args.target} (${spec.contract} @ ${proxyAddress})`);
  console.log(`  owner:       ${timelockAddress}`);
  console.log(`  artifact:    ${contractName}`);
  console.log(`  runtime:     ${runtimeMatchesArtifact ? "artifact match" : "MISMATCH"}`);
  console.log(`  minDelay:    ${minDelay} seconds`);
  console.log("governed contracts:");
  console.log(`  DeepFamily:  ${proxyAddress} (owner ${timelockAddress})`);
  if (token) {
    console.log(
      `  token:       ${token.address} ` +
        `(bootstrap owner ${token.ownerRetired ? "retired" : token.owner})`,
    );
    console.log(`  wiring:      ${token.wiringAligned ? "aligned" : "MISMATCH"}`);
  } else {
    console.log("  token:       unavailable");
  }
  console.log("roles (exact on-chain membership):");
  printMembers("admin", roles.admin.members);
  printMembers("proposer", roles.proposer.members);
  printMembers("canceller", roles.canceller.members);
  printMembers("executor", roles.executor.members);

  console.log("governance multisig inspection:");
  if (!multisig) {
    console.log("  address:     (cannot infer a unique multisig from PROPOSER_ROLE)");
  } else {
    console.log(`  address:     ${multisig.address}`);
    console.log(`  contract:    ${multisig.hasCode ? "yes" : "no"}`);
    console.log(
      `  threshold:   ${multisig.threshold === null ? "unavailable" : multisig.threshold}`,
    );
    if (multisig.profile) console.log(`  profile:     ${multisig.profile} (match)`);
    printMembers("owners", multisig.owners);
  }

  if (operation) {
    console.log("operation status:");
    console.log(`  operationId: ${operation.id}`);
    console.log(`  state:       ${operation.state}`);
    console.log(`  timestamp:   ${operation.timestamp}`);
    if (operation.state === "waiting") {
      console.log(`  remaining:   ${operation.remainingSeconds} seconds`);
    }
  }

  console.log(
    `checked governance invariants: ${healthy ? "PASS" : `ISSUES (${issues.length} found)`}`,
  );
  for (const issue of issues) console.warn(`  DANGER: ${issue}`);

  return {
    target: { name: args.target, contract: spec.contract, address: proxyAddress },
    timelock: {
      address: timelockAddress,
      artifact: contractName,
      minDelay,
      runtimeMatchesArtifact,
      roles,
    },
    token,
    multisig,
    operation,
    healthy,
    issues,
  };
};

export default task(
  "timelock-status",
  "Inspect DeepFamily timelock, multisig roles, and an operation",
)
  .addOption({
    name: "target",
    description: "Governed contract whose owner identifies the timelock: main",
    type: ArgumentType.STRING,
    defaultValue: "main",
  })
  .addOption({
    name: "contractName",
    description: "Versioned artifact expected at the Timelock owner address",
    type: ArgumentType.STRING,
    defaultValue: DEFAULT_TIMELOCK_ARTIFACT,
  })
  .addOption({
    name: "operationId",
    description: "Optional operation ID printed by a governance schedule task",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
