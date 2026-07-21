/**
 * Usage (amount is a human-readable DEEP amount, not an 18-decimal base-unit integer):
 *   npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
 *     --phase schedule --recipient 0xRecipient --amount 125.5
 *   # After the schedule transaction is mined and the Timelock delay has elapsed:
 *   npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
 *     --phase execute --recipient 0xRecipient --amount 125.5
 *
 * Required: --phase, --recipient, and a positive decimal --amount. Do not use signs, exponent
 * notation, or raw 18-decimal base units.
 * Keep --recipient, --amount, artifact options, and optional --salt identical in both phases.
 * The target is always the deployment-recorded DeepFamilyToken; arbitrary tokens and calldata are
 * not accepted. The recipient cannot be zero, the Timelock, the Token, or DeepFamily. Scheduling
 * does not reserve DEEP, so execute checks the live balance again. If needed, submit each printed
 * to/value/data transaction through the multisig.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs treasury-transfer --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { DEFAULT_TIMELOCK_ARTIFACT } from "./lib/timelockArtifacts.mjs";
import {
  DEFAULT_TOKEN_ARTIFACT,
  resolveTreasuryTransferOperation,
} from "./lib/timelockTreasury.mjs";
import { sendOrPrint } from "./lib/timelockUpgrade.mjs";

const assertSufficientBalance = ({ balance, rawAmount, symbol }) => {
  if (balance < rawAmount) {
    throw new Error(
      `treasury balance ${balance} ${symbol} base units is below transfer amount ${rawAmount}`,
    );
  }
};

export const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const [signer] = await ethers.getSigners();
  const operation = await resolveTreasuryTransferOperation({ hre, connection, ethers, args });
  const {
    phase,
    timelock,
    timelockAddress,
    token,
    tokenAddress,
    symbol,
    decimals,
    minDelay,
    roleState,
    recipient,
    rawAmount,
    value,
    predecessor,
    payload,
    salt,
    operationId,
  } = operation;
  const currentBalance = await token.balanceOf(timelockAddress);

  console.log("DeepFamily treasury transfer plan:");
  console.log(`  phase:        ${phase}`);
  console.log(`  timelock:     ${timelockAddress}`);
  console.log(`  multisig:     ${roleState.currentMultisig}`);
  console.log(`  token target: ${tokenAddress} (${symbol})`);
  console.log(`  recipient:    ${recipient}`);
  console.log(`  amount:       ${ethers.formatUnits(rawAmount, decimals)} ${symbol}`);
  console.log(`  rawAmount:    ${rawAmount}`);
  console.log(`  rawBalance:   ${currentBalance}`);
  console.log(`  payload:      ${payload}`);
  console.log(`  salt:         ${salt}`);
  console.log(`  operationId:  ${operationId}`);

  if (phase === "schedule") {
    if (await timelock.isOperation(operationId)) {
      throw new Error(
        `operation ${operationId} is already scheduled or executed; use --phase execute or ` +
          "choose a different --salt",
      );
    }
    assertSufficientBalance({ balance: currentBalance, rawAmount, symbol });
    try {
      await ethers.provider.call({
        to: tokenAddress,
        from: timelockAddress,
        data: payload,
        value,
      });
    } catch (error) {
      const detail = error.shortMessage || error.reason || error.message;
      throw new Error(`treasury ERC20 transfer simulation reverted: ${detail}`);
    }

    const proposerRole = await timelock.PROPOSER_ROLE();
    const result = await sendOrPrint({
      timelock,
      timelockAddress,
      signer,
      role: proposerRole,
      method: "schedule",
      callArgs: [tokenAddress, value, payload, predecessor, salt, minDelay],
    });
    if (!result.sent) {
      console.log(
        "  transfer NOT scheduled: submit the governance multisig transaction above; " +
          "the delay starts when it is mined.",
      );
    }
    console.warn(
      "  NOTE: scheduling does not reserve DEEP; execution re-checks the treasury balance.",
    );
    return {
      operationId,
      salt,
      phase,
      scheduled: result.sent,
      calldata: result.calldata,
      tokenAddress,
      recipient,
      rawAmount,
    };
  }

  if (await timelock.isOperationDone(operationId)) {
    console.log("  treasury transfer already executed and confirmed on-chain.");
    return {
      operationId,
      salt,
      phase,
      executed: true,
      alreadyDone: true,
      tokenAddress,
      recipient,
      rawAmount,
    };
  }
  if (!(await timelock.isOperation(operationId))) {
    throw new Error(
      `operation ${operationId} is not scheduled; run this task with --phase schedule first ` +
        "using the same --recipient/--amount/--salt",
    );
  }
  if (!(await timelock.isOperationReady(operationId))) {
    const readyAt = await timelock.getTimestamp(operationId);
    throw new Error(`operation not ready yet; the timelock delay elapses at unix ${readyAt}`);
  }
  assertSufficientBalance({ balance: currentBalance, rawAmount, symbol });

  const executorRole = await timelock.EXECUTOR_ROLE();
  const result = await sendOrPrint({
    timelock,
    timelockAddress,
    signer,
    role: executorRole,
    method: "execute",
    callArgs: [tokenAddress, value, payload, predecessor, salt],
  });
  if (!result.sent) {
    console.log("  transfer NOT executed: submit the governance multisig transaction above.");
    return {
      operationId,
      salt,
      phase,
      executed: false,
      calldata: result.calldata,
      tokenAddress,
      recipient,
      rawAmount,
    };
  }

  if (!(await timelock.isOperationDone(operationId))) {
    throw new Error(`operation ${operationId} was sent but is not marked done on-chain`);
  }
  const treasuryBalanceAfter = await token.balanceOf(timelockAddress);
  console.log(
    `  transfer confirmed on-chain: ${ethers.formatUnits(rawAmount, decimals)} ${symbol}.`,
  );
  console.log(`  current raw treasury balance: ${treasuryBalanceAfter}`);
  return {
    operationId,
    salt,
    phase,
    executed: true,
    tokenAddress,
    recipient,
    rawAmount,
  };
};

export default task(
  "treasury-transfer",
  "Schedule or execute a timelocked transfer of DeepFamilyToken treasury funds",
)
  .addOption({
    name: "phase",
    description: "Required operation phase: schedule or execute",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "recipient",
    description: "Non-zero recipient address (must match in schedule and execute)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "amount",
    description: "Positive decimal DEEP amount, expressed in token units rather than base units",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "salt",
    description: "Override the deterministic operation salt (bytes32)",
    type: ArgumentType.STRING,
    defaultValue: "",
  })
  .addOption({
    name: "contractName",
    description: "Versioned artifact expected at the current Timelock address",
    type: ArgumentType.STRING,
    defaultValue: DEFAULT_TIMELOCK_ARTIFACT,
  })
  .addOption({
    name: "tokenContractName",
    description: "Versioned artifact expected at the deployed DeepFamilyToken address",
    type: ArgumentType.STRING,
    defaultValue: DEFAULT_TOKEN_ARTIFACT,
  })
  .setAction(() => Promise.resolve({ default: action }))
  .build();
