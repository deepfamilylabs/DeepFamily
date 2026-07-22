import {
  assertGovernanceMultisigWithProfile,
  normalizeGovernanceMultisigProfile,
} from "../../scripts/lib/governanceSafety.mjs";
import { readExactTimelockRoleState } from "./timelockMultisigMigration.mjs";

/**
 * Enforces the configured implementation-specific governance wallet profile for an existing
 * Timelock. A blank profile intentionally preserves the implementation-neutral operational path;
 * deployment, migration and treasury tooling continue to apply their existing generic multisig
 * checks independently.
 *
 * When a profile is configured, role membership is also required to be exact: the Timelock is its
 * own sole admin and one nonzero wallet is the sole proposer, canceller and executor.
 */
export const assertConfiguredTimelockGovernanceProfile = async ({
  ethers,
  timelock,
  timelockAddress,
  roleState,
  label = "current governance multisig",
  profile = process.env.GOVERNANCE_MULTISIG_PROFILE,
}) => {
  const normalizedProfile = normalizeGovernanceMultisigProfile(profile);
  if (normalizedProfile === "") return null;

  const resolvedRoleState =
    roleState ?? (await readExactTimelockRoleState({ ethers, timelock, timelockAddress }));
  const multisigPolicy = await assertGovernanceMultisigWithProfile({
    ethers,
    provider: ethers.provider,
    address: resolvedRoleState.currentMultisig,
    label,
    profile: normalizedProfile,
  });
  return {
    profile: normalizedProfile,
    roleState: resolvedRoleState,
    multisigPolicy,
  };
};
