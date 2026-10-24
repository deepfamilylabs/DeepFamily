import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicSignals,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedReceiveCredentialBinding,
  emptyShieldedReceiveAuthorizations,
  createLineageTree,
  decodeShieldedNotePayload,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { getBigInt, getBytes, hexlify, type Contract } from "ethers";
import type { LineageSnapshot } from "./inheritanceChain";
import type { VerifiedShieldedRecipient } from "./shieldedReceiveCode";
import {
  prepareShieldedFund,
  createShieldedPolicyDescriptor,
  validateShieldedFundingDestination,
} from "./shieldedFundingPreparation";
import { prepareShieldedShield } from "./shieldedNotePreparation";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const lineageAddress = "0x3333333333333333333333333333333333333333";
const endorser = "0x4444444444444444444444444444444444444444";
const donorSecret = 77_777n;
const heirSecret = 88_888n;
const rootIdentity = 12_345n;
const heirIdentity = 67_890n;
const blockHash = `0x${"ab".repeat(32)}`;
const timestamp = 1_700_000_000;

async function open(ciphertext: Uint8Array, secret: bigint) {
  const payload = await decryptShieldedNote({
    hpkeIkm: getBytes(deriveShieldedHeirKeyMaterial(secret).hpkeIkm),
    ciphertext,
    chainId,
    poolAddress,
  });
  try {
    return decodeShieldedNotePayload(payload, {
      chainId,
      poolAddress,
      viewingKey: await deriveShieldedViewPublicKey(deriveShieldedHeirKeyMaterial(secret).hpkeIkm),
    });
  } finally {
    payload.fill(0);
  }
}

async function setup(periodDays = 30n) {
  const donorKeys = deriveShieldedHeirKeyMaterial(donorSecret);
  const heirKeys = deriveShieldedHeirKeyMaterial(heirSecret);
  const shield = await prepareShieldedShield({
    chainId,
    poolAddress,
    keyMaterial: donorKeys,
    amount: 100n,
  });
  const firstTree = createLineageTree(shield.outputs.map((output) => output.commitment));
  const preliminaryWallet: LocalShieldedWalletSnapshot = {
    poolAddress: poolAddress.toLowerCase(),
    chainId,
    toBlock: 10,
    blockHash,
    shards: new Map([[0n, firstTree]]),
    ownedNotes: new Map(
      shield.outputs.map((output, index) => [
        output.commitment,
        {
          shardId: 0n,
          leafIndex: BigInt(index),
          commitment: output.commitment,
          root: firstTree.root,
          ciphertext: output.ciphertext,
          ciphertextHashField: output.ciphertextHashField,
          blockNumber: 10,
          logIndex: index,
          note: {
            kind: "value" as const,
            ownerCommitment: getBigInt(output.note.ownerCommitment),
            amount: getBigInt(output.note.amount),
            nonce: getBigInt(output.note.nonce),
          },
        },
      ]),
    ),
    spentNullifiers: new Set(),
    walletOwnerCommitment: donorKeys.ownerCommitment,
    walletKeyMode: 0,
    walletIdentityCommitment: rootIdentity,
  };
  const policy = createShieldedPolicyDescriptor(
    {
      rootIdentityCommitment: rootIdentity,
      rootVersionIndex: 0n,
      amountPerPeriod: 10n,
      periodDays,
    },
    { chainId, poolAddress },
  );
  const noteTree = firstTree;
  const wallet: LocalShieldedWalletSnapshot = {
    ...preliminaryWallet,
    shards: new Map([[0n, noteTree]]),
  };
  const viewingKey = await deriveShieldedViewPublicKey(heirKeys.hpkeIkm);
  const heirPersonHash = wrapIdentityCommitmentAsPersonHash(heirIdentity).toLowerCase();
  // The worker verifies a receive code before a payer can hold this type.
  const recipient = {
    disclosure: "fund",
    keyMode: 0,
    identityCommitment: heirIdentity,
    ownerCommitment: heirKeys.ownerCommitment,
    viewingKey: hexlify(viewingKey),
    personHash: heirPersonHash,
  } as VerifiedShieldedRecipient;
  const parentsDigest = computeLineageParentsDigest({
    fatherIdentityCommitment: rootIdentity,
    motherIdentityCommitment: 555n,
  });
  const endorsedAt = BigInt(timestamp - 100);
  const endorsementLeaf = computeLineageEndorsementLeaf({
    identityCommitment: heirIdentity,
    parentsDigest,
    versionIndex: 0n,
    endorser,
    writtenAt: endorsedAt,
  });
  const trustedLeaf = computeLineageTrustedLeaf({
    rootIdentityCommitment: rootIdentity,
    rootVersionIndex: 0n,
    account: endorser,
  });
  const endorsementTree = createLineageTree([endorsementLeaf, 987n]);
  const trustedTree = createLineageTree([trustedLeaf, 654n]);
  const chainEndorsementRoot = endorsementTree.root;
  const chainTrustedRoot = trustedTree.root;
  const rootPersonHash = wrapIdentityCommitmentAsPersonHash(rootIdentity).toLowerCase();
  const lineage: LineageSnapshot = {
    blockNumber: 10,
    blockHash,
    timestamp: BigInt(timestamp),
    checkpointId: 7n,
    checkpointCreatedAt: 0n,
    endorsementTree,
    trustedTree,
    versions: new Map([
      [
        rootPersonHash,
        [
          {
            personHash: rootPersonHash,
            versionIndex: 0,
            identityCommitment: rootIdentity,
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
          },
        ],
      ],
      [
        heirPersonHash,
        [
          {
            personHash: heirPersonHash,
            versionIndex: 0,
            identityCommitment: heirIdentity,
            fatherIdentityCommitment: rootIdentity,
            motherIdentityCommitment: 555n,
          },
        ],
      ],
    ]),
    endorsements: new Map([
      [
        heirPersonHash,
        new Map([
          [
            endorser.toLowerCase(),
            {
              versionIndex: 0,
              timestamp: endorsedAt,
            },
          ],
        ]),
      ],
    ]),
    trustedEndorsers: new Map([[`${rootPersonHash}:0`, new Set([endorser.toLowerCase()])]]),
  };
  const provider = {
    getNetwork: async () => ({ chainId }),
    getBlock: async (block: number | string) =>
      block === "latest"
        ? { number: 10, timestamp, hash: blockHash }
        : block === 10
          ? { number: 10, timestamp, hash: blockHash }
          : null,
  };
  const pool = {
    runner: { provider },
    getAddress: async () => poolAddress,
    LINEAGE_INDEX: async () => lineageAddress,
  } as unknown as Contract;
  const lineageIndex = {
    getAddress: async () => lineageAddress,
    identityCommitmentOf: vi.fn(async () => {
      throw new Error("Funding must not send a person-specific identity query");
    }),
    root: async (which: number) => (which === 0 ? chainEndorsementRoot : chainTrustedRoot),
    isKnownCheckpoint: vi.fn(
      async (id: bigint, endorsement: bigint, trusted: bigint) =>
        id === 7n && endorsement === chainEndorsementRoot && trusted === chainTrustedRoot,
    ),
  } as unknown as Contract;
  const common = {
    pool,
    wallet,
    keyMaterial: donorKeys,
    donorCommitment: shield.outputs[0].commitment,
    recipient,
  };
  return { common, pool, policy, lineage, lineageIndex, heirKeys, noteTree, recipient };
}

async function recordFunding(
  fixture: Awaited<ReturnType<typeof setup>>,
  prepared: Awaited<ReturnType<typeof prepareShieldedFund>>,
) {
  const changeIndex = fixture.noteTree.sizeBigInt + 1n;
  for (const output of prepared.outputs) fixture.noteTree.insert(output.commitment);
  for (const nullifier of prepared.data.inputNullifiers)
    fixture.common.wallet.spentNullifiers.add(getBigInt(nullifier));
  const change = prepared.outputs[1];
  fixture.common.wallet.ownedNotes.set(change.commitment, {
    shardId: 0n,
    leafIndex: changeIndex,
    commitment: change.commitment,
    root: fixture.noteTree.root,
    ciphertext: change.ciphertext,
    ciphertextHashField: change.ciphertextHashField,
    blockNumber: 10,
    logIndex: Number(changeIndex),
    note: await open(change.ciphertext, donorSecret),
  });
  fixture.common.donorCommitment = change.commitment;
}

describe("funding destination validation before consolidation", () => {
  it.each([0, 1] as const)(
    "validates initial visibility-%s funding without selecting a donor, and rejects lost child eligibility",
    async (budgetKind) => {
      const fixture = await setup();
      const input = {
        ...fixture.common,
        donorCommitment: 0n,
        wallet: { ...fixture.common.wallet, ownedNotes: new Map() },
        fundMode: 0 as const,
        budgetKind,
        policy: fixture.policy,
        lineageIndex: {
          ...fixture.lineageIndex,
          root: async (which: number) =>
            which === 0 ? fixture.lineage.endorsementTree.root : fixture.lineage.trustedTree.root,
          isKnownCheckpoint: async () => true,
        } as unknown as Contract,
        lineage: fixture.lineage,
        publicRecipientPersonHash: fixture.recipient.personHash,
        budgetPeriods: 1n,
      };
      await expect(validateShieldedFundingDestination(input)).resolves.toBeUndefined();
      expect(fixture.lineageIndex.identityCommitmentOf).not.toHaveBeenCalled();
      await expect(prepareShieldedFund(input)).rejects.toThrow("recovered value note");
      fixture.lineage.trustedTree.update(0n, 0n);
      await expect(validateShieldedFundingDestination(input)).rejects.toThrow(
        "no current direct-child endorsement",
      );
    },
  );

  it.each(["absent", "empty", "zero"] as const)(
    "rejects a public recipient with %s local identity records before needing a donor note",
    async (records) => {
      const fixture = await setup();
      const personHash = fixture.recipient.personHash!;
      if (records === "absent") fixture.lineage.versions.delete(personHash);
      else if (records === "empty") fixture.lineage.versions.set(personHash, []);
      else fixture.lineage.versions.get(personHash)![0].identityCommitment = 0n;
      await expect(
        validateShieldedFundingDestination({
          ...fixture.common,
          donorCommitment: 0n,
          fundMode: 0,
          budgetKind: 1,
          policy: fixture.policy,
          lineageIndex: fixture.lineageIndex,
          lineage: fixture.lineage,
          publicRecipientPersonHash: fixture.recipient.personHash,
          budgetPeriods: 1n,
        }),
      ).rejects.toThrow("Recipient identity is unknown");
      expect(fixture.lineageIndex.identityCommitmentOf).not.toHaveBeenCalled();
    },
  );

  it.each(["different identity", "different person", "inconsistent versions"] as const)(
    "rejects %s in local public recipient records",
    async (attack) => {
      const fixture = await setup();
      const versions = fixture.lineage.versions.get(fixture.recipient.personHash!)!;
      if (attack === "different identity") versions[0].identityCommitment += 1n;
      else if (attack === "different person")
        versions[0].personHash = wrapIdentityCommitmentAsPersonHash(999n);
      else versions.push({ ...versions[0], versionIndex: 1, identityCommitment: 999n });
      await expect(
        validateShieldedFundingDestination({
          ...fixture.common,
          fundMode: 0,
          budgetKind: 1,
          policy: fixture.policy,
          lineageIndex: fixture.lineageIndex,
          lineage: fixture.lineage,
          publicRecipientPersonHash: fixture.recipient.personHash,
          budgetPeriods: 1n,
        }),
      ).rejects.toThrow("Recipient identity does not match");
      expect(fixture.lineageIndex.identityCommitmentOf).not.toHaveBeenCalled();
    },
  );

  it("checks the existing lineage snapshot once during direct funding", async () => {
    const fixture = await setup();
    const isKnownCheckpoint = vi.fn(async () => true);
    await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0,
      policy: fixture.policy,
      lineageIndex: { ...fixture.lineageIndex, isKnownCheckpoint } as unknown as Contract,
      lineage: fixture.lineage,
      budgetPeriods: 1n,
    });
    expect(isKnownCheckpoint).toHaveBeenCalledExactlyOnceWith(
      7n,
      fixture.lineage.endorsementTree.root,
      fixture.lineage.trustedTree.root,
      BigInt(timestamp),
      { blockTag: 10 },
    );
  });

  it.each([0, 1] as const)(
    "validates a visibility-%s refill without a donor and preserves its template authorization",
    async (budgetKind) => {
      const fixture = await setup();
      const lineageIndex = {
        ...fixture.lineageIndex,
      } as unknown as Contract;
      const initial = await prepareShieldedFund({
        ...fixture.common,
        fundMode: 0,
        budgetKind,
        policy: fixture.policy,
        lineageIndex,
        lineage: fixture.lineage,
        publicRecipientPersonHash: fixture.recipient.personHash,
        budgetPeriods: 1n,
      });
      await recordFunding(fixture, initial);
      const budget = {
        ...initial.outputs[0],
        shardId: 0n,
        viewingKey: fixture.recipient.viewingKey,
        ruleOpening: initial.outputs[1].note.fundingMemo?.ruleOpening,
      };
      const input = {
        ...fixture.common,
        donorCommitment: 0n,
        wallet: { ...fixture.common.wallet, ownedNotes: new Map() },
        fundMode: 1 as const,
        budgetKind,
        lineageIndex,
        publicRecipientPersonHash: fixture.recipient.personHash,
        budget,
        budgetPeriods: 1n,
      };
      await expect(validateShieldedFundingDestination(input)).resolves.toBeUndefined();
      expect(fixture.lineageIndex.identityCommitmentOf).not.toHaveBeenCalled();
      await expect(
        validateShieldedFundingDestination({ ...input, budgetKind: budgetKind === 1 ? 0 : 1 }),
      ).rejects.toThrow("cannot change budget binding");
      if (budgetKind === 0) {
        await expect(
          validateShieldedFundingDestination({
            ...input,
            recipient: { ...fixture.recipient, viewingKey: `0x${"11".repeat(32)}` },
          }),
        ).rejects.toThrow("cannot change recipient viewing material");
      } else {
        await expect(
          validateShieldedFundingDestination({
            ...input,
            publicRecipientPersonHash: wrapIdentityCommitmentAsPersonHash(999n),
          }),
        ).rejects.toThrow("Recipient identity does not match its person hash");
        await expect(
          validateShieldedFundingDestination({
            ...input,
            budget: { ...budget, ruleOpening: undefined },
          }),
        ).rejects.toThrow("needs its donor rule opening");
      }
    },
  );
});

describe("local unified funding preparation", () => {
  it("rejects the removed donor-derived-secret-only input shape", async () => {
    const fixture = await setup();
    const { keyMaterial: _keyMaterial, ...oldCommon } = fixture.common;
    await expect(
      prepareShieldedFund({
        ...oldCommon,
        donorDerivedSecretField: donorSecret,
        fundMode: 0,
        policy: fixture.policy,
        lineage: fixture.lineage,
        lineageIndex: fixture.lineageIndex,
        budgetPeriods: 2n,
      } as unknown as Parameters<typeof prepareShieldedFund>[0]),
    ).rejects.toThrow("key material is required");
  });

  it("private independent funding retains owner, mode and viewing material on refill", async () => {
    const fixture = await setup();
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: new Uint8Array(32).fill(10),
      independentKeyIdentitySecret: new Uint8Array(32).fill(91),
    });
    fixture.common.recipient = {
      ...fixture.common.recipient,
      keyMode: 1,
      ownerCommitment: keys.ownerCommitment,
      viewingKey: hexlify(keys.viewPublicKey),
    };
    const initial = await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 1n,
    });
    expect(initial.outputs[0].note.keyMode).toBe(1n);
    expect(initial.witness.keyMode).toBe("1");
    await recordFunding(fixture, initial);
    const budget = {
      ...initial.outputs[0],
      shardId: 0n,
      viewingKey: fixture.common.recipient.viewingKey,
    };
    const input = { ...fixture.common, fundMode: 1 as const, budget, budgetPeriods: 1n };
    await expect(prepareShieldedFund({ ...input, recipient: undefined })).rejects.toThrow(
      "current Fund identity disclosure material",
    );
    const refill = await prepareShieldedFund(input);
    expect(refill.outputs[0].note.keyMode).toBe(1n);
    expect(refill.witness.oldKeyMode).toBe("1");
    await expect(
      prepareShieldedFund({ ...input, recipient: { ...fixture.common.recipient, keyMode: 0 } }),
    ).rejects.toThrow("recipient");
    await expect(prepareShieldedFund({ ...input, budgetKind: 1 })).rejects.toThrow("binding");
    await expect(
      prepareShieldedFund({
        ...input,
        recipient: { ...fixture.common.recipient, viewingKey: "0x" + "11".repeat(32) },
      }),
    ).rejects.toThrow("viewing material");
  });

  it.each([1n, 7n, 365n])(
    "binds %s days to the initial budget and preserves it on additional funding",
    async (periodDays) => {
      const fixture = await setup(periodDays);
      const initial = await prepareShieldedFund({
        ...fixture.common,
        fundMode: 0,
        policy: fixture.policy,
        lineageIndex: fixture.lineageIndex,
        lineage: fixture.lineage,
        budgetPeriods: 1n,
      });
      const initialNote = await open(initial.outputs[0].ciphertext, heirSecret);
      expect(initialNote.kind).toBe("budget");
      if (initialNote.kind !== "budget") throw new Error("Budget missing");
      expect(initialNote.periodDays).toBe(periodDays);
      expect(initial.witness.periodDays).toBe(periodDays.toString());
      await recordFunding(fixture, initial);
      const additional = await prepareShieldedFund({
        ...fixture.common,
        fundMode: 1,
        budget: {
          note: initial.outputs[0].note,
          commitment: initial.outputs[0].commitment,
          ciphertext: initial.outputs[0].ciphertext,
          shardId: 0n,
          viewingKey: fixture.common.recipient.viewingKey,
        },
        budgetPeriods: 2n,
      });
      expect(additional.outputs[0].note.periodDays).toBe(periodDays);
      expect(additional.outputs[0].note.eligibleFrom).toBe(initial.outputs[0].note.eligibleFrom);
      expect(additional.witness.periodDays).toBe(periodDays.toString());
      expect(additional.policyCommitment).toBe(initial.policyCommitment);
    },
  );

  it.each([0n, -1n, 4_294_967_296n])("rejects out-of-range period days %s", (periodDays) => {
    expect(() =>
      createShieldedPolicyDescriptor(
        {
          rootIdentityCommitment: rootIdentity,
          rootVersionIndex: 1n,
          amountPerPeriod: 10n,
          periodDays,
        },
        { chainId, poolAddress },
      ),
    ).toThrow("positive uint32");
  });

  it.each([0, 1] as const)(
    "rejects an initial budget for another parent in visibility mode %s",
    async (budgetKind) => {
      const fixture = await setup();
      await expect(
        prepareShieldedFund({
          ...fixture.common,
          wallet: { ...fixture.common.wallet, walletIdentityCommitment: rootIdentity + 1n },
          fundMode: 0,
          budgetKind,
          policy: fixture.policy,
          lineageIndex: fixture.lineageIndex,
          lineage: fixture.lineage,
          budgetPeriods: 1n,
        }),
      ).rejects.toThrow("another parent identity");
    },
  );

  it("requires the current parent's identity when preparing funding", async () => {
    const fixture = await setup();
    await expect(
      prepareShieldedFund({
        ...fixture.common,
        wallet: { ...fixture.common.wallet, walletIdentityCommitment: undefined },
        fundMode: 0,
        policy: fixture.policy,
        lineageIndex: fixture.lineageIndex,
        lineage: fixture.lineage,
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("wallet recovered with the parent's identity");
  });

  it("rejects additional funding against a different parent's template", async () => {
    const fixture = await setup();
    const initial = await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 1n,
    });
    await expect(
      prepareShieldedFund({
        ...fixture.common,
        fundMode: 1,
        budget: {
          ...initial.outputs[0],
          note: { ...initial.outputs[0].note, rootIdentityCommitment: rootIdentity + 1n },
          shardId: 0n,
          viewingKey: fixture.common.recipient.viewingKey,
        },
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("another parent identity");
  });

  it("builds the funding's named public inputs, a direct-child witness, and a child-decryptable budget", async () => {
    const fixture = await setup();
    const prepared = await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 5n,
    });
    expect(prepared.witness.endorsementRoot).toBe(String(fixture.lineage.endorsementTree.root));
    expect(prepared.witness.trustedRoot).toBe(String(fixture.lineage.trustedTree.root));
    expect(prepared.witness.asOf).toBe(String(timestamp));
    expect(prepared.witness.inputRoots).toEqual([
      String(fixture.noteTree.root),
      String(fixture.noteTree.root),
    ]);
    expect(prepared.data.inputRoots).toEqual([fixture.noteTree.root, fixture.noteTree.root]);
    expect(prepared.witness.endorsementSiblings).toHaveLength(64);
    expect(prepared.witness.trustedSiblings).toHaveLength(64);
    expect(prepared.witness.fundMode).toBe("0");
    expect(prepared.witness.oldBudgetSiblings).toEqual(Array(32).fill("0"));
    expect(prepared.witness).not.toHaveProperty("policyNonce");
    const change = await open(prepared.outputs[1].ciphertext, donorSecret);
    expect(change.kind === "value" && change.fundingMemo?.allocationKey).toBe(
      fixture.policy.allocationKey,
    );
    const child = await open(prepared.outputs[0].ciphertext, heirSecret);
    expect(child).not.toHaveProperty("allocationKey");
    expect(prepared.witness.heirIdentityCommitment).toBe(String(heirIdentity));
    expect(prepared.witness.heirOwnerCommitment).toBe(String(fixture.heirKeys.ownerCommitment));
    expect(prepared.witness).not.toHaveProperty("viewKeyHi");
    expect(prepared.witness).not.toHaveProperty("publicSignals");
    expect(await open(prepared.outputs[0].ciphertext, heirSecret)).toMatchObject({
      kind: "budget",
      heirIdentityCommitment: heirIdentity,
      remaining: 50n,
      eligibleFrom: BigInt(timestamp + 7200),
    });
    expect(await open(prepared.outputs[1].ciphertext, donorSecret)).toMatchObject({
      kind: "value",
      amount: 50n,
    });
    const payload = await decryptShieldedNote({
      hpkeIkm: getBytes(fixture.heirKeys.hpkeIkm),
      ciphertext: prepared.outputs[0].ciphertext,
      chainId,
      poolAddress,
    });
    try {
      expect(
        verifyShieldedNotePayload(
          {
            payload,
            ciphertext: prepared.outputs[0].ciphertext,
            noteCommitment: prepared.outputs[0].commitment,
          },
          {
            chainId,
            poolAddress,
            viewingKey: await deriveShieldedViewPublicKey(fixture.heirKeys.hpkeIkm),
          },
        ).note.kind,
      ).toBe("budget");
    } finally {
      payload.fill(0);
    }
  });

  it("uses an existing child budget only as a read-only template and funds new periods from donor value", async () => {
    const fixture = await setup();
    const initialFunding = await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 5n,
    });
    await recordFunding(fixture, initialFunding);
    const additionalFunding = await prepareShieldedFund({
      fundMode: 1,
      ...fixture.common,
      budget: {
        ...initialFunding.outputs[0],
        shardId: 0n,
        viewingKey: fixture.common.recipient.viewingKey,
      },
      budgetPeriods: 3n,
    });
    // Continuation funding keeps the original enrollment and uses canonical zero lineage inputs.
    expect(additionalFunding.witness.endorsementRoot).toBe("0");
    expect(additionalFunding.witness.asOf).toBe("0");
    expect(additionalFunding.data.inputRoots).toEqual([
      fixture.noteTree.root,
      fixture.noteTree.root,
    ]);
    expect(additionalFunding.witness.oldBudgetRemainingPeriods).toBe("5");
    expect(additionalFunding.witness.allocationKey).toBe("0");
    expect(additionalFunding.witness.endorsementSiblings).toEqual(Array(64).fill("0"));
    expect(additionalFunding.witness.fundMode).toBe("1");
    expect(additionalFunding.witness.budgetPeriods).toBe("3");
    expect(additionalFunding.witness.heirIdentityCommitment).toBe(String(heirIdentity));
    expect(await open(additionalFunding.outputs[0].ciphertext, heirSecret)).toMatchObject({
      kind: "budget",
      remaining: 30n,
      eligibleFrom: BigInt(timestamp + 7200),
    });
    expect(await open(additionalFunding.outputs[1].ciphertext, donorSecret)).toMatchObject({
      kind: "value",
      amount: 20n,
    });
  });

  it("keeps one enrollment per rule and heir without a standalone policy note", async () => {
    const fixture = await setup();
    const args = {
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 1n,
    };
    const initial = await prepareShieldedFund(args);
    await recordFunding(fixture, initial);
    await expect(
      prepareShieldedFund({ ...args, donorCommitment: fixture.common.donorCommitment }),
    ).rejects.toThrow("already enrolled");
    const spent = await setup();
    const first = await prepareShieldedFund({
      ...spent.common,
      fundMode: 0,
      policy: spent.policy,
      lineageIndex: spent.lineageIndex,
      lineage: spent.lineage,
      budgetPeriods: 1n,
    });
    spent.common.wallet.spentNullifiers.add(getBigInt(first.data.inputNullifiers[0]));
    await expect(
      prepareShieldedFund({
        ...spent.common,
        fundMode: 0,
        policy: spent.policy,
        lineageIndex: spent.lineageIndex,
        lineage: spent.lineage,
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("already been spent");
    const exposed = await setup();
    exposed.common.wallet.shards.set(0n, createLineageTree([exposed.common.donorCommitment]));
    await expect(
      prepareShieldedFund({
        ...exposed.common,
        fundMode: 0,
        policy: exposed.policy,
        lineageIndex: exposed.lineageIndex,
        lineage: exposed.lineage,
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("Single-leaf");
  });

  it("accepts a canonical wallet snapshot when unrelated blocks arrive before funding", async () => {
    const fixture = await setup();
    const provider = fixture.pool.runner!.provider as unknown as {
      getBlock: (
        block: number | string,
      ) => Promise<{ number: number; timestamp: number; hash: string } | null>;
    };
    const getBlock = provider.getBlock.bind(provider);
    provider.getBlock = async (block) =>
      block === "latest"
        ? { number: 11, timestamp: timestamp + 2, hash: `0x${"cd".repeat(32)}` }
        : getBlock(block);

    const latestRoots = vi.spyOn(fixture.lineageIndex, "root").mockResolvedValue(999n);
    const initialFunding = await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 1n,
    });
    expect(initialFunding.data.asOf).toBe(BigInt(timestamp));
    expect(initialFunding.data.lineageCheckpointId).toBe(7n);
    expect(latestRoots).not.toHaveBeenCalled();
    await recordFunding(fixture, initialFunding);
    const additionalFunding = await prepareShieldedFund({
      fundMode: 1,
      ...fixture.common,
      budget: {
        ...initialFunding.outputs[0],
        shardId: 0n,
        viewingKey: fixture.common.recipient.viewingKey,
      },
      budgetPeriods: 1n,
    });
    expect(additionalFunding.outputs[0].note.eligibleFrom).toBe(BigInt(timestamp + 7200));
  });

  it("rejects a recipient whose identity is inconsistent or not an endorsed direct child", async () => {
    const fixture = await setup();
    const input = {
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 1n,
    };
    await expect(
      prepareShieldedFund({
        ...input,
        recipient: { ...fixture.recipient, identityCommitment: heirIdentity + 1n },
      }),
    ).rejects.toThrow("Recipient identity does not match its person hash");
    await expect(
      prepareShieldedFund({
        ...input,
        recipient: {
          ...fixture.recipient,
          identityCommitment: heirIdentity + 1n,
          personHash: wrapIdentityCommitmentAsPersonHash(heirIdentity + 1n),
        },
      }),
    ).rejects.toThrow("no current direct-child endorsement");
  });

  it("rejects additional funding for a different recipient than the budget's heir", async () => {
    const fixture = await setup();
    const initialFunding = await prepareShieldedFund({
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 2n,
    });
    await recordFunding(fixture, initialFunding);
    await expect(
      prepareShieldedFund({
        fundMode: 1,
        ...fixture.common,
        recipient: {
          ...fixture.recipient,
          ownerCommitment: fixture.recipient.ownerCommitment + 1n,
        },
        budget: {
          ...initialFunding.outputs[0],
          shardId: 0n,
          viewingKey: fixture.common.recipient.viewingKey,
        },
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("does not belong to this recipient");
  });

  it("rejects insufficient funds, stale lineage, and a substituted template", async () => {
    const fixture = await setup();
    const input = {
      ...fixture.common,
      fundMode: 0 as const,
      policy: fixture.policy,
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 11n,
    };
    await expect(prepareShieldedFund(input)).rejects.toThrow("cannot fund the whole");
    fixture.lineage.endorsementTree.insert(999n);
    await expect(prepareShieldedFund({ ...input, budgetPeriods: 1n })).rejects.toThrow(
      "eligibility snapshot expired",
    );
    const validFixture = await setup();
    validFixture.common.wallet.ownedNotes.get(
      validFixture.common.donorCommitment,
    )!.ciphertext[100] ^= 1;
    await expect(
      prepareShieldedFund({
        ...validFixture.common,
        fundMode: 0,
        policy: validFixture.policy,
        budgetPeriods: 1n,
        lineageIndex: validFixture.lineageIndex,
        lineage: validFixture.lineage,
      }),
    ).rejects.toThrow("does not match");
  });

  it("requires a current donor event replay and an owned donor note", async () => {
    const stale = await setup();
    stale.common.wallet.toBlock = 9;
    await expect(
      prepareShieldedFund({
        ...stale.common,
        fundMode: 0 as const,
        policy: stale.policy,
        lineageIndex: stale.lineageIndex,
        lineage: stale.lineage,
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("Wallet snapshot is stale");

    const forged = await setup();
    const owned = forged.common.wallet.ownedNotes.get(forged.common.donorCommitment);
    if (!owned || owned.note.kind !== "value") throw new Error("Test donor note is missing");
    owned.note.ownerCommitment = 1n;
    await expect(
      prepareShieldedFund({
        ...forged.common,
        fundMode: 0 as const,
        policy: forged.policy,
        lineageIndex: forged.lineageIndex,
        lineage: forged.lineage,
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("belongs to another identity");
  });

  // Test-only opt-in for real proofs using the same public artifacts as the app.
  // eslint-disable-next-line no-restricted-syntax
  it.skipIf(process.env.SHIELDED_FUNDING_PROOF !== "1").each([0, 1] as const)(
    "verifies initial and continuation mode-%s budgets with current public Groth16 keys",
    async (keyMode) => {
      const fixture = await setup();
      if (keyMode === 1) {
        const keys = await deriveShieldedIndependentKeyMaterial({
          independentKeyRoot: new Uint8Array(32).fill(10),
          independentKeyIdentitySecret: new Uint8Array(32).fill(91),
        });
        fixture.common.recipient = {
          ...fixture.common.recipient,
          keyMode,
          ownerCommitment: keys.ownerCommitment,
          viewingKey: hexlify(keys.viewPublicKey),
        };
      }
      const initialFunding = await prepareShieldedFund({
        ...fixture.common,
        fundMode: 0 as const,
        policy: fixture.policy,
        lineageIndex: fixture.lineageIndex,
        lineage: fixture.lineage,
        budgetPeriods: 5n,
      });
      await recordFunding(fixture, initialFunding);
      const additionalFunding = await prepareShieldedFund({
        fundMode: 1,
        ...fixture.common,
        budget: {
          ...initialFunding.outputs[0],
          shardId: 0n,
          viewingKey: fixture.common.recipient.viewingKey,
        },
        budgetPeriods: 3n,
      });
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-funding-prep-"));
      try {
        const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
        const artifacts = path.join(repoRoot, "frontend/public/zk/shielded");
        const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
        for (const [source, action, prepared] of [
          ["shielded_fund", SHIELDED_POOL_ACTION.Fund, initialFunding],
          ["shielded_fund", SHIELDED_POOL_ACTION.Fund, additionalFunding],
        ] as const) {
          const { witness } = prepared;
          // Complete the same receiver binding the Worker adds after preparation.
          // This test proves the Fund business circuit; presentation authentication
          // is verified by the dedicated real receive-proof integration tests.
          const authorizationAlias = 99101n;
          const salt = 99102n;
          const expiresAt = BigInt(timestamp + 86_400);
          const binding = computeShieldedReceiveCredentialBinding({
            credential: {
              ...fixture.common.recipient,
              authorizationAlias,
              authorizationCounter: 0n,
              expiresAt,
            },
            salt,
          });
          witness.receiveAuthorizationAlias = String(authorizationAlias);
          witness.receiveSalt = String(salt);
          witness.receiveBindings = [String(binding), "0"];
          prepared.data.receiveAuthorizations = emptyShieldedReceiveAuthorizations();
          prepared.data.receiveAuthorizations[0] = {
            checkpointId: 1n,
            asOf: BigInt(timestamp),
            expiresAt,
            recipientBinding: binding,
            proof: "0x",
          };
          const inputPath = path.join(temporary, `${source}.input.json`);
          const proofPath = path.join(temporary, `${source}.proof.json`);
          const publicPath = path.join(temporary, `${source}.public.json`);
          fs.writeFileSync(inputPath, JSON.stringify(witness));
          execFileSync(
            process.execPath,
            [
              cli,
              "groth16",
              "fullprove",
              inputPath,
              path.join(artifacts, `${source}.wasm`),
              path.join(artifacts, `${source}_final.zkey`),
              proofPath,
              publicPath,
            ],
            { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
          );
          expect(JSON.parse(fs.readFileSync(publicPath, "utf8"))).toEqual(
            buildShieldedPoolPublicSignals({ action, chainId, poolAddress, ...prepared.data }).map(
              String,
            ),
          );
          const verified = execFileSync(
            process.execPath,
            [
              cli,
              "groth16",
              "verify",
              path.join(artifacts, `${source}.vkey.json`),
              publicPath,
              proofPath,
            ],
            { encoding: "utf8", timeout: 120_000 },
          );
          expect(verified).toMatch(/OK!/u);
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
    300_000,
  );
});
