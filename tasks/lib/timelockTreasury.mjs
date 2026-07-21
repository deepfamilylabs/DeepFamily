import { assertGovernanceMultisig } from "../../scripts/lib/governanceSafety.mjs";
import { DEFAULT_TIMELOCK_ARTIFACT, parseArtifactName } from "./timelockArtifacts.mjs";
import { readExactTimelockRoleState } from "./timelockMultisigMigration.mjs";
import {
  assertImplementationMatchesArtifact,
  readDeploymentAddress,
  resolveTarget,
} from "./timelockUpgrade.mjs";

export const DEFAULT_TOKEN_ARTIFACT = "DeepFamilyToken";

const sameAddress = (left, right) => left.toLowerCase() === right.toLowerCase();

export const parseTreasuryPhase = (rawPhase) => {
  const phase = String(rawPhase ?? "")
    .trim()
    .toLowerCase();
  if (phase !== "schedule" && phase !== "execute") {
    throw new Error('--phase must be explicitly set to "schedule" or "execute"');
  }
  return phase;
};

export const parseTreasuryRecipient = (ethers, rawRecipient) => {
  const recipient = String(rawRecipient ?? "").trim();
  if (!ethers.isAddress(recipient)) {
    throw new Error("--recipient must be a valid non-zero address");
  }
  const normalized = ethers.getAddress(recipient);
  if (sameAddress(normalized, ethers.ZeroAddress)) {
    throw new Error("--recipient must be a valid non-zero address");
  }
  return normalized;
};

export const parseTreasuryAmount = (ethers, rawAmount, decimals) => {
  const amount = String(rawAmount ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)) {
    throw new Error(
      "--amount must be a positive decimal DEEP amount without signs or scientific notation",
    );
  }

  const [, fraction = ""] = amount.split(".");
  if (fraction.length > decimals) {
    throw new Error(`--amount has more than the token's ${decimals} decimal places`);
  }

  let raw;
  try {
    raw = ethers.parseUnits(amount, decimals);
  } catch (error) {
    throw new Error(`--amount cannot be represented as token units: ${error.message}`);
  }
  if (raw <= 0n) throw new Error("--amount must be greater than zero");
  if (raw > (1n << 256n) - 1n) {
    throw new Error("--amount must fit in an unsigned 256-bit integer");
  }
  return raw;
};

export const deriveTreasuryTransferSalt = (
  ethers,
  { timelockAddress, tokenAddress, recipient, rawAmount, override },
) => {
  if (override) {
    if (!ethers.isHexString(override, 32)) {
      throw new Error("--salt must be a 32-byte hex value");
    }
    return override;
  }

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "address", "address", "address", "uint256"],
      ["deepfamily-treasury-transfer", timelockAddress, tokenAddress, recipient, rawAmount],
    ),
  );
};

export const resolveTreasury = async ({ hre, connection, ethers, args }) => {
  const contractName = parseArtifactName(
    args.contractName,
    "contract-name",
    DEFAULT_TIMELOCK_ARTIFACT,
  );
  const tokenContractName = parseArtifactName(
    args.tokenContractName,
    "token-contract-name",
    DEFAULT_TOKEN_ARTIFACT,
  );
  const resolved = await resolveTarget(connection, ethers, "main", contractName);
  const {
    proxy: deepFamily,
    proxyAddress: deepFamilyAddress,
    timelock,
    timelockAddress,
  } = resolved;

  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName,
    implementation: timelockAddress,
    spec: { needsLibraries: false },
  });
  const roleState = await readExactTimelockRoleState({
    ethers,
    timelock,
    timelockAddress,
  });
  const multisigPolicy = await assertGovernanceMultisig({
    ethers,
    provider: ethers.provider,
    address: roleState.currentMultisig,
    label: "treasury governance multisig",
  });
  const minDelay = await timelock.getMinDelay();
  if (minDelay <= 0n) throw new Error("treasury timelock must have a non-zero minimum delay");

  const tokenAddress = ethers.getAddress(
    await readDeploymentAddress(connection, "DeepFamilyToken"),
  );
  await assertImplementationMatchesArtifact({
    connection,
    ethers,
    hre,
    contractName: tokenContractName,
    implementation: tokenAddress,
    spec: { needsLibraries: false },
  });
  const token = await ethers.getContractAt(tokenContractName, tokenAddress);
  const [configuredToken, configuredMain, tokenOwner, decimals, symbol] = await Promise.all([
    deepFamily.DEEP_FAMILY_TOKEN_CONTRACT(),
    token.deepFamilyContract(),
    token.owner(),
    token.decimals(),
    token.symbol(),
  ]);
  if (!sameAddress(ethers.getAddress(configuredToken), tokenAddress)) {
    throw new Error(
      `DeepFamily token binding ${configuredToken} does not match deployed DeepFamilyToken ` +
        tokenAddress,
    );
  }
  if (!sameAddress(ethers.getAddress(configuredMain), deepFamilyAddress)) {
    throw new Error(
      `DeepFamilyToken main binding ${configuredMain} does not match deployed DeepFamily ` +
        deepFamilyAddress,
    );
  }
  if (!sameAddress(ethers.getAddress(tokenOwner), ethers.ZeroAddress)) {
    throw new Error(
      `DeepFamilyToken bootstrap owner ${tokenOwner} is still active; expected ` +
        `${ethers.ZeroAddress} after its one-time binding`,
    );
  }

  const normalizedDecimals = Number(decimals);
  if (
    !Number.isSafeInteger(normalizedDecimals) ||
    normalizedDecimals < 0 ||
    normalizedDecimals > 77
  ) {
    throw new Error(`DeepFamilyToken returned unsupported decimals=${decimals}`);
  }

  return {
    ...resolved,
    contractName,
    tokenContractName,
    deepFamily,
    deepFamilyAddress,
    token,
    tokenAddress,
    decimals: normalizedDecimals,
    symbol,
    minDelay,
    roleState,
    multisigPolicy,
  };
};

export const resolveTreasuryTransferOperation = async ({ hre, connection, ethers, args }) => {
  const phase = parseTreasuryPhase(args.phase);
  const treasury = await resolveTreasury({ hre, connection, ethers, args });
  const recipient = parseTreasuryRecipient(ethers, args.recipient);
  for (const [label, protectedAddress] of [
    ["treasury timelock", treasury.timelockAddress],
    ["DeepFamilyToken", treasury.tokenAddress],
    ["DeepFamily", treasury.deepFamilyAddress],
  ]) {
    if (sameAddress(recipient, protectedAddress)) {
      throw new Error(`--recipient must not be the ${label} address ${protectedAddress}`);
    }
  }

  const rawAmount = parseTreasuryAmount(ethers, args.amount, treasury.decimals);
  const value = 0n;
  const predecessor = ethers.ZeroHash;
  const payload = treasury.token.interface.encodeFunctionData("transfer", [recipient, rawAmount]);
  const salt = deriveTreasuryTransferSalt(ethers, {
    timelockAddress: treasury.timelockAddress,
    tokenAddress: treasury.tokenAddress,
    recipient,
    rawAmount,
    override: args.salt,
  });
  const operationId = await treasury.timelock.hashOperation(
    treasury.tokenAddress,
    value,
    payload,
    predecessor,
    salt,
  );

  return {
    ...treasury,
    phase,
    recipient,
    rawAmount,
    value,
    predecessor,
    payload,
    salt,
    operationId,
  };
};
