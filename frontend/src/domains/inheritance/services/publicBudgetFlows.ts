import {
  INHERITANCE_PERIOD_SECONDS,
  buildShieldedPublicClaimPublicInputs,
  computeIdentityFromDerivedSecret,
  computeShieldedCiphertextHashField,
  computeShieldedValueNoteCommitment,
  decryptShieldedNote,
  deriveShieldedHeirKeyMaterial,
  deriveShieldedViewPublicKey,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
  generateShieldedRandomField,
  verifyShieldedNotePayload,
  type ShieldedValueNotePayload,
} from "@deepfamily/protocol-core";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import {
  getAddress,
  getBigInt,
  getBytes,
  ZeroAddress,
  type BigNumberish,
  type Contract,
  type Signer,
  type TransactionReceipt,
  type Log,
} from "ethers";
import { getEventScanConfig } from "../../../shared/config/env";
import type { IdentityMaterialV1Result } from "../../../shared/workers/cryptoWorkerClient";
import { zkWorkerCall } from "../../../shared/workers/zkWorkerClient";
import type { ShieldedWitness } from "../../../shared/zk/shieldedZk";
import { findHeirLegitimacy, type LineageSnapshot } from "./inheritanceChain";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const BUDGET_FIELDS = [
  "createdBy",
  "rootPersonHash",
  "rootVersionIndex",
  "heirPersonHash",
  "amountPerPeriod",
  "eligibleFrom",
  "remaining",
  "nextPeriod",
] as const;

export type PublicBudget = {
  budgetId: bigint;
  createdBy: string;
  rootPersonHash: string;
  rootVersionIndex: bigint;
  heirPersonHash: string;
  amountPerPeriod: bigint;
  eligibleFrom: bigint;
  remaining: bigint;
  nextPeriod: bigint;
};
export type PublicBudgetSnapshot = {
  poolAddress: string;
  chainId: bigint;
  toBlock: number;
  blockHash: string;
  asOf: bigint;
  budgets: PublicBudget[];
  /** Includes each public wallet that has ever contributed to the arrangement. */
  funders: Map<bigint, Set<string>>;
};
export type PublicBudgetClaimPreview = {
  firstPeriod: bigint;
  claimCount: number;
  amount: bigint;
  remaining: bigint;
  nextDueAt?: bigint;
};
export type PublicFundingData = {
  budgetId: bigint;
  rootPersonHash: string;
  rootVersionIndex: bigint;
  heirPersonHash: string;
  amountPerPeriod: bigint;
  budgetPeriods: bigint;
  heirVersionIndex: bigint;
  endorser: string;
};
export type PublicClaimData = {
  budgetId: bigint;
  firstPeriod: bigint;
  claimCount: number;
  heirVersionIndex: bigint;
  endorser: string;
  outputCommitments: readonly [bigint, bigint];
  outputCiphertexts: readonly [Uint8Array, Uint8Array];
};
type PublicPreparationContext = {
  chainId: bigint;
  poolAddress: string;
  toBlock: number;
  blockHash: string;
  asOf: bigint;
  lineageIndex: Contract;
  endorsementRoot?: bigint;
  trustedRoot?: bigint;
  budget?: PublicBudget;
};
export type PreparedPublicBudgetFunding = {
  data: PublicFundingData;
  amount: bigint;
  context: PublicPreparationContext;
};
type PublicClaimOutput = {
  note: ShieldedValueNotePayload;
  commitment: bigint;
  ciphertext: Uint8Array;
  ciphertextHashField: bigint;
};
export type PreparedPublicBudgetClaim = {
  data: PublicClaimData;
  amount: bigint;
  witness: ShieldedWitness;
  context: PublicPreparationContext;
  heirIdentityCommitment: bigint;
  outputs: readonly [PublicClaimOutput, PublicClaimOutput];
};
export type PublicBudgetFlowStage =
  | "approving"
  | "proving"
  | "checkingGas"
  | "submitting"
  | "confirming";
export type PublicBudgetFlowResult = {
  transactionHash: string;
  receipt: TransactionReceipt;
  gasEstimate: bigint;
  gasLimit: bigint;
};

function bounded(value: BigNumberish, maximum: bigint, label: string): bigint {
  const result = getBigInt(value);
  if (result < 0n || result > maximum) throw new Error(`${label} is outside its integer range`);
  return result;
}
function personHash(value: string): string {
  if (!/^0x[0-9a-f]{64}$/i.test(value) || BigInt(value) === 0n)
    throw new Error("Person hash must be a nonzero bytes32");
  return value.toLowerCase();
}
function parseBudget(budgetId: bigint, row: Record<string, unknown>): PublicBudget {
  const budget = {
    budgetId,
    createdBy: getAddress(String(row.createdBy)),
    rootPersonHash: personHash(String(row.rootPersonHash)),
    rootVersionIndex: bounded(row.rootVersionIndex as BigNumberish, MAX_UINT64, "rootVersionIndex"),
    heirPersonHash: personHash(String(row.heirPersonHash)),
    amountPerPeriod: bounded(row.amountPerPeriod as BigNumberish, MAX_UINT128, "amountPerPeriod"),
    eligibleFrom: bounded(row.eligibleFrom as BigNumberish, MAX_UINT64, "eligibleFrom"),
    remaining: bounded(row.remaining as BigNumberish, MAX_UINT128, "remaining"),
    nextPeriod: bounded(row.nextPeriod as BigNumberish, MAX_UINT64, "nextPeriod"),
  };
  if (
    budgetId === 0n ||
    budget.createdBy === ZeroAddress ||
    budget.rootVersionIndex === 0n ||
    budget.amountPerPeriod === 0n ||
    budget.remaining % budget.amountPerPeriod !== 0n
  )
    throw new Error("Invalid public budget state");
  return budget;
}
function sameBudget(a: PublicBudget, b: PublicBudget): boolean {
  return a.budgetId === b.budgetId && BUDGET_FIELDS.every((field) => a[field] === b[field]);
}

/** Replay all public arrangements and reconcile every row at one block, with no person filter. */
export async function readPublicBudgets(
  pool: Contract,
  options: { fromBlock?: number; blockChunk?: number } = {},
): Promise<PublicBudgetSnapshot> {
  const provider = pool.runner?.provider;
  if (!provider) throw new Error("Public budget pool has no provider");
  const [poolAddress, network, toBlock] = await Promise.all([
    pool.getAddress(),
    provider.getNetwork(),
    provider.getBlockNumber(),
  ]);
  const anchor = await provider.getBlock(toBlock);
  if (!anchor?.hash) throw new Error("Public budget scan block is unavailable");
  const config = getEventScanConfig();
  const fromBlock = options.fromBlock ?? config.fromBlock;
  const blockChunk = options.blockChunk ?? config.blockChunk;
  if (
    !Number.isSafeInteger(fromBlock) ||
    fromBlock < 0 ||
    !Number.isSafeInteger(blockChunk) ||
    blockChunk < 1
  )
    throw new Error("Invalid public budget scan range");
  const funded = pool.interface.getEvent("PublicBudgetFunded");
  const claimed = pool.interface.getEvent("PublicBudgetClaimed");
  if (!funded || !claimed) throw new Error("Pool ABI is missing public budget events");
  const budgets = new Map<bigint, PublicBudget>();
  const funders = new Map<bigint, Set<string>>();
  for (let start = fromBlock; start <= toBlock; start += blockChunk) {
    const end = Math.min(toBlock, start + blockChunk - 1);
    const logs = await provider.getLogs({
      address: poolAddress,
      topics: [[funded.topicHash, claimed.topicHash]],
      fromBlock: start,
      toBlock: end,
    });
    logs.sort((a: Log, b: Log) => a.blockNumber - b.blockNumber || a.index - b.index);
    for (const log of logs) {
      if (
        log.address.toLowerCase() !== poolAddress.toLowerCase() ||
        log.blockNumber < start ||
        log.blockNumber > end ||
        ![funded.topicHash, claimed.topicHash].includes(log.topics[0])
      )
        throw new Error("Public budget log is outside the requested scan");
      const event = pool.interface.parseLog(log);
      if (!event) throw new Error("Unrecognized public budget event");
      const budgetId = bounded(event.args.budgetId, MAX_UINT64, "budgetId");
      const prior = budgets.get(budgetId);
      const amount = bounded(event.args.amount, MAX_UINT128, "amount");
      const remaining = bounded(event.args.remaining, MAX_UINT128, "remaining");
      if (amount === 0n) throw new Error("Public budget event amount must be positive");
      if (event.name === "PublicBudgetFunded") {
        const next = parseBudget(budgetId, {
          createdBy: prior?.createdBy ?? event.args.funder,
          rootPersonHash: event.args.rootPersonHash,
          rootVersionIndex: event.args.rootVersionIndex,
          heirPersonHash: event.args.heirPersonHash,
          amountPerPeriod: event.args.amountPerPeriod,
          eligibleFrom: event.args.eligibleFrom,
          remaining,
          nextPeriod: prior?.nextPeriod ?? 0n,
        });
        if (
          (!prior && budgetId !== BigInt(budgets.size + 1)) ||
          remaining !== (prior?.remaining ?? 0n) + amount ||
          amount % next.amountPerPeriod !== 0n ||
          (prior && !sameBudget({ ...next, remaining: prior.remaining }, prior))
        )
          throw new Error("Public funding events are incomplete or inconsistent");
        budgets.set(budgetId, next);
        const contributors = funders.get(budgetId) ?? new Set<string>();
        contributors.add(getAddress(String(event.args.funder)).toLowerCase());
        funders.set(budgetId, contributors);
      } else if (event.name === "PublicBudgetClaimed") {
        const count = bounded(event.args.claimCount, 12n, "claimCount");
        const first = bounded(event.args.firstPeriod, MAX_UINT64, "firstPeriod");
        if (
          !prior ||
          count === 0n ||
          first !== prior.nextPeriod ||
          personHash(String(event.args.heirPersonHash)) !== prior.heirPersonHash ||
          amount !== prior.amountPerPeriod * count ||
          amount > prior.remaining ||
          remaining !== prior.remaining - amount
        )
          throw new Error("Public claim events are incomplete or inconsistent");
        budgets.set(budgetId, {
          ...prior,
          remaining,
          nextPeriod: bounded(first + count, MAX_UINT64, "nextPeriod"),
        });
      } else throw new Error("Unexpected public budget event");
    }
  }
  const count = bounded(
    await pool.publicBudgetCount({ blockTag: toBlock }),
    MAX_UINT64,
    "publicBudgetCount",
  );
  if (count !== BigInt(budgets.size)) throw new Error("Public budget event history is incomplete");
  for (const [budgetId, replayed] of budgets) {
    const row = parseBudget(budgetId, await pool.publicBudgets(budgetId, { blockTag: toBlock }));
    if (!sameBudget(row, replayed))
      throw new Error("Public budget event history does not match chain state");
  }
  if ((await provider.getBlock(toBlock))?.hash !== anchor.hash)
    throw new Error("Public budget scan was reorganized");
  return {
    poolAddress: getAddress(poolAddress),
    chainId: network.chainId,
    toBlock,
    blockHash: anchor.hash,
    asOf: BigInt(anchor.timestamp),
    budgets: [...budgets.values()],
    funders,
  };
}
export function listIncomingPublicBudgets(
  snapshot: PublicBudgetSnapshot,
  heirPersonHash: string,
): PublicBudget[] {
  const hash = personHash(heirPersonHash);
  return snapshot.budgets.filter((budget) => budget.heirPersonHash === hash);
}
export function listOutgoingPublicBudgets(
  snapshot: PublicBudgetSnapshot,
  funderAddress: string,
): PublicBudget[] {
  const address = getAddress(funderAddress).toLowerCase();
  return snapshot.budgets.filter((budget) => snapshot.funders.get(budget.budgetId)?.has(address));
}
/** Public arrangements have their own sequential clock and no private policy period nullifiers. */
export function previewPublicBudgetClaim(
  budget: PublicBudget,
  asOfInput: BigNumberish,
): PublicBudgetClaimPreview {
  const asOf = bounded(asOfInput, MAX_UINT64, "asOf");
  const dueCount =
    asOf > budget.eligibleFrom ? (asOf - budget.eligibleFrom) / INHERITANCE_PERIOD_SECONDS : 0n;
  const mature = dueCount > budget.nextPeriod ? dueCount - budget.nextPeriod : 0n;
  const available = budget.remaining / budget.amountPerPeriod;
  const count = [mature, available, 12n].reduce((a, b) => (a < b ? a : b));
  const amount = count * budget.amountPerPeriod;
  const remaining = budget.remaining - amount;
  const nextDueAt =
    budget.eligibleFrom + (budget.nextPeriod + count + 1n) * INHERITANCE_PERIOD_SECONDS;
  return {
    firstPeriod: budget.nextPeriod,
    claimCount: Number(count),
    amount,
    remaining,
    ...(remaining > 0n && nextDueAt <= MAX_UINT64 ? { nextDueAt } : {}),
  };
}

async function preparationContext(
  pool: Contract,
  lineageIndex: Contract,
): Promise<PublicPreparationContext> {
  const provider = pool.runner?.provider;
  if (!provider) throw new Error("Public budget pool has no provider");
  const [network, poolAddress, indexAddress, expectedIndex, toBlock] = await Promise.all([
    provider.getNetwork(),
    pool.getAddress(),
    lineageIndex.getAddress(),
    pool.LINEAGE_INDEX(),
    provider.getBlockNumber(),
  ]);
  if (getAddress(indexAddress) !== getAddress(expectedIndex))
    throw new Error("Lineage index does not belong to this pool");
  const block = await provider.getBlock(toBlock);
  if (!block?.hash) throw new Error("Public budget preparation block is unavailable");
  return {
    chainId: bounded(network.chainId, MAX_UINT64, "chainId"),
    poolAddress: getAddress(poolAddress),
    toBlock,
    blockHash: block.hash,
    asOf: BigInt(block.timestamp),
    lineageIndex,
  };
}
async function currentLineageSource(
  context: PublicPreparationContext,
  lineage: LineageSnapshot,
  rootHash: string,
  version: bigint,
  heirHash: string,
) {
  if (lineage.blockNumber > context.toBlock || version > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Lineage snapshot is ahead of the preparation state");
  const [endorsement, trusted] = await Promise.all([
    context.lineageIndex.root(0, { blockTag: context.toBlock }),
    context.lineageIndex.root(1, { blockTag: context.toBlock }),
  ]);
  if (
    lineage.endorsementTree.root !== getBigInt(endorsement) ||
    lineage.trustedTree.root !== getBigInt(trusted)
  )
    throw new Error("Lineage snapshot is stale; refresh public family records");
  const root = lineage.versions
    .get(rootHash)
    ?.find((candidate) => BigInt(candidate.versionIndex) === version);
  const heir = lineage.versions.get(heirHash)?.[0];
  if (!root || !heir) throw new Error("Public funding root or heir is absent from family records");
  const source = findHeirLegitimacy({
    snapshot: lineage,
    heir: { personHash: heirHash, identityCommitment: heir.identityCommitment },
    root: { identityCommitment: root.identityCommitment },
    rootVersionIndex: Number(version),
  }).find((candidate) => candidate.writtenAt <= context.asOf);
  if (!source)
    throw new Error(
      "No current direct-child endorsement and trusted source match this public budget",
    );
  context.endorsementRoot = getBigInt(endorsement);
  context.trustedRoot = getBigInt(trusted);
  return source;
}
export async function preparePublicBudgetFunding(input: {
  pool: Contract;
  lineageIndex: Contract;
  lineage: LineageSnapshot;
  budgetId?: BigNumberish;
  rootPersonHash: string;
  rootVersionIndex: BigNumberish;
  heirPersonHash: string;
  amountPerPeriod: BigNumberish;
  budgetPeriods: BigNumberish;
}): Promise<PreparedPublicBudgetFunding> {
  const context = await preparationContext(input.pool, input.lineageIndex);
  const data: PublicFundingData = {
    budgetId: bounded(input.budgetId ?? 0n, MAX_UINT64, "budgetId"),
    rootPersonHash: personHash(input.rootPersonHash),
    rootVersionIndex: bounded(input.rootVersionIndex, MAX_UINT64, "rootVersionIndex"),
    heirPersonHash: personHash(input.heirPersonHash),
    amountPerPeriod: bounded(input.amountPerPeriod, MAX_UINT128, "amountPerPeriod"),
    budgetPeriods: bounded(input.budgetPeriods, MAX_UINT64, "budgetPeriods"),
    heirVersionIndex: 0n,
    endorser: ZeroAddress,
  };
  const amount = bounded(data.amountPerPeriod * data.budgetPeriods, MAX_UINT128, "Funding amount");
  if (amount === 0n || data.rootVersionIndex === 0n)
    throw new Error("Public funding requires a root version, positive rate and periods");
  if (data.budgetId === 0n) {
    const source = await currentLineageSource(
      context,
      input.lineage,
      data.rootPersonHash,
      data.rootVersionIndex,
      data.heirPersonHash,
    );
    data.heirVersionIndex = BigInt(source.versionIndex);
    data.endorser = getAddress(source.endorser);
  } else {
    const budget = parseBudget(
      data.budgetId,
      await input.pool.publicBudgets(data.budgetId, { blockTag: context.toBlock }),
    );
    if (
      budget.rootPersonHash !== data.rootPersonHash ||
      budget.rootVersionIndex !== data.rootVersionIndex ||
      budget.heirPersonHash !== data.heirPersonHash ||
      budget.amountPerPeriod !== data.amountPerPeriod
    )
      throw new Error("Additional funding must preserve the public arrangement's terms");
    bounded(budget.remaining + amount, MAX_UINT128, "Remaining public budget");
    context.budget = budget;
  }
  await assertFreshPrepared(input.pool, context);
  return { data, amount, context };
}

/** Encrypt and reopen both payout outputs on the holder's device. */
export async function preparePublicBudgetClaim(input: {
  pool: Contract;
  lineageIndex: Contract;
  lineage: LineageSnapshot;
  identity: IdentityMaterialV1Result;
  budgetId: BigNumberish;
}): Promise<PreparedPublicBudgetClaim> {
  const context = await preparationContext(input.pool, input.lineageIndex);
  const budgetId = bounded(input.budgetId, MAX_UINT64, "budgetId");
  const budget = parseBudget(
    budgetId,
    await input.pool.publicBudgets(budgetId, { blockTag: context.toBlock }),
  );
  const material = computeIdentityFromDerivedSecret({
    identity: input.identity.identity,
    identitySuiteId: input.identity.identitySuiteId,
    derivedSecretField: input.identity.derivedSecretField,
  });
  if (
    material.identityCommitment !== getBigInt(input.identity.identityCommitment) ||
    material.nameField !== getBigInt(input.identity.nameField) ||
    material.packedBirthGenderField !== getBigInt(input.identity.packedBirthGenderField) ||
    material.suiteCommitment !== getBigInt(input.identity.suiteCommitment) ||
    material.personHash.toLowerCase() !== input.identity.personHash.toLowerCase()
  )
    throw new Error("Identity material does not match the passphrase-derived secret");
  if (budget.heirPersonHash !== material.personHash.toLowerCase())
    throw new Error("Public budget belongs to another heir");
  const source = await currentLineageSource(
    context,
    input.lineage,
    budget.rootPersonHash,
    budget.rootVersionIndex,
    budget.heirPersonHash,
  );
  const preview = previewPublicBudgetClaim(budget, context.asOf);
  if (preview.claimCount === 0) throw new Error("Public budget has no funded whole period due");
  context.budget = budget;
  const keys = deriveShieldedHeirKeyMaterial(material.derivedSecretField);
  const viewingKey = await deriveShieldedViewPublicKey(keys.hpkeIkm);
  const outputs = (await Promise.all(
    [preview.amount, 0n].map(async (amount) => {
      const note: ShieldedValueNotePayload = {
        ownerCommitment: keys.ownerCommitment,
        amount,
        nonce: generateShieldedRandomField(),
      };
      const payload = encodeShieldedValueNotePayload(note);
      const hpkeIkm = getBytes(keys.hpkeIkm);
      let opened: Uint8Array | undefined;
      try {
        const ciphertext = await encryptShieldedNote({
          recipientPublicKey: viewingKey,
          payload,
          chainId: context.chainId,
          poolAddress: context.poolAddress,
        });
        const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
        const commitment = computeShieldedValueNoteCommitment({ ...note, ciphertextHashField });
        opened = await decryptShieldedNote({
          hpkeIkm,
          ciphertext,
          chainId: context.chainId,
          poolAddress: context.poolAddress,
        });
        const recovered = verifyShieldedNotePayload({
          payload: opened,
          ciphertext,
          noteCommitment: commitment,
        }).note;
        if (
          recovered.kind !== "value" ||
          recovered.ownerCommitment !== keys.ownerCommitment ||
          recovered.amount !== amount ||
          recovered.nonce !== note.nonce
        )
          throw new Error("Public claim output did not decrypt to its intended value");
        return { note, commitment, ciphertext, ciphertextHashField };
      } finally {
        payload.fill(0);
        opened?.fill(0);
        hpkeIkm.fill(0);
      }
    }),
  )) as [PublicClaimOutput, PublicClaimOutput];
  const data: PublicClaimData = {
    budgetId,
    firstPeriod: preview.firstPeriod,
    claimCount: preview.claimCount,
    heirVersionIndex: BigInt(source.versionIndex),
    endorser: getAddress(source.endorser),
    outputCommitments: [outputs[0].commitment, outputs[1].commitment],
    outputCiphertexts: [outputs[0].ciphertext, outputs[1].ciphertext],
  };
  const publicInputs = buildShieldedPublicClaimPublicInputs({
    chainId: context.chainId,
    poolAddress: context.poolAddress,
    budgetId,
    heirIdentityCommitment: material.identityCommitment,
    firstPeriod: data.firstPeriod,
    claimCount: data.claimCount,
    amount: preview.amount,
    outputCommitments: data.outputCommitments,
    outputCiphertexts: data.outputCiphertexts,
  });
  const witness: ShieldedWitness = {
    ...publicInputs.witness,
    derivedSecretField: String(material.derivedSecretField),
    nameField: String(material.nameField),
    isBirthBC: input.identity.identity.isBirthBC ? "1" : "0",
    birthYear: String(input.identity.identity.birthYear),
    birthMonth: String(input.identity.identity.birthMonth),
    birthDay: String(input.identity.identity.birthDay),
    gender: String(input.identity.identity.gender),
    suiteId: String(input.identity.identitySuiteId),
    outputNonces: outputs.map((output) => String(output.note.nonce)),
  };
  await assertFreshPrepared(input.pool, context);
  return {
    data,
    amount: preview.amount,
    witness,
    context,
    heirIdentityCommitment: material.identityCommitment,
    outputs,
  };
}

async function assertFreshPrepared(
  pool: Contract,
  context: PublicPreparationContext,
): Promise<void> {
  const provider = pool.runner?.provider;
  if (
    !provider ||
    (await provider.getNetwork()).chainId !== context.chainId ||
    getAddress(await pool.getAddress()) !== context.poolAddress
  )
    throw new Error("Public budget preparation belongs to another pool or chain");
  if ((await provider.getBlock(context.toBlock))?.hash !== context.blockHash)
    throw new Error("Public budget preparation was reorganized; prepare again");
  const latest = await provider.getBlockNumber();
  if (
    context.budget &&
    !sameBudget(
      parseBudget(
        context.budget.budgetId,
        await pool.publicBudgets(context.budget.budgetId, { blockTag: latest }),
      ),
      context.budget,
    )
  )
    throw new Error("Public budget changed; refresh and prepare again");
  if (context.endorsementRoot !== undefined) {
    const [endorsement, trusted] = await Promise.all([
      context.lineageIndex.root(0, { blockTag: latest }),
      context.lineageIndex.root(1, { blockTag: latest }),
    ]);
    if (
      getBigInt(endorsement) !== context.endorsementRoot ||
      getBigInt(trusted) !== context.trustedRoot
    )
      throw new Error("Public family records changed; refresh and prepare again");
  }
}
async function assertSigner(signer: Signer, chainId: bigint): Promise<void> {
  if ((await signer.provider?.getNetwork())?.chainId !== chainId)
    throw new Error("Transaction wallet is connected to the wrong network");
}
type TransactionMethod = ((
  ...args: unknown[]
) => Promise<{ hash: string; wait: () => Promise<TransactionReceipt | null> }>) & {
  estimateGas: (...args: unknown[]) => Promise<bigint>;
};
async function sendPublicTransaction(
  input: {
    pool: Contract;
    signer: Signer;
    expectedChainId: bigint;
    context: PublicPreparationContext;
    onStage?: (stage: PublicBudgetFlowStage) => void;
  },
  method: TransactionMethod,
  args: unknown[],
): Promise<PublicBudgetFlowResult> {
  if (input.expectedChainId !== input.context.chainId)
    throw new Error("Prepared public budget has a different chain");
  await assertSigner(input.signer, input.expectedChainId);
  await assertFreshPrepared(input.pool, input.context);
  input.onStage?.("checkingGas");
  const gasEstimate = await method.estimateGas(...args);
  const gasLimit = (gasEstimate * 120n + 99n) / 100n;
  const provider = input.signer.provider;
  if (!provider) throw new Error("Transaction wallet has no provider");
  const [fee, balance] = await Promise.all([
    provider.getFeeData(),
    provider.getBalance(await input.signer.getAddress()),
  ]);
  const price = fee.maxFeePerGas ?? fee.gasPrice;
  if (!price || price <= 0n || balance < gasLimit * price)
    throw new Error("Transaction wallet has insufficient gas balance");
  await assertSigner(input.signer, input.expectedChainId);
  await assertFreshPrepared(input.pool, input.context);
  input.onStage?.("submitting");
  const tx = await method(...args, { gasLimit });
  input.onStage?.("confirming");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error(
      `Transaction ${tx.hash} failed or could not be confirmed; inspect its status before retrying`,
    );
  return { transactionHash: tx.hash, receipt, gasEstimate, gasLimit };
}
export async function submitPublicBudgetFunding(input: {
  pool: Contract;
  token: Contract;
  signer: Signer;
  expectedChainId: bigint;
  prepared: PreparedPublicBudgetFunding;
  onStage?: (stage: PublicBudgetFlowStage) => void;
}): Promise<PublicBudgetFlowResult> {
  const { prepared } = input;
  const data = { ...prepared.data };
  if (
    bounded(data.amountPerPeriod * data.budgetPeriods, MAX_UINT128, "Funding amount") !==
    prepared.amount
  ) {
    throw new Error("Public funding amount does not match its transaction");
  }
  if (input.expectedChainId !== prepared.context.chainId)
    throw new Error("Prepared public funding has a different chain");
  await assertSigner(input.signer, input.expectedChainId);
  await assertFreshPrepared(input.pool, prepared.context);
  const address = await input.signer.getAddress();
  const expectedToken = getAddress(await input.pool.TOKEN());
  if (getAddress(await input.token.getAddress()) !== expectedToken)
    throw new Error("Funding token does not belong to this public pool");
  if (getBigInt(await input.token.balanceOf(address)) < prepared.amount)
    throw new Error("Public wallet DEEP balance cannot fund this arrangement");
  if (
    getBigInt(await input.token.allowance(address, prepared.context.poolAddress)) < prepared.amount
  ) {
    input.onStage?.("approving");
    const token = input.token.connect(input.signer) as Contract;
    await assertSigner(input.signer, input.expectedChainId);
    const approval = await token.approve(prepared.context.poolAddress, prepared.amount);
    const receipt = await approval.wait();
    if (!receipt || receipt.status !== 1)
      throw new Error(
        `Approval ${approval.hash} did not succeed; inspect its status before retrying`,
      );
  }
  const connected = input.pool.connect(input.signer) as Contract;
  return sendPublicTransaction(
    { ...input, context: prepared.context },
    connected.fundPublic as TransactionMethod,
    [data],
  );
}
export async function submitPublicBudgetClaim(input: {
  pool: Contract;
  lineageIndex: Contract;
  signer: Signer;
  expectedChainId: bigint;
  prepared: PreparedPublicBudgetClaim;
  onStage?: (stage: PublicBudgetFlowStage) => void;
  proofTimeoutMs?: number;
}): Promise<PublicBudgetFlowResult> {
  const { prepared } = input;
  if (input.expectedChainId !== prepared.context.chainId) {
    throw new Error("Prepared public claim has a different chain");
  }
  if (
    getAddress(await input.lineageIndex.getAddress()) !==
    getAddress(await prepared.context.lineageIndex.getAddress())
  )
    throw new Error("Public claim lineage index does not match its preparation");
  await assertSigner(input.signer, input.expectedChainId);
  await assertFreshPrepared(input.pool, prepared.context);
  const data: PublicClaimData = {
    ...prepared.data,
    outputCommitments: [...prepared.data.outputCommitments],
    outputCiphertexts: [
      prepared.data.outputCiphertexts[0].slice(),
      prepared.data.outputCiphertexts[1].slice(),
    ],
  };
  const expected = buildShieldedPublicClaimPublicInputs({
    chainId: input.expectedChainId,
    poolAddress: prepared.context.poolAddress,
    budgetId: data.budgetId,
    heirIdentityCommitment: prepared.heirIdentityCommitment,
    firstPeriod: data.firstPeriod,
    claimCount: data.claimCount,
    amount: prepared.amount,
    outputCommitments: data.outputCommitments,
    outputCiphertexts: data.outputCiphertexts,
  }).signals.map(String);
  input.onStage?.("proving");
  const generated = await zkWorkerCall(
    "generateShieldedProof",
    { circuit: "claimPublic", witness: prepared.witness, expectedPublicSignals: expected },
    { timeoutMs: input.proofTimeoutMs ?? 1_200_000 },
  );
  if (
    generated.publicSignals.length !== expected.length ||
    generated.publicSignals.some((value, index) => getBigInt(value) !== getBigInt(expected[index]))
  )
    throw new Error("Public claim proof signals do not match the transaction");
  const proof = encodeGroth16AbcProofData(normalizeGroth16Proof(generated.proof));
  const connected = input.pool.connect(input.signer) as Contract;
  return sendPublicTransaction(
    { ...input, context: prepared.context },
    connected.claimPublic as TransactionMethod,
    [data, proof],
  );
}
