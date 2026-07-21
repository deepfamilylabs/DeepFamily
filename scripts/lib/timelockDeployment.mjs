import { assertGovernanceMultisig, isLocalDevelopmentConnection } from "./governanceSafety.mjs";

const LOCAL_MIN_DELAY_SECONDS = 120;

const hasValue = (value) => typeof value === "string" && value.trim() !== "";

export const parsePositiveSafeInteger = (value, name) => {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${name} must be a positive safe integer (got ${value ?? "unset"})`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer (got ${normalized})`);
  }
  return parsed;
};

export const parseGovernanceMultisig = ({ ethers, value }) => {
  const address = String(value ?? "").trim();
  if (!ethers.isAddress(address)) {
    throw new Error(`GOVERNANCE_MULTISIG must be a valid address (got ${value ?? "unset"})`);
  }
  const normalized = ethers.getAddress(address);
  if (normalized === ethers.ZeroAddress) {
    throw new Error("GOVERNANCE_MULTISIG must not be the zero address");
  }
  return normalized;
};

export const isLocalTimelockNetwork = ({ connection }) => isLocalDevelopmentConnection(connection);

export const resolveTimelockDeploymentConfig = async ({
  connection,
  ethers,
  env,
  deployerAddress,
  provider = ethers.provider,
  inspectMultisig = assertGovernanceMultisig,
}) => {
  const isLocal = isLocalTimelockNetwork({ connection });

  if (!isLocal) {
    const missing = ["MIN_DELAY", "GOVERNANCE_MULTISIG"].filter((name) => !hasValue(env[name]));
    if (missing.length > 0) {
      throw new Error(
        `Live timelock deployment requires explicit ${missing.join(", ")}; ` +
          "deployer defaults are available only on local simulated/localhost networks",
      );
    }
  }

  const minDelay = parsePositiveSafeInteger(
    hasValue(env.MIN_DELAY) ? env.MIN_DELAY : LOCAL_MIN_DELAY_SECONDS,
    "MIN_DELAY",
  );
  const governanceMultisig = parseGovernanceMultisig({
    ethers,
    value: hasValue(env.GOVERNANCE_MULTISIG) ? env.GOVERNANCE_MULTISIG : deployerAddress,
  });

  if (!isLocal) {
    await inspectMultisig({
      ethers,
      provider,
      address: governanceMultisig,
      label: "GOVERNANCE_MULTISIG",
    });
  }

  return { isLocal, minDelay, governanceMultisig };
};
