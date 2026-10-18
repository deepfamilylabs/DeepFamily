import { getBigInt, type BigNumberish, type Contract } from "ethers";

/** Public-wallet funds and pool allowance are separate prerequisites for a deposit. */
export class ShieldedDepositBalanceError extends Error {
  readonly balance: bigint;
  readonly amount: bigint;

  constructor(balance: bigint, amount: bigint) {
    super("ERC20 deposit wallet balance is insufficient");
    this.name = "ShieldedDepositBalanceError";
    this.balance = balance;
    this.amount = amount;
  }
}

export async function assertShieldedDepositBalance(
  token: Contract,
  account: string,
  amount: BigNumberish,
): Promise<void> {
  const required = getBigInt(amount);
  if (required <= 0n) throw new Error("Deposit amount must be positive");
  const balance = getBigInt(await token.balanceOf(account));
  if (balance < required) throw new ShieldedDepositBalanceError(balance, required);
}
