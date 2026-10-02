import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Interface, getBytes, ZeroAddress, type Contract, type Signer } from "ethers";
import {
  INHERITANCE_PERIOD_SECONDS,
  buildShieldedPublicClaimPublicInputs,
  computeIdentityFromDerivedSecret,
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  verifyShieldedNotePayload,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import type { LineageSnapshot } from "./inheritanceChain";
import {
  readPublicBudgets,
  listIncomingPublicBudgets,
  listOutgoingPublicBudgets,
  previewPublicBudgetClaim,
  preparePublicBudgetFunding,
  preparePublicBudgetClaim,
  submitPublicBudgetFunding,
  submitPublicBudgetClaim,
  type PublicBudget,
} from "./publicBudgetFlows";

const mocks = vi.hoisted(() => ({ zkWorkerCall: vi.fn() }));
vi.mock("../../../shared/workers/zkWorkerClient", () => ({ zkWorkerCall: mocks.zkWorkerCall }));
const CHAIN = 1030n;
const POOL = "0x1111111111111111111111111111111111111111";
const INDEX = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const FUNDER = "0x4444444444444444444444444444444444444444";
const OTHER = "0x5555555555555555555555555555555555555555";
const ROOT = 123456n;
const ROOT_HASH = wrapIdentityCommitmentAsPersonHash(ROOT).toLowerCase();
const ENDO = "0x6666666666666666666666666666666666666666";
const SECRET = 987654321n;
const HASH = `0x${"a".repeat(64)}`;
const ABI = [
  "event PublicBudgetFunded(uint64 indexed budgetId,bytes32 indexed heirPersonHash,address indexed funder,bytes32 rootPersonHash,uint64 rootVersionIndex,uint128 amountPerPeriod,uint64 eligibleFrom,uint128 amount,uint128 remaining)",
  "event PublicBudgetClaimed(uint64 indexed budgetId,bytes32 indexed heirPersonHash,uint64 firstPeriod,uint8 claimCount,uint128 amount,uint128 remaining)",
];
const PROOF = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["3", "4"],
    ["5", "6"],
    ["1", "0"],
  ],
  pi_c: ["7", "8", "1"],
};

function fixture() {
  const material = computeIdentityFromDerivedSecret({
    identity: {
      fullName: "Public Heir",
      gender: 1,
      birthYear: 2000,
      birthMonth: 1,
      birthDay: 2,
      isBirthBC: false,
    },
    identitySuiteId: 1,
    derivedSecretField: SECRET,
  });
  const identity: IdentityMaterialV1Result = {
    identity: material.identity,
    identitySuiteId: material.identitySuiteId,
    derivedSecretField: String(SECRET),
    nameField: String(material.nameField),
    packedBirthGenderField: String(material.packedBirthGenderField),
    suiteCommitment: String(material.suiteCommitment),
    nameSecretCommitment: String(material.nameSecretCommitment),
    identityCommitment: String(material.identityCommitment),
    personHash: material.personHash,
  };
  const heirHash = identity.personHash.toLowerCase();
  const endorsement = computeLineageEndorsementLeaf({
    identityCommitment: material.identityCommitment,
    parentsDigest: computeLineageParentsDigest({
      fatherIdentityCommitment: ROOT,
      motherIdentityCommitment: 999n,
    }),
    versionIndex: 2n,
    endorser: ENDO,
    writtenAt: 500n,
  });
  const trust = computeLineageTrustedLeaf({
    rootIdentityCommitment: ROOT,
    rootVersionIndex: 3n,
    account: ENDO,
  });
  const lineage: LineageSnapshot = {
    blockNumber: 1,
    versions: new Map([
      [
        ROOT_HASH,
        [
          {
            personHash: ROOT_HASH,
            versionIndex: 3,
            identityCommitment: ROOT,
            fatherIdentityCommitment: 0n,
            motherIdentityCommitment: 0n,
          },
        ],
      ],
      [
        heirHash,
        [
          {
            personHash: heirHash,
            versionIndex: 2,
            identityCommitment: material.identityCommitment,
            fatherIdentityCommitment: ROOT,
            motherIdentityCommitment: 999n,
          },
        ],
      ],
    ]),
    endorsements: new Map([[heirHash, new Map([[ENDO, { versionIndex: 2, timestamp: 500n }]])]]),
    trustedEndorsers: new Map(),
    endorsementTree: createLineageTree([endorsement, 77n]),
    trustedTree: createLineageTree([trust, 88n]),
  };
  let row: PublicBudget = {
    budgetId: 1n,
    createdBy: FUNDER,
    rootPersonHash: ROOT_HASH,
    rootVersionIndex: 3n,
    heirPersonHash: heirHash,
    amountPerPeriod: 100n,
    eligibleFrom: 1000n,
    remaining: 1200n,
    nextPeriod: 0n,
  };
  let chainId = CHAIN;
  let blockHash = HASH;
  let timestamp = 1000n + 12n * INHERITANCE_PERIOD_SECONDS;
  let endorsementRoot = lineage.endorsementTree.root;
  const logs: Array<Record<string, unknown>> = [];
  const iface = new Interface(ABI);
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId })),
    getBlockNumber: vi.fn(async () => 1),
    getBlock: vi.fn(async () => ({ number: 1, hash: blockHash, timestamp: Number(timestamp) })),
    getLogs: vi.fn(async (_filter: Record<string, unknown>) => logs),
    getFeeData: vi.fn(async () => ({ maxFeePerGas: 1n, gasPrice: null })),
    getBalance: vi.fn(async () => 10n ** 18n),
  };
  const transaction = (name: string) =>
    Object.assign(
      vi.fn(async () => ({ hash: `0x${name}`, wait: async () => ({ status: 1 }) })),
      { estimateGas: vi.fn(async () => 100_000n) },
    );
  const fundPublic = transaction("fundPublic");
  const claimPublic = transaction("claimPublic");
  const approve = transaction("approve");
  const pool = {
    interface: iface,
    runner: { provider },
    getAddress: async () => POOL,
    LINEAGE_INDEX: async () => INDEX,
    TOKEN: async () => TOKEN,
    publicBudgetCount: async () => 1n,
    publicBudgets: vi.fn(async () => ({ ...row })),
    connect: () => ({ fundPublic, claimPublic }),
  } as unknown as Contract;
  const lineageIndex = {
    getAddress: async () => INDEX,
    root: vi.fn(async (treeId: number) =>
      treeId === 0 ? endorsementRoot : lineage.trustedTree.root,
    ),
  } as unknown as Contract;
  const token = {
    getAddress: async () => TOKEN,
    balanceOf: vi.fn(async () => 10_000n),
    allowance: vi.fn(async () => 0n),
    connect: () => ({ approve }),
  } as unknown as Contract;
  const signer = { provider, getAddress: async () => FUNDER } as unknown as Signer;
  function log(name: string, values: unknown[]) {
    logs.push({
      ...iface.encodeEventLog(iface.getEvent(name)!, values),
      address: POOL,
      blockNumber: 1,
      index: logs.length,
    });
  }
  return {
    identity,
    lineage,
    lineageIndex,
    pool,
    token,
    signer,
    provider,
    fundPublic,
    claimPublic,
    approve,
    logs,
    log,
    funding: {
      pool,
      lineageIndex,
      lineage,
      rootPersonHash: ROOT_HASH,
      rootVersionIndex: 3n,
      heirPersonHash: heirHash,
      amountPerPeriod: 100n,
      budgetPeriods: 3n,
    },
    get row() {
      return row;
    },
    set row(value: PublicBudget) {
      row = value;
    },
    setTimestamp: (value: bigint) => {
      timestamp = value;
    },
    setChain: (value: bigint) => {
      chainId = value;
    },
    reorganize: () => {
      blockHash = `0x${"b".repeat(64)}`;
    },
    changeLineage: () => {
      endorsementRoot += 1n;
    },
  };
}
beforeEach(() => {
  mocks.zkWorkerCall.mockReset();
  mocks.zkWorkerCall.mockImplementation(async (_name, params) => ({
    proof: PROOF,
    publicSignals: params.expectedPublicSignals,
  }));
});

describe("public budget recovery and sequential claims", () => {
  it("replays initial funding, claiming, and another donor's additional funding at a pinned block", async () => {
    const f = fixture();
    f.log("PublicBudgetFunded", [
      1n,
      f.row.heirPersonHash,
      FUNDER,
      ROOT_HASH,
      3n,
      100n,
      1000n,
      1200n,
      1200n,
    ]);
    f.log("PublicBudgetClaimed", [1n, f.row.heirPersonHash, 0n, 2, 200n, 1000n]);
    f.log("PublicBudgetFunded", [
      1n,
      f.row.heirPersonHash,
      OTHER,
      ROOT_HASH,
      3n,
      100n,
      1000n,
      300n,
      1300n,
    ]);
    f.row = { ...f.row, nextPeriod: 2n, remaining: 1300n };
    const snapshot = await readPublicBudgets(f.pool, { fromBlock: 1, blockChunk: 1 });
    expect(snapshot.budgets).toEqual([f.row]);
    expect(listIncomingPublicBudgets(snapshot, f.identity.personHash)).toEqual([f.row]);
    expect(listOutgoingPublicBudgets(snapshot, FUNDER)).toEqual([f.row]);
    expect(listOutgoingPublicBudgets(snapshot, OTHER)).toEqual([f.row]);
    expect(f.provider.getLogs.mock.calls[0][0]).toMatchObject({
      address: POOL,
      topics: [expect.any(Array)],
      fromBlock: 1,
      toBlock: 1,
    });
    expect(f.provider.getLogs.mock.calls[0][0].topics).toHaveLength(1);
    expect(f.pool.publicBudgets).toHaveBeenCalledWith(1n, { blockTag: 1 });
  });
  it("rejects missing event history, inconsistent getters, and reorganized scans", async () => {
    const missing = fixture();
    await expect(readPublicBudgets(missing.pool, { fromBlock: 1 })).rejects.toThrow("incomplete");
    const wrong = fixture();
    wrong.log("PublicBudgetFunded", [
      1n,
      wrong.row.heirPersonHash,
      FUNDER,
      ROOT_HASH,
      3n,
      100n,
      1000n,
      1200n,
      1200n,
    ]);
    wrong.row = { ...wrong.row, remaining: 1100n };
    await expect(readPublicBudgets(wrong.pool, { fromBlock: 1 })).rejects.toThrow(
      "does not match chain",
    );
    const reorg = fixture();
    reorg.log("PublicBudgetFunded", [
      1n,
      reorg.row.heirPersonHash,
      FUNDER,
      ROOT_HASH,
      3n,
      100n,
      1000n,
      1200n,
      1200n,
    ]);
    reorg.provider.getLogs.mockImplementation(async () => {
      reorg.reorganize();
      return reorg.logs;
    });
    await expect(readPublicBudgets(reorg.pool, { fromBlock: 1 })).rejects.toThrow("reorganized");
  });
  it("takes the largest funded matured consecutive batch up to twelve, then preserves the cursor", () => {
    const f = fixture();
    expect(previewPublicBudgetClaim(f.row, 1000n + INHERITANCE_PERIOD_SECONDS - 1n)).toMatchObject({
      claimCount: 0,
      amount: 0n,
    });
    expect(previewPublicBudgetClaim(f.row, 1000n + INHERITANCE_PERIOD_SECONDS)).toMatchObject({
      firstPeriod: 0n,
      claimCount: 1,
      amount: 100n,
      remaining: 1100n,
    });
    expect(
      previewPublicBudgetClaim(
        { ...f.row, remaining: 2000n },
        1000n + 20n * INHERITANCE_PERIOD_SECONDS,
      ),
    ).toMatchObject({ claimCount: 12, amount: 1200n });
    expect(
      previewPublicBudgetClaim(
        { ...f.row, nextPeriod: 5n, remaining: 200n },
        1000n + 20n * INHERITANCE_PERIOD_SECONDS,
      ),
    ).toEqual({ firstPeriod: 5n, claimCount: 2, amount: 200n, remaining: 0n });
  });
});
describe("public funding without recipient keys", () => {
  it("prepares and approves a new ordinary-wallet deposit without a receive code or identity secret", async () => {
    const f = fixture();
    const prepared = await preparePublicBudgetFunding(f.funding);
    expect(prepared).toMatchObject({
      amount: 300n,
      data: { budgetId: 0n, heirVersionIndex: 2n, endorser: ENDO },
    });
    expect(prepared).not.toHaveProperty("witness");
    const stages: string[] = [];
    await submitPublicBudgetFunding({
      pool: f.pool,
      token: f.token,
      signer: f.signer,
      expectedChainId: CHAIN,
      prepared,
      onStage: (stage) => stages.push(stage),
    });
    expect(f.approve).toHaveBeenCalledWith(POOL, 300n);
    expect(f.fundPublic).toHaveBeenCalledWith(prepared.data, { gasLimit: 120_000n });
    expect(stages).toEqual(["approving", "checkingGas", "submitting", "confirming"]);
    expect(mocks.zkWorkerCall).not.toHaveBeenCalled();
  });
  it("keeps all terms and the original clock on additional funding, with canonical unused lineage fields", async () => {
    const f = fixture();
    f.changeLineage();
    const prepared = await preparePublicBudgetFunding({ ...f.funding, budgetId: 1n });
    expect(prepared.data).toMatchObject({
      budgetId: 1n,
      heirVersionIndex: 0n,
      endorser: ZeroAddress,
    });
    expect(prepared.context.budget?.eligibleFrom).toBe(1000n);
    await expect(
      preparePublicBudgetFunding({ ...f.funding, budgetId: 1n, amountPerPeriod: 101n }),
    ).rejects.toThrow("preserve");
    f.row = { ...f.row, remaining: (((1n << 128n) - 1n) / 100n) * 100n };
    await expect(preparePublicBudgetFunding({ ...f.funding, budgetId: 1n })).rejects.toThrow(
      "integer range",
    );
  });
  it("refuses invalid amounts, missing eligibility, stale lineage, and the wrong wallet network", async () => {
    const f = fixture();
    await expect(preparePublicBudgetFunding({ ...f.funding, budgetPeriods: 0n })).rejects.toThrow(
      "positive",
    );
    await expect(
      preparePublicBudgetFunding({ ...f.funding, amountPerPeriod: 1n << 127n }),
    ).rejects.toThrow("integer range");
    f.lineage.endorsements.clear();
    await expect(preparePublicBudgetFunding(f.funding)).rejects.toThrow("direct-child");
    const stale = fixture();
    stale.changeLineage();
    await expect(preparePublicBudgetFunding(stale.funding)).rejects.toThrow("stale");
    const wrong = fixture();
    const prepared = await preparePublicBudgetFunding(wrong.funding);
    wrong.setChain(1n);
    await expect(
      submitPublicBudgetFunding({
        pool: wrong.pool,
        token: wrong.token,
        signer: wrong.signer,
        expectedChainId: CHAIN,
        prepared,
      }),
    ).rejects.toThrow("wrong network");
    expect(wrong.approve).not.toHaveBeenCalled();
  });
});
describe("public budget claims into private value", () => {
  it("binds the heir identity and both recoverable outputs to the eleven transaction signals", async () => {
    const f = fixture();
    const prepared = await preparePublicBudgetClaim({
      ...f.funding,
      identity: f.identity,
      budgetId: 1n,
    });
    expect(prepared.data).toMatchObject({
      budgetId: 1n,
      firstPeriod: 0n,
      claimCount: 12,
      heirVersionIndex: 2n,
    });
    const hpkeIkm = getBytes(deriveShieldedHeirKeyMaterial(SECRET).hpkeIkm);
    for (const [index, output] of prepared.outputs.entries()) {
      const payload = await decryptShieldedNote({
        hpkeIkm,
        ciphertext: output.ciphertext,
        chainId: CHAIN,
        poolAddress: POOL,
      });
      const note = verifyShieldedNotePayload({
        payload,
        ciphertext: output.ciphertext,
        noteCommitment: output.commitment,
      }).note;
      expect(note).toMatchObject({ kind: "value", amount: index === 0 ? 1200n : 0n });
      payload.fill(0);
    }
    hpkeIkm.fill(0);
    await submitPublicBudgetClaim({
      pool: f.pool,
      lineageIndex: f.lineageIndex,
      signer: f.signer,
      expectedChainId: CHAIN,
      prepared,
    });
    expect(mocks.zkWorkerCall.mock.calls[0][1]).toMatchObject({
      circuit: "claimPublic",
      expectedPublicSignals: expect.any(Array),
    });
    expect(mocks.zkWorkerCall.mock.calls[0][1].expectedPublicSignals).toHaveLength(11);
    expect(f.claimPublic).toHaveBeenCalledWith(
      prepared.data,
      expect.stringMatching(/^0x[0-9a-f]{512}$/),
      { gasLimit: 120_000n },
    );
  });
  it("rejects another heir, altered derived identity material, and an immature or exhausted budget", async () => {
    const f = fixture();
    await expect(
      preparePublicBudgetClaim({
        ...f.funding,
        identity: { ...f.identity, derivedSecretField: "19" },
        budgetId: 1n,
      }),
    ).rejects.toThrow("does not match");
    f.row = { ...f.row, heirPersonHash: ROOT_HASH };
    await expect(
      preparePublicBudgetClaim({ ...f.funding, identity: f.identity, budgetId: 1n }),
    ).rejects.toThrow("another heir");
    const due = fixture();
    due.setTimestamp(1000n + INHERITANCE_PERIOD_SECONDS - 1n);
    await expect(
      preparePublicBudgetClaim({ ...due.funding, identity: due.identity, budgetId: 1n }),
    ).rejects.toThrow("no funded whole period");
    due.setTimestamp(1000n + 20n * INHERITANCE_PERIOD_SECONDS);
    due.row = { ...due.row, remaining: 0n };
    await expect(
      preparePublicBudgetClaim({ ...due.funding, identity: due.identity, budgetId: 1n }),
    ).rejects.toThrow("no funded whole period");
  });
  it("rejects budget changes during proving and never automatically reuses or retries the proof", async () => {
    const f = fixture();
    const prepared = await preparePublicBudgetClaim({
      ...f.funding,
      identity: f.identity,
      budgetId: 1n,
    });
    mocks.zkWorkerCall.mockImplementationOnce(async (_name, params) => {
      f.row = { ...f.row, nextPeriod: 1n, remaining: 1100n };
      return { proof: PROOF, publicSignals: params.expectedPublicSignals };
    });
    await expect(
      submitPublicBudgetClaim({
        pool: f.pool,
        lineageIndex: f.lineageIndex,
        signer: f.signer,
        expectedChainId: CHAIN,
        prepared,
      }),
    ).rejects.toThrow("changed");
    expect(mocks.zkWorkerCall).toHaveBeenCalledOnce();
    expect(f.claimPublic).not.toHaveBeenCalled();
  });
  it("rejects changed lineage, chain reorganizations, and wrong public proof signals before broadcasting", async () => {
    for (const fault of ["lineage", "reorg", "signal"] as const) {
      const f = fixture();
      const prepared = await preparePublicBudgetClaim({
        ...f.funding,
        identity: f.identity,
        budgetId: 1n,
      });
      if (fault === "lineage") f.changeLineage();
      if (fault === "reorg") f.reorganize();
      if (fault === "signal")
        mocks.zkWorkerCall.mockImplementationOnce(async (_name, params) => ({
          proof: PROOF,
          publicSignals: params.expectedPublicSignals.map((value: string, index: number) =>
            index === 6 ? "999" : value,
          ),
        }));
      await expect(
        submitPublicBudgetClaim({
          pool: f.pool,
          lineageIndex: f.lineageIndex,
          signer: f.signer,
          expectedChainId: CHAIN,
          prepared,
        }),
      ).rejects.toThrow();
      expect(f.claimPublic).not.toHaveBeenCalled();
    }
  });
  // Test-only opt-in for the current browser proving artifacts.
  // eslint-disable-next-line no-restricted-syntax
  it.skipIf(process.env.PUBLIC_BUDGET_CLAIM_PROOF !== "1")(
    "verifies the actual public-claim preparer's Groth16 proof",
    async () => {
      const f = fixture();
      const prepared = await preparePublicBudgetClaim({
        ...f.funding,
        identity: f.identity,
        budgetId: 1n,
      });
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-public-claim-"));
      try {
        const root = fileURLToPath(new URL("../../../../../", import.meta.url));
        const artifacts = path.join(root, "frontend/public/zk/shielded/shielded_claim_public");
        const cli = path.join(root, "node_modules/snarkjs/build/cli.cjs");
        const input = path.join(temporary, "input.json");
        const proof = path.join(temporary, "proof.json");
        const signals = path.join(temporary, "signals.json");
        fs.writeFileSync(input, JSON.stringify(prepared.witness));
        execFileSync(
          process.execPath,
          [
            cli,
            "groth16",
            "fullprove",
            input,
            `${artifacts}.wasm`,
            `${artifacts}_final.zkey`,
            proof,
            signals,
          ],
          { timeout: 120_000 },
        );
        expect(JSON.parse(fs.readFileSync(signals, "utf8"))).toEqual(
          buildShieldedPublicClaimPublicInputs({
            chainId: CHAIN,
            poolAddress: POOL,
            budgetId: 1n,
            heirIdentityCommitment: prepared.heirIdentityCommitment,
            firstPeriod: prepared.data.firstPeriod,
            claimCount: prepared.data.claimCount,
            amount: prepared.amount,
            outputCommitments: prepared.data.outputCommitments,
            outputCiphertexts: prepared.data.outputCiphertexts,
          }).signals.map(String),
        );
        expect(
          execFileSync(
            process.execPath,
            [cli, "groth16", "verify", `${artifacts}.vkey.json`, signals, proof],
            { encoding: "utf8", timeout: 120_000 },
          ),
        ).toMatch(/OK!/u);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    },
    150_000,
  );
});
