import { resolveTarget } from "./timelockUpgrade.mjs";

const FORBIDDEN_GOVERNANCE_SIGNATURES = [
  "upgradeToAndCall(address,bytes)",
  "upgradeTo(address)",
  "renounceOwnership()",
  "transferOwnership(address)",
];

const assertJsonNumbersAreSafe = (value, path = "args") => {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        `--args ${path} contains an unsafe or non-integer JSON number; ` +
          "quote integer values as strings instead",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonNumbersAreSafe(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      assertJsonNumbersAreSafe(item, `${path}.${key}`);
    }
  }
};

export const parseGovernanceArgs = (rawArgs = "[]") => {
  let parsed;
  try {
    parsed = JSON.parse(rawArgs === "" ? "[]" : rawArgs);
  } catch (error) {
    throw new Error(`--args must be valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("--args must be a JSON array");
  }
  assertJsonNumbersAreSafe(parsed);
  return parsed;
};

export const resolveGovernanceCall = ({ ethers, targetContract, functionName, rawArgs }) => {
  if (!functionName || functionName.trim() === "") {
    throw new Error("--function <ABI function name or signature> is required");
  }

  const callArgs = parseGovernanceArgs(rawArgs);
  let fragment;
  try {
    fragment = targetContract.interface.getFunction(functionName.trim());
  } catch (error) {
    throw new Error(`Cannot resolve --function "${functionName}": ${error.message}`);
  }
  if (!fragment) {
    throw new Error(`Cannot resolve --function "${functionName}" in the main contract ABI`);
  }

  const signature = fragment.format("sighash");
  const forbiddenSelectors = new Map(
    FORBIDDEN_GOVERNANCE_SIGNATURES.map((item) => [
      ethers.id(item).slice(0, 10).toLowerCase(),
      item,
    ]),
  );
  const forbiddenSignature = forbiddenSelectors.get(fragment.selector.toLowerCase());
  if (forbiddenSignature) {
    if (forbiddenSignature.startsWith("upgradeTo")) {
      throw new Error(
        `${forbiddenSignature} is blocked in generic governance; use upgrade-schedule and ` +
          "upgrade-execute so storage and implementation checks cannot be bypassed",
      );
    }
    if (forbiddenSignature === "renounceOwnership()") {
      throw new Error(
        "renounceOwnership() is blocked in generic governance because it permanently disables " +
          "upgrades and owner configuration; a final governance exit requires a separate audit " +
          "and an explicitly reviewed raw Timelock operation",
      );
    }
    throw new Error(
      `${forbiddenSignature} is blocked in generic governance; ownership changes require a ` +
        "dedicated, validated governance migration flow",
    );
  }

  let calldata;
  try {
    calldata = targetContract.interface.encodeFunctionData(fragment, callArgs);
  } catch (error) {
    throw new Error(`Cannot encode ${signature} with --args: ${error.message}`);
  }
  return { fragment, signature, callArgs, calldata };
};

export const deriveGovernanceSalt = (ethers, { targetAddress, calldata, override }) => {
  if (override && override !== "") {
    if (!ethers.isHexString(override, 32)) {
      throw new Error("--salt must be a 32-byte hex value");
    }
    return override;
  }

  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "address", "bytes32"],
      ["deepfamily-governance", targetAddress, ethers.keccak256(calldata)],
    ),
  );
};

export const parseGovernanceDelay = (rawDelay, minDelay) => {
  if (rawDelay === undefined || rawDelay === null || rawDelay === "") return minDelay;
  let delay;
  try {
    delay = BigInt(rawDelay);
  } catch {
    throw new Error("--delay must be a non-negative integer number of seconds");
  }
  if (delay < 0n) {
    throw new Error("--delay must be a non-negative integer number of seconds");
  }
  if (delay < minDelay) {
    throw new Error(`--delay ${delay} is below the timelock minDelay ${minDelay}`);
  }
  return delay;
};

export const resolveGovernanceOperation = async ({ connection, ethers, args }) => {
  const resolved = await resolveTarget(connection, ethers, args.target);
  const { proxy, proxyAddress, timelock } = resolved;
  const call = resolveGovernanceCall({
    ethers,
    targetContract: proxy,
    functionName: args.function,
    rawArgs: args.args,
  });
  const predecessor = ethers.ZeroHash;
  const value = 0n;
  const salt = deriveGovernanceSalt(ethers, {
    targetAddress: proxyAddress,
    calldata: call.calldata,
    override: args.salt,
  });
  const operationId = await timelock.hashOperation(
    proxyAddress,
    value,
    call.calldata,
    predecessor,
    salt,
  );
  return { ...resolved, ...call, predecessor, value, salt, operationId };
};

export const simulateGovernanceCall = async ({
  ethers,
  targetAddress,
  timelockAddress,
  calldata,
}) => {
  try {
    await ethers.provider.call({
      to: targetAddress,
      from: timelockAddress,
      data: calldata,
      value: 0n,
    });
  } catch (error) {
    const detail = error.shortMessage || error.reason || error.message;
    throw new Error(`governance call simulation reverted: ${detail}`);
  }
};
