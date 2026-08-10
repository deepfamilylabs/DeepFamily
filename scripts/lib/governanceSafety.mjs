import { assertCanonicalSafeProfile } from "./safeGovernance.mjs";
import {
  CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
  ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE,
} from "./chainProfiles.mjs";

const MULTISIG_INSPECTION_ABI = [
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
];

const LOCAL_HTTP_NETWORK_NAMES = new Set(["localhost"]);
export { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE, ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE };

const REMOVED_GOVERNANCE_ENVIRONMENT_NAMES = Object.freeze({
  GOVERNANCE_MULTISIG: "GOVERNANCE_SAFE_ADDRESS",
  GOVERNANCE_OWNER: "GOVERNANCE_TIMELOCK_ADDRESS",
  GOVERNANCE_MULTISIG_PROFILE: "GOVERNANCE_SAFE_PROFILE",
});

export const assertNoRemovedGovernanceEnvironmentVariables = (env = process.env) => {
  for (const [removedName, replacementName] of Object.entries(
    REMOVED_GOVERNANCE_ENVIRONMENT_NAMES,
  )) {
    if (String(env[removedName] ?? "").trim() !== "") {
      throw new Error(
        `${removedName} has been removed; use ${replacementName} instead (do not set both)`,
      );
    }
  }
};

const PROFILE_CHAIN_IDS = Object.freeze({
  [CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE]: new Set([71n, 1030n]),
  [ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE]: new Set([1n, 11155111n]),
});

export const normalizeGovernanceMultisigProfile = (profile) => {
  if (profile === undefined) {
    assertNoRemovedGovernanceEnvironmentVariables(process.env);
    return String(process.env.GOVERNANCE_SAFE_PROFILE ?? "").trim();
  }
  return String(profile ?? "").trim();
};

export const isLocalDevelopmentConnection = (connection) => {
  if (connection?.networkConfig?.type === "edr-simulated") return true;
  const networkName = connection?.networkName || connection?.network?.name;
  return connection?.networkConfig?.type === "http" && LOCAL_HTTP_NETWORK_NAMES.has(networkName);
};

export const assertGovernanceMultisig = async ({ ethers, provider, address, label }) => {
  const code = await provider.getCode(address);
  if (!code || /^0x0*$/i.test(code)) {
    throw new Error(`${label} ${address} has no contract code on this network`);
  }

  let threshold;
  let owners;
  try {
    const multisig = new ethers.Contract(address, MULTISIG_INSPECTION_ABI, provider);
    [threshold, owners] = await Promise.all([multisig.getThreshold(), multisig.getOwners()]);
  } catch (error) {
    const detail = error.shortMessage || error.reason || error.message;
    throw new Error(
      `${label} ${address} does not expose the required getThreshold/getOwners ` +
        `inspection interface (${detail})`,
    );
  }

  if (threshold < 2n) {
    throw new Error(`${label} ${address} threshold=${threshold}; production requires at least 2`);
  }
  if (BigInt(owners.length) < threshold) {
    throw new Error(
      `${label} ${address} has ${owners.length} owners but threshold=${threshold}; ` +
        `the multisig policy is invalid`,
    );
  }

  const normalizedOwners = [];
  const seen = new Set();
  for (const owner of owners) {
    if (!ethers.isAddress(owner) || owner === ethers.ZeroAddress) {
      throw new Error(`${label} ${address} returned an invalid owner address: ${owner}`);
    }
    const normalized = ethers.getAddress(owner);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`${label} ${address} returned duplicate owner ${normalized}`);
    }
    seen.add(key);
    normalizedOwners.push(normalized);
  }

  return { threshold, owners: normalizedOwners };
};

/**
 * Applies an optional machine-readable production wallet profile on top of the generic multisig
 * interface check. Leaving the profile blank keeps alternative multisig implementations usable;
 * selecting a pinned Safe profile makes production deployment and migration checks identical to
 * the matching network's release rehearsal.
 */
export const assertGovernanceMultisigWithProfile = async ({
  ethers,
  provider,
  address,
  label,
  profile,
}) => {
  const genericPolicy = await assertGovernanceMultisig({ ethers, provider, address, label });
  const configuredProfile = await assertGovernanceMultisigProfile({
    provider,
    address,
    owners: genericPolicy.owners,
    profile,
  });
  if (configuredProfile === null) return genericPolicy;

  return { ...genericPolicy, ...configuredProfile };
};

/**
 * Applies only the optional implementation-specific portion of the wallet policy. Callers such as
 * status reporting that already ran `assertGovernanceMultisig` can use this without performing the
 * generic threshold/owner inspection twice.
 */
export const assertGovernanceMultisigProfile = async ({ provider, address, owners, profile }) => {
  const normalizedProfile = normalizeGovernanceMultisigProfile(profile);
  if (normalizedProfile === "") return null;
  const allowedChainIds = PROFILE_CHAIN_IDS[normalizedProfile];
  if (!allowedChainIds) {
    throw new Error(
      `Unsupported GOVERNANCE_SAFE_PROFILE=${normalizedProfile}; supported profiles: ` +
        `${CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE}, ${ETHEREUM_SAFE_1_3_0_2_OF_3_PROFILE}`,
    );
  }

  const network = await provider.getNetwork();
  if (!allowedChainIds.has(network.chainId)) {
    const scope =
      normalizedProfile === CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE
        ? "restricted to Conflux eSpace chainIds 71 and 1030"
        : "restricted to Ethereum chainIds 1 and 11155111";
    throw new Error(
      `GOVERNANCE_SAFE_PROFILE=${normalizedProfile} is ${scope}; got ${network.chainId}`,
    );
  }
  const safeProfile = await assertCanonicalSafeProfile({
    provider,
    chainId: network.chainId,
    safeAddress: address,
    expectedOwners: owners,
  });
  return { profile: normalizedProfile, safeProfile };
};
