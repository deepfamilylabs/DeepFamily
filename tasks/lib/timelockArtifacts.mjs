export const DEFAULT_TIMELOCK_ARTIFACT = "GovernanceTimelock";

export const parseArtifactName = (rawValue, optionName, defaultValue = "") => {
  const name = String(rawValue ?? defaultValue).trim();
  if (!name) throw new Error(`--${optionName} is required`);
  if (name.length > 256 || !/^[A-Za-z0-9_@./:$-]+$/.test(name)) {
    throw new Error(`--${optionName} is not a valid Hardhat artifact name`);
  }
  return name;
};
