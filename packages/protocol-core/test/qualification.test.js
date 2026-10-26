import test from "node:test";
import assert from "node:assert/strict";
import { getBytes } from "ethers";
import {
  createWalletState,
  normalizeWalletState,
  encryptWalletBackup,
  decryptWalletBackup,
  computeIdentityFromDerivedSecret,
  encodeQualificationRequest,
  decodeQualificationRequest,
  qualificationHandoffPublicKey,
  encryptQualificationPackage,
  decryptQualificationPackage,
} from "../index.js";

const chainId = 31337n,
  authorizerScope = "0x0000000000000000000000000000000000001234";
const sourceAddress = "0x0000000000000000000000000000000000005678";
const endorser = "0x0000000000000000000000000000000000001111";
const identity = {
  fields: {
    fullName: "Qualification Subject",
    birthYear: 2000,
    birthMonth: 5,
    birthDay: 17,
    isBirthBC: false,
    gender: 1,
  },
  identitySuiteId: 1,
};
async function fixture() {
  const wallet = await createWalletState({
    chainId,
    authorizerScope,
    masterKey: new Uint8Array(32).fill(17),
    codeRootSecret: 111n,
    identity,
  });
  const nonce = "0x" + "21".repeat(32);
  const child = computeIdentityFromDerivedSecret({
    identity: identity.fields,
    identitySuiteId: 1,
    derivedSecretField: wallet.codeRootSecret,
  });
  const request = encodeQualificationRequest({
    chainId,
    registryAddress: authorizerScope,
    sourceAddress,
    childIdentity: child.identityCommitment,
    parentIdentity: 123456n,
    parentVersion: 1n,
    endorser,
    nonce,
    recipientPublicKey: await qualificationHandoffPublicKey({ ...wallet, nonce }),
  });
  const source = {
    kind: "fact",
    sourceAddress,
    controller: endorser,
    leafIndex: "5",
    xChild: "123",
    xEndorse: "456",
    xTrust: "0",
    sourceFactSalt: "789",
    sourceTrustSalt: "0",
    familySalt: "0",
  };
  return { wallet, request, source };
}

test("qualification request is canonical, public and independently bound to the recipient handoff key", async () => {
  const { wallet, request } = await fixture();
  assert.deepEqual(decodeQualificationRequest(request.request), request);
  assert.equal(
    request.childPersonHash,
    computeIdentityFromDerivedSecret({
      identity: identity.fields,
      identitySuiteId: 1,
      derivedSecretField: wallet.codeRootSecret,
    }).personHash,
  );
  assert.equal(request.parentPersonHash.length, 66);
  const changed = encodeQualificationRequest({ ...request, nonce: "0x" + "22".repeat(32) });
  assert.notEqual(changed.requestId, request.requestId);
  assert.notEqual(
    await qualificationHandoffPublicKey({ ...wallet, nonce: changed.nonce }),
    request.recipientPublicKey,
  );
  assert.throws(() => decodeQualificationRequest(request.request + "="), /encoding/u);
  assert.throws(() => decodeQualificationRequest(request.request.slice(0, -1)), /request/u);
});

test("real HPKE source handoff rejects tampering, another request, another wallet and another deployment", async () => {
  const { wallet, request, source } = await fixture();
  const encrypted = await encryptQualificationPackage({ request: request.request, source });
  assert.equal(encrypted.length, 549);
  assert.deepEqual(
    await decryptQualificationPackage({ wallet, request: request.request, package: encrypted }),
    source,
  );
  for (const offset of [0, 7, 39, encrypted.length - 1]) {
    const tampered = encrypted.slice();
    tampered[offset] ^= 1;
    await assert.rejects(() =>
      decryptQualificationPackage({ wallet, request: request.request, package: tampered }),
    );
  }
  const other = await createWalletState({
    chainId,
    authorizerScope,
    masterKey: new Uint8Array(32).fill(18),
    codeRootSecret: 111n,
  });
  await assert.rejects(
    () =>
      decryptQualificationPackage({ wallet: other, request: request.request, package: encrypted }),
    /another wallet/u,
  );
  const differentRequest = encodeQualificationRequest({
    ...request,
    nonce: "0x" + "23".repeat(32),
  });
  await assert.rejects(
    () =>
      decryptQualificationPackage({
        wallet,
        request: differentRequest.request,
        package: encrypted,
      }),
    /another request/u,
  );
  await assert.rejects(
    () =>
      decryptQualificationPackage({
        wallet: { ...wallet, chainId: 1n },
        request: request.request,
        package: encrypted,
      }),
    /scope/u,
  );
  await assert.rejects(
    () =>
      encryptQualificationPackage({
        request: request.request,
        source: { ...source, sourceAddress: "0x0000000000000000000000000000000000009999" },
      }),
    /source mismatch/u,
  );
  assert.equal(new TextDecoder().decode(encrypted).includes(identity.fields.fullName), false);
});

test("encrypted wallet backup persists identity, pending source openings and family salts without changing spending material", async () => {
  const { wallet, request, source } = await fixture();
  const candidate = normalizeWalletState({
    ...wallet,
    qualification: {
      requests: [
        {
          id: request.requestId,
          request: request.request,
          fact: source,
          trust: null,
          issue: null,
          credentialIndex: null,
        },
      ],
      sources: [
        {
          ...source,
          id: "0x" + "55".repeat(32),
          request: request.request,
          publication: { leafIndex: "5", transactionHash: null },
        },
      ],
      families: [
        {
          parentIdentity: request.parentIdentity,
          parentVersion: request.parentVersion,
          familySalt: "987654321",
        },
      ],
    },
  });
  const backup = await encryptWalletBackup({
    wallet: candidate,
    rawPassphrase: "qualification backup password",
  });
  const restored = await decryptWalletBackup({
    backup,
    rawPassphrase: "qualification backup password",
    chainId,
    authorizerScope,
  });
  assert.deepEqual(restored, candidate);
  assert.deepEqual(restored.masterKey, wallet.masterKey);
  assert.equal(restored.codeRootSecret, wallet.codeRootSecret);
  assert.equal(restored.nextCodeIndex, wallet.nextCodeIndex);
  assert.deepEqual(restored.identity, identity);
  assert.equal(restored.qualification.families[0].familySalt, "987654321");
  assert.equal(new TextDecoder().decode(backup).includes(identity.fields.fullName), false);
  assert.throws(
    () => normalizeWalletState({ ...candidate, codeRootSecret: 112n }),
    /wallet identity/u,
  );
  const foreign = encodeQualificationRequest({ ...request, chainId: 1n });
  assert.throws(
    () =>
      normalizeWalletState({
        ...wallet,
        qualification: {
          requests: [],
          families: [],
          sources: [
            { ...source, id: "0x" + "55".repeat(32), request: foreign.request, publication: null },
          ],
        },
      }),
    /wallet registry/u,
  );
  assert.equal(getBytes(backup).length > 64, true);
});
