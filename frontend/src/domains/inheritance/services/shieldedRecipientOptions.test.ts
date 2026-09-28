import { describe, expect, it } from "vitest";
import type { NodeData } from "../../../shared/model";
import {
  getShieldedLocalRecipientLabels,
  validateShieldedRecipientSelection,
  type ShieldedRecipientOption,
} from "./shieldedRecipientOptions";

const child = `0x${"aa".repeat(32)}`;
const other = `0x${"bb".repeat(32)}`;
const options: ShieldedRecipientOption[] = [
  { personHash: child, label: "Child", registered: true, eligible: true },
  { personHash: other, registered: false, eligible: false },
];

describe("shielded recipient selection", () => {
  it("uses only public minted names and validated unlocked names", () => {
    const nodes = {
      minted: {
        id: "minted",
        personHash: child,
        versionIndex: 1,
        tokenId: "1",
        fullName: " Child ",
      },
      stalePrivate: {
        id: "stale",
        personHash: other,
        versionIndex: 1,
        fullName: "Hidden",
        metadataUnlockValidated: false,
      },
    } as Record<string, NodeData>;
    const labels = getShieldedLocalRecipientLabels(nodes);
    expect(labels.get(child)).toBe("Child");
    expect(labels.has(other)).toBe(false);
  });

  it("requires full hashes, current child eligibility, and receiving registration", () => {
    expect(
      validateShieldedRecipientSelection({ kind: "child", value: child, options, loading: false }),
    ).toBeUndefined();
    expect(
      validateShieldedRecipientSelection({ kind: "child", value: other, options, loading: false }),
    ).toBe("notEligibleChild");
    expect(
      validateShieldedRecipientSelection({
        kind: "recipient",
        value: other,
        options,
        loading: false,
      }),
    ).toBe("notRegistered");
    expect(
      validateShieldedRecipientSelection({
        kind: "recipient",
        value: child.slice(0, 20),
        options,
        loading: false,
      }),
    ).toBe("invalidHash");
    expect(
      validateShieldedRecipientSelection({ kind: "child", value: child, options, loading: true }),
    ).toBe("loading");
  });
});
