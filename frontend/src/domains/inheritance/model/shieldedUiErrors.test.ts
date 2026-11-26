import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import { getAddress } from "ethers";
import { restoreChainError, serializeChainError } from "@deepfamily/chain-client";
import { normalizeShieldedUiError } from "./shieldedUiErrors";
import { InheritanceError } from "./inheritanceErrors";
import { PUBLIC_TREE_RECIPIENT_MESSAGE } from "../services/shieldedPublicTreeIdentity";
import { SHIELDED_PERIODS_BEYOND_TIME_LIMIT_MESSAGE } from "./shieldedBudgetPeriod";

const t = ((key: string) => key) as TFunction;
describe("shielded error presentation", () => {
  it.each(["bad", "0x8Ba1f109551bD432803012645Ac136ddd64DBA72"])("does not treat a generic invalid address as a withdrawal error: %s", (address) => {
    let cause: unknown;
    try {
      getAddress(address);
    } catch (error) {
      cause = error;
    }
    expect(cause).toBeDefined();
    const error = normalizeShieldedUiError(cause, t);
    expect(error.message).not.toBe("shielded.invalidExitRecipient");
    expect(error.details).toContain("address");
  });
  it.each([
    "Choose a public withdrawal destination.",
    "Unshield recipient must be nonzero",
    "Unshield recipient must not be the pool",
  ])("still localizes an explicit withdrawal validation: %s", (message) => {
    expect(normalizeShieldedUiError(new Error(message), t).message).toBe("shielded.invalidExitRecipient");
  });
  it("localizes expected validation and expired previews", () => {
    expect(normalizeShieldedUiError(new InheritanceError("periodDaysInvalid"), t).message).toBe("shielded.periodDaysInvalid");
    expect(normalizeShieldedUiError(new Error("The proof expired before submission. Prepare and confirm a fresh preview."), t).message).toBe("shielded.walletKeys.reviewAgain");
  });
  it.each([
    [PUBLIC_TREE_RECIPIENT_MESSAGE, "shielded.publicTreeRecipient"],
    [SHIELDED_PERIODS_BEYOND_TIME_LIMIT_MESSAGE, "shielded.periodsBeyondTimeLimit"],
  ])("localizes a funding refusal across the asset Worker boundary: %s", (message, key) => {
    const refused = restoreChainError(serializeChainError(new Error(message), message));
    expect(normalizeShieldedUiError(refused, t).message).toBe(key);
  });
  it("keeps unknown diagnostics out of the main instruction", () => {
    const error = normalizeShieldedUiError(new Error("Unexpected low-level configuration value"), t);
    expect(error.message).toBe("shielded.unknownError");
    expect(error.details).toContain("Unexpected low-level configuration value");
  });
  it("retains transaction context with an explicit refresh instruction", () => {
    const error = Object.assign(new Error("readback unavailable"), { transactionHash: "0xconfirmed", transactionConfirmed: true });
    expect(normalizeShieldedUiError(error, t, { message: "refresh balances" })).toMatchObject({ message: "refresh balances", transactionHash: "0xconfirmed", transactionConfirmed: true });
  });
});
