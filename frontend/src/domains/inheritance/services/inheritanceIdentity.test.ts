import { IDENTITY_SUITE_CANDIDATE_1 } from "@deepfamily/protocol-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { IdentityFormHandle } from "../model/inheritanceTypes";
import { deriveIdentityFromForm } from "./inheritanceIdentity";

const mocks = vi.hoisted(() => ({ cryptoWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: mocks.cryptoWorkerCall,
}));

const publicIdentity = {
  fullName: "Ada Lovelace",
  gender: 2,
  birthYear: 1815,
  birthMonth: 12,
  birthDay: 10,
  isBirthBC: false,
};
const identityMaterial: IdentityMaterialV1Result = {
  identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
  identity: publicIdentity,
  derivedSecretField: "123",
  nameField: "456",
  packedBirthGenderField: "789",
  suiteCommitment: "12",
  nameSecretCommitment: "34",
  identityCommitment: "56",
  personHash: `0x${"12".repeat(32)}`,
};

function identityForm(passphrase: string, fullName = publicIdentity.fullName): IdentityFormHandle {
  return {
    getPublicFormData: vi.fn(() => ({ ...publicIdentity, fullName })),
    getSecretInputs: vi.fn(() => ({ passphrase })),
  };
}

describe("funding identity empty-passphrase protection", () => {
  beforeEach(() => {
    mocks.cryptoWorkerCall.mockReset();
    mocks.cryptoWorkerCall.mockResolvedValue(identityMaterial);
  });

  it.each([
    ["empty", "", "passphraseRequired"],
    ["ASCII spaces", "     ", "passphraseRequired"],
    ["Unicode spaces", "\u00a0\u2002\u2009\u202f\u3000", "passphraseRequired"],
    ["TAB control", "\t", "passphraseDisallowed"],
    ["invisible BOM", "Tr0ub4dor&3-\ufeffxkcd-horse", "passphraseDisallowed"],
    ["malformed Unicode", "\ud800", "passphraseDisallowed"],
  ])("rejects %s before invoking the crypto worker", async (_label, passphrase, code) => {
    await expect(deriveIdentityFromForm(identityForm(passphrase))).rejects.toMatchObject({
      name: "InheritanceError",
      code,
    });
    expect(mocks.cryptoWorkerCall).not.toHaveBeenCalled();
  });

  it.each([
    ["single character", "x"],
    ["common password", "password"],
    ["common password in fullwidth", "ｐａｓｓｗｏｒｄ"],
    ["long repeated characters", "A".repeat(32)],
    ["long repeating sequence", "Ab9!".repeat(5)],
    ["long digit sequence", "1234567890123456"],
    ["alphabet sequence", "abcdefghijklmnopqrstuvwxyz"],
    ["medium strength", "M7!kP2@vZ8#s"],
    ["strong ASCII", "Tr0ub4dor&3-xkcd-horse"],
    ["strong Chinese", "家族秘密要够长才安全一二三"],
  ])(
    "accepts a nonempty passphrase with %s and passes it unchanged",
    async (_label, rawPassphrase) => {
      const form = identityForm(rawPassphrase);
      await expect(deriveIdentityFromForm(form)).resolves.toBe(identityMaterial);
      expect(mocks.cryptoWorkerCall).toHaveBeenCalledExactlyOnceWith(
        "deriveIdentityMaterialV1",
        {
          identity: publicIdentity,
          rawPassphrase,
          identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
        },
        { timeoutMs: 240_000 },
      );
      expect(form.getSecretInputs).toHaveBeenCalledTimes(1);
    },
  );

  it("passes the original passphrase to the worker while canonicalizing the identity name", async () => {
    const rawPassphrase = "  Tr0ub4dor&3-xkcd-horse\u00a0a\u030a ";
    const form = identityForm(rawPassphrase, "\u3000Ａｄａ\u0085Lovelace\u00a0");

    await expect(deriveIdentityFromForm(form)).resolves.toBe(identityMaterial);
    expect(mocks.cryptoWorkerCall).toHaveBeenCalledExactlyOnceWith(
      "deriveIdentityMaterialV1",
      {
        identity: publicIdentity,
        rawPassphrase,
        identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
      },
      { timeoutMs: 240_000 },
    );
  });

  it("preserves the missing-name error without deriving a secret", async () => {
    await expect(deriveIdentityFromForm(null)).rejects.toMatchObject({ code: "nameRequired" });
    const form = identityForm("Tr0ub4dor&3-xkcd-horse", "\u3000\u00a0");
    await expect(deriveIdentityFromForm(form)).rejects.toMatchObject({ code: "nameRequired" });
    expect(form.getSecretInputs).not.toHaveBeenCalled();
    expect(mocks.cryptoWorkerCall).not.toHaveBeenCalled();
  });

  it("clears the input before a pending KDF starts and passes cancellation to the worker", async () => {
    let inputValue = "Tr0ub4dor&3-xkcd-horse";
    const controller = new AbortController();
    const form = {
      getPublicFormData: () => publicIdentity,
      getSecretInputs: vi.fn(() => ({ passphrase: inputValue })),
      clearSecretInputs: vi.fn(() => {
        inputValue = "";
      }),
    };
    let finish!: (value: IdentityMaterialV1Result) => void;
    mocks.cryptoWorkerCall.mockImplementationOnce((_method, params, options) => {
      expect(inputValue).toBe("");
      expect(params.rawPassphrase).toBe("Tr0ub4dor&3-xkcd-horse");
      expect(options.signal).toBe(controller.signal);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const derivation = deriveIdentityFromForm(form, { signal: controller.signal });
    expect(form.clearSecretInputs).toHaveBeenCalledOnce();
    expect(form.getSecretInputs).toHaveBeenCalledOnce();
    finish(identityMaterial);
    await expect(derivation).resolves.toBe(identityMaterial);
  });
});
