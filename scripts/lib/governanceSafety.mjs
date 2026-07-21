const MULTISIG_INSPECTION_ABI = [
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
];

const LOCAL_HTTP_NETWORK_NAMES = new Set(["localhost"]);

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
