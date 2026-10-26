import test from "node:test";
import assert from "node:assert/strict";
import { poseidon3, poseidon5, poseidon7 } from "poseidon-lite";
import {
  createWalletState,
  normalizeWalletState,
  allocateWalletCode,
  encryptWalletBackup,
  decryptWalletBackup,
  recoverWalletNotes,
} from "../wallet.js";
import { deriveReceiveKeyMaterial } from "../receive-code.js";
import { encryptShieldedNote } from "../shielded-hpke.js";
import { encodeShieldedValueNotePayload } from "../shielded-note-codec.js";
import {
  computeShieldedCiphertextHashField,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
} from "../shielded-inheritance.js";
import { encodeBudgetNotePayload, computeBudgetNoteCommitment } from "../budget.js";

const chainId = 31337n,
  authorizerScope = 0x1111111111111111111111111111111111111111n;
const scope = { chainId, poolAddress: "0x2222222222222222222222222222222222222222" };
const passphrase = "private wallet backup phrase with enough entropy for tests";
const makeWallet = () =>
  createWalletState({
    chainId,
    authorizerScope,
    masterKey: new Uint8Array(32).fill(23),
    codeRootSecret: 34567n,
    nextCodeIndex: 3n,
  });
function credential(wallet) {
  const c = {
    issueNonce: 17n,
    familyRoot: 19n,
    endorser: 23n,
    parentVersion: 1n,
    xChild: 29n,
    xEndorse: 31n,
    xTrust: 37n,
    credentialSalt: 41n,
    credentialIndex: 0n,
  };
  const u = poseidon3([73204n, wallet.codeRootSecret, c.issueNonce]);
  c.credentialCommitment = poseidon5([
    73400n,
    poseidon7([73101n, u, c.familyRoot, c.endorser, c.parentVersion, c.xChild, c.xEndorse]),
    poseidon5([73102n, c.familyRoot, c.endorser, c.parentVersion, c.xTrust]),
    c.credentialSalt,
    poseidon3([74000n, chainId, authorizerScope]),
  ]);
  return c;
}
test("private index allocation preserves previous backups and validates qualified subject openings", async () => {
  const wallet = await makeWallet();
  const allocated = allocateWalletCode(wallet);
  assert.equal(wallet.nextCodeIndex, 3n);
  assert.equal(allocated.codeIndex, 3n);
  assert.equal(allocated.state.nextCodeIndex, 4n);
  wallet.credentials = [credential(wallet)];
  assert.deepEqual(normalizeWalletState(wallet).credentials, wallet.credentials);
  assert.throws(
    () => normalizeWalletState({ ...wallet, codeRootSecret: wallet.codeRootSecret + 1n }),
    /subject and registry/u,
  );
  assert.throws(
    () =>
      normalizeWalletState({
        ...wallet,
        credentials: [...wallet.credentials, ...wallet.credentials],
      }),
    /Duplicate/u,
  );
});
test("encrypted backup restores keys, code indices, credentials and controller revocations", async () => {
  const wallet = await makeWallet();
  wallet.credentials = [credential(wallet)];
  wallet.revocationRoles = [{ role: 2, secret: 918273645n }];
  const backup = await encryptWalletBackup({ wallet, rawPassphrase: passphrase });
  const other = await encryptWalletBackup({ wallet, rawPassphrase: passphrase });
  assert.notDeepEqual(backup, other);
  const opened = await decryptWalletBackup({
    backup,
    rawPassphrase: passphrase,
    chainId,
    authorizerScope,
  });
  assert.deepEqual(opened, wallet);
  const before = await deriveReceiveKeyMaterial({ ...wallet, codeIndex: 2n });
  const after = await deriveReceiveKeyMaterial({ ...opened, codeIndex: 2n });
  assert.deepEqual(before, after);
  assert.ok(!new TextDecoder().decode(backup).includes("918273645"));
  await assert.rejects(decryptWalletBackup({ backup, rawPassphrase: passphrase + "wrong" }));
  const changed = backup.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(decryptWalletBackup({ backup: changed, rawPassphrase: passphrase }));
  const header = backup.slice();
  header[12] ^= 1;
  await assert.rejects(decryptWalletBackup({ backup: header, rawPassphrase: passphrase }));
  await assert.rejects(
    decryptWalletBackup({ backup, rawPassphrase: passphrase, chainId: 1n }),
    /another chain/u,
  );
});
test("restored branches recover real encrypted money and budget notes and filter spent or forged entries", async () => {
  const wallet = await makeWallet(),
    events = [];
  for (const index of [0n, 2n]) {
    const key = await deriveReceiveKeyMaterial({ ...wallet, codeIndex: index });
    const note = {
      ownerCommitment: key.ownerCommitment,
      amount: 100n + index,
      nonce: 500n + index,
    };
    const ciphertext = await encryptShieldedNote({
      ...scope,
      recipientPublicKey: key.viewingKey,
      payload: encodeShieldedValueNotePayload(note, scope),
    });
    events.push({
      commitment: computeShieldedValueNoteCommitment(
        { ...note, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
        scope,
      ),
      ciphertext,
      shardId: 0n,
      leafIndex: index,
    });
  }
  const key = await deriveReceiveKeyMaterial({ ...wallet, codeIndex: 1n });
  const budget = {
    familyCommitment: 101n,
    parentVersion: 1n,
    rate: 5n,
    periodDays: 30n,
    policySalt: 103n,
    allocationKeyCommitment: 107n,
    codeAlias: (await import("poseidon-lite")).poseidon4([
      73103n,
      wallet.codeRootSecret,
      key.nonce,
      key.codeSecret,
    ]),
    codeNonce: key.nonce,
    ownerCommitment: key.ownerCommitment,
    viewingKey: key.viewingKey,
    eligibleFrom: 1_800_000_000n,
    remaining: 15n,
    nonce: 601n,
  };
  const ciphertext = await encryptShieldedNote({
    ...scope,
    recipientPublicKey: key.viewingKey,
    payload: encodeBudgetNotePayload(budget, scope),
  });
  events.push({
    commitment: computeBudgetNoteCommitment(
      { ...budget, ciphertextHashField: computeShieldedCiphertextHashField(ciphertext) },
      scope,
    ),
    ciphertext,
    shardId: 0n,
    leafIndex: 3n,
  });
  const restored = await decryptWalletBackup({
    backup: await encryptWalletBackup({ wallet, rawPassphrase: passphrase }),
    rawPassphrase: passphrase,
  });
  const firstKey = await deriveReceiveKeyMaterial({ ...wallet, codeIndex: 0n });
  const spent = [
    computeShieldedSpendNullifier(
      { ownerSecret: firstKey.ownerSecret, noteCommitment: events[0].commitment },
      scope,
    ),
  ];
  const recovered = await recoverWalletNotes(
    {
      wallet: restored,
      events: [...events, events[1], { ...events[0], commitment: 1n }],
      spentNullifiers: spent,
    },
    scope,
  );
  assert.equal(recovered.length, 2);
  assert.deepEqual(
    recovered.map((item) => [item.kind, item.codeIndex]),
    [
      ["budget", 1n],
      ["value", 2n],
    ],
  );
  assert.equal(recovered[0].note.remaining, 15n);
  assert.equal(recovered[1].note.amount, 102n);
  assert.equal(
    (
      await recoverWalletNotes(
        { wallet: restored, events },
        { ...scope, poolAddress: "0x3333333333333333333333333333333333333333" },
      )
    ).length,
    0,
  );
});
