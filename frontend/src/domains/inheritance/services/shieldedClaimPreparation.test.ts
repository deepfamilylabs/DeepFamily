import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicSignals,
  computeIdentityFromDerivedSecret,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedNoteCommitmentFromPayload,
  computeShieldedEnrollmentCommitment,
  computeShieldedPeriodNullifier,
  computeShieldedPolicyCommitment,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encryptShieldedNote,
  verifyShieldedNotePayload,
  type ShieldedOwnerBudgetNotePayload,
} from "@deepfamily/protocol-core";
import { getBytes, hexlify } from "ethers";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { LineageSnapshot } from "./inheritanceChain";
import { prepareShieldedClaim } from "./shieldedClaimPreparation";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const endorser = "0x2222222222222222222222222222222222222222";
const period = 2_592_000n;
const eligibleFrom = 1_000n;
const rootIdentityCommitment = 123456n;
const rootVersionIndex = 3n;
const derivedSecretField = 987654321n;

function identityMaterial(): IdentityMaterialV1Result {
  const material = computeIdentityFromDerivedSecret({
    identity: {
      fullName: "Heir Example",
      gender: 1,
      birthYear: 2000,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
    },
    identitySuiteId: 1,
    derivedSecretField,
  });
  return {
    identity: material.identity,
    identitySuiteId: material.identitySuiteId,
    derivedSecretField: String(material.derivedSecretField),
    nameField: String(material.nameField),
    packedBirthGenderField: String(material.packedBirthGenderField),
    suiteCommitment: String(material.suiteCommitment),
    nameSecretCommitment: String(material.nameSecretCommitment),
    identityCommitment: String(material.identityCommitment),
    personHash: material.personHash,
  };
}

function lineage(identity: IdentityMaterialV1Result): LineageSnapshot {
  const heirIdentityCommitment = BigInt(identity.identityCommitment);
  const fatherIdentityCommitment = rootIdentityCommitment;
  const motherIdentityCommitment = 999n;
  const versionIndex = 2;
  const writtenAt = 500n;
  const endorsementLeaf = computeLineageEndorsementLeaf({
    identityCommitment: heirIdentityCommitment,
    parentsDigest: computeLineageParentsDigest({
      fatherIdentityCommitment,
      motherIdentityCommitment,
    }),
    versionIndex,
    endorser,
    writtenAt,
  });
  const trustedLeaf = computeLineageTrustedLeaf({
    rootIdentityCommitment,
    rootVersionIndex,
    account: endorser,
  });
  const personHash = identity.personHash.toLowerCase();
  return {
    blockNumber: 1,
    blockHash: `0x${"11".repeat(32)}`,
    timestamp: eligibleFrom + 12n * period,
    checkpointId: 7n,
    checkpointCreatedAt: 0n,
    versions: new Map([
      [
        personHash,
        [
          {
            personHash,
            versionIndex,
            identityCommitment: heirIdentityCommitment,
            fatherIdentityCommitment,
            motherIdentityCommitment,
          },
        ],
      ],
    ]),
    trustedEndorsers: new Map([[`${personHash}:${versionIndex}`, new Set([endorser])]]),
    endorsements: new Map([
      [personHash, new Map([[endorser.toLowerCase(), { versionIndex, timestamp: writtenAt }]])],
    ]),
    endorsementTree: createLineageTree([endorsementLeaf, 77n]),
    trustedTree: createLineageTree([trustedLeaf, 88n]),
  };
}

async function fixture(
  remaining = 1_200n,
  amountPerPeriod = 100n,
  periodDays = 30n,
  keyMaterial?: { ownerSecret: bigint; ownerCommitment: bigint; hpkeIkm: string },
) {
  const identity = identityMaterial();
  const keys = keyMaterial ?? deriveShieldedHeirKeyMaterial(derivedSecretField);
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const note = {
    viewingKey: hexlify(viewingKey),
    budgetOrigin: 0n,
    keyMode: keyMaterial ? 1n : 0n,
    rootIdentityCommitment,
    rootVersionIndex,
    policySalt: 222n,
    allocationKeyCommitment: 333n,
    heirIdentityCommitment: BigInt(identity.identityCommitment),
    eligibleFrom,
    enrollmentSalt: 444n,
    heirOwnerCommitment: keys.ownerCommitment,
    amountPerPeriod,
    periodDays,
    remaining,
    nonce: 555n,
  } satisfies ShieldedOwnerBudgetNotePayload;
  const policyCommitment = computeShieldedPolicyCommitment(note, { chainId, poolAddress });
  const enrollmentCommitment = computeShieldedEnrollmentCommitment(
    {
      policyCommitment,
      heirIdentityCommitment: note.heirIdentityCommitment,
      eligibleFrom,
      enrollmentSalt: note.enrollmentSalt,
    },
    { chainId, poolAddress },
  );
  const ciphertext = await encryptShieldedNote({
    recipientPublicKey: viewingKey,
    payload: encodeShieldedBudgetNotePayload(note, { chainId, poolAddress }),
    chainId,
    poolAddress,
  });
  const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
  const budgetCommitment = computeShieldedBudgetNoteCommitment(
    {
      policyCommitment,
      enrollmentCommitment,
      heirOwnerCommitment: note.heirOwnerCommitment,
      viewingKey,
      budgetOrigin: note.budgetOrigin,
      keyMode: note.keyMode,
      amountPerPeriod: note.amountPerPeriod,
      remaining: note.remaining,
      nonce: note.nonce,
      ciphertextHashField,
    },
    { chainId, poolAddress },
  );
  const tree = createLineageTree([budgetCommitment, 999n]);
  const wallet: LocalShieldedWalletSnapshot = {
    poolAddress: poolAddress.toLowerCase(),
    chainId,
    toBlock: 1,
    blockHash: `0x${"11".repeat(32)}`,
    shards: new Map([[0n, tree]]),
    ownedNotes: new Map([
      [
        budgetCommitment,
        {
          shardId: 0n,
          leafIndex: 0n,
          commitment: budgetCommitment,
          root: tree.root,
          ciphertext,
          ciphertextHashField,
          blockNumber: 1,
          logIndex: 0,
          note: { kind: "budget", ...note },
        },
      ],
    ]),
    spentNullifiers: new Set(),
    walletOwnerCommitment: keys.ownerCommitment,
    walletKeyMode: keyMaterial ? 1 : 0,
    walletIdentityCommitment: BigInt(identity.identityCommitment),
  };
  return {
    keyMaterial: keys,
    chainId,
    poolAddress,
    identity,
    wallet,
    lineage: lineage(identity),
    budgetCommitment,
    asOf: eligibleFrom + 12n * period,
    periodIndices: [0n],
    policyCommitment,
    keys,
  };
}

async function addSecondBudget(
  input: Awaited<ReturnType<typeof fixture>>,
  overrides: Partial<ShieldedOwnerBudgetNotePayload> = {},
) {
  const first = input.wallet.ownedNotes.get(input.budgetCommitment)!;
  if (first.note.kind !== "budget") throw new Error("Fixture budget missing");
  if (first.note.binding === "identity") throw new Error("Expected owner fixture");
  const note = { ...first.note, remaining: 100n, nonce: 556n, ...overrides };
  const payload = encodeShieldedBudgetNotePayload(note, { chainId, poolAddress });
  const ciphertext = await encryptShieldedNote({
    payload,
    recipientPublicKey: await deriveShieldedViewPublicKey(input.keys.hpkeIkm),
    chainId,
    poolAddress,
  });
  const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
  const commitment = computeShieldedNoteCommitmentFromPayload(
    {
      payload,
      ciphertextHashField,
    },
    { chainId, poolAddress, viewingKey: await deriveShieldedViewPublicKey(input.keys.hpkeIkm) },
  ).noteCommitment;
  const tree = input.wallet.shards.get(0n)!;
  const leafIndex = tree.sizeBigInt;
  tree.insert(commitment);
  input.wallet.ownedNotes.set(commitment, {
    ...first,
    leafIndex,
    commitment,
    ciphertext,
    ciphertextHashField,
    note: { ...note, kind: "budget" } as typeof first.note,
  });
  return commitment;
}

describe("local shielded claim preparation", () => {
  it("binds the claim to its snapshot ID and defaults asOf to that snapshot's block", async () => {
    const input = await fixture();
    const prepared = await prepareShieldedClaim({ ...input, asOf: undefined });
    expect(prepared.data.lineageCheckpointId).toBe(input.lineage.checkpointId);
    expect(prepared.data.asOf).toBe(input.lineage.timestamp);
  });

  it("rejects claim times outside the selected snapshot's active interval", async () => {
    const input = await fixture();
    input.lineage.checkpointCreatedAt = input.asOf - 1n;
    for (const asOf of [input.asOf - 2n, input.lineage.timestamp + 1n]) {
      await expect(prepareShieldedClaim({ ...input, asOf })).rejects.toThrow(
        "outside the family eligibility snapshot",
      );
    }
    input.lineage.checkpointId = 0n;
    await expect(prepareShieldedClaim(input)).rejects.toThrow("valid family eligibility snapshot");
  });

  it("requires explicit independent keys even for an identity-derived budget", async () => {
    const input = await fixture();
    await expect(
      prepareShieldedClaim({
        ...input,
        keyMaterial: undefined,
      } as unknown as Parameters<typeof prepareShieldedClaim>[0]),
    ).rejects.toThrow("key material is required");
  });

  it("independent budgets claim to their original root and reject identity fallback", async () => {
    const keys = await deriveShieldedIndependentKeyMaterial({
      independentKeyRoot: new Uint8Array(32).fill(9),
      independentKeyIdentitySecret: new Uint8Array(32).fill(91),
    });
    const input = await fixture(1_200n, 100n, 30n, keys);
    const prepared = await prepareShieldedClaim(input);
    expect(prepared.outputs[0].note.keyMode).toBe(1n);
    expect(prepared.outputs[1].note.ownerCommitment).toBe(keys.ownerCommitment);
    expect(prepared.witness.ownerSecret).toBe(keys.ownerSecret.toString());
    await expect(
      prepareShieldedClaim({
        ...input,
        keyMaterial: undefined,
      } as unknown as Parameters<typeof prepareShieldedClaim>[0]),
    ).rejects.toThrow("key material is required");
    await expect(
      prepareShieldedClaim({
        ...input,
        keyMaterial: deriveShieldedHeirKeyMaterial(derivedSecretField),
      }),
    ).rejects.toThrow();
    const identityBound = await fixture();
    await expect(prepareShieldedClaim({ ...identityBound, keyMaterial: keys })).rejects.toThrow(
      "canonical identity keys",
    );
  });
  it("rejects a substituted viewing key for identity-derived claim authorization", async () => {
    const input = await fixture();
    await expect(
      prepareShieldedClaim({
        ...input,
        keyMaterial: {
          ...input.keyMaterial,
          hpkeIkm: deriveShieldedHeirKeyMaterial(123n).hpkeIkm,
        },
      }),
    ).rejects.toThrow("canonical identity keys");
  });
  it("rejects the removed second-budget input even when both notes share an owner", async () => {
    const input = await fixture(100n);
    const secondBudgetCommitment = await addSecondBudget(input);
    const unsupported = { ...input, secondBudgetCommitment };
    await expect(prepareShieldedClaim(unsupported)).rejects.toThrow("exactly one budget note");
  });
  it.each([1n, 7n, 365n])(
    "claims on a %s-day schedule only when a complete period has elapsed",
    async (periodDays) => {
      const input = await fixture(1_200n, 100n, periodDays);
      const dueAt = eligibleFrom + periodDays * 86_400n;
      input.lineage.timestamp = dueAt;
      await expect(prepareShieldedClaim({ ...input, asOf: dueAt - 1n })).rejects.toThrow();
      const prepared = await prepareShieldedClaim({ ...input, asOf: dueAt });
      expect(prepared.amount).toBe(100n);
      expect(prepared.witness.periodDays).toBe(periodDays.toString());
      expect(prepared.outputs[0].note.periodDays).toBe(periodDays);
      expect(prepared.outputs[0].note.eligibleFrom).toBe(eligibleFrom);
    },
  );

  it("builds exact fixed public inputs and encrypted continuation/payout notes", async () => {
    const input = await fixture();
    const prepared = await prepareShieldedClaim(input);
    const { witness } = prepared;
    expect(prepared.data.inputShardIds).toHaveLength(1);
    expect(prepared.data.inputRoots).toHaveLength(1);
    expect(witness.inputRoots).toEqual(prepared.data.inputRoots.map(String));
    expect(witness).not.toHaveProperty("hasSecondInput");
    expect(Object.keys(witness).some((key) => key.startsWith("second"))).toBe(false);
    const nullifiers = witness.inputNullifiers as string[];
    expect(nullifiers).toHaveLength(1);
    expect(witness.periodNullifiers).toHaveLength(3);
    expect(witness.endorsementRoot).toBe(String(input.lineage.endorsementTree.root));
    expect(witness.trustedRoot).toBe(String(input.lineage.trustedTree.root));
    expect(witness).not.toHaveProperty("amount");
    expect(witness).not.toHaveProperty("recipient");
    expect(prepared.amount).toBe(100n);
    expect(prepared.witness.remainingPeriods).toBe("12");
    expect(prepared.witness.periodIndices).toEqual(["0", ...Array(2).fill("0")]);
    expect(prepared.witness.endorsementSiblings).toHaveLength(64);
    expect(prepared.witness.trustedSiblings).toHaveLength(64);
    expect(prepared.witness.noteSiblings).toHaveLength(32);
    expect(prepared.outputs[0].note.remaining).toBe(1_100n);
    expect(prepared.outputs[1].note.amount).toBe(100n);
    for (const output of prepared.outputs) {
      expect(output.ciphertext).toHaveLength(512);
      const opened = await decryptShieldedNote({
        hpkeIkm: getBytes(input.keys.hpkeIkm),
        ciphertext: output.ciphertext,
        chainId,
        poolAddress,
      });
      try {
        expect(
          verifyShieldedNotePayload(
            {
              payload: opened,
              ciphertext: output.ciphertext,
              noteCommitment: output.commitment,
            },
            {
              chainId,
              poolAddress,
              viewingKey: await deriveShieldedViewPublicKey(input.keys.hpkeIkm),
            },
          ).noteCommitment,
        ).toBe(output.commitment);
      } finally {
        opened.fill(0);
      }
    }
  });

  it("cannot use a second recovered budget to cover the selected note's shortfall", async () => {
    const input = await fixture(100n);
    await addSecondBudget(input, { remaining: 1_200n });
    await expect(prepareShieldedClaim({ ...input, periodIndices: [0n, 1n] })).rejects.toThrow();
    const prepared = await prepareShieldedClaim({ ...input, periodIndices: [0n] });
    expect(prepared.amount).toBe(100n);
    expect(prepared.outputs[0].note.remaining).toBe(0n);
    expect(prepared.data.inputNullifiers).toHaveLength(1);
  });

  it("claims 3 whole matured periods while preserving the original enrollment", async () => {
    const input = await fixture();
    const prepared = await prepareShieldedClaim({
      ...input,
      periodIndices: Array.from({ length: 3 }, (_, index) => BigInt(index)),
    });
    expect(prepared.amount).toBe(300n);
    expect(prepared.outputs[0].note.remaining).toBe(900n);
    expect(prepared.outputs[0].note.eligibleFrom).toBe(eligibleFrom);
    expect(prepared.outputs[0].note.binding).not.toBe("identity");
    if (prepared.outputs[0].note.binding !== "identity")
      expect(prepared.outputs[0].note.enrollmentSalt).toBe(444n);
    expect(prepared.outputs[1].note.amount).toBe(300n);
    expect(prepared.data.periodNullifiers[0]).toBe(
      computeShieldedPeriodNullifier(
        {
          derivedSecretField,
          policyCommitment: input.policyCommitment,
          periodIndex: 0n,
        },
        { chainId, poolAddress },
      ),
    );
    expect(prepared.data.periodNullifiers[2]).toBe(
      computeShieldedPeriodNullifier(
        {
          derivedSecretField,
          policyCommitment: input.policyCommitment,
          periodIndex: 2n,
        },
        { chainId, poolAddress },
      ),
    );
  });

  it("uses a new current endorsement version without resetting the private eligibility start", async () => {
    const input = await fixture();
    const personHash = input.identity.personHash.toLowerCase();
    const nextVersion = 3;
    const writtenAt = 2_000n;
    const nextLeaf = computeLineageEndorsementLeaf({
      identityCommitment: BigInt(input.identity.identityCommitment),
      parentsDigest: computeLineageParentsDigest({
        fatherIdentityCommitment: rootIdentityCommitment,
        motherIdentityCommitment: 999n,
      }),
      versionIndex: nextVersion,
      endorser,
      writtenAt,
    });
    input.lineage.versions.get(personHash)!.push({
      personHash,
      versionIndex: nextVersion,
      identityCommitment: BigInt(input.identity.identityCommitment),
      fatherIdentityCommitment: rootIdentityCommitment,
      motherIdentityCommitment: 999n,
    });
    input.lineage.endorsements.get(personHash)!.set(endorser.toLowerCase(), {
      versionIndex: nextVersion,
      timestamp: writtenAt,
    });
    input.lineage.endorsementTree.update(0n, nextLeaf);
    const prepared = await prepareShieldedClaim(input);
    expect(prepared.witness.versionIndex).toBe("3");
    expect(prepared.outputs[0].note.eligibleFrom).toBe(eligibleFrom);
    expect(prepared.witness.endorsementRoot).toBe(String(input.lineage.endorsementTree.root));
  });

  it("rejects a lineage endorsement newer than the selected claim timestamp", async () => {
    const input = await fixture();
    const writtenAt = input.asOf + 1n;
    const nextLeaf = computeLineageEndorsementLeaf({
      identityCommitment: BigInt(input.identity.identityCommitment),
      parentsDigest: computeLineageParentsDigest({
        fatherIdentityCommitment: rootIdentityCommitment,
        motherIdentityCommitment: 999n,
      }),
      versionIndex: 2,
      endorser,
      writtenAt,
    });
    input.lineage.endorsements
      .get(input.identity.personHash.toLowerCase())!
      .set(endorser.toLowerCase(), { versionIndex: 2, timestamp: writtenAt });
    input.lineage.endorsementTree.update(0n, nextLeaf);
    await expect(prepareShieldedClaim(input)).rejects.toThrow("written after");
  });

  it("rejects missing, immature, duplicate, oversized, and unfunded period batches", async () => {
    const input = await fixture();
    await expect(prepareShieldedClaim({ ...input, periodIndices: [] })).rejects.toThrow("1 to 3");
    await expect(
      prepareShieldedClaim({
        ...input,
        periodIndices: Array.from({ length: 4 }, (_, index) => BigInt(index)),
      }),
    ).rejects.toThrow("1 to 3");
    await expect(
      prepareShieldedClaim({ ...input, asOf: eligibleFrom + period - 1n }),
    ).rejects.toThrow("not yet due");
    await expect(prepareShieldedClaim({ ...input, periodIndices: [0n, 0n] })).rejects.toThrow(
      "strictly increasing",
    );
    const underfunded = await fixture(100n);
    await expect(prepareShieldedClaim({ ...underfunded, periodIndices: [0n, 1n] })).rejects.toThrow(
      "does not cover",
    );
    const hugeRate = (1n << 127n) + 1n;
    const overflowing = await fixture(hugeRate, hugeRate);
    await expect(prepareShieldedClaim({ ...overflowing, periodIndices: [0n, 1n] })).rejects.toThrow(
      "exceeds uint128",
    );
    input.wallet.spentNullifiers.add(
      computeShieldedPeriodNullifier(
        {
          derivedSecretField,
          policyCommitment: input.policyCommitment,
          periodIndex: 0n,
        },
        { chainId, poolAddress },
      ),
    );
    await expect(prepareShieldedClaim(input)).rejects.toThrow("already been used");
  });

  it("rejects an invalid heir, cancelled endorsement, removed trusted source, or tampered note", async () => {
    const input = await fixture();
    await expect(
      prepareShieldedClaim({
        ...input,
        identity: { ...input.identity, derivedSecretField: "4321" },
      }),
    ).rejects.toThrow("does not match the passphrase-derived secret");
    const badSource = { ...input, source: { endorser, versionIndex: 999 } };
    await expect(prepareShieldedClaim(badSource)).rejects.toThrow("No current direct-child");
    input.lineage.endorsementTree.update(0n, 0n);
    await expect(prepareShieldedClaim(input)).rejects.toThrow("No current direct-child");
    const removed = await fixture();
    removed.lineage.trustedTree.update(0n, 0n);
    await expect(prepareShieldedClaim(removed)).rejects.toThrow("No current direct-child");
    const tampered = await fixture();
    tampered.wallet.ownedNotes.get(tampered.budgetCommitment)!.ciphertextHashField = 1n;
    await expect(prepareShieldedClaim(tampered)).rejects.toThrow(
      "does not match its public ciphertext",
    );
  });

  it("fails before encryption when a budget was spent or its note root has one leaf", async () => {
    const input = await fixture();
    const prepared = await prepareShieldedClaim(input);
    input.wallet.spentNullifiers.add(BigInt((prepared.witness.inputNullifiers as string[])[0]));
    await expect(prepareShieldedClaim(input)).rejects.toThrow("already been spent");
    input.wallet.spentNullifiers.clear();
    input.wallet.shards.set(0n, createLineageTree([input.budgetCommitment]));
    await expect(prepareShieldedClaim(input)).rejects.toThrow("Single-leaf note roots");
  });

  // Test-only opt-in for real proofs using the same public artifacts as the app.
  // eslint-disable-next-line no-restricted-syntax
  it.skipIf(process.env.SHIELDED_CLAIM_PROOF !== "1")(
    "verifies a real local Groth16 claim proof with current public keys",
    async () => {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-claim-prep-"));
      try {
        const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
        const artifacts = path.join(repoRoot, "frontend/public/zk/shielded");
        const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
        const inputPath = path.join(temporary, "input.json");
        const proofPath = path.join(temporary, "proof.json");
        const publicPath = path.join(temporary, "public.json");
        for (const [keyMode, source] of [[0, "shielded_claim32"], [1, "shielded_claim32"], [0, "shielded_claim"], [1, "shielded_claim"]] as const) {
          const keys =
            keyMode === 1
              ? await deriveShieldedIndependentKeyMaterial({
                  independentKeyRoot: new Uint8Array(32).fill(9),
                  independentKeyIdentitySecret: new Uint8Array(32).fill(91),
                })
              : undefined;
          const input = await fixture(1_200n, 100n, 30n, keys);
          const prepared = await prepareShieldedClaim({
            ...input,
            periodIndices: Array.from({ length: 3 }, (_, index) => BigInt(index)),
          });
          const witness = source === "shielded_claim32" ? { ...prepared.witness,
            endorsementSiblings: (prepared.witness.endorsementSiblings as string[]).slice(0, 32),
            trustedSiblings: (prepared.witness.trustedSiblings as string[]).slice(0, 32),
          } : prepared.witness;
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
          const signals = JSON.parse(fs.readFileSync(publicPath, "utf8"));
          expect(signals).toEqual(
            buildShieldedPoolPublicSignals({
              action: SHIELDED_POOL_ACTION.Claim,
              chainId,
              poolAddress,
              ...prepared.data,
            }).map(String),
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
    150_000,
  );
});
