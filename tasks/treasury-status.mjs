/**
 * Usage:
 *   npx hardhat --config hardhat.config.mjs treasury-status --network confluxTestnet \
 *     --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
 *
 * Required: none. Both artifact names default to the current production contract names.
 * This is read-only. It verifies the current Timelock, multisig policy, Token runtime and binding,
 * then prints raw and human-readable DEEP treasury balances.
 * List every option with:
 *   npx hardhat --config hardhat.config.mjs treasury-status --help
 */
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { DEFAULT_TIMELOCK_ARTIFACT } from "./lib/timelockArtifacts.mjs";
import { DEFAULT_TOKEN_ARTIFACT, resolveTreasury } from "./lib/timelockTreasury.mjs";

export const action = async (args, hre) => {
  const connection = await hre.network.connect();
  const { ethers } = connection;
  const treasury = await resolveTreasury({ hre, connection, ethers, args });
  const {
    deepFamilyAddress,
    timelockAddress,
    contractName,
    token,
    tokenAddress,
    tokenContractName,
    decimals,
    symbol,
    minDelay,
    roleState,
    multisigPolicy,
  } = treasury;
  const [rawBalance, totalSupply] = await Promise.all([
    token.balanceOf(timelockAddress),
    token.totalSupply(),
  ]);
  const formattedBalance = ethers.formatUnits(rawBalance, decimals);
  const formattedTotalSupply = ethers.formatUnits(totalSupply, decimals);

  console.log("DeepFamily protocol treasury status:");
  console.log(`  DeepFamily:     ${deepFamilyAddress}`);
  console.log(`  timelock:       ${timelockAddress} (${contractName})`);
  console.log(`  minDelay:       ${minDelay} seconds`);
  console.log(
    `  multisig:       ${roleState.currentMultisig} ` +
      `(threshold=${multisigPolicy.threshold}/${multisigPolicy.owners.length})`,
  );
  console.log(`  token:          ${tokenAddress} (${tokenContractName})`);
  console.log(`  symbol:         ${symbol}`);
  console.log(`  decimals:       ${decimals}`);
  console.log(`  rawBalance:     ${rawBalance}`);
  console.log(`  balance:        ${formattedBalance} ${symbol}`);
  console.log(`  rawTotalSupply: ${totalSupply}`);
  console.log(`  totalSupply:    ${formattedTotalSupply} ${symbol}`);

  return {
    deepFamilyAddress,
    timelockAddress,
    contractName,
    multisigAddress: roleState.currentMultisig,
    multisigPolicy,
    minDelay,
    tokenAddress,
    tokenContractName,
    symbol,
    decimals,
    rawBalance,
    formattedBalance,
    rawTotalSupply: totalSupply,
    formattedTotalSupply,
  };
};

export default task(
  "treasury-status",
  "Inspect the deployed DeepFamilyToken balance held by the governance timelock",
)
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
