import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Interface, getBigInt, hexlify, type Contract } from "ethers";
import {
  SECONDS_PER_DAY,
  SHIELDED_POOL_PROTOCOL_VERSION,
  computeIdentityFromDerivedSecret,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedViewPublicKey,
  getShieldedBudgetCommitments,
  isPublicShieldedBudgetEnvelope,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { LineageSnapshot } from "./inheritanceChain";
import type { VerifiedShieldedRecipient } from "./shieldedReceiveCode";
import { selectClaimBudget } from "./shieldedActionSelection";
import { prepareShieldedClaim } from "./shieldedClaimPreparation";
import { createShieldedPolicyDescriptor, prepareShieldedFund } from "./shieldedFundingPreparation";
import { prepareShieldedShield } from "./shieldedNotePreparation";
import {
  listRecoveredFundingTemplates,
  listRecoveredShieldedPolicies,
  listUnspentRecoveredShieldedNotes,
  recoverLocalShieldedWallet,
} from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const lineageAddress = "0x2222222222222222222222222222222222222222";
const endorser = "0x3333333333333333333333333333333333333333";
const rootIC = 111n;
const donorSecret = 777n;
const childSecret = 888n;
const donorKeys = { ...deriveShieldedHeirKeyMaterial(donorSecret), keyMode: 0 as const };
const initialTime = 1_700_000_000n;

/** Opt-in circuit assertions for the exact public/private witnesses prepared by the UI service. */
function checkWitness(circuit: "fund" | "claim", witness: Record<string, unknown>) {
  // eslint-disable-next-line no-restricted-syntax
  if (process.env.SHIELDED_UNIFIED_WITNESS !== "1") return;
  const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-unified-witness-"));
  try {
    const inputPath = path.join(temporary, "input.json");
    fs.writeFileSync(inputPath, JSON.stringify(witness));
    execFileSync(
      process.execPath,
      [
        path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs"),
        "wtns",
        "calculate",
        path.join(repoRoot, `frontend/public/zk/shielded/shielded_${circuit}.wasm`),
        inputPath,
        path.join(temporary, "witness.wtns"),
      ],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function childIdentity(): IdentityMaterialV1Result {
  const material = computeIdentityFromDerivedSecret({
    identity: {
      fullName: "Unified Child",
      isBirthBC: false,
      birthYear: 2000,
      birthMonth: 1,
      birthDay: 2,
      gender: 1,
    },
    identitySuiteId: 1,
    derivedSecretField: childSecret,
  });
  return {
    ...material,
    derivedSecretField: String(material.derivedSecretField),
    identityCommitment: String(material.identityCommitment),
    nameField: String(material.nameField),
    packedBirthGenderField: String(material.packedBirthGenderField),
    suiteCommitment: String(material.suiteCommitment),
    nameSecretCommitment: String(material.nameSecretCommitment),
  };
}

async function fixture(periodDays = 30n, keyMode: 0 | 1 = 0) {
  const identity = childIdentity();
  const childIC = BigInt(identity.identityCommitment);
  const rootHash = wrapIdentityCommitmentAsPersonHash(rootIC).toLowerCase();
  const childHash = identity.personHash.toLowerCase();
  const writtenAt = initialTime - 100n;
  const endorsementTree = createLineageTree([
    computeLineageEndorsementLeaf({
      identityCommitment: childIC,
      parentsDigest: computeLineageParentsDigest({
        fatherIdentityCommitment: rootIC,
        motherIdentityCommitment: 999n,
      }),
      versionIndex: 2n,
      endorser,
      writtenAt,
    }),
    77n,
  ]);
  const trustedTree = createLineageTree([
    computeLineageTrustedLeaf({
      rootIdentityCommitment: rootIC,
      rootVersionIndex: 1n,
      account: endorser,
    }),
    88n,
  ]);
  const lineage: LineageSnapshot = {
    blockNumber: 10,
    blockHash: `0x${"ab".repeat(32)}`,
    timestamp: initialTime,
    checkpointId: 7n,
    checkpointCreatedAt: 0n,
    endorsementTree,
    trustedTree,
    versions: new Map([
      [
        rootHash,
        [
          {
            personHash: rootHash,
            versionIndex: 1,
            identityCommitment: rootIC,
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
          },
        ],
      ],
      [
        childHash,
        [
          {
            personHash: childHash,
            versionIndex: 2,
            identityCommitment: childIC,
            fatherIdentityCommitment: rootIC,
            motherIdentityCommitment: 999n,
          },
        ],
      ],
    ]),
    endorsements: new Map([
      [childHash, new Map([[endorser.toLowerCase(), { versionIndex: 2, timestamp: writtenAt }]])],
    ]),
    trustedEndorsers: new Map([[`${rootHash}:1`, new Set([endorser.toLowerCase()])]]),
  };
  const iface = new Interface([
    "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
    "event NullifierSpent(uint256 nullifier)",
    "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
    "function protocolVersion() view returns (uint256)",
    "function nullifierCount() view returns (uint256)",
  ]);
  const tree = createLineageTree();
  const logs: Array<{
    data: string;
    topics: string[];
    address: string;
    blockNumber: number;
    index: number;
    transactionHash: string;
  }> = [];
  let now = initialTime;
  let nullifierCount = 0n;
  const getLogs = vi.fn(async () => [...logs]);
  const provider = {
    getNetwork: async () => ({ chainId }),
    getBlockNumber: async () => 10,
    getBlock: async () => ({ number: 10, timestamp: Number(now), hash: `0x${"ab".repeat(32)}` }),
    getLogs,
  };
  const pool = {
    interface: iface,
    runner: { provider },
    getAddress: async () => poolAddress,
    protocolVersion: async () => BigInt(SHIELDED_POOL_PROTOCOL_VERSION),
    nullifierCount: async () => nullifierCount,
    LINEAGE_INDEX: async () => lineageAddress,
    currentShardId: async () => 0n,
    noteShard: async () => ({ size: tree.sizeBigInt, root: tree.root }),
  } as unknown as Contract;
  const lineageIndex = {
    getAddress: async () => lineageAddress,
    identityCommitmentOf: vi.fn(async (hash: string) =>
      hash.toLowerCase() === childHash ? childIC : 0n,
    ),
    root: async (which: number) => (which === 0 ? endorsementTree.root : trustedTree.root),
    isKnownCheckpoint: async (id: bigint, endorsement: bigint, trusted: bigint) =>
      id === 7n && endorsement === endorsementTree.root && trusted === trustedTree.root,
  } as unknown as Contract;
  function record(
    prepared: {
      outputs: readonly { commitment: bigint; ciphertext: Uint8Array }[];
      data: {
        inputShardIds: readonly unknown[];
        inputNullifiers: readonly unknown[];
        periodNullifiers: readonly unknown[];
      };
    },
    action: 0 | 1 | 2,
  ) {
    if (prepared.outputs.length !== 2) throw new Error("An action must have two outputs");
    const transactionHash = `0x${BigInt(logs.length + 1)
      .toString(16)
      .padStart(64, "0")}`;
    for (const value of [...prepared.data.inputNullifiers, ...prepared.data.periodNullifiers]) {
      const nf = getBigInt(value as bigint);
      if (nf !== 0n) {
        nullifierCount += 1n;
        logs.push({
          ...iface.encodeEventLog(iface.getEvent("NullifierSpent")!, [nf]),
          address: poolAddress,
          blockNumber: 10,
          index: logs.length,
          transactionHash,
        });
      }
    }
    logs.push({
      ...iface.encodeEventLog(iface.getEvent("ActionExecuted")!, [
        action, prepared.data.inputShardIds[0] ?? 0n, prepared.data.inputShardIds[1] ?? prepared.data.inputShardIds[0] ?? 0n,
      ]),
      address: poolAddress,
      blockNumber: 10,
      index: logs.length,
      transactionHash,
    });
    for (const output of prepared.outputs) {
      const index = tree.sizeBigInt;
      tree.insert(output.commitment);
      logs.push({
        ...iface.encodeEventLog(iface.getEvent("NoteAppended")!, [
          0n,
          index,
          output.commitment,
          tree.root,
          output.ciphertext,
        ]),
        address: poolAddress,
        blockNumber: 10,
        index: logs.length,
        transactionHash,
      });
    }
  }
  const shield = await prepareShieldedShield({
    chainId,
    poolAddress,
    keyMaterial: donorKeys,
    amount: 100n,
  });
  record(shield, 0);
  const donor = await recoverLocalShieldedWallet(pool, {
    keyMaterial: donorKeys,
    identityCommitment: rootIC,
  });
  const policy = createShieldedPolicyDescriptor(
    {
      rootIdentityCommitment: rootIC,
      rootVersionIndex: 1n,
      amountPerPeriod: 10n,
      periodDays,
    },
    { chainId, poolAddress },
  );
  const childKeys = keyMode === 0
    ? { ...deriveShieldedHeirKeyMaterial(childSecret), keyMode: 0 as const }
    : await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: new Uint8Array(32).fill(33),
        independentKeyIdentitySecret: new Uint8Array(32).fill(44),
      });
  const childRecovery = { keyMaterial: childKeys, identityCommitment: childIC };
  const recipient = {
    disclosure: "fund",
    keyMode,
    identityCommitment: childIC,
    personHash: identity.personHash,
    ownerCommitment: childKeys.ownerCommitment,
    viewingKey: hexlify(await deriveShieldedViewPublicKey(childKeys.hpkeIkm)),
  } as VerifiedShieldedRecipient;
  const common = {
    pool,
    wallet: donor,
    keyMaterial: donorKeys,
    donorCommitment: shield.outputs[0].commitment,
    lineageIndex,
    publicRecipientPersonHash: identity.personHash,
  };
  return {
    common,
    policy,
    lineage,
    pool,
    identity,
    childKeys,
    childRecovery,
    recipient,
    record,
    getLogs,
    mature() {
      now = initialTime + 7200n + 4n * periodDays * SECONDS_PER_DAY;
      lineage.timestamp = now;
    },
    get now() {
      return now;
    },
  };
}

describe("unified budget recovery and claims", () => {
  it.each([1n, 7n, 365n])(
    "funds a %s-day identity budget without a receive code, recovers it, claims privately and refills from donor backup",
    async (periodDays) => {
      const f = await fixture(periodDays);
      const funded = await prepareShieldedFund({
        ...f.common,
        fundMode: 0,
        budgetKind: 1,
        policy: f.policy,
        lineage: f.lineage,
        budgetPeriods: 5n,
      });
      checkWitness("fund", funded.witness);
      expect(funded.data.budgetKind).toBe(1n);
      expect(funded.witness.publicBudget).toHaveLength(10);
      expect((funded.witness.publicBudget as string[])[9]).toBe(periodDays.toString());
      expect(funded.outputs[0].note.periodDays).toBe(periodDays);
      expect(funded.witness.heirOwnerCommitment).toBe("0");
      expect(isPublicShieldedBudgetEnvelope(funded.outputs[0].ciphertext)).toBe(true);
      expect(funded.outputs[0].note).not.toHaveProperty("policySalt");
      f.record(funded, 1);
      const donor = await recoverLocalShieldedWallet(f.pool, {
        keyMaterial: donorKeys,
        identityCommitment: rootIC,
      });
      const template = listRecoveredFundingTemplates(donor)[0];
      expect(template.ruleOpening?.policySalt).toBe(f.policy.policySalt);
      expect(listRecoveredShieldedPolicies(donor)).toEqual([f.policy]);
      expect(donor.ownedNotes.has(funded.outputs[0].commitment)).toBe(false);
      const child = await recoverLocalShieldedWallet(f.pool, f.childRecovery);
      expect(child.ownedNotes.has(funded.outputs[0].commitment)).toBe(true);
      const wrongChild = await recoverLocalShieldedWallet(f.pool, {
        keyMaterial: { ...deriveShieldedHeirKeyMaterial(889n), keyMode: 0 },
        identityCommitment: 123n,
      });
      expect(wrongChild.ownedNotes.size).toBe(0);
      for (const [filter] of f.getLogs.mock.calls as unknown as Array<[Record<string, unknown>]>) {
        expect((filter.topics as unknown[]).length).toBe(1);
        expect(filter).not.toHaveProperty("recipient");
      }
      f.mature();
      const claimed = await prepareShieldedClaim({
        chainId,
        poolAddress,
        identity: f.identity,
        keyMaterial: f.childKeys,
        wallet: child,
        lineage: f.lineage,
        budgetCommitment: funded.outputs[0].commitment,
        asOf: f.now,
        periodIndices: [0n, 1n],
      });
      checkWitness("claim", claimed.witness);
      expect(claimed.witness.budgetKind).toBe("1");
      expect(claimed.witness.periodDays).toBe(periodDays.toString());
      for (const name of ["policySalt", "allocationKeyCommitment", "enrollmentSalt"])
        expect(claimed.witness[name]).toBe("0");
      expect(claimed.outputs[0].note.binding).toBe("identity");
      expect(isPublicShieldedBudgetEnvelope(claimed.outputs[0].ciphertext)).toBe(false);
      expect(claimed.outputs[1].note.ownerCommitment).toBe(f.childKeys.ownerCommitment);
      f.record(claimed, 2);
      const afterClaim = await recoverLocalShieldedWallet(f.pool, f.childRecovery);
      const live = listUnspentRecoveredShieldedNotes(afterClaim, f.childKeys);
      expect(live.find((entry) => entry.note.kind === "value")?.note).toMatchObject({
        amount: 20n,
      });
      const recoveredDonor = await recoverLocalShieldedWallet(f.pool, {
        keyMaterial: donorKeys,
        identityCommitment: rootIC,
      });
      const refill = await prepareShieldedFund({
        ...f.common,
        wallet: recoveredDonor,
        donorCommitment: funded.outputs[1].commitment,
        fundMode: 1,
        budgetKind: 1,
        budget: listRecoveredFundingTemplates(recoveredDonor)[0],
        budgetPeriods: 3n,
      });
      checkWitness("fund", refill.witness);
      expect(refill.outputs[0].note.periodDays).toBe(periodDays);
      expect(
        getShieldedBudgetCommitments(refill.outputs[0].note, { chainId, poolAddress }),
      ).toEqual(getShieldedBudgetCommitments(funded.outputs[0].note, { chainId, poolAddress }));
      f.record(refill, 1);
      const replenished = await recoverLocalShieldedWallet(f.pool, f.childRecovery);
      const choice = selectClaimBudget(
        listUnspentRecoveredShieldedNotes(replenished, f.childKeys),
        replenished,
        childSecret,
        f.now,
      );
      expect(choice?.periodIndices).toEqual([2n, 3n]);
      await expect(
        prepareShieldedClaim({
          chainId,
          poolAddress,
          identity: f.identity,
        keyMaterial: f.childKeys,
          wallet: replenished,
          lineage: f.lineage,
          budgetCommitment: claimed.outputs[0].commitment,
          asOf: f.now,
          periodIndices: [0n],
        }),
      ).rejects.toThrow("already");
    },
  );

  it.each([0, 1] as const)("preserves private authorization while consuming only one budget in key mode %s", async (keyMode) => {
    const f = await fixture(30n, keyMode);
    await expect(
      prepareShieldedFund({
        ...f.common,
        fundMode: 0,
        policy: f.policy,
        lineage: f.lineage,
        budgetPeriods: 1n,
      }),
    ).rejects.toThrow("current Fund identity disclosure material");
    const privateFund = await prepareShieldedFund({
      ...f.common,
      recipient: f.recipient,
      fundMode: 0,
      policy: f.policy,
      lineage: f.lineage,
      budgetPeriods: 1n,
    });
    checkWitness("fund", privateFund.witness);
    expect(privateFund.witness.publicBudget).toEqual(Array(10).fill("0"));
    f.record(privateFund, 1);
    const donor = await recoverLocalShieldedWallet(f.pool, {
      keyMaterial: donorKeys,
      identityCommitment: rootIC,
    });
    const budget = listRecoveredFundingTemplates(donor)[0];
    await expect(
      prepareShieldedFund({
        ...f.common,
        wallet: donor,
        donorCommitment: privateFund.outputs[1].commitment,
        fundMode: 1,
        budgetKind: 1,
        budget,
        budgetPeriods: 2n,
      }),
    ).rejects.toThrow("binding");
    await expect(prepareShieldedFund({
      ...f.common,
      wallet: donor,
      donorCommitment: privateFund.outputs[1].commitment,
      fundMode: 1,
      budgetKind: 0,
      budget,
      budgetPeriods: 2n,
    })).rejects.toThrow("current Fund identity disclosure material");
    const privateRefill = await prepareShieldedFund({
      ...f.common,
      recipient: f.recipient,
      wallet: donor,
      donorCommitment: privateFund.outputs[1].commitment,
      fundMode: 1,
      budgetKind: 0,
      budget,
      budgetPeriods: 2n,
    });
    checkWitness("fund", privateRefill.witness);
    f.record(privateRefill, 1);
    f.mature();
    const wallet = await recoverLocalShieldedWallet(f.pool, f.childRecovery);
    const selection = selectClaimBudget(
      listUnspentRecoveredShieldedNotes(wallet, f.childKeys),
      wallet,
      childSecret,
      f.now,
    );
    expect(selection).not.toHaveProperty("secondBudget");
    const claim = await prepareShieldedClaim({
      chainId,
      poolAddress,
      identity: f.identity,
        keyMaterial: f.childKeys,
      wallet,
      lineage: f.lineage,
      budgetCommitment: privateRefill.outputs[0].commitment,
      asOf: f.now,
      periodIndices: [0n, 1n],
    });
    checkWitness("claim", claim.witness);
    expect(claim.witness.budgetKind).toBe("0");
    expect(claim.witness).not.toHaveProperty("secondBudgetKind");
    expect(claim.outputs[0].note).toMatchObject({
      heirOwnerCommitment: f.childKeys.ownerCommitment,
      remaining: 0n,
      keyMode: BigInt(keyMode),
    });
    expect(wallet.ownedNotes.has(privateFund.outputs[0].commitment)).toBe(true);
    expect(claim.data.inputNullifiers).toHaveLength(1);
  });
  it("ignores a malformed public envelope while recovering later private notes", async () => {
    const f = await fixture();
    const fund = await prepareShieldedFund({
      ...f.common,
      fundMode: 0,
      budgetKind: 1,
      policy: f.policy,
      lineage: f.lineage,
      budgetPeriods: 1n,
    });
    const bad = fund.outputs[0].ciphertext.slice();
    bad[511] = 1;
    const own = await prepareShieldedShield({
      chainId,
      poolAddress,
      keyMaterial: f.childKeys,
      amount: 9n,
    });
    f.record({
      outputs: [
        { commitment: 123456n, ciphertext: bad },
        { commitment: 123457n, ciphertext: bad },
      ],
      data: { inputShardIds: [0n, 0n], inputNullifiers: [0n, 0n], periodNullifiers: [] },
    }, 0);
    f.record(own, 0);
    const wallet = await recoverLocalShieldedWallet(f.pool, f.childRecovery);
    expect(wallet.ownedNotes.has(123456n)).toBe(false);
    expect(wallet.ownedNotes.has(own.outputs[0].commitment)).toBe(true);
    expect(
      listUnspentRecoveredShieldedNotes(wallet, f.childKeys).filter(
        (entry) => entry.note.kind === "value",
      ),
    ).toHaveLength(2);
  });
});
