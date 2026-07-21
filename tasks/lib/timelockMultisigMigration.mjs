import { assertGovernanceMultisig } from "../../scripts/lib/governanceSafety.mjs";

const GOVERNANCE_ROLE_NAMES = ["PROPOSER_ROLE", "CANCELLER_ROLE", "EXECUTOR_ROLE"];

export const parseMultisigMigrationPhase = (rawPhase) => {
  const phase = String(rawPhase || "")
    .trim()
    .toLowerCase();
  if (phase !== "schedule" && phase !== "execute") {
    throw new Error('--phase must be explicitly set to "schedule" or "execute"');
  }
  return phase;
};

export const parseRequiredAddress = (ethers, value, optionName) => {
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`--${optionName} must be a valid non-zero address`);
  }
  return ethers.getAddress(value);
};

const sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase();

const readSoleRoleMember = async (timelock, role, roleName) => {
  const count = await timelock.getRoleMemberCount(role);
  if (count !== 1n) {
    throw new Error(`timelock ${roleName} is abnormal: expected exactly 1 member, found ${count}`);
  }
  return timelock.getRoleMember(role, 0);
};

export const readExactTimelockRoleState = async ({ ethers, timelock, timelockAddress }) => {
  const normalizedTimelock = ethers.getAddress(timelockAddress);
  const adminRole = await timelock.DEFAULT_ADMIN_ROLE();
  const admin = await readSoleRoleMember(timelock, adminRole, "DEFAULT_ADMIN_ROLE");
  if (!sameAddress(admin, normalizedTimelock)) {
    throw new Error(
      `timelock DEFAULT_ADMIN_ROLE is abnormal: sole member ${admin} is not the timelock itself ` +
        normalizedTimelock,
    );
  }

  const roles = {};
  const members = {};
  for (const roleName of GOVERNANCE_ROLE_NAMES) {
    const role = await timelock[roleName]();
    roles[roleName] = role;
    members[roleName] = await readSoleRoleMember(timelock, role, roleName);
  }

  const currentMultisig = ethers.getAddress(members.PROPOSER_ROLE);
  if (currentMultisig === ethers.ZeroAddress) {
    throw new Error(
      "timelock governance roles are abnormal: address(0) cannot be the current multisig",
    );
  }
  for (const roleName of GOVERNANCE_ROLE_NAMES.slice(1)) {
    if (!sameAddress(members[roleName], currentMultisig)) {
      throw new Error(
        "timelock governance roles are abnormal: PROPOSER_ROLE, CANCELLER_ROLE and " +
          `EXECUTOR_ROLE must have the same sole member (found ${currentMultisig} and ` +
          `${members[roleName]})`,
      );
    }
  }

  return { adminRole, admin: ethers.getAddress(admin), roles, currentMultisig };
};

export const assertNewMultisigForMigration = async ({ ethers, address }) => {
  return assertGovernanceMultisig({
    ethers,
    provider: ethers.provider,
    address,
    label: "new governance multisig",
  });
};

export const deriveMultisigMigrationSalt = (
  ethers,
  { targets, values, payloads, predecessor, override },
) => {
  if (override && override !== "") {
    if (!ethers.isHexString(override, 32)) {
      throw new Error("--salt must be a 32-byte hex value");
    }
    return override;
  }

  const batchHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "bytes[]", "bytes32"],
      [targets, values, payloads, predecessor],
    ),
  );
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "bytes32"],
      ["deepfamily-timelock-migrate-multisig", batchHash],
    ),
  );
};

export const buildMultisigMigrationOperation = async ({
  ethers,
  timelock,
  timelockAddress,
  roles,
  oldMultisig,
  newMultisig,
  saltOverride,
}) => {
  const orderedRoles = [roles.PROPOSER_ROLE, roles.CANCELLER_ROLE, roles.EXECUTOR_ROLE];
  const payloads = [
    ...orderedRoles.map((role) =>
      timelock.interface.encodeFunctionData("grantRole", [role, newMultisig]),
    ),
    ...orderedRoles.map((role) =>
      timelock.interface.encodeFunctionData("revokeRole", [role, oldMultisig]),
    ),
  ];
  const targets = Array(payloads.length).fill(timelockAddress);
  const values = Array(payloads.length).fill(0n);
  const predecessor = ethers.ZeroHash;
  const salt = deriveMultisigMigrationSalt(ethers, {
    targets,
    values,
    payloads,
    predecessor,
    override: saltOverride,
  });
  const operationId = await timelock.hashOperationBatch(
    targets,
    values,
    payloads,
    predecessor,
    salt,
  );
  return { targets, values, payloads, predecessor, salt, operationId };
};

export const assertCurrentMultisig = (actual, expected, context) => {
  if (!sameAddress(actual, expected)) {
    throw new Error(
      `${context}: expected the sole governance multisig to be ${expected}, but found ${actual}`,
    );
  }
};
