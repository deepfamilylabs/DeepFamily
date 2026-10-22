import { beforeEach, describe, expect, it, vi } from "vitest";
import { proveShieldedReceivePresentation } from "./shieldedReceivePresentation";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  prove: vi.fn(),
  link: vi.fn(),
  issuerKeys: { anonymous: { name: "anonymous issuer" }, fund: { name: "fund issuer" } },
  linkKeys: {} as Record<
    string,
    {
      verificationKey: { name: string };
      deltaG1: string[];
      issuerDeltaG1: string[];
    }
  >,
}));

vi.mock("@deepfamily/protocol-core", () => ({
  prepareReceivePresentationWitness: mocks.prepare,
  linkGroth16Proofs: mocks.link,
}));
vi.mock("./shieldedZk", () => ({
  generateShieldedProof: mocks.prove,
  SHIELDED_RECEIVE_CREDENTIAL_VERIFICATION_KEYS: mocks.issuerKeys,
  SHIELDED_RECEIVE_LINK_KEYS: mocks.linkKeys,
}));

const issuerProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
};
const operationProof = { ...issuerProof, pi_a: ["9", "10", "1"] };
const expected = Array.from({ length: 11 }, (_, index) => String(index + 1));
const witness = { authorizationAlias: "900", siblings: Array(64).fill("0") };

function prepare(kind = "anonymous") {
  const commonInputs = Array(kind === "fund" ? 12 : 11).fill("900");
  const publicInputs = kind === "attachment" ? [...expected, "12", "13", "14"] : [...expected];
  const circuit =
    kind === "attachment" ? "attachedReceivePresentation" : `${kind}ReceivePresentation`;
  const prepared = { witness, commonInputs, publicInputs, circuit };
  mocks.prepare.mockReturnValue(prepared);
  return prepared;
}

describe("local receive presentation linking", () => {
  beforeEach(() => {
    mocks.prepare.mockReset();
    mocks.prove.mockReset().mockResolvedValue({ proof: operationProof });
    mocks.link.mockReset().mockResolvedValue("0x1234");
    for (const kind of ["anonymous", "fund", "attachment"]) {
      mocks.linkKeys[kind] = {
        verificationKey: { name: `${kind} presentation` },
        deltaG1: ["15", "16", "1"],
        issuerDeltaG1: ["17", "18", "1"],
      };
    }
    prepare();
  });

  it.each(["anonymous", "fund", "attachment"])(
    "links %s against fixed issuer and presentation keys, keeping shared values private",
    async (kind) => {
      const prepared = prepare(kind);
      const request = { kind, credentialProof: issuerProof };
      await expect(
        proveShieldedReceivePresentation(request, prepared.publicInputs),
      ).resolves.toEqual({
        proof: "0x1234",
        publicSignals: prepared.publicInputs,
      });
      expect(mocks.prove).toHaveBeenCalledExactlyOnceWith({
        circuit: prepared.circuit,
        witness,
        expectedPublicSignals: [...prepared.commonInputs, ...prepared.publicInputs],
      });
      expect(mocks.link).toHaveBeenCalledExactlyOnceWith({
        issuer: {
          proof: issuerProof,
          verificationKey: mocks.issuerKeys[kind === "fund" ? "fund" : "anonymous"],
          deltaG1: mocks.linkKeys[kind].issuerDeltaG1,
        },
        presentation: {
          proof: operationProof,
          verificationKey: mocks.linkKeys[kind].verificationKey,
          deltaG1: mocks.linkKeys[kind].deltaG1,
        },
        commonInputs: prepared.commonInputs,
        publicInputs: prepared.publicInputs,
      });
    },
  );

  it.each(["changed transaction", "missing transaction value", "wrong disclosure"])(
    "rejects %s before generating a proof",
    async (attack) => {
      const prepared = prepare();
      if (attack === "wrong disclosure") prepared.circuit = "fundReceivePresentation";
      else if (attack === "missing transaction value") prepared.publicInputs.pop();
      else prepared.publicInputs[5] = "999";
      await expect(
        proveShieldedReceivePresentation(
          { kind: "anonymous", credentialProof: issuerProof },
          expected,
        ),
      ).rejects.toThrow("does not match the authenticated transaction");
      expect(mocks.prove).not.toHaveBeenCalled();
      expect(mocks.link).not.toHaveBeenCalled();
    },
  );

  it("rejects missing pinned keys without fetching an alternative verifier", async () => {
    delete mocks.linkKeys.anonymous;
    await expect(
      proveShieldedReceivePresentation(
        { kind: "anonymous", credentialProof: issuerProof },
        expected,
      ),
    ).rejects.toThrow("keys are missing");
    expect(mocks.prove).not.toHaveBeenCalled();
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("does not return a transaction proof when linking verification fails", async () => {
    mocks.link.mockRejectedValue(new Error("Credential proof failed verification"));
    await expect(
      proveShieldedReceivePresentation(
        { kind: "anonymous", credentialProof: issuerProof },
        expected,
      ),
    ).rejects.toThrow("Credential proof failed verification");
  });

  it("rejects unknown circuits before preparing private input", async () => {
    await expect(proveShieldedReceivePresentation({ kind: "other" }, expected)).rejects.toThrow(
      "Unsupported receive proof kind",
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
