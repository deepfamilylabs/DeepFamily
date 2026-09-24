import { describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import { INHERITANCE_PERIOD_SECONDS } from "@deepfamily/protocol-core";
import FamilyInheritance from "../../../abi/FamilyInheritance.json";
import { InheritanceError } from "../model/inheritanceErrors";
import {
  assertWalletChain,
  createInheritanceFlow,
  depositFlow,
  summarizeClaim,
} from "./inheritanceFlows";

const PERIOD = INHERITANCE_PERIOD_SECONDS;
const START = 1_700_000_000n;

describe("summarizeClaim", () => {
  const row = { startTime: START, amountPerPeriod: 100n, balance: 1_000n, claimed: 0n };

  it("opens one full period after the endorsement, on the inheritance's period grid", () => {
    const writtenAt = START + 10n;
    const summary = summarizeClaim(row, writtenAt, START + PERIOD);
    expect(summary.eligibleFrom).toBe(START + 2n * PERIOD);
    expect(summary.ready).toBe(false);
    expect(summary.claimable).toBe(0n);
  });

  it("accrues every started period and subtracts what was already claimed", () => {
    const writtenAt = START - PERIOD;
    const now = START + 2n * PERIOD + 5n;
    expect(summarizeClaim(row, writtenAt, now)).toEqual({
      eligibleFrom: START,
      ready: true,
      owed: 300n,
      claimable: 300n,
    });
    expect(summarizeClaim({ ...row, claimed: 250n }, writtenAt, now).owed).toBe(50n);
  });

  it("caps the payout at the balance and keeps the rest owed", () => {
    const summary = summarizeClaim({ ...row, balance: 120n }, START - PERIOD, START + 2n * PERIOD);
    expect(summary.owed).toBe(300n);
    expect(summary.claimable).toBe(120n);
  });
});

function inheritanceStub(eventName: string, args: unknown[]) {
  const iface = new ethers.Interface(FamilyInheritance.abi);
  const event = iface.getEvent(eventName)!;
  const encoded = iface.encodeEventLog(event, args);
  const tx = { hash: "0xhash", wait: vi.fn(async () => ({ logs: [encoded] })) };
  return {
    interface: iface,
    getAddress: vi.fn(async () => "0x00000000000000000000000000000000000000aa"),
    createInheritance: vi.fn(async () => tx),
    deposit: vi.fn(async () => tx),
  };
}

function tokenStub(allowance: bigint) {
  return {
    allowance: vi.fn(async () => allowance),
    approve: vi.fn(async () => ({ wait: vi.fn(async () => undefined) })),
  };
}

describe("funding flows", () => {
  const owner = "0x00000000000000000000000000000000000000bb";

  it("approves exactly the deposit when the allowance falls short, then creates", async () => {
    const inheritance = inheritanceStub("InheritanceCreated", [7n, 11n, owner, START, 5n, 50n]);
    const token = tokenStub(10n);
    const stages: string[] = [];
    const result = await createInheritanceFlow({
      inheritance: inheritance as any,
      token,
      owner,
      amount: 50n,
      credential: 11n,
      amountPerPeriod: 5n,
      onStage: (stage) => stages.push(stage),
    });
    expect(token.approve).toHaveBeenCalledWith("0x00000000000000000000000000000000000000aa", 50n);
    expect(inheritance.createInheritance).toHaveBeenCalledWith(11n, 5n, 50n);
    expect(stages).toEqual(["approving", "submitting"]);
    expect(result).toEqual({ id: 7n, transactionHash: "0xhash" });
  });

  it("skips the approval when the allowance already covers the deposit", async () => {
    const inheritance = inheritanceStub("InheritanceDeposited", [7n, owner, 50n]);
    const token = tokenStub(50n);
    const stages: string[] = [];
    await depositFlow({
      inheritance: inheritance as any,
      token,
      owner,
      amount: 50n,
      id: 7n,
      onStage: (stage) => stages.push(stage),
    });
    expect(token.approve).not.toHaveBeenCalled();
    expect(inheritance.deposit).toHaveBeenCalledWith(7n, 50n);
    expect(stages).toEqual(["submitting"]);
  });

  it("refuses to send from a wallet on another chain", async () => {
    const signer = { provider: { getNetwork: async () => ({ chainId: 1n }) } };
    await expect(assertWalletChain(signer as any, 1030)).rejects.toBeInstanceOf(InheritanceError);
    await expect(assertWalletChain(signer as any, 1)).resolves.toBeUndefined();
  });
});
