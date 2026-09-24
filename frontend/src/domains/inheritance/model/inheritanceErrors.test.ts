import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import { ProtocolError } from "@deepfamily/protocol-core";
import FamilyInheritance from "../../../abi/FamilyInheritance.json";
import { InheritanceError, toInheritanceFriendlyError } from "./inheritanceErrors";

const t = ((key: string, fallback?: string) => fallback ?? key) as any;

describe("toInheritanceFriendlyError", () => {
  it("explains the flow's own failures under inheritance.errors", () => {
    const friendly = toInheritanceFriendlyError(new InheritanceError("notLegitHeir"), t);
    expect(friendly.type).toBe("notLegitHeir");
    expect(friendly.message).toBe("inheritance.errors.notLegitHeir");
    expect(friendly.retryable).toBe(false);
    expect(toInheritanceFriendlyError(new InheritanceError("snapshotMismatch"), t).retryable).toBe(
      true,
    );
  });

  it("maps witness checks from protocol-core to the same explanations", () => {
    const early = new ProtocolError("INHERITANCE_NOT_YET_ELIGIBLE", "not yet");
    expect(toInheritanceFriendlyError(early, t).message).toBe("inheritance.errors.notEligibleYet");
    const mismatch = new ProtocolError("LINEAGE_LEAF_MISMATCH", "leaf");
    expect(toInheritanceFriendlyError(mismatch, t).type).toBe("snapshotMismatch");
  });

  it("decodes FamilyInheritance custom errors through the contract interface", () => {
    const contract = { interface: new ethers.Interface(FamilyInheritance.abi) };
    const data = contract.interface.encodeErrorResult("NothingToClaim", []);
    const friendly = toInheritanceFriendlyError(
      { code: "CALL_EXCEPTION", data, message: "execution reverted" },
      t,
      contract,
    );
    expect(friendly.reason).toBe("NothingToClaim");
    expect(friendly.message).toBe("Nothing is claimable right now.");
  });
});
