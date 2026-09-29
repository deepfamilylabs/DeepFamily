import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SNARK_SCALAR_FIELD,
  computeIdentityFromDerivedSecret,
  computeShieldedRegistrationSalt,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import {
  deriveShieldedRecipientMaterial,
  encodeShieldedReceiveCode,
  parseShieldedReceiveCode,
  resolveShieldedRecipientMaterial,
} from "./shieldedReceiveCode";

const mocks = vi.hoisted(() => ({ cryptoWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/cryptoWorkerClient", () => ({
  cryptoWorkerCall: mocks.cryptoWorkerCall,
}));

const registryAddress = "0x1111111111111111111111111111111111111111";
const chainId = 1030n;
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
const registrationSalt = computeShieldedRegistrationSalt({
  derivedSecretField: fixture.derivedSecretField,
  identityCommitment: fixture.identityCommitment,
  chainId,
  registryAddress,
});

beforeEach(() => {
  mocks.cryptoWorkerCall.mockReset();
});

describe("private shielded recipient material", () => {
  it("round trips the receive code without a public identity lookup", () => {
    const code = encodeShieldedReceiveCode(19n, 23n);
    const expected = {
      identityCommitment: 19n,
      registrationSalt: 23n,
      personHash: wrapIdentityCommitmentAsPersonHash(19n),
    };
    expect(parseShieldedReceiveCode(code)).toEqual(expected);
    expect(resolveShieldedRecipientMaterial({ kind: "receiveCode", code })).toEqual(expected);
  });

  it("rejects malformed or out-of-field receive codes", () => {
    expect(() => parseShieldedReceiveCode("0x1234")).toThrow("format");
    expect(() => encodeShieldedReceiveCode(0n, 23n)).toThrow("identity");
    expect(() => encodeShieldedReceiveCode(19n, SNARK_SCALAR_FIELD)).toThrow("salt");
  });

  it("uses the dedicated worker and returns only narrow recipient material", async () => {
    mocks.cryptoWorkerCall.mockResolvedValueOnce({
      identityCommitment: String(fixture.identityCommitment),
      registrationSalt: String(registrationSalt),
      personHash: fixture.personHash,
    });
    const rawPassphrase = "child secret for this test";
    const direct = await deriveShieldedRecipientMaterial({
      identity,
      rawPassphrase,
      chainId,
      registryAddress,
    });
    const fromCode = parseShieldedReceiveCode(
      encodeShieldedReceiveCode(fixture.identityCommitment, registrationSalt),
    );

    expect(mocks.cryptoWorkerCall).toHaveBeenCalledWith(
      "deriveShieldedRecipientMaterial",
      { identity, rawPassphrase, chainId, registryAddress },
      { timeoutMs: 240_000 },
    );
    expect(direct).toEqual(fromCode);
    expect(Object.keys(direct).sort()).toEqual([
      "identityCommitment",
      "personHash",
      "registrationSalt",
    ]);
  });

  it("rejects forged narrow worker output", async () => {
    mocks.cryptoWorkerCall.mockResolvedValueOnce({
      identityCommitment: String(fixture.identityCommitment),
      registrationSalt: String(registrationSalt),
      personHash: `0x${"ab".repeat(32)}`,
    });
    await expect(deriveShieldedRecipientMaterial({
      identity,
      rawPassphrase: "secret",
      chainId,
      registryAddress,
    })).rejects.toThrow("invalid");

    expect(() => resolveShieldedRecipientMaterial({
      kind: "derivedRecipient",
      material: {
        identityCommitment: fixture.identityCommitment,
        registrationSalt: 0n,
        personHash: fixture.personHash,
      },
    })).toThrow("invalid");
  });
});
