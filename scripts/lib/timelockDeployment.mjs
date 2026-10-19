import {
  assertGovernanceMultisigWithProfile,
  isLocalDevelopmentConnection,
} from "./governanceSafety.mjs";
import { supportedChainProfiles } from "./chainProfiles.mjs";
import { MAINNET_MIN_DELAY_FLOOR_SECONDS } from "./mainnetReleaseSafety.mjs";

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
    throw new Error(`GOVERNANCE_SAFE_ADDRESS must be a valid address (got ${value ?? "unset"})`);
  }
  const normalized = ethers.getAddress(address);
  if (normalized === ethers.ZeroAddress) {
    throw new Error("GOVERNANCE_SAFE_ADDRESS must not be the zero address");
  }
  return normalized;
};

export const isLocalTimelockNetwork = ({ connection }) => isLocalDevelopmentConnection(connection);

export const isProductionTimelockNetwork = async ({ connection, provider }) => {
  if (connection?.networkConfig?.type === "edr-simulated") return false;
  // HTTP network names and configured chain IDs do not establish the RPC's actual chain.
  const { chainId } = await provider.getNetwork();
  return supportedChainProfiles().some((profile) => profile.mainnet.chainId === BigInt(chainId));
};

/** Deployment policy only; later governance operations continue to use the live delay. */
export const assertProductionTimelockDelay = async ({
  connection,
  provider,
  minDelay,
  label = "MIN_DELAY",
}) => {
  const isMainnet = await isProductionTimelockNetwork({ connection, provider });
  if (isMainnet && BigInt(minDelay) < BigInt(MAINNET_MIN_DELAY_FLOOR_SECONDS)) {
    throw new Error(
      `${label} must be at least ${MAINNET_MIN_DELAY_FLOOR_SECONDS} seconds (7 days) ` +
        `on mainnet; got ${minDelay}`,
    );
  }
};

export const resolveTimelockDeploymentConfig = async ({
  connection,
  ethers,
  env = process.env,
  deployerAddress,
  provider = ethers.provider,
  inspectMultisig,
}) => {
  const isLocal =
    isLocalTimelockNetwork({ connection }) &&
    !(await isProductionTimelockNetwork({ connection, provider }));

  if (!isLocal) {
    const missing = ["MIN_DELAY", "GOVERNANCE_SAFE_ADDRESS"].filter((name) => !hasValue(env[name]));
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
  await assertProductionTimelockDelay({ connection, provider, minDelay });
  const governanceMultisig = parseGovernanceMultisig({
    ethers,
    value: hasValue(env.GOVERNANCE_SAFE_ADDRESS) ? env.GOVERNANCE_SAFE_ADDRESS : deployerAddress,
  });

  if (!isLocal) {
    const inspect =
      inspectMultisig ??
      ((args) =>
        assertGovernanceMultisigWithProfile({
          ...args,
          // `env` is an explicit configuration boundary for this resolver. Passing undefined
          // would trigger the helper's process.env default and make injected/test environments
          // unexpectedly inherit a host-level production profile.
          profile: env.GOVERNANCE_SAFE_PROFILE ?? "",
        }));
    await inspect({
      ethers,
      provider,
      address: governanceMultisig,
      label: "GOVERNANCE_SAFE_ADDRESS",
    });
  }

  return { isLocal, minDelay, governanceMultisig };
};
