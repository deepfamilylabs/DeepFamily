import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeIdentityFromDerivedSecret,
  encodeShieldedReceiveCredential,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import {
  ShieldedReceiveCodeError,
  createShieldedReceiveCodeForRecipient,
  peekShieldedReceiveCodePersonHash,
  verifyShieldedReceiveCode,
} from "./shieldedReceiveCode";

const mocks = vi.hoisted(() => ({ zkWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/zkWorkerClient", () => ({
  zkWorkerCall: mocks.zkWorkerCall,
}));

const identity = {
  fullName: "Child Example",
  gender: 1,
  birthYear: 2001,
  birthMonth: 4,
  birthDay: 9,
  isBirthBC: false,
};
const fixture = computeIdentityFromDerivedSecret({
  identity,
  identitySuiteId: 1,
  derivedSecretField: 13n,
});
const receiveContext = { rpcUrl: "http://localhost:8545", chainId: "31337", factoryAddress: "0x1111111111111111111111111111111111111111" };
const receiveOptions = { context: receiveContext, expiresAt: "2000000000" };
const personHash = wrapIdentityCommitmentAsPersonHash(fixture.identityCommitment);
const viewingKey = `0x${"42".repeat(32)}`;
// Decoding only needs canonical proof coordinates; the worker verifies the proof.
const code = encodeShieldedReceiveCredential({
  disclosure: "fund", authorizationAlias: 17n, authorizationCounter: 0n, expiresAt: 2_000_000_000n, keyMode: 0, identitySuiteId: 1,
  identityCommitment: fixture.identityCommitment,
  ownerCommitment: 29n,
  viewingKey,
  proof: {
    protocol: "groth16", curve: "bn128",
    pi_a: ["1", "2", "1"],
    pi_b: [
      ["3", "4"],
      ["5", "6"],
      ["1", "0"],
    ],
    pi_c: ["7", "8", "1"],
  },
});

beforeEach(() => {
  mocks.zkWorkerCall.mockReset();
});

describe("shielded receive codes", () => {
  it("returns payment keys only after the worker verifies the code", async () => {
    mocks.zkWorkerCall.mockResolvedValueOnce({
      ok: true,
      identityCommitment: fixture.identityCommitment.toString(),
      ownerCommitment: "29",
      viewingKey,
      personHash,
    });
    const recipient = await verifyShieldedReceiveCode(code);
    expect(mocks.zkWorkerCall).toHaveBeenCalledWith(
      "verifyShieldedReceiveCode",
      { code },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(recipient).toEqual({
      identityCommitment: fixture.identityCommitment,
      ownerCommitment: 29n,
      viewingKey,
      personHash,
    });
  });

  it("separates copying mistakes, tampering and an inconsistent identity", async () => {
    mocks.zkWorkerCall.mockResolvedValueOnce({ ok: false, reason: "malformed" });
    await expect(verifyShieldedReceiveCode("dfrecv1q")).rejects.toMatchObject({
      name: "ShieldedReceiveCodeError",
      reason: "malformed",
    });
    mocks.zkWorkerCall.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    await expect(verifyShieldedReceiveCode(code)).rejects.toBeInstanceOf(ShieldedReceiveCodeError);
    mocks.zkWorkerCall.mockResolvedValueOnce({
      ok: true,
      identityCommitment: fixture.identityCommitment.toString(),
      ownerCommitment: "29",
      viewingKey,
      personHash: wrapIdentityCommitmentAsPersonHash(fixture.identityCommitment + 1n),
    });
    await expect(verifyShieldedReceiveCode(code)).rejects.toMatchObject({ reason: "invalid" });
  });

  it("previews the named person without verifying the proof", () => {
    expect(peekShieldedReceiveCodePersonHash(code)).toBe(personHash);
    expect(peekShieldedReceiveCodePersonHash(`  ${code}\n`)).toBe(personHash);
    expect(peekShieldedReceiveCodePersonHash("")).toBeNull();
    expect(peekShieldedReceiveCodePersonHash(code.slice(0, -1))).toBeNull();
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });

  it("returns only the code when creating one from a recipient's credentials", async () => {
    const rawPassphrase = "  Tr0ub4dor&3-xkcd-horse\u00a0a\u030a ";
    mocks.zkWorkerCall.mockResolvedValueOnce({ code, personHash });
    await expect(createShieldedReceiveCodeForRecipient({ identity, rawPassphrase, ...receiveOptions })).resolves.toBe(
      code,
    );
    expect(mocks.zkWorkerCall).toHaveBeenCalledWith(
      "createShieldedReceiveCodeFromCredentials",
      { identity, rawPassphrase, ...receiveOptions },
      expect.any(Object),
    );
  });

  it.each([
    ["empty", "", "passphraseRequired"],
    ["ASCII spaces", "   ", "passphraseRequired"],
    ["Unicode spaces", "\u00a0\u3000", "passphraseRequired"],
    ["control character", "\t", "passphraseDisallowed"],
  ])(
    "rejects recipient credentials with %s before invoking the ZK worker",
    async (_label, rawPassphrase, code) => {
      await expect(
        createShieldedReceiveCodeForRecipient({ identity, rawPassphrase, ...receiveOptions }),
      ).rejects.toMatchObject({ name: "InheritanceError", code });
      expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["weak", "password"],
    ["medium", "M7!kP2@vZ8#s"],
    ["repeated", "A".repeat(32)],
    ["sequential", "1234567890123456"],
    ["strong Chinese", "家族秘密要够长才安全一二三"],
  ])(
    "allows %s nonempty recipient credentials without changing the passphrase",
    async (_label, rawPassphrase) => {
      mocks.zkWorkerCall.mockResolvedValueOnce({ code, personHash });
      await expect(
        createShieldedReceiveCodeForRecipient({ identity, rawPassphrase, ...receiveOptions }),
      ).resolves.toBe(code);
      expect(mocks.zkWorkerCall).toHaveBeenCalledExactlyOnceWith(
        "createShieldedReceiveCodeFromCredentials",
        { identity, rawPassphrase, ...receiveOptions },
        expect.any(Object),
      );
    },
  );
});
