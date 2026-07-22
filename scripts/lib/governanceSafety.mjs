import { assertCanonicalSafeProfile } from "./safeGovernance.mjs";

const MULTISIG_INSPECTION_ABI = [
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
];

const LOCAL_HTTP_NETWORK_NAMES = new Set(["localhost"]);
export const CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE = "conflux-safe-1.3.0-2of3";

export const normalizeGovernanceMultisigProfile = (
  profile = process.env.GOVERNANCE_MULTISIG_PROFILE,
) => String(profile ?? "").trim();

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
 * selecting the pinned Conflux Safe profile makes production deployment and migration checks
 * identical to the eSpace release rehearsal.
 */
export const assertGovernanceMultisigWithProfile = async ({
  ethers,
  provider,
  address,
  label,
  profile = process.env.GOVERNANCE_MULTISIG_PROFILE,
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
export const assertGovernanceMultisigProfile = async ({
  provider,
  address,
  owners,
  profile = process.env.GOVERNANCE_MULTISIG_PROFILE,
}) => {
  const normalizedProfile = normalizeGovernanceMultisigProfile(profile);
  if (normalizedProfile === "") return null;
  if (normalizedProfile !== CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE) {
    throw new Error(
      `Unsupported GOVERNANCE_MULTISIG_PROFILE=${normalizedProfile}; supported profile: ` +
        CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE,
    );
  }

  const network = await provider.getNetwork();
  const safeProfile = await assertCanonicalSafeProfile({
    provider,
    chainId: network.chainId,
    safeAddress: address,
    expectedOwners: owners,
  });
  return { profile: normalizedProfile, safeProfile };
};
