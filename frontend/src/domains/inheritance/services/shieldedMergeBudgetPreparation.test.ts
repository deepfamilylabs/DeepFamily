import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeShieldedBudgetNoteCommitment,
  computeShieldedCiphertextHashField,
  computeShieldedEnrollmentCommitment,
  computeShieldedPolicyCommitment,
  computeShieldedSpendNullifier,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedBudgetNotePayload,
  encryptShieldedNote,
  verifyShieldedNotePayload,
  type ShieldedBudgetNotePayload,
} from "@deepfamily/protocol-core";
import { getBytes } from "ethers";
import { prepareShieldedMergeBudget } from "./shieldedMergeBudgetPreparation";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const derivedSecretField = 987654321n;
const heirIdentityCommitment = 444444n;
type BudgetFields = { [K in keyof ShieldedBudgetNotePayload]: bigint };

async function fixture(options: {
  firstRemaining?: bigint;
  secondRemaining?: bigint;
  rate?: bigint;
  secondNote?: Partial<BudgetFields>;
} = {}) {
  const keys = deriveShieldedHeirKeyMaterial(derivedSecretField);
  const base = {
    rootIdentityCommitment: 11111n,
    rootVersionIndex: 2n,
    policySalt: 22222n,
    allocationKeyCommitment: 33333n,
    heirIdentityCommitment,
    eligibleFrom: 1000n,
    enrollmentSalt: 55555n,
    heirOwnerCommitment: keys.ownerCommitment,
    amountPerPeriod: options.rate ?? 10n,
  };
  const first: BudgetFields = {
    ...base,
    remaining: options.firstRemaining ?? 30n,
    nonce: 7001n,
  };
  const second: BudgetFields = {
    ...base,
    remaining: options.secondRemaining ?? 20n,
    nonce: 7002n,
    ...options.secondNote,
  };
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const records = await Promise.all([first, second].map(async (note, index) => {
    const payload = encodeShieldedBudgetNotePayload(note);
    try {
      const ciphertext = await encryptShieldedNote({
        recipientPublicKey: viewingKey,
        payload,
        chainId,
        poolAddress,
      });
      const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
      const policyCommitment = computeShieldedPolicyCommitment(note);
      const enrollmentCommitment = computeShieldedEnrollmentCommitment({
        policyCommitment,
        heirIdentityCommitment: note.heirIdentityCommitment,
        eligibleFrom: note.eligibleFrom,
        enrollmentSalt: note.enrollmentSalt,
      });
      const commitment = computeShieldedBudgetNoteCommitment({
        policyCommitment,
        enrollmentCommitment,
        heirOwnerCommitment: note.heirOwnerCommitment,
        amountPerPeriod: note.amountPerPeriod,
        remaining: note.remaining,
        nonce: note.nonce,
        ciphertextHashField,
      });
      return { note, ciphertext, ciphertextHashField, commitment, index };
    } finally {
      payload.fill(0);
    }
  }));
  const tree = createLineageTree(records.map(({ commitment }) => commitment));
  const wallet: LocalShieldedWalletSnapshot = {
    chainId,
    poolAddress: poolAddress.toLowerCase(),
    toBlock: 10,
    blockHash: `0x${"11".repeat(32)}`,
    shards: new Map([[0n, tree]]),
    ownedNotes: new Map(records.map(({ note, ciphertext, ciphertextHashField, commitment, index }) => [
      commitment,
      {
        shardId: 0n,
        leafIndex: BigInt(index),
        commitment,
        root: tree.root,
        ciphertext,
        ciphertextHashField,
        blockNumber: 10,
        logIndex: index,
        note: { kind: "budget" as const, ...note },
      },
    ])),
    spentNullifiers: new Set(),
    walletOwnerCommitment: keys.ownerCommitment,
    walletIdentityCommitment: heirIdentityCommitment,
  };
  return {
    chainId,
    poolAddress,
    derivedSecretField,
    wallet,
    inputCommitments: [records[0].commitment, records[1].commitment] as const,
    keys,
    records,
  };
}

describe("local shielded budget merge preparation", () => {
  it("consumes two distinct owned budgets and encrypts an exact merged budget plus dummy", async () => {
    const input = await fixture();
    const prepared = await prepareShieldedMergeBudget(input);
    const { witness } = prepared;
    const root = String(input.wallet.shards.get(0n)!.root);
    expect(witness.inputShardIds).toEqual(["0", "0"]);
    expect(witness.inputRoots).toEqual([root, root]);
    const nullifiers = witness.inputNullifiers as string[];
    expect(nullifiers[0]).not.toBe(nullifiers[1]);
    expect(witness).not.toHaveProperty("periodNullifiers");
    expect(witness).not.toHaveProperty("asOf");
    expect(prepared.witness.remaining).toEqual(["30", "20"]);
    expect(prepared.witness.remainingPeriods).toEqual(["3", "2"]);
    expect(prepared.witness.inputDepths).toEqual(["1", "1"]);
    expect(prepared.witness.inputIndices).toEqual(["0", "1"]);
    expect(prepared.witness.inputSiblings).toEqual([
      expect.arrayContaining([String(input.inputCommitments[1])]),
      expect.arrayContaining([String(input.inputCommitments[0])]),
    ]);
    expect(prepared.outputs[0].note.remaining).toBe(50n);
    expect(prepared.outputs[0].note.eligibleFrom).toBe(1000n);
    expect(prepared.outputs[1].note.amount).toBe(0n);
    expect(prepared.data.outputCommitments).toEqual([
      prepared.outputs[0].commitment,
      prepared.outputs[1].commitment,
    ]);
    for (const output of prepared.outputs) {
      expect(output.ciphertext).toHaveLength(512);
      const opened = await decryptShieldedNote({
        hpkeIkm: getBytes(input.keys.hpkeIkm),
        ciphertext: output.ciphertext,
        chainId,
        poolAddress,
      });
      try {
        expect(verifyShieldedNotePayload({
          payload: opened,
          ciphertext: output.ciphertext,
          noteCommitment: output.commitment,
        }).noteCommitment).toBe(output.commitment);
      } finally {
        opened.fill(0);
      }
    }
  });

  it("rejects mismatched policy, enrollment, owner, or period rate", async () => {
    for (const secondNote of [
      { policySalt: 999n },
      { eligibleFrom: 999n },
      { heirIdentityCommitment: 999n },
      { amountPerPeriod: 5n },
    ]) {
      const input = await fixture({ secondNote });
      await expect(prepareShieldedMergeBudget(input)).rejects.toThrow();
    }
    const otherOwner = deriveShieldedHeirKeyMaterial(12345n).ownerCommitment;
    const input = await fixture({ secondNote: { heirOwnerCommitment: otherOwner } });
    await expect(prepareShieldedMergeBudget(input)).rejects.toThrow("another heir");
  });

  it("rejects duplicate or already spent inputs and a one-leaf anonymity set", async () => {
    const input = await fixture();
    await expect(prepareShieldedMergeBudget({
      ...input,
      inputCommitments: [input.inputCommitments[0], input.inputCommitments[0]],
    })).rejects.toThrow("distinct budget notes");
    const spent = computeShieldedSpendNullifier({
      ownerSecret: input.keys.ownerSecret,
      noteCommitment: input.inputCommitments[1],
    });
    input.wallet.spentNullifiers.add(spent);
    await expect(prepareShieldedMergeBudget(input)).rejects.toThrow("already been spent");
    input.wallet.spentNullifiers.clear();
    input.wallet.shards.set(0n, createLineageTree([input.inputCommitments[0]]));
    await expect(prepareShieldedMergeBudget(input)).rejects.toThrow("Single-leaf note roots");
  });

  it("rejects ciphertext tampering, incorrect wallet context, and identity mismatch", async () => {
    const input = await fixture();
    input.wallet.ownedNotes.get(input.inputCommitments[0])!.ciphertextHashField = 0n;
    await expect(prepareShieldedMergeBudget(input)).rejects.toThrow("does not match its public ciphertext");
    input.wallet.ownedNotes.get(input.inputCommitments[0])!.ciphertextHashField =
      input.records[0].ciphertextHashField;
    await expect(prepareShieldedMergeBudget({ ...input, chainId: 1n })).rejects.toThrow("does not match this chain");
    await expect(prepareShieldedMergeBudget({ ...input, derivedSecretField: 123n }))
      .rejects.toThrow("does not match this identity");
  });

  it("rejects a merged uint128 amount or uint64 period count overflow", async () => {
    const hugeRate = 1n << 127n;
    const amountOverflow = await fixture({
      rate: hugeRate,
      firstRemaining: hugeRate,
      secondRemaining: hugeRate,
    });
    await expect(prepareShieldedMergeBudget(amountOverflow)).rejects.toThrow("period limit");
    const maxPeriods = (1n << 64n) - 1n;
    const periodOverflow = await fixture({
      rate: 1n,
      firstRemaining: maxPeriods,
      secondRemaining: maxPeriods,
    });
    await expect(prepareShieldedMergeBudget(periodOverflow)).rejects.toThrow("period limit");
  });

  // Test-only opt-in for real proofs using the same public artifacts as the app.
  // eslint-disable-next-line no-restricted-syntax
  it.skipIf(process.env.SHIELDED_MERGE_PROOF !== "1")(
    "verifies a real Groth16 merge proof with current public artifacts",
    async () => {
      const prepared = await prepareShieldedMergeBudget(await fixture());
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-merge-prep-"));
      try {
        const source = "shielded_merge_budget";
        const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
        const artifacts = path.join(repoRoot, "frontend/public/zk/shielded");
        const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
        const inputPath = path.join(temporary, "input.json");
        const proofPath = path.join(temporary, "proof.json");
        const publicPath = path.join(temporary, "public.json");
        fs.writeFileSync(inputPath, JSON.stringify(prepared.witness));
        execFileSync(process.execPath, [
          cli,
          "groth16", "fullprove",
          inputPath,
          path.join(artifacts, `${source}.wasm`),
          path.join(artifacts, `${source}_final.zkey`),
          proofPath,
          publicPath,
        ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
        expect(JSON.parse(fs.readFileSync(publicPath, "utf8")))
          .toEqual(prepared.witness.publicSignals);
        const verified = execFileSync(process.execPath, [
          cli, "groth16", "verify",
          path.join(artifacts, `${source}.vkey.json`),
          publicPath,
          proofPath,
        ], { encoding: "utf8", timeout: 120_000 });
        expect(verified).toContain("OK!");
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
    180_000,
  );
});
