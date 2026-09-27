import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  computeShieldedRegistrationLeaf,
  createLineageTree,
  decodeShieldedNotePayload,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  splitShieldedViewPublicKey,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { getBigInt, getBytes, hexlify, type Contract } from "ethers";
import type { LineageSnapshot } from "./inheritanceChain";
import type { KeyRegistrySnapshot, PublicHeirKey } from "./shieldedKeyRegistryChain";
import { prepareShieldedAllocate, prepareShieldedTopUp } from "./shieldedFundingPreparation";
import { prepareShieldedCreatePolicy, prepareShieldedShield } from "./shieldedNotePreparation";
import type { LocalShieldedWalletSnapshot } from "./shieldedWalletRecovery";

const chainId = 1030n;
const poolAddress = "0x1111111111111111111111111111111111111111";
const registryAddress = "0x2222222222222222222222222222222222222222";
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
    return decodeShieldedNotePayload(payload);
  } finally {
    payload.fill(0);
  }
}

async function setup() {
  const donorKeys = deriveShieldedHeirKeyMaterial(donorSecret);
  const heirKeys = deriveShieldedHeirKeyMaterial(heirSecret);
  const shield = await prepareShieldedShield({ chainId, poolAddress, derivedSecretField: donorSecret, amount: 100n });
  const firstTree = createLineageTree(shield.outputs.map((output) => output.commitment));
  const preliminaryWallet: LocalShieldedWalletSnapshot = {
    poolAddress: poolAddress.toLowerCase(),
    chainId,
    toBlock: 10,
    blockHash,
    shards: new Map([[0n, firstTree]]),
    ownedNotes: new Map(shield.outputs.map((output, index) => [output.commitment, {
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
    }])),
    spentNullifiers: new Set(),
    walletOwnerCommitment: donorKeys.ownerCommitment,
  };
  const policy = await prepareShieldedCreatePolicy({
    chainId,
    poolAddress,
    derivedSecretField: donorSecret,
    wallet: preliminaryWallet,
    inputCommitment: shield.outputs[0].commitment,
    rootIdentityCommitment: rootIdentity,
    rootVersionIndex: 0n,
    amountPerPeriod: 10n,
  });
  const noteTree = createLineageTree([
    ...shield.outputs.map((output) => output.commitment),
    ...policy.outputs.map((output) => output.commitment),
  ]);
  const wallet: LocalShieldedWalletSnapshot = {
    ...preliminaryWallet,
    shards: new Map([[0n, noteTree]]),
  };
  const viewingKey = await deriveShieldedViewPublicKey(heirKeys.hpkeIkm);
  const { viewKeyHi, viewKeyLo } = splitShieldedViewPublicKey(viewingKey);
  const keyLeaf = computeShieldedRegistrationLeaf({
    identityCommitment: heirIdentity,
    ownerCommitment: heirKeys.ownerCommitment,
    viewKeyHi,
    viewKeyLo,
  });
  const keyTree = createLineageTree([keyLeaf, 123n]);
  const heirPersonHash = wrapIdentityCommitmentAsPersonHash(heirIdentity).toLowerCase();
  const heirKey: PublicHeirKey = {
    personHash: heirPersonHash,
    identityCommitment: heirIdentity,
    ownerCommitment: heirKeys.ownerCommitment,
    viewingKey: hexlify(viewingKey),
    shardId: 0n,
    leafIndex: 0n,
    leaf: keyLeaf,
  };
  const keyRegistry: KeyRegistrySnapshot = {
    registryAddress: registryAddress.toLowerCase(),
    chainId,
    toBlock: 10,
    blockHash,
    shards: new Map([[0n, keyTree]]),
    keys: new Map([[heirPersonHash, heirKey]]),
  };
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
    endorsementTree,
    trustedTree,
    versions: new Map([
      [rootPersonHash, [{
        personHash: rootPersonHash,
        versionIndex: 0,
        identityCommitment: rootIdentity,
        fatherIdentityCommitment: 0n,
        motherIdentityCommitment: 0n,
      }]],
      [heirPersonHash, [{
        personHash: heirPersonHash,
        versionIndex: 0,
        identityCommitment: heirIdentity,
        fatherIdentityCommitment: rootIdentity,
        motherIdentityCommitment: 555n,
      }]],
    ]),
    endorsements: new Map([[heirPersonHash, new Map([[endorser.toLowerCase(), {
      versionIndex: 0,
      timestamp: endorsedAt,
    }]])]]),
    trustedEndorsers: new Map([[`${rootPersonHash}:0`, new Set([endorser.toLowerCase()])]]),
  };
  const provider = {
    getNetwork: async () => ({ chainId }),
    getBlock: async (block: number | string) => block === "latest"
      ? { number: 10, timestamp, hash: blockHash }
      : block === 10 ? { number: 10, timestamp, hash: blockHash } : null,
  };
  const pool = {
    runner: { provider },
    getAddress: async () => poolAddress,
    KEY_REGISTRY: async () => registryAddress,
    LINEAGE_INDEX: async () => lineageAddress,
  } as unknown as Contract;
  const lineageIndex = {
    getAddress: async () => lineageAddress,
    root: async (which: number) => which === 0 ? chainEndorsementRoot : chainTrustedRoot,
  } as unknown as Contract;
  const common = {
    pool,
    wallet,
    donorDerivedSecretField: donorSecret,
    donorCommitment: shield.outputs[0].commitment,
    keyRegistry,
    heirPersonHash,
  };
  return { common, pool, policy, keyRegistry, lineage, lineageIndex, heirKeys, noteTree };
}

describe("local private allocation and top-up preparation", () => {
  it("builds exact 32 public signals, a current direct-child witness, and a child-decryptable budget", async () => {
    const fixture = await setup();
    const prepared = await prepareShieldedAllocate({
      ...fixture.common,
      policy: { ...fixture.policy.outputs[0], shardId: 0n },
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 5n,
    });
    const signals = prepared.witness.publicSignals as string[];
    expect(signals).toHaveLength(32);
    expect(signals[0]).toBe("2");
    expect(signals[27]).toBe(String(fixture.lineage.endorsementTree.root));
    expect(signals[28]).toBe(String(fixture.lineage.trustedTree.root));
    expect(signals[29]).toBe(String(timestamp));
    expect(signals[30]).toBe(String(fixture.keyRegistry.shards.get(0n)!.root));
    expect(prepared.data.inputRoots).toEqual([fixture.noteTree.root, fixture.noteTree.root]);
    expect(prepared.witness.endorsementSiblings).toHaveLength(64);
    expect(prepared.witness.trustedSiblings).toHaveLength(64);
    expect(prepared.witness.registrationSiblings).toHaveLength(32);
    expect(await open(prepared.outputs[0].ciphertext, heirSecret)).toMatchObject({
      kind: "budget",
      heirIdentityCommitment: heirIdentity,
      remaining: 50n,
      eligibleFrom: BigInt(timestamp + 7200),
    });
    expect(await open(prepared.outputs[1].ciphertext, donorSecret)).toMatchObject({ kind: "value", amount: 50n });
    const payload = await decryptShieldedNote({
      hpkeIkm: getBytes(fixture.heirKeys.hpkeIkm),
      ciphertext: prepared.outputs[0].ciphertext,
      chainId,
      poolAddress,
    });
    try {
      expect(verifyShieldedNotePayload({
        payload,
        ciphertext: prepared.outputs[0].ciphertext,
        noteCommitment: prepared.outputs[0].commitment,
      }).note.kind).toBe("budget");
    } finally {
      payload.fill(0);
    }
  });

  it("uses an existing child budget only as a read-only template and funds new periods from donor value", async () => {
    const fixture = await setup();
    const allocated = await prepareShieldedAllocate({
      ...fixture.common,
      policy: { ...fixture.policy.outputs[0], shardId: 0n },
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 5n,
    });
    fixture.noteTree.insert(allocated.outputs[0].commitment);
    fixture.noteTree.insert(allocated.outputs[1].commitment);
    const topUp = await prepareShieldedTopUp({
      ...fixture.common,
      budget: { ...allocated.outputs[0], shardId: 0n },
      topUpPeriods: 3n,
    });
    const signals = topUp.witness.publicSignals as string[];
    expect(signals).toHaveLength(32);
    expect(signals[0]).toBe("3");
    expect(signals[27]).toBe("0");
    expect(signals[28]).toBe("0");
    expect(signals[29]).toBe("0");
    expect(topUp.data.inputRoots).toEqual([fixture.noteTree.root, fixture.noteTree.root]);
    expect(topUp.witness.oldBudgetRemainingPeriods).toBe("5");
    expect(topUp.witness.topUpPeriods).toBe("3");
    expect(await open(topUp.outputs[0].ciphertext, heirSecret)).toMatchObject({
      kind: "budget", remaining: 30n, eligibleFrom: BigInt(timestamp + 7200),
    });
    expect(await open(topUp.outputs[1].ciphertext, donorSecret)).toMatchObject({ kind: "value", amount: 70n });
  });

  it("rejects insufficient funds, stale lineage, a one-key root, and a substituted template", async () => {
    const fixture = await setup();
    const input = {
      ...fixture.common,
      policy: { ...fixture.policy.outputs[0], shardId: 0n },
      lineageIndex: fixture.lineageIndex,
      lineage: fixture.lineage,
      budgetPeriods: 11n,
    };
    await expect(prepareShieldedAllocate(input)).rejects.toThrow("cannot fund the whole");
    fixture.lineage.endorsementTree.insert(999n);
    await expect(prepareShieldedAllocate({ ...input, budgetPeriods: 1n })).rejects.toThrow("roots are stale");
    const oneKeyFixture = await setup();
    oneKeyFixture.keyRegistry.shards.set(0n, createLineageTree([oneKeyFixture.keyRegistry.keys.get(oneKeyFixture.common.heirPersonHash)!.leaf]));
    await expect(prepareShieldedAllocate({
      ...oneKeyFixture.common,
      policy: { ...oneKeyFixture.policy.outputs[0], shardId: 0n },
      lineageIndex: oneKeyFixture.lineageIndex,
      lineage: oneKeyFixture.lineage,
      budgetPeriods: 1n,
    })).rejects.toThrow("at least two keys");
    const validFixture = await setup();
    const tampered = new Uint8Array(validFixture.policy.outputs[0].ciphertext);
    tampered[100] ^= 1;
    await expect(prepareShieldedAllocate({
      ...validFixture.common,
      budgetPeriods: 1n,
      lineageIndex: validFixture.lineageIndex,
      lineage: validFixture.lineage,
      policy: { ...validFixture.policy.outputs[0], shardId: 0n, ciphertext: tampered },
    })).rejects.toThrow("does not match");
  });

  it("requires a current donor event replay and an owned donor note", async () => {
    const stale = await setup();
    stale.common.wallet.toBlock = 9;
    await expect(prepareShieldedAllocate({
      ...stale.common,
      policy: { ...stale.policy.outputs[0], shardId: 0n },
      lineageIndex: stale.lineageIndex,
      lineage: stale.lineage,
      budgetPeriods: 1n,
    })).rejects.toThrow("Wallet snapshot is stale");

    const forged = await setup();
    const owned = forged.common.wallet.ownedNotes.get(forged.common.donorCommitment);
    if (!owned || owned.note.kind !== "value") throw new Error("Test donor note is missing");
    owned.note.ownerCommitment = 1n;
    await expect(prepareShieldedAllocate({
      ...forged.common,
      policy: { ...forged.policy.outputs[0], shardId: 0n },
      lineageIndex: forged.lineageIndex,
      lineage: forged.lineage,
      budgetPeriods: 1n,
    })).rejects.toThrow("belongs to another identity");
  });

  // Development artifacts are ignored and never loaded by the runtime app.
  // eslint-disable-next-line no-restricted-syntax
  it.skipIf(process.env.SHIELDED_FUNDING_DEV_PROOF !== "1")(
    "verifies the composed Allocate and TopUp witnesses with local development Groth16 keys",
    async () => {
      const fixture = await setup();
      const allocated = await prepareShieldedAllocate({
        ...fixture.common,
        policy: { ...fixture.policy.outputs[0], shardId: 0n },
        lineageIndex: fixture.lineageIndex,
        lineage: fixture.lineage,
        budgetPeriods: 5n,
      });
      fixture.noteTree.insert(allocated.outputs[0].commitment);
      fixture.noteTree.insert(allocated.outputs[1].commitment);
      const topUp = await prepareShieldedTopUp({
        ...fixture.common,
        budget: { ...allocated.outputs[0], shardId: 0n },
        topUpPeriods: 3n,
      });
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-funding-prep-"));
      try {
        const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
        const artifacts = path.join(repoRoot, "zk-artifacts/shielded");
        const cli = path.join(repoRoot, "node_modules/snarkjs/build/cli.cjs");
        for (const [source, witness] of [
          ["shielded_allocate", allocated.witness],
          ["shielded_top_up", topUp.witness],
        ] as const) {
          const inputPath = path.join(temporary, `${source}.input.json`);
          const proofPath = path.join(temporary, `${source}.proof.json`);
          const publicPath = path.join(temporary, `${source}.public.json`);
          fs.writeFileSync(inputPath, JSON.stringify(witness));
          execFileSync(process.execPath, [
            cli,
            "groth16", "fullprove",
            inputPath,
            path.join(artifacts, `${source}_js`, `${source}.wasm`),
            path.join(artifacts, `${source}_dev_final.zkey`),
            proofPath,
            publicPath,
          ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
          expect(JSON.parse(fs.readFileSync(publicPath, "utf8"))).toEqual(witness.publicSignals);
          const verified = execFileSync(process.execPath, [
            cli, "groth16", "verify",
            path.join(artifacts, `${source}.vkey.json`),
            publicPath,
            proofPath,
          ], { encoding: "utf8", timeout: 120_000 });
          expect(verified).toMatch(/OK!/u);
        }
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
    300_000,
  );
});
