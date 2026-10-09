import {
  IDENTITY_SUITE_CANDIDATE_1,
  SHIELDED_POOL_PROTOCOL_VERSION,
  SHIELDED_POOL_ACTION,
  buildShieldedPoolPublicSignals,
  canonicalizeFullName,
  computeShieldedAllocationKeyCommitment,
  computeShieldedPolicyCommitment,
  deriveIdentityMaterial,
  deriveShieldedHeirKeyMaterial,
  getShieldedBudgetCommitments,
  wrapIdentityCommitmentAsPersonHash,
  wipeBytes,
  equalHexConstantTime,
  planShieldedValueSpend,
} from "@deepfamily/protocol-core";
import {
  createShieldedAssetRoot,
  deriveShieldedAssetKeyMaterial,
  deriveShieldedAssetRootFromSignature,
} from "@deepfamily/protocol-core";
import {
  decryptShieldedAssetVault,
  encryptShieldedAssetVault,
  generateShieldedVaultUnlockCredential,
} from "@deepfamily/protocol-core";
import { JsonRpcProvider, getAddress, getBigInt, hexlify, type BigNumberish } from "ethers";
import {
  createDeepFamilyContract,
  createLineageIndexContract,
  createShieldedPoolFactoryContract,
  createShieldedErc20PoolContract,
  createShieldedNativePoolContract,
} from "../shared/clients/contractFactory";
import {
  getFundingPassphraseError,
  validatePassphraseStrength,
} from "../shared/crypto/passphraseStrength";
import type { IdentityMaterialV1Result } from "../shared/workers/cryptoWorkerClient";
import type {
  ShieldedAssetWorkerCallMap,
  ShieldedAssetSessionState,
  ShieldedPublicFunds,
  ShieldedPublicIdentity,
  ShieldedWorkerContext,
  ShieldedKeySlot,
  ShieldedWalletSummary,
  ShieldedAssetActionRequest,
  ShieldedActionPreview,
  ShieldedProvenAction,
} from "../shared/workers/shieldedAssetWorkerTypes";
import {
  generateShieldedProof,
  type ShieldedCircuitName,
  type ShieldedWitness,
} from "../shared/zk/shieldedZk";
import {
  createShieldedReceiveCode,
  verifyShieldedReceiveCode,
} from "../shared/zk/shieldedReceiveCode";
import type { VerifiedShieldedRecipient } from "../domains/inheritance/services/shieldedReceiveCode";
import {
  recoverLocalShieldedWallet,
  listUnspentRecoveredShieldedNotes,
  listRecoveredFundingTemplates,
  listRecoveredShieldedPolicies,
  type LocalShieldedWalletSnapshot,
} from "../domains/inheritance/services/shieldedWalletRecovery";
import {
  findHeirLegitimacy,
  loadLineageSnapshot,
} from "../domains/inheritance/services/inheritanceChain";
import { listShieldedClaimBudgetOptions } from "../domains/inheritance/services/shieldedClaimOverview";
import {
  listShieldedFundingChildren,
  listShieldedFundingParentVersions,
} from "../domains/inheritance/services/shieldedFundingFamily";
import { prepareShieldedShield } from "../domains/inheritance/services/shieldedNotePreparation";
import {
  createShieldedPolicyDescriptor,
  prepareShieldedFund,
} from "../domains/inheritance/services/shieldedFundingPreparation";
import { prepareShieldedClaim } from "../domains/inheritance/services/shieldedClaimPreparation";
import {
  prepareShieldedPrivateTransfer,
  prepareShieldedUnshield,
} from "../domains/inheritance/services/shieldedTransferExitPreparation";
import { loadShieldedPoolSnapshot } from "../domains/inheritance/services/shieldedPoolChain";
import type { ShieldedPoolActionData } from "../shared/zk/shieldedActionTypes";
import {
  discoverShieldedFactoryPools,
  withShieldedRecoveryTimeout,
} from "../domains/inheritance/services/shieldedAssetRegistry";

type IdentityMaterial = Awaited<ReturnType<typeof deriveIdentityMaterial>>;
type AssetKeys = Awaited<ReturnType<typeof deriveShieldedAssetKeyMaterial>>;
type Keys = { ownerSecret: bigint; ownerCommitment: bigint; hpkeIkm: string; keyMode: 0 | 1 };
type SourceMetadata = Awaited<
  ReturnType<typeof deriveShieldedAssetRootFromSignature>
>["sourceMetadata"];
type Discovery = {
  chainId: string;
  factoryAddress: string;
  factoryDeploymentBlock: number;
  lineageIndexAddress: string;
  verifierAddress: string;
  protocolVersion: 3;
};
type Prepared = {
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  outputs: readonly { note: { amount?: BigNumberish; remaining?: BigNumberish } }[];
};
class AssetSessionError extends Error {}
const ASSET_METHODS = new Set([
  "unlockIdentity",
  "createFunds",
  "restoreSignature",
  "exportFunds",
  "importFunds",
  "receiveCode",
  "recover",
  "discover",
  "preview",
  "prove",
  "cancelPreview",
]);
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssetSessionError(message);
}
function serializeIdentity(material: IdentityMaterial): IdentityMaterialV1Result {
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

/** Owns every secret and note opening for one ephemeral asset Worker. */
export class ShieldedAssetSession {
  private identity: IdentityMaterial | null = null;
  private identityHandle = "";
  private root: Uint8Array | null = null;
  private assetKeys: AssetKeys | null = null;
  private funds: ShieldedPublicFunds | null = null;
  private sourceMetadata: SourceMetadata | undefined;
  private allowHistoryVerification = false;
  private discovery: Discovery[] = [];
  private sequence = 0;
  private scope = "";
  private wallets = new Map<ShieldedKeySlot, LocalShieldedWalletSnapshot>();
  private summary: ShieldedWalletSummary | null = null;
  private policyDrafts = new Map<string, ReturnType<typeof createShieldedPolicyDescriptor>>();
  private pending: {
    context: ShieldedWorkerContext;
    request: ShieldedAssetActionRequest;
    preview: ShieldedActionPreview;
    prepared: Prepared;
    circuit: ShieldedCircuitName;
    actionId: number;
  } | null = null;

  state(): ShieldedAssetSessionState {
    const identity: ShieldedPublicIdentity | null = this.identity
      ? {
          handle: this.identityHandle,
          identitySuiteId: this.identity.identitySuiteId,
          identityCommitment: String(this.identity.identityCommitment),
          personHash: this.identity.personHash,
          identity: { fullName: this.identity.identity.fullName },
        }
      : null;
    return { identity, funds: this.funds ? { ...this.funds } : null };
  }

  clear(): void {
    wipeBytes(this.identity?.identitySalt);
    wipeBytes(this.identity?.derivedSecretBytes);
    this.identity = null;
    this.identityHandle = "";
    this.root?.fill(0);
    this.root = null;
    this.assetKeys = null;
    this.funds = null;
    this.sourceMetadata = undefined;
    this.allowHistoryVerification = false;
    this.wallets.clear();
    this.summary = null;
    this.pending = null;
    this.discovery = [];
    this.policyDrafts.clear();
    this.scope = "";
  }

  private keys(slot: ShieldedKeySlot, requireVerified = true): Keys {
    if (slot === "identity") {
      requireValue(this.identity, "Unlock the original identity credentials first.");
      return { ...deriveShieldedHeirKeyMaterial(this.identity.derivedSecretField), keyMode: 0 };
    }
    requireValue(
      this.assetKeys && this.funds,
      "Import the original funds file or restore its signature. A missing root cannot be replaced.",
    );
    requireValue(
      !requireVerified || this.funds.recoveryVerified,
      "Verify recovery of this funds root before receiving or spending.",
    );
    return { ...this.assetKeys, keyMode: 1 };
  }

  async unlockIdentity(
    params: ShieldedAssetWorkerCallMap["unlockIdentity"]["params"],
  ): Promise<ShieldedAssetSessionState> {
    const passphraseError = getFundingPassphraseError(params.rawPassphrase);
    requireValue(!passphraseError, "Identity passphrase does not meet the funding requirements.");
    const material = await deriveIdentityMaterial({
      identity: { ...params.identity, fullName: canonicalizeFullName(params.identity.fullName) },
      rawPassphrase: params.rawPassphrase,
      identitySuiteId: IDENTITY_SUITE_CANDIDATE_1,
    });
    params.rawPassphrase = "";
    if (this.identity && this.identity.identityCommitment !== material.identityCommitment) {
      wipeBytes(material.identitySalt);
      wipeBytes(material.derivedSecretBytes);
      throw new AssetSessionError("Lock before switching to a different identity.");
    }
    wipeBytes(this.identity?.identitySalt);
    wipeBytes(this.identity?.derivedSecretBytes);
    this.identity = material;
    this.identityHandle = `identity:${++this.sequence}`;
    this.policyDrafts.clear();
    this.wallets.clear();
    this.summary = null;
    this.pending = null;
    return this.state();
  }

  private async context(ctx: ShieldedWorkerContext) {
    const scope = [
      ctx.chainId,
      ctx.factoryAddress.toLowerCase(),
      ctx.familyAddress.toLowerCase(),
      ctx.lineageIndexAddress.toLowerCase(),
      ctx.poolAddress.toLowerCase(),
      ctx.rpcUrl,
    ].join(":");
    requireValue(
      !this.scope || scope === this.scope,
      "Protocol context changed. Lock and unlock in the new context.",
    );
    const provider = new JsonRpcProvider(ctx.rpcUrl);
    requireValue(
      (await provider.getNetwork()).chainId === BigInt(ctx.chainId),
      "RPC chain does not match the wallet context.",
    );
    const factory = createShieldedPoolFactoryContract(ctx.factoryAddress, provider);
    const family = createDeepFamilyContract(ctx.familyAddress, provider);
    const [lineageAddress, verifierAddress, familyLineage] = await Promise.all([
      factory.LINEAGE_INDEX(),
      factory.VERIFIER(),
      family.lineageIndex(),
    ]);
    requireValue(
      getAddress(lineageAddress) === getAddress(ctx.lineageIndexAddress) &&
        getAddress(familyLineage) === getAddress(lineageAddress),
      "Factory and family lineage configuration do not match.",
    );
    const pool =
      ctx.assetKind === "native"
        ? createShieldedNativePoolContract(ctx.poolAddress, provider)
        : createShieldedErc20PoolContract(ctx.poolAddress, provider);
    const [version, lineage, verifier, kind, asset] = await Promise.all([
      pool.protocolVersion(),
      pool.LINEAGE_INDEX(),
      pool.VERIFIER(),
      pool.assetKind(),
      ctx.assetKind === "native"
        ? Promise.resolve("0x0000000000000000000000000000000000000000")
        : pool.TOKEN(),
    ]);
    requireValue(
      Number(version) === SHIELDED_POOL_PROTOCOL_VERSION &&
        getAddress(lineage) === getAddress(lineageAddress) &&
        getAddress(verifier) === getAddress(verifierAddress) &&
        Number(kind) === (ctx.assetKind === "native" ? 1 : 0) &&
        getAddress(await factory.poolFor(asset)) === getAddress(ctx.poolAddress),
      "Pool does not belong to the selected protocol.",
    );
    const discovery: Discovery = {
      chainId: ctx.chainId,
      factoryAddress: getAddress(ctx.factoryAddress).toLowerCase(),
      factoryDeploymentBlock: ctx.factoryDeploymentBlock,
      lineageIndexAddress: getAddress(ctx.lineageIndexAddress).toLowerCase(),
      verifierAddress: getAddress(verifierAddress).toLowerCase(),
      protocolVersion: SHIELDED_POOL_PROTOCOL_VERSION,
    };
    this.scope = scope;
    return {
      provider,
      factory,
      pool,
      discovery,
      lineageIndex: createLineageIndexContract(ctx.lineageIndexAddress, provider),
      family,
    };
  }

  private async installRoot(
    root: Uint8Array,
    source: "random" | "walletSignature",
    metadata?: SourceMetadata,
    expectedFingerprint?: string,
    path?: "file" | "signature",
  ) {
    try {
      const keys = await deriveShieldedAssetKeyMaterial(root);
      if (expectedFingerprint)
        requireValue(
          equalHexConstantTime(keys.fundsFingerprint, expectedFingerprint),
          "Funds fingerprint differs from the original wallet. The existing root was not replaced.",
        );
      if (this.assetKeys)
        requireValue(
          this.assetKeys.fundsFingerprint === keys.fundsFingerprint &&
            this.funds?.rootSource === source &&
            JSON.stringify(this.sourceMetadata) === JSON.stringify(metadata),
          "Lock before opening another funds root or changing its source. Existing budgets cannot change owner.",
        );
      this.root?.fill(0);
      this.root = root.slice();
      this.assetKeys = keys;
      this.sourceMetadata = metadata;
      this.allowHistoryVerification = false;
      this.funds = {
        ownerCommitment: String(keys.ownerCommitment),
        viewingKey: hexlify(keys.viewPublicKey),
        fundsFingerprint: keys.fundsFingerprint,
        rootSource: source,
        ...(metadata ? { signerAddress: metadata.signerAddress } : {}),
        recoveryVerified: !!path,
        ...(path ? { recoveryPath: path } : {}),
      };
      this.wallets.clear();
      this.pending = null;
      this.summary = null;
    } finally {
      root.fill(0);
    }
  }

  async createFunds(params: ShieldedAssetWorkerCallMap["createFunds"]["params"]) {
    requireValue(
      params.intent === "create" && !this.root,
      "Creating a new root requires an explicit new-wallet action and an empty funds slot.",
    );
    const { discovery } = await this.context(params.context);
    requireValue(
      params.rootSource === "random" || params.rootSource === "walletSignature",
      "Unsupported root source.",
    );
    if (params.rootSource === "random") {
      requireValue(
        !params.signature && !params.signerAddress,
        "Random creation does not use a signing wallet.",
      );
      await this.installRoot(
        createShieldedAssetRoot({ intent: "create", rootSource: "random" }),
        "random",
      );
    } else {
      requireValue(
        params.signerAddress && params.signature,
        "The selected wallet must sign the exact funds message.",
      );
      const generated = await deriveShieldedAssetRootFromSignature({
        signerAddress: params.signerAddress,
        signature: params.signature,
      });
      params.signature = undefined;
      await this.installRoot(generated.assetRoot, "walletSignature", generated.sourceMetadata);
    }
    this.discovery = [discovery];
    return this.state();
  }

  async restoreSignature(params: ShieldedAssetWorkerCallMap["restoreSignature"]["params"]) {
    requireValue(
      !this.root,
      "Clear the original secret session before a real re-sign verification.",
    );
    const { discovery } = await this.context(params.context);
    const generated = await deriveShieldedAssetRootFromSignature({
      signerAddress: params.signerAddress,
      signature: params.signature,
    });
    params.signature = "";
    await this.installRoot(
      generated.assetRoot,
      "walletSignature",
      generated.sourceMetadata,
      params.expectedFingerprint,
      params.expectedFingerprint ? "signature" : undefined,
    );
    this.allowHistoryVerification = !params.expectedFingerprint;
    this.discovery = [discovery];
    return this.state();
  }

  async exportFunds(params: ShieldedAssetWorkerCallMap["exportFunds"]["params"]) {
    requireValue(this.root && this.funds, "Unlock the existing funds root before exporting it.");
    requireValue(
      !params.unlockCredential || validatePassphraseStrength(params.unlockCredential).isStrong,
      "Choose a strong separate vault credential, or use the generated random credential.",
    );
    const { discovery } = await this.context(params.context);
    const contexts = [
      ...this.discovery.filter(
        (item) =>
          !(item.chainId === discovery.chainId && item.factoryAddress === discovery.factoryAddress),
      ),
      discovery,
    ];
    const unlockCredential = params.unlockCredential || generateShieldedVaultUnlockCredential();
    const file = await encryptShieldedAssetVault({
      assetRoot: this.root,
      rootSource: this.funds.rootSource,
      signatureMetadata: this.sourceMetadata,
      discovery: contexts,
      unlockCredential,
    });
    params.unlockCredential = undefined;
    return { file, unlockCredential, fundsFingerprint: this.funds.fundsFingerprint };
  }

  async importFunds(params: ShieldedAssetWorkerCallMap["importFunds"]["params"]) {
    requireValue(
      !this.root,
      "Clear the original secret session before independently importing a funds file.",
    );
    const { discovery } = await this.context(params.context);
    const restored = await decryptShieldedAssetVault({
      file: params.file,
      unlockCredential: params.unlockCredential,
      expectedFingerprint: params.expectedFingerprint,
    });
    params.unlockCredential = "";
    const covered = restored.discovery.some(
      (item) =>
        String(item.chainId) === discovery.chainId &&
        item.factoryAddress.toLowerCase() === discovery.factoryAddress &&
        item.factoryDeploymentBlock === discovery.factoryDeploymentBlock &&
        item.lineageIndexAddress.toLowerCase() === discovery.lineageIndexAddress &&
        item.verifierAddress.toLowerCase() === discovery.verifierAddress &&
        item.protocolVersion === discovery.protocolVersion,
    );
    // A valid old root can be loaded to update its backup. New discovery scope
    // remains gated until the updated file is independently imported.
    await this.installRoot(
      restored.assetRoot,
      restored.rootSource,
      restored.signatureMetadata,
      params.expectedFingerprint,
      covered ? "file" : undefined,
    );
    this.discovery = restored.discovery;
    return this.state();
  }

  async receiveCode(params: ShieldedAssetWorkerCallMap["receiveCode"]["params"]) {
    requireValue(this.identity, "Identity credentials are required to prove a receiving code.");
    const keys = this.keys(params.slot);
    const result = await createShieldedReceiveCode({
      ...serializeIdentity(this.identity),
      keyMode: keys.keyMode,
      keyMaterial: keys,
    });
    return { code: result.code, fingerprint: result.fingerprint };
  }

  async recover(
    params: ShieldedAssetWorkerCallMap["recover"]["params"],
  ): Promise<ShieldedWalletSummary> {
    requireValue(
      this.identity || this.assetKeys,
      "Unlock identity credentials or restore the original funds root first.",
    );
    const ctx = params.context;
    const { provider, pool, lineageIndex, family } = await this.context(ctx);
    const toBlock = await provider.getBlockNumber();
    const block = await provider.getBlock(toBlock);
    requireValue(block?.hash, "Recovery block is unavailable.");
    const summary: ShieldedWalletSummary = {
      toBlock,
      blockHash: block.hash,
      notes: [],
      policies: [],
      templates: [],
      claims: [],
      parentVersions: [],
      children: [],
    };
    const lineage = this.identity
      ? await loadLineageSnapshot(lineageIndex, family).catch(() => null)
      : null;
    const seenNotes = new Set<string>();
    this.wallets.clear();
    for (const slot of ["identity", "asset"] as const) {
      if ((slot === "identity" && !this.identity) || (slot === "asset" && !this.assetKeys))
        continue;
      const keys = this.keys(slot, false);
      const wallet = await recoverLocalShieldedWallet(
        pool,
        {
          keyMaterial: keys,
          ...(this.identity ? { identityCommitment: this.identity.identityCommitment } : {}),
        },
        { fromBlock: ctx.poolDeploymentBlock, toBlock },
      );
      this.wallets.set(slot, wallet);
      const notes = listUnspentRecoveredShieldedNotes(wallet, keys);
      for (const event of notes) {
        if (seenNotes.has(String(event.commitment))) continue;
        seenNotes.add(String(event.commitment));
        const note = event.note;
        summary.notes.push(
          note.kind === "value"
            ? {
                commitment: String(event.commitment),
                ownerCommitment: String(note.ownerCommitment),
                slot,
                kind: "value",
                amount: String(note.amount),
              }
            : {
                commitment: String(event.commitment),
                ownerCommitment: String(keys.ownerCommitment),
                slot,
                kind: "budget",
                amount: String(note.remaining),
                bindingKind: note.binding === "identity" ? 1 : 0,
                keyMode: Number(note.keyMode ?? 0) as 0 | 1,
                amountPerPeriod: String(note.amountPerPeriod),
                periodDays: String(note.periodDays),
                eligibleFrom: String(note.eligibleFrom),
                pendingIdentity: !this.identity,
              },
        );
      }
      for (const event of wallet.pendingIdentityBudgets?.values() ?? []) {
        if (seenNotes.has(String(event.commitment)) || event.note.kind !== "budget") continue;
        seenNotes.add(String(event.commitment));
        const note = event.note;
        summary.notes.push({
          commitment: String(event.commitment),
          ownerCommitment: String(keys.ownerCommitment),
          slot,
          kind: "budget",
          amount: String(note.remaining),
          bindingKind: note.binding === "identity" ? 1 : 0,
          keyMode: Number(note.keyMode ?? 0) as 0 | 1,
          amountPerPeriod: String(note.amountPerPeriod),
          periodDays: String(note.periodDays),
          eligibleFrom: String(note.eligibleFrom),
          pendingIdentity: true,
        });
      }
      if (
        slot === "asset" &&
        this.funds &&
        this.allowHistoryVerification &&
        !this.funds.recoveryVerified &&
        notes.some((event) => event.note.kind === "value" && event.note.amount > 0n)
      ) {
        this.funds.recoveryVerified = true;
        this.funds.recoveryPath = "history";
      }
      for (const policy of listRecoveredShieldedPolicies(wallet)) {
        if (
          !this.identity ||
          getBigInt(policy.rootIdentityCommitment) !== this.identity.identityCommitment
        )
          continue;
        const handle = String(
          computeShieldedPolicyCommitment(
            {
              ...policy,
              allocationKeyCommitment: computeShieldedAllocationKeyCommitment(
                policy.allocationKey,
                wallet,
              ),
            },
            wallet,
          ),
        );
        if (!summary.policies.some((item) => item.handle === handle))
          summary.policies.push({
            handle,
            rootVersionIndex: String(policy.rootVersionIndex),
            amountPerPeriod: String(policy.amountPerPeriod),
            periodDays: String(policy.periodDays),
          });
      }
      for (const template of listRecoveredFundingTemplates(wallet)) {
        if (
          !this.identity ||
          template.note.rootIdentityCommitment !== this.identity.identityCommitment
        )
          continue;
        summary.templates.push({
          handle: String(template.commitment),
          policyHandle: String(
            getShieldedBudgetCommitments(template.note, wallet).policyCommitment,
          ),
          personHash: wrapIdentityCommitmentAsPersonHash(template.note.heirIdentityCommitment),
          bindingKind: template.note.binding === "identity" ? 1 : 0,
          keyMode: Number(template.note.keyMode ?? 0) as 0 | 1,
          ...(template.note.binding !== "identity"
            ? { ownerCommitment: String(template.note.heirOwnerCommitment) }
            : {}),
        });
      }
      if (!this.identity || !lineage) continue;
      const eligible = notes.filter(
        (event) =>
          event.note.kind === "budget" &&
          event.note.rootVersionIndex <= BigInt(Number.MAX_SAFE_INTEGER) &&
          findHeirLegitimacy({
            snapshot: lineage,
            heir: {
              personHash: this.identity!.personHash,
              identityCommitment: this.identity!.identityCommitment,
            },
            root: { identityCommitment: event.note.rootIdentityCommitment },
            rootVersionIndex: Number(event.note.rootVersionIndex),
          }).some((source) => source.writtenAt <= BigInt(block.timestamp)),
      );
      for (const option of listShieldedClaimBudgetOptions(
        eligible,
        wallet,
        this.identity.derivedSecretField,
        BigInt(block.timestamp),
      )) {
        const claim = option.overview.claim;
        summary.claims.push({
          handle: `${slot}:${option.key}`,
          slot,
          budgets: claim
            ? [
                String(claim.budget.commitment),
                ...(claim.secondBudget ? [String(claim.secondBudget.commitment)] : []),
              ]
            : [],
          periodIndices: claim?.periodIndices.map(String) ?? [],
          amount: String(claim?.amount ?? 0n),
          amountPerPeriod: String(option.notes[0].note.amountPerPeriod),
          status: option.overview.status,
          ...(option.overview.nextDueAt === undefined
            ? {}
            : { nextDueAt: String(option.overview.nextDueAt) }),
        });
      }
    }
    if (this.identity && lineage) {
      summary.parentVersions = listShieldedFundingParentVersions({
        snapshot: lineage,
        parentIdentityCommitment: this.identity.identityCommitment,
      });
      for (const rootVersionIndex of summary.parentVersions)
        summary.children.push(
          ...listShieldedFundingChildren({
            snapshot: lineage,
            asOf: BigInt(block.timestamp),
            parentIdentityCommitment: this.identity.identityCommitment,
            rootVersionIndex,
          }).map((child) => ({ ...child, rootVersionIndex, eligible: !!child.eligible })),
        );
    }
    summary.sessionState = this.state();
    this.summary = summary;
    return summary;
  }

  async cancelPreview() {
    this.pending = null;
    return { ok: true as const };
  }

  private async recipient(code: string, fingerprint?: string): Promise<VerifiedShieldedRecipient> {
    const result = await verifyShieldedReceiveCode(code);
    requireValue(
      result.ok,
      "The receiving code is incomplete or failed its identity and ownership proof.",
    );
    requireValue(
      fingerprint && result.fingerprint === fingerprint,
      "Confirm the complete receiving-code fingerprint with the recipient before paying.",
    );
    return {
      ...result,
      identityCommitment: BigInt(result.identityCommitment),
      ownerCommitment: BigInt(result.ownerCommitment),
    } as unknown as VerifiedShieldedRecipient;
  }

  async preview(request: ShieldedAssetActionRequest): Promise<ShieldedActionPreview> {
    this.pending = null;
    const keys = this.keys(request.slot);
    const ctx = request.context;
    const summary = await this.recover({ context: ctx });
    const wallet = this.wallets.get(request.slot);
    requireValue(wallet, "Recover this funds slot before preparing a transaction.");
    const env = await this.context(ctx);
    const scope = { chainId: BigInt(ctx.chainId), poolAddress: ctx.poolAddress };
    let amount = BigInt(request.amount ?? "0");
    let prepared: Prepared;
    let circuit: ShieldedCircuitName = request.action;
    let actionId: number;
    let actualAction = request.action;
    let inputs: string[] = [];
    let inputAmounts: string[] = [];
    let steps: ShieldedActionPreview["steps"] = [];
    let recipient: string | undefined;
    let policyHandle: string | undefined;
    let fundArgs: Parameters<typeof prepareShieldedFund>[0] | undefined;
    // Verify the final destination before any preparatory consolidation spend.
    const transferRecipient =
      request.action === "privateTransfer"
        ? await this.recipient(request.recipientCode ?? "", request.recipientFingerprint)
        : undefined;
    if (transferRecipient) recipient = transferRecipient.personHash;
    if (request.action === "fund") {
      requireValue(
        this.identity,
        "Unlock the funding parent's identity to select the family policy.",
      );
      const draftScope = `${scope.chainId}:${scope.poolAddress.toLowerCase()}:`;
      const sourceWallets = [...this.wallets.values()];
      const policy = request.policyHandle
        ? (sourceWallets
            .flatMap((snapshot) => listRecoveredShieldedPolicies(snapshot))
            .find(
              (candidate) =>
                String(
                  computeShieldedPolicyCommitment(
                    {
                      ...candidate,
                      allocationKeyCommitment: computeShieldedAllocationKeyCommitment(
                        candidate.allocationKey,
                        scope,
                      ),
                    },
                    scope,
                  ),
                ) === request.policyHandle,
            ) ?? this.policyDrafts.get(`${draftScope}${request.policyHandle}`))
        : createShieldedPolicyDescriptor(
            {
              rootIdentityCommitment: this.identity.identityCommitment,
              rootVersionIndex: request.rootVersionIndex!,
              amountPerPeriod: amount,
              periodDays: request.periodDays!,
            },
            scope,
          );
      requireValue(
        policy && getBigInt(policy.rootIdentityCommitment) === this.identity.identityCommitment,
        "The original funding policy is unavailable or belongs to a different identity.",
      );
      const periods = BigInt(request.periods ?? "0");
      requireValue(
        periods > 0n && periods < 1n << 64n,
        "Choose a positive uint64 number of funded periods.",
      );
      amount = getBigInt(policy.amountPerPeriod) * periods;
      policyHandle = String(
        computeShieldedPolicyCommitment(
          {
            ...policy,
            allocationKeyCommitment: computeShieldedAllocationKeyCommitment(
              policy.allocationKey,
              wallet,
            ),
          },
          wallet,
        ),
      );
      this.policyDrafts.set(`${draftScope}${policyHandle}`, policy);
      requireValue(request.publicRecipient, "Select a registered child person hash.");
      const template = sourceWallets
        .flatMap((snapshot) => listRecoveredFundingTemplates(snapshot))
        .find(
          (candidate) =>
            String(getShieldedBudgetCommitments(candidate.note, wallet).policyCommitment) ===
              policyHandle &&
            wrapIdentityCommitmentAsPersonHash(
              candidate.note.heirIdentityCommitment,
            ).toLowerCase() === request.publicRecipient!.toLowerCase(),
        );
      const kind = request.fundingEntry === "public" ? (1 as const) : (0 as const);
      const mode = request.fundingEntry === "privateIndependent" ? (1 as const) : (0 as const);
      requireValue(
        request.fundingEntry === "public" ||
          request.fundingEntry === "privateConvenient" ||
          request.fundingEntry === "privateIndependent",
        "Choose one of the three funding entries.",
      );
      if (template)
        requireValue(
          (template.note.binding === "identity" ? 1 : 0) === kind &&
            getBigInt(template.note.keyMode ?? 0n) === BigInt(mode),
          "Refilling cannot change the original budget's binding or key mode.",
        );
      const verified = request.recipientCode
        ? await this.recipient(request.recipientCode, request.recipientFingerprint)
        : undefined;
      if (kind === 0 && !template)
        requireValue(verified, "Private initial funding requires a verified receiving code.");
      if (verified)
        requireValue(
          kind === 0 &&
            verified.keyMode === mode &&
            verified.personHash.toLowerCase() === request.publicRecipient.toLowerCase(),
          "The receiving code does not match the selected child and funding entry.",
        );
      if (template && verified && template.note.binding !== "identity") {
        requireValue(
          getBigInt(template.note.heirOwnerCommitment) === verified.ownerCommitment &&
            template.viewingKey?.toLowerCase() === verified.viewingKey.toLowerCase(),
          "Refilling cannot replace the original budget owner or viewing key.",
        );
      }
      const common = {
        pool: env.pool,
        wallet,
        keyMaterial: keys,
        donorCommitment: 0n,
        recipient: verified,
        budgetKind: kind,
        publicRecipientPersonHash: request.publicRecipient,
        lineageIndex: env.lineageIndex,
        budgetPeriods: periods,
      };
      fundArgs = template
        ? { ...common, fundMode: 1, budget: template }
        : {
            ...common,
            fundMode: 0,
            policy,
            lineageIndex: env.lineageIndex,
            lineage: await loadLineageSnapshot(env.lineageIndex, env.family),
          };
      recipient = request.publicRecipient;
    }
    if (request.action === "shield") {
      requireValue(
        amount > 0n && amount < 1n << 128n,
        "Deposit amount must be a positive uint128 integer.",
      );
      prepared = await prepareShieldedShield({ ...scope, keyMaterial: keys, amount });
      actionId = SHIELDED_POOL_ACTION.Shield;
    } else if (request.action === "claim") {
      requireValue(
        this.identity,
        "A funds root alone cannot replace the budget's identity credentials.",
      );
      const claim = summary.claims.find(
        (candidate) => candidate.handle === request.claimHandle && candidate.slot === request.slot,
      );
      requireValue(
        claim && claim.budgets.length && claim.periodIndices.length,
        "The selected claim is no longer available. Review fresh history first.",
      );
      const indices = request.periodIndices ?? claim.periodIndices;
      requireValue(
        indices.length >= 1 &&
          indices.length <= 12 &&
          indices.every(
            (index, position) =>
              claim.periodIndices.includes(index) &&
              (position === 0 || BigInt(index) > BigInt(indices[position - 1])),
          ),
        "Select 1 to 12 strictly increasing, due and unpaid periods from the preview.",
      );
      const block = await env.provider.getBlock("latest");
      requireValue(block, "Current block is unavailable.");
      const result = await prepareShieldedClaim({
        ...scope,
        identity: serializeIdentity(this.identity),
        keyMaterial: keys,
        wallet,
        lineage: await loadLineageSnapshot(env.lineageIndex, env.family),
        budgetCommitment: claim.budgets[0],
        ...(claim.budgets[1] ? { secondBudgetCommitment: claim.budgets[1] } : {}),
        asOf: block.timestamp,
        periodIndices: indices,
      });
      prepared = result;
      amount = result.amount;
      inputs = claim.budgets;
      inputAmounts = inputs.map((commitment) =>
        String(
          wallet.ownedNotes.get(BigInt(commitment))?.note.kind === "budget"
            ? (wallet.ownedNotes.get(BigInt(commitment))!.note as { remaining: bigint }).remaining
            : 0n,
        ),
      );
      actionId = SHIELDED_POOL_ACTION.Claim;
    } else {
      requireValue(
        amount > 0n && amount < 1n << 128n,
        "Amount must be a positive uint128 integer.",
      );
      requireValue(
        request.candidates?.length,
        "Choose the permitted candidate notes before preparing a spend.",
      );
      const values = listUnspentRecoveredShieldedNotes(wallet, keys).filter(
        (event) =>
          event.note.kind === "value" &&
          event.note.ownerCommitment === keys.ownerCommitment &&
          event.note.amount > 0n,
      );
      const plan = planShieldedValueSpend({
        notes: values.map((event) => ({
          commitment: event.commitment,
          amount: event.note.kind === "value" ? event.note.amount : 0n,
          ownerCommitment: keys.ownerCommitment,
          chainId: scope.chainId,
          poolAddress: scope.poolAddress,
        })),
        candidateCommitments: request.candidates,
        amount,
        maxInputs: request.action === "fund" ? 1 : 8,
      });
      steps = plan.steps.map((step) => ({
        action: step.kind === "merge" ? "privateTransfer" : request.action,
        inputs: step.inputCommitments,
        outputAmounts: step.outputAmounts.map(String),
      }));
      const first = plan.steps[0];
      inputs = first.inputCommitments;
      inputAmounts = inputs.map((commitment) =>
        String(
          values.find((event) => String(event.commitment) === commitment)?.note.kind === "value"
            ? (
                values.find((event) => String(event.commitment) === commitment)!.note as {
                  amount: bigint;
                }
              ).amount
            : 0n,
        ),
      );
      const valueInputs = inputs.map((commitment) => ({ wallet, keyMaterial: keys, commitment }));
      if (first.kind === "merge") {
        prepared = await prepareShieldedPrivateTransfer({
          ...scope,
          inputs: valueInputs,
          destinations: [
            { kind: "inputOwner", inputIndex: 0, amount: first.outputAmounts[0] },
            { kind: "inputOwner", inputIndex: 0, amount: first.outputAmounts[1] },
          ],
        });
        actualAction = "privateTransfer";
        actionId = SHIELDED_POOL_ACTION.PrivateTransfer;
        circuit = inputs.length > 2 ? "privateTransfer8" : "privateTransfer";
      } else if (request.action === "fund") {
        requireValue(fundArgs, "Funding policy was not prepared.");
        prepared = await prepareShieldedFund({ ...fundArgs, donorCommitment: inputs[0] });
        actionId = SHIELDED_POOL_ACTION.Fund;
      } else if (request.action === "privateTransfer") {
        requireValue(transferRecipient, "The transfer recipient was not verified.");
        prepared = await prepareShieldedPrivateTransfer({
          ...scope,
          inputs: valueInputs,
          destinations: [
            { kind: "recipient", recipient: transferRecipient, amount },
            { kind: "inputOwner", inputIndex: 0, amount: first.outputAmounts[1] },
          ],
        });
        actionId = SHIELDED_POOL_ACTION.PrivateTransfer;
        circuit = inputs.length > 2 ? "privateTransfer8" : "privateTransfer";
      } else {
        requireValue(request.publicRecipient, "Choose a public withdrawal destination.");
        const result = await prepareShieldedUnshield({
          ...scope,
          inputs: valueInputs,
          amount,
          recipient: request.publicRecipient,
        });
        prepared = result;
        recipient = result.recipient;
        actionId = SHIELDED_POOL_ACTION.Unshield;
        circuit = inputs.length > 1 ? "unshield8" : "unshield";
      }
    }
    const outputAmounts = prepared.outputs.map((output) =>
      String(output.note.amount ?? output.note.remaining ?? 0n),
    );
    const preview: ShieldedActionPreview = {
      handle: `action:${++this.sequence}`,
      action: actualAction,
      amount: String(amount),
      slot: request.slot,
      inputs,
      inputAmounts,
      steps: steps.length ? steps : [{ action: actualAction, inputs, outputAmounts }],
      outputAmounts,
      ...(recipient ? { recipient } : {}),
      ...(policyHandle ? { policyHandle } : {}),
    };
    this.pending = { context: ctx, request, preview, prepared, circuit, actionId };
    return preview;
  }

  async prove(
    params: ShieldedAssetWorkerCallMap["prove"]["params"],
  ): Promise<ShieldedProvenAction> {
    const pending = this.pending;
    requireValue(
      pending &&
        pending.preview.handle === params.handle &&
        JSON.stringify(pending.context) === JSON.stringify(params.context),
      "This preview expired. Review the current inputs and outputs again.",
    );
    this.keys(pending.request.slot);
    const env = await this.context(params.context);
    const wallet = this.wallets.get(pending.request.slot);
    requireValue(wallet, "The wallet snapshot expired.");
    const anchor = await env.provider.getBlock(wallet.toBlock);
    requireValue(
      anchor?.hash === wallet.blockHash,
      "The preview's block was reorganized. Recover and confirm a new plan.",
    );
    // Replay the complete public pool history at one fixed anchor. Never disclose
    // selected spend or period nullifiers in individual RPC queries.
    const toBlock = await env.provider.getBlockNumber();
    const history = await loadShieldedPoolSnapshot(env.pool, async () => null, {
      fromBlock: params.context.poolDeploymentBlock,
      toBlock,
    });
    for (const nullifier of pending.prepared.data.inputNullifiers) {
      requireValue(
        !history.spentNullifiers.has(getBigInt(nullifier)),
        "An input was spent after preview. Recover and confirm a new plan.",
      );
    }
    if (pending.preview.action === "claim") {
      for (const nullifier of pending.prepared.data.periodNullifiers) {
        requireValue(
          !history.spentNullifiers.has(getBigInt(nullifier)),
          "A claim period was used after preview. Recover and confirm a new plan.",
        );
      }
    }
    if (
      pending.preview.action === "claim" ||
      (pending.preview.action === "fund" && Number(pending.prepared.data.fundMode) === 0)
    ) {
      const latest = await env.provider.getBlock(toBlock);
      requireValue(
        latest?.hash === history.blockHash &&
          BigInt(latest.timestamp) >= getBigInt(pending.prepared.data.asOf) &&
          BigInt(latest.timestamp) - getBigInt(pending.prepared.data.asOf) <
            getBigInt(await env.pool.ACTION_PROOF_LIFETIME({ blockTag: toBlock })),
        "This time-bound proof preview expired. Recover and confirm a new plan.",
      );
      const [endorsement, trusted] = await Promise.all([
        env.lineageIndex.root(0, { blockTag: toBlock }),
        env.lineageIndex.root(1, { blockTag: toBlock }),
      ]);
      requireValue(
        getBigInt(endorsement) === getBigInt(pending.prepared.data.relation0) &&
          getBigInt(trusted) === getBigInt(pending.prepared.data.relation1),
        "Family roots changed after preview. Prepare and confirm a fresh proof.",
      );
    }
    const expected = buildShieldedPoolPublicSignals({
      action: pending.actionId,
      chainId: BigInt(params.context.chainId),
      poolAddress: params.context.poolAddress,
      fundMode: pending.prepared.data.fundMode,
      budgetKind: pending.prepared.data.budgetKind,
      inputShardIds: [...pending.prepared.data.inputShardIds],
      inputRoots: [...pending.prepared.data.inputRoots],
      inputNullifiers: [...pending.prepared.data.inputNullifiers],
      periodNullifiers: [...pending.prepared.data.periodNullifiers],
      outputCommitments: [...pending.prepared.data.outputCommitments],
      outputCiphertexts: [...pending.prepared.data.outputCiphertexts],
      amount:
        pending.preview.action === "shield" || pending.preview.action === "unshield"
          ? pending.preview.amount
          : 0n,
      recipient: pending.preview.action === "unshield" ? pending.preview.recipient : undefined,
      relation0: pending.prepared.data.relation0,
      relation1: pending.prepared.data.relation1,
      asOf: pending.prepared.data.asOf,
    });
    try {
      const { proof } = await generateShieldedProof({
        circuit: pending.circuit,
        witness: pending.prepared.witness,
        expectedPublicSignals: expected.map(String),
      });
      requireValue(
        this.pending === pending,
        "The prepared action was replaced or locked while proving. Review a fresh preview.",
      );
      return {
        action: pending.preview.action,
        data: pending.prepared.data,
        proof,
        amount: pending.preview.amount,
        ...(pending.preview.recipient ? { recipient: pending.preview.recipient } : {}),
      };
    } finally {
      if (this.pending === pending) this.pending = null;
    }
  }

  async discover(
    params: ShieldedAssetWorkerCallMap["discover"]["params"],
  ): Promise<ShieldedAssetWorkerCallMap["discover"]["result"]> {
    requireValue(
      this.identity || this.assetKeys,
      "Unlock a key slot before recovering factory pools.",
    );
    const env = await this.context(params.context);
    const found = await discoverShieldedFactoryPools(env.factory, env.provider, {
      factoryDeploymentBlock: params.context.factoryDeploymentBlock,
      lineageIndexAddress: params.context.lineageIndexAddress,
      verifierAddress: env.discovery.verifierAddress,
      chainId: BigInt(params.context.chainId),
      timeoutMs: 10_000,
    });
    const pools: ShieldedAssetWorkerCallMap["discover"]["result"]["pools"] = [];
    for (const item of found.pools) {
      if (!item.configurationVerified || !item.pool || item.poolDeploymentBlock === undefined) {
        pools.push({
          assetAddress: item.assetAddress,
          poolAddress: item.poolAddress,
          status: "failed",
          error: "Pool configuration could not be verified.",
        });
        continue;
      }
      try {
        let rawValueBalance = 0n;
        let rawBudgetBalance = 0n;
        const seen = new Set<string>();
        for (const slot of ["identity", "asset"] as const) {
          if ((slot === "identity" && !this.identity) || (slot === "asset" && !this.assetKeys))
            continue;
          const keys = this.keys(slot, false);
          // Timed-out work has only local variables; its late completion cannot install a session/snapshot.
          const wallet = await withShieldedRecoveryTimeout(
            recoverLocalShieldedWallet(
              item.pool,
              {
                keyMaterial: keys,
                ...(this.identity ? { identityCommitment: this.identity.identityCommitment } : {}),
              },
              { fromBlock: item.poolDeploymentBlock, toBlock: found.toBlock },
            ),
            10_000,
          );
          for (const event of listUnspentRecoveredShieldedNotes(wallet, keys)) {
            if (seen.has(String(event.commitment))) continue;
            seen.add(String(event.commitment));
            if (event.note.kind === "value") rawValueBalance += event.note.amount;
            else rawBudgetBalance += event.note.remaining;
          }
        }
        pools.push({
          assetAddress: item.assetAddress,
          poolAddress: item.poolAddress,
          status: "recovered",
          rawValueBalance: String(rawValueBalance),
          rawBudgetBalance: String(rawBudgetBalance),
        });
      } catch {
        pools.push({
          assetAddress: item.assetAddress,
          poolAddress: item.poolAddress,
          status: "failed",
          error: "Pool history could not be completely verified; balance is unknown.",
        });
      }
    }
    const anchor = await env.provider.getBlock(found.toBlock);
    requireValue(
      anchor?.hash === found.blockHash,
      "Discovery block was reorganized. Re-run recovery.",
    );
    return {
      complete: found.enumerationComplete && pools.every((pool) => pool.status === "recovered"),
      pools,
      ...(found.enumerationError ? { error: found.enumerationError } : {}),
    };
  }

  async call<M extends keyof ShieldedAssetWorkerCallMap>(
    method: M,
    params: ShieldedAssetWorkerCallMap[M]["params"],
  ): Promise<ShieldedAssetWorkerCallMap[M]["result"]> {
    requireValue(ASSET_METHODS.has(method), "Unsupported asset operation.");
    const handler = this[method] as unknown as (
      value: typeof params,
    ) => Promise<ShieldedAssetWorkerCallMap[M]["result"]>;
    requireValue(typeof handler === "function", "Unsupported asset operation.");
    try {
      return await handler.call(this, params);
    } finally {
      if (params && typeof params === "object") {
        if ("rawPassphrase" in params) params.rawPassphrase = "";
        if ("unlockCredential" in params) params.unlockCredential = "";
        if ("signature" in params) params.signature = "";
      }
    }
  }
}

/** Cryptographic library failures must not serialize witnesses, signatures, or passwords. */
export function shieldedAssetErrorMessage(error: unknown): string {
  return error instanceof AssetSessionError
    ? error.message
    : "Asset operation could not be completed. The original root was not replaced; check the file, credentials, deployment, and chain history.";
}
