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
  computeShieldedAuthorizationAlias,
  prepareShieldedIdentityCounterAuthorization,
  decodeShieldedReceiveCredential, computeShieldedReceiveCredentialBinding, computeShieldedReceiveActionHash,
  emptyShieldedReceiveAuthorizations, prepareShieldedReceivePresentation, generateShieldedRandomField,
  splitShieldedViewPublicKey, createShieldedLetterEnvelope, computeShieldedLetterRelationCommitment,
  encryptShieldedLetter, decryptShieldedLetter, computeShieldedLetterCiphertextHash,
  computeShieldedCiphertextHashField, normalizeShieldedBudgetOrigin,
  encodeGroth16AbcProofData,
  normalizeGroth16Proof,
  createShieldedIndependentKeyRoot,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedIndependentKeyIdentitySecret,
  deriveShieldedIndependentKeyRootFromSignature,
  encodeShieldedIndependentKeyMnemonic,
  decodeShieldedIndependentKeyMnemonic,
  encodeShieldedIndependentKey,
  decodeShieldedIndependentKey,
} from "@deepfamily/protocol-core";
import { normalizeShieldedStateReadMode, type ShieldedStateReadMode } from "../shared/config/shieldedStateReadMode";
import { JsonRpcProvider, getAddress, getBigInt, getBytes, hexlify, randomBytes, ZeroAddress, type BigNumberish } from "ethers";
import {
  createDeepFamilyContract,
  createLineageIndexContract,
  createShieldedPoolFactoryContract,
  createShieldedErc20PoolContract,
  createShieldedNativePoolContract,
} from "../shared/clients/contractFactory";
import type { IdentityMaterialV1Result } from "../shared/workers/cryptoWorkerClient";
import type {
  ShieldedAssetWorkerCallMap,
  ShieldedAssetSessionState,
  ShieldedPublicIndependentKey,
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
  loadTargetedLineageSnapshot,
  loadLineageSnapshot,
} from "../domains/inheritance/services/inheritanceChain";
import { listShieldedClaimBudgetOptions } from "../domains/inheritance/services/shieldedClaimOverview";
import {
  listShieldedFundingChildren,
  listShieldedFundingParentVersions,
} from "../domains/inheritance/services/shieldedFundingFamily";
import { InheritanceError } from "../domains/inheritance/model/inheritanceErrors";
import { prepareShieldedShield } from "../domains/inheritance/services/shieldedNotePreparation";
import {
  createShieldedPolicyDescriptor,
  prepareShieldedFund,
  validateShieldedFundingDestination,
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
import { createIdentityAuthorizationContract, loadShieldedIdentityAuthorizationWitnessForMode } from "../domains/inheritance/services/shieldedIdentityAuthorizationChain";

import { createPrivateLetterContract, readPrivateLetters } from "../domains/inheritance/services/privateLetterChain";
import { proveShieldedReceivePresentation } from "../shared/zk/shieldedReceivePresentation";

type IdentityMaterial = Awaited<ReturnType<typeof deriveIdentityMaterial>>;
type IndependentKeyMaterial = Awaited<ReturnType<typeof deriveShieldedIndependentKeyMaterial>>;
type Keys = { ownerSecret: bigint; ownerCommitment: bigint; hpkeIkm: string; keyMode: 0 | 1 };
type SourceMetadata = Awaited<
  ReturnType<typeof deriveShieldedIndependentKeyRootFromSignature>
>["sourceMetadata"];
type Prepared = {
  data: ShieldedPoolActionData;
  witness: ShieldedWitness;
  outputs: readonly { note: { amount?: BigNumberish; remaining?: BigNumberish } }[];
};
class AssetSessionError extends Error {}
const ASSET_METHODS = new Set([
  "unlockIdentity",
  "createIndependentKey",
  "restoreSignature",
  "exportRecoveryMaterial",
  "importRecoveryMaterial",
  "clearIndependentKey",
  "clearPendingIndependentKey",
  "receiveCode",
  "prepareLetter",
  "recoverLetters",
  "authorizeIdentityCounter",
  "recover",
  "discover",
  "preview",
  "prove",
  "cancelPreview",
]);
function firstStepIsFinal(steps: ShieldedActionPreview["steps"]) { return steps.length === 1; }
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
  private credentialsHandle = "";
  private independentKeyIdentitySecret: Uint8Array | null = null;
  private credentialsEpoch = 0;
  private independentKeyEpoch = 0;
  private root: Uint8Array | null = null;
  private independentKeyMaterial: IndependentKeyMaterial | null = null;
  private independentKey: ShieldedPublicIndependentKey | null = null;
  private sourceMetadata: SourceMetadata | undefined;
  private allowHistoryVerification = false;
  private createdHere = false;
  private knownPendingRoot = false;
  private sequence = 0;
  // Chain, factory, family, lineage and RPC are fixed for a session; the pool may change.
  private baseScope = "";
  private poolScope = "";
  private stateReadMode: ShieldedStateReadMode | null = null;
  private contextProvider: JsonRpcProvider | null = null;
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
    receive?: { credential: ReturnType<typeof decodeShieldedReceiveCredential>; salt: bigint; slot: number }[];
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
    return {
      credentials: this.independentKeyIdentitySecret ? { handle: this.credentialsHandle } : null,
      identity,
      independentKey: this.independentKey ? { ...this.independentKey } : null,
    };
  }

  clear(): void {
    this.credentialsEpoch++;
    this.independentKeyEpoch++;
    wipeBytes(this.independentKeyIdentitySecret);
    this.independentKeyIdentitySecret = null;
    this.credentialsHandle = "";
    wipeBytes(this.identity?.identitySalt);
    wipeBytes(this.identity?.derivedSecretBytes);
    this.identity = null;
    this.identityHandle = "";
    this.root?.fill(0);
    this.root = null;
    this.independentKeyMaterial = null;
    this.independentKey = null;
    this.sourceMetadata = undefined;
    this.allowHistoryVerification = false;
    this.createdHere = false;
    this.knownPendingRoot = false;
    this.wallets.clear();
    this.summary = null;
    this.pending = null;
    this.policyDrafts.clear();
    this.baseScope = "";
    this.poolScope = "";
    this.stateReadMode = null;
    this.contextProvider?.destroy();
    this.contextProvider = null;
  }

  private keys(slot: ShieldedKeySlot, requireVerified = true): Keys {
    if (slot === "identity") {
      requireValue(this.identity, "Unlock the original identity credentials first.");
      return { ...deriveShieldedHeirKeyMaterial(this.identity.derivedSecretField), keyMode: 0 };
    }
    this.requireCredentials();
    requireValue(
      this.independentKeyMaterial && this.independentKey,
      "Restore the original independent key mnemonic, Shielded Key or signature. A missing root cannot be replaced.",
    );
    requireValue(
      !requireVerified || this.independentKey.recoveryVerified,
      "Verify recovery of this independent key root before receiving or spending.",
    );
    return { ...this.independentKeyMaterial, keyMode: 1 };
  }

  async unlockIdentity(
    params: ShieldedAssetWorkerCallMap["unlockIdentity"]["params"],
  ): Promise<ShieldedAssetSessionState> {
    // Replacing credentials releases both secret paths, every root and prepared action.
    this.clear();
    const epoch = this.credentialsEpoch;
    let keyIdentitySecret: Uint8Array | undefined;
    let material: IdentityMaterial | undefined;
    try {
      // This path receives the original form fields and uses the fixed independent-key rules.
      // Run the two memory-hard KDFs sequentially.
      keyIdentitySecret = await deriveShieldedIndependentKeyIdentitySecret({
        identity: params.identity,
        rawPassphrase: params.rawPassphrase,
      });
      requireValue(
        keyIdentitySecret.length === 32,
        "Independent-key credentials require a complete 32-byte secret.",
      );
      requireValue(epoch === this.credentialsEpoch, "Credentials session was replaced or locked.");
      try {
        material = await deriveIdentityMaterial({
          identity: {
            ...params.identity,
            fullName: canonicalizeFullName(params.identity.fullName),
          },
          rawPassphrase: params.rawPassphrase,
          identitySuiteId: params.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1,
        });
      } catch {
        // Identity proof support is optional for recovering and spending existing VALUE.
      }
      requireValue(epoch === this.credentialsEpoch, "Credentials session was replaced or locked.");
      // A destroyed Worker may later be recreated with its counters reset.
      const credentialsHandle = `credentials:${crypto.randomUUID()}`;
      this.independentKeyIdentitySecret = keyIdentitySecret;
      keyIdentitySecret = undefined;
      this.credentialsHandle = credentialsHandle;
      this.identity = material ?? null;
      material = undefined;
      this.identityHandle = this.identity ? `identity:${++this.sequence}` : "";
      return this.state();
    } finally {
      params.rawPassphrase = "";
      wipeBytes(keyIdentitySecret);
      wipeBytes(material?.identitySalt);
      wipeBytes(material?.derivedSecretBytes);
    }
  }

  private requireCredentials(expectedHandle?: string): Uint8Array {
    requireValue(
      this.credentialsHandle && this.independentKeyIdentitySecret?.length === 32,
      "Unlock the original independent-key identity credentials first.",
    );
    requireValue(
      expectedHandle === undefined || expectedHandle === this.credentialsHandle,
      "Credentials session was replaced or locked.",
    );
    return this.independentKeyIdentitySecret;
  }

  private requireIndependentKeyRequest(expectedHandle: string, epoch: number): Uint8Array {
    requireValue(
      typeof expectedHandle === "string" && expectedHandle.length > 0,
      "A current credentials session handle is required.",
    );
    const secret = this.requireCredentials(expectedHandle);
    requireValue(epoch === this.independentKeyEpoch, "Independent key session was replaced or cleared.");
    return secret;
  }

  private sessionGuard(): () => void {
    const credentialsEpoch = this.credentialsEpoch;
    const independentKeyEpoch = this.independentKeyEpoch;
    return () =>
      requireValue(
        credentialsEpoch === this.credentialsEpoch && independentKeyEpoch === this.independentKeyEpoch,
        "The secret session was replaced or locked. Retry with the current credentials.",
      );
  }

  private async context(ctx: ShieldedWorkerContext) {
    const stateReadMode = normalizeShieldedStateReadMode(ctx.stateReadMode);
    const credentialsEpoch = this.credentialsEpoch;
    const baseScope = [
      ctx.chainId,
      ctx.factoryAddress.toLowerCase(),
      ctx.familyAddress.toLowerCase(),
      ctx.lineageIndexAddress.toLowerCase(),
      ctx.rpcUrl,
    ].join(":");
    const poolScope = ctx.poolAddress.toLowerCase();
    requireValue(
      !this.baseScope || baseScope === this.baseScope,
      "Protocol context changed. Lock and unlock in the new context.",
    );
    // Reuse the provider so verified public event snapshots survive between actions.
    const createdProvider = this.contextProvider === null;
    const provider = this.contextProvider ?? new JsonRpcProvider(ctx.rpcUrl);
    try {
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
      requireValue(
        credentialsEpoch === this.credentialsEpoch,
        "Credentials session was replaced or locked.",
      );
      if (this.poolScope && (poolScope !== this.poolScope || stateReadMode !== this.stateReadMode)) {
        // Preserve identity and key roots while dropping history, prepared
        // witnesses and policy drafts from the previous pool or read mode.
        this.wallets.clear();
        this.summary = null;
        this.pending = null;
        this.policyDrafts.clear();
      }
      this.baseScope = baseScope;
      this.poolScope = poolScope;
      this.stateReadMode = stateReadMode;
      this.contextProvider = provider;
      return {
        provider,
        factory,
        pool,
        verifierAddress: getAddress(verifierAddress).toLowerCase(),
        lineageIndex: createLineageIndexContract(ctx.lineageIndexAddress, provider),
        family,
      };
    } catch (cause) {
      if (createdProvider) {
        provider.destroy();
        if (this.contextProvider === provider) this.contextProvider = null;
      }
      throw cause;
    }
  }

  private async installRoot(
    root: Uint8Array,
    expectedCredentialsHandle: string,
    epoch: number,
    source: ShieldedPublicIndependentKey["rootSource"],
    metadata?: SourceMetadata,
    expectedFingerprint?: string,
    path?: "signature" | "mnemonic" | "shieldedKey",
  ) {
    let secret: Uint8Array | undefined;
    try {
      secret = this.requireIndependentKeyRequest(expectedCredentialsHandle, epoch).slice();
      const keys = await deriveShieldedIndependentKeyMaterial({
        independentKeyRoot: root,
        independentKeyIdentitySecret: secret,
      });
      this.requireIndependentKeyRequest(expectedCredentialsHandle, epoch);
      if (expectedFingerprint)
        requireValue(
          equalHexConstantTime(keys.keyFingerprint, expectedFingerprint),
          "Key fingerprint differs from the original wallet. The existing root was not replaced.",
        );
      if (this.independentKeyMaterial)
        requireValue(
          this.independentKeyMaterial.keyFingerprint === keys.keyFingerprint &&
            this.independentKey?.rootSource === source &&
            JSON.stringify(this.sourceMetadata) === JSON.stringify(metadata),
          "Lock before opening another independent key root or changing its source. Existing budgets cannot change owner.",
        );
      this.root?.fill(0);
      this.root = root.slice();
      this.independentKeyMaterial = keys;
      this.sourceMetadata = metadata;
      this.allowHistoryVerification = false;
      this.createdHere = false;
      this.knownPendingRoot = false;
      this.independentKey = {
        ownerCommitment: String(keys.ownerCommitment),
        viewingKey: hexlify(keys.viewPublicKey),
        keyFingerprint: keys.keyFingerprint,
        rootSource: source,
        ...(metadata ? { signerAddress: metadata.signerAddress } : {}),
        recoveryVerified: !!path,
        ...(path ? { recoveryPath: path } : {}),
      };
      this.wallets.clear();
      this.pending = null;
      this.summary = null;
    } finally {
      wipeBytes(secret);
      root.fill(0);
    }
  }

  async createIndependentKey(params: ShieldedAssetWorkerCallMap["createIndependentKey"]["params"]) {
    const epoch = this.independentKeyEpoch;
    requireValue(
      params.intent === "create" && !this.root,
      "Creating a new root requires an explicit new-wallet action and an empty independent key slot.",
    );
    this.requireIndependentKeyRequest(params.expectedCredentialsHandle, epoch);
    await this.context(params.context);
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
        createShieldedIndependentKeyRoot({ intent: "create", rootSource: "random" }),
        params.expectedCredentialsHandle,
        epoch,
        "random",
      );
    } else {
      requireValue(
        params.signerAddress && params.signature,
        "The selected wallet must sign the exact independent key message.",
      );
      const generated = await deriveShieldedIndependentKeyRootFromSignature({
        signerAddress: params.signerAddress,
        signature: params.signature,
      });
      params.signature = undefined;
      await this.installRoot(
        generated.independentKeyRoot,
        params.expectedCredentialsHandle,
        epoch,
        "walletSignature",
        generated.sourceMetadata,
      );
    }
    this.createdHere = true;
    this.independentKey!.backupRequired = true;
    return this.state();
  }

  async restoreSignature(params: ShieldedAssetWorkerCallMap["restoreSignature"]["params"]) {
    const epoch = this.independentKeyEpoch;
    this.requireIndependentKeyRequest(params.expectedCredentialsHandle, epoch);
    requireValue(
      !this.root,
      "Clear the original secret session before a real re-sign verification.",
    );
    await this.context(params.context);
    const generated = await deriveShieldedIndependentKeyRootFromSignature({
      signerAddress: params.signerAddress,
      signature: params.signature,
    });
    params.signature = "";
    await this.installRoot(
      generated.independentKeyRoot,
      params.expectedCredentialsHandle,
      epoch,
      "walletSignature",
      generated.sourceMetadata,
      params.expectedFingerprint,
      params.expectedFingerprint ? "signature" : undefined,
    );
    const backupRequired = params.pendingBackupFingerprints?.includes(this.independentKey!.keyFingerprint);
    if (backupRequired) {
      // The client retained this original public fingerprint before locking.
      // Re-export may resume its backup drill; spending remains gated.
      this.knownPendingRoot = true;
      this.independentKey!.backupRequired = true;
      this.independentKey!.recoveryVerified = false;
      delete this.independentKey!.recoveryPath;
    }
    this.allowHistoryVerification = !params.expectedFingerprint && !backupRequired;
    return this.state();
  }

  async exportRecoveryMaterial(
    params: ShieldedAssetWorkerCallMap["exportRecoveryMaterial"]["params"],
  ): Promise<ShieldedAssetWorkerCallMap["exportRecoveryMaterial"]["result"]> {
    this.requireCredentials();
    requireValue(this.root && this.independentKey, "Unlock the existing independent key root before exporting it.");
    requireValue(
      this.createdHere || this.knownPendingRoot || this.independentKey.recoveryVerified,
      "Confirm the original key fingerprint or owned history before backing up a recovery candidate.",
    );
    requireValue(
      params.format === "mnemonic" || params.format === "shieldedKey",
      "Unsupported independent key recovery format.",
    );
    await this.context(params.context);
    return {
      material:
        params.format === "mnemonic"
          ? encodeShieldedIndependentKeyMnemonic(this.root)
          : encodeShieldedIndependentKey(this.root),
      format: params.format,
      version: 1,
      keyFingerprint: this.independentKey.keyFingerprint,
    };
  }

  async importRecoveryMaterial(
    params: ShieldedAssetWorkerCallMap["importRecoveryMaterial"]["params"],
  ): Promise<ShieldedAssetSessionState> {
    let root: Uint8Array | undefined;
    let material = params.material;
    params.material = "";
    try {
      const epoch = this.independentKeyEpoch;
      this.requireIndependentKeyRequest(params.expectedCredentialsHandle, epoch);
      requireValue(
        !this.root,
        "Clear the original secret session before importing recovery material.",
      );
      requireValue(
        params.format === "mnemonic" || params.format === "shieldedKey",
        "Unsupported independent key recovery format.",
      );
      root =
        params.format === "mnemonic"
          ? decodeShieldedIndependentKeyMnemonic(material)
          : decodeShieldedIndependentKey(material);
      material = "";
      await this.context(params.context);
      // A parsable backup alone does not confirm the original credentials or wallet.
      await this.installRoot(
        root,
        params.expectedCredentialsHandle,
        epoch,
        "imported",
        undefined,
        params.expectedFingerprint,
        params.expectedFingerprint ? params.format : undefined,
      );
      this.independentKey!.backupRequired = false;
      // The tab's original public creation challenge also survives a full lock
      // or reload. Entering the saved backup under the same independent-key credentials
      // completes its real drill even when the new wallet has no history yet.
      const matchesCreationChallenge = params.pendingBackupFingerprints?.includes(
        this.independentKey!.keyFingerprint,
      );
      if (matchesCreationChallenge) {
        this.independentKey!.recoveryVerified = true;
        this.independentKey!.recoveryPath = params.format;
      }
      this.allowHistoryVerification = !this.independentKey!.recoveryVerified;
      return this.state();
    } finally {
      material = "";
      root?.fill(0);
    }
  }

  /** Restart setup only while the same unverified key and credentials are still current. */
  async clearPendingIndependentKey(
    params: ShieldedAssetWorkerCallMap["clearPendingIndependentKey"]["params"],
  ): Promise<ShieldedAssetSessionState> {
    const epoch = this.independentKeyEpoch;
    this.requireIndependentKeyRequest(params.expectedCredentialsHandle, epoch);
    requireValue(
      this.root &&
        this.independentKey?.backupRequired === true &&
        this.independentKey.recoveryVerified !== true,
      "Only an unverified independent key awaiting backup can be cleared for new setup.",
    );
    requireValue(
      typeof params.expectedFingerprint === "string" &&
        equalHexConstantTime(this.independentKey.keyFingerprint, params.expectedFingerprint),
      "The pending independent key fingerprint changed. The existing root was not cleared.",
    );
    return this.clearIndependentKey();
  }

  /**
   * Removes the independent key root, its branches and independent-slot history. The
   * independent-key identity secret and optional identity capability stay available for
   * signing and backup rehearsal. The next import starts empty.
   */
  async clearIndependentKey(): Promise<ShieldedAssetSessionState> {
    this.independentKeyEpoch++;
    this.root?.fill(0);
    this.root = null;
    this.independentKeyMaterial = null;
    this.independentKey = null;
    this.sourceMetadata = undefined;
    this.allowHistoryVerification = false;
    this.createdHere = false;
    this.knownPendingRoot = false;
    this.wallets.delete("independent");
    this.summary = null;
    this.pending = null;
    this.policyDrafts.clear();
    return this.state();
  }

  /** Positive VALUE, or an independent BUDGET checked against the unlocked identity, under this owner. */
  private confirmsCandidateRoot(notes: ReturnType<typeof listUnspentRecoveredShieldedNotes>) {
    const owner = this.independentKeyMaterial?.ownerCommitment;
    const identityCommitment = this.identity?.identityCommitment;
    return notes.some(({ note }) =>
      note.kind === "value"
        ? note.amount > 0n && note.ownerCommitment === owner
        : identityCommitment !== undefined &&
          note.binding !== "identity" &&
          getBigInt(note.keyMode ?? 0) === 1n &&
          note.remaining > 0n &&
          note.heirOwnerCommitment === owner &&
          note.heirIdentityCommitment === identityCommitment,
    );
  }

  private historyCandidate(): string | null {
    return this.independentKey &&
      this.allowHistoryVerification &&
      !this.independentKey.recoveryVerified &&
      !this.independentKey.backupRequired
      ? this.independentKey.keyFingerprint
      : null;
  }

  async prepareLetter(params: ShieldedAssetWorkerCallMap["prepareLetter"]["params"]): Promise<ShieldedAssetWorkerCallMap["prepareLetter"]["result"]> {
    const current = this.sessionGuard();
    const ctx = params.context;
    requireValue(ctx.lettersAddress, "The private letter archive is not configured for this chain.");
    const env = await this.context(ctx);
    const archive = createPrivateLetterContract(ctx.lettersAddress, env.provider);
    const authorizationAddress = await env.pool.AUTHORIZATION_STATE();
    requireValue(getAddress(await archive.POOL_FACTORY()) === getAddress(ctx.factoryAddress) &&
      getAddress(await archive.AUTHORIZATION_STATE()) === getAddress(authorizationAddress), "Letter archive belongs to another protocol deployment.");
    const verified = await this.recipient(params.code);
    requireValue(verified.disclosure === "anonymous", "Use an anonymous receive code for letters.");
    const credential = decodeShieldedReceiveCredential(params.code);
    const messageId = BigInt(hexlify(randomBytes(16))) || 1n;
    const salt = generateShieldedRandomField();
    const binding = computeShieldedReceiveCredentialBinding({ credential, salt });
    let attachment: { asset: string; pool: string; shardId: string; noteRoot: string; relationCommitment: string } | undefined;
    let attachmentWitness: Record<string, unknown> | undefined;
    let budgetReference;
    if (params.budgetCommitment) {
      await this.recover({ context: ctx });
      const template = [...this.wallets.values()].flatMap(listRecoveredFundingTemplates)
        .find(item => String(item.commitment) === params.budgetCommitment);
      requireValue(template && template.note.binding !== "identity" && Number(normalizeShieldedBudgetOrigin(template.note.budgetOrigin)) === 0,
        "Only a recovered, verified private Fund budget can have an attached letter.");
      requireValue(getBigInt(template.note.heirOwnerCommitment) === verified.ownerCommitment &&
        Number(template.note.keyMode ?? 0) === verified.keyMode && template.viewingKey?.toLowerCase() === verified.viewingKey.toLowerCase(),
        "The anonymous receive code must use the original budget's receiving keys and mode.");
      const wallet = [...this.wallets.values()].find(item => item.fundingTemplates?.has(template.commitment));
      const tree = wallet?.shards.get(template.shardId);
      requireValue(tree && tree.sizeBigInt >= 2n, "The budget's shared note tree is unavailable.");
      const path = tree.generateProof(tree.indexOf(template.commitment));
      requireValue(path.leaf === template.commitment && path.siblings.length <= 32, "The real budget is absent from its shared note tree.");
      budgetReference = { chainId: ctx.chainId, poolAddress: ctx.poolAddress, budgetCommitment: template.commitment };
      const relation = computeShieldedLetterRelationCommitment({ attachment: budgetReference, binding, salt });
      const commitments = getShieldedBudgetCommitments(template.note, wallet!);
      attachmentWitness = { budgetPool: String(BigInt(ctx.poolAddress)), budgetRoot: String(path.root), relation: String(relation),
        policy: String(commitments.policyCommitment), enrollment: String(commitments.enrollmentCommitment),
        rate: String(template.note.amountPerPeriod), remaining: String(template.note.remaining), nonce: String(template.note.nonce),
        ciphertextHash: String(computeShieldedCiphertextHashField(template.ciphertext)), depth: String(path.siblings.length), index: String(path.index),
        siblings: [...path.siblings, ...Array<bigint>(32 - path.siblings.length).fill(0n)].map(String) };
      const asset = ctx.assetKind === "native" ? ZeroAddress : await env.pool.TOKEN();
      attachment = { asset, pool: ctx.poolAddress, shardId: String(template.shardId), noteRoot: String(path.root), relationCommitment: String(relation) };
    }
    const envelope = createShieldedLetterEnvelope({ body: params.body, salt, attachment: budgetReference });
    const ciphertext = await encryptShieldedLetter({ chainId: ctx.chainId, lettersAddress: ctx.lettersAddress, messageId,
      recipientPublicKey: getBytes(verified.viewingKey), envelope });
    const state = await loadShieldedIdentityAuthorizationWitnessForMode(createIdentityAuthorizationContract(authorizationAddress, env.provider), credential.authorizationAlias, ctx.stateReadMode, { chainId: ctx.chainId, authorizationStateAddress: authorizationAddress });
    const presentation = prepareShieldedReceivePresentation({ credential, salt, authorizationWitness: state.witness, authorizationStateRoot: state.stateRoot, checkpointId: state.checkpointId,
      asOf: state.asOf, chainId: ctx.chainId, consumer: ctx.lettersAddress, action: attachment ? 2 : 1, messageId,
      payloadHash: computeShieldedLetterCiphertextHash(ciphertext) });
    const expected = [...presentation.publicSignals, ...(attachment ? [BigInt(attachment.pool), BigInt(attachment.noteRoot), BigInt(attachment.relationCommitment)] : [])];
    const proof = await proveShieldedReceivePresentation({ ...presentation.request, ...(attachmentWitness ? { attachment: attachmentWitness } : {}) }, expected);
    current();
    return { delivery: { messageId: String(messageId), checkpointId: String(state.checkpointId), asOf: String(state.asOf),
      expiresAt: String(credential.expiresAt), recipientBinding: String(binding) }, ciphertext: hexlify(ciphertext), proof: proof.proof, ...(attachment ? { attachment } : {}) };
  }

  async recoverLetters(params: ShieldedAssetWorkerCallMap["recoverLetters"]["params"]): Promise<ShieldedAssetWorkerCallMap["recoverLetters"]["result"]> {
    const current = this.sessionGuard();
    requireValue(this.identity || this.independentKeyMaterial, "Unlock the original identity credentials or restore the original independent key before reading letters.");
    const ctx = params.context;
    requireValue(ctx.lettersAddress, "The private letter archive is not configured for this chain.");
    const env = await this.context(ctx);
    const archive = createPrivateLetterContract(ctx.lettersAddress, env.provider);
    requireValue(getAddress(await archive.POOL_FACTORY()) === getAddress(ctx.factoryAddress) &&
      getAddress(await archive.AUTHORIZATION_STATE()) === getAddress(await env.pool.AUTHORIZATION_STATE()), "Letter archive belongs to another protocol deployment.");
    const records = await readPrivateLetters(archive);
    const letters: ShieldedAssetWorkerCallMap["recoverLetters"]["result"]["letters"] = [];
    for (const record of records) {
      for (const slot of ["identity", "independent"] as const) {
        if (slot === "identity" ? !this.identity : !this.independentKeyMaterial) continue;
        // Historical reading is available while a restored key is still a candidate.
        const keys = this.keys(slot, false);
        try {
          const envelope = await decryptShieldedLetter({ chainId: ctx.chainId, lettersAddress: ctx.lettersAddress, messageId: record.messageId,
            hpkeIkm: keys.hpkeIkm, ciphertext: record.ciphertext, expectedCiphertextHash: record.ciphertextHash,
            expectedBinding: record.recipientBinding, relationCommitment: record.relationCommitment });
          letters.push({ messageId: record.messageId, body: envelope.body, registeredAt: record.registeredAt, transactionHash: record.transactionHash, slot,
            attachment: envelope.attachment ? { chainId: String(envelope.attachment.chainId), poolAddress: envelope.attachment.poolAddress, budgetCommitment: String(envelope.attachment.budgetCommitment) } : null });
          break;
        } catch { /* All archived candidates are tried locally; unrelated recipients stay private. */ }
      }
    }
    current();
    return { letters, unavailable: 0 };
  }

  async receiveCode(params: ShieldedAssetWorkerCallMap["receiveCode"]["params"]) {
    requireValue(this.identity, "Identity credentials are required to prove a receiving code.");
    const keys = this.keys(params.slot);
    requireValue(params.context && params.expiresAt, "Receive code requires a chain and expiry.");
    const { provider, pool } = await this.context(params.context);
    const alias = computeShieldedAuthorizationAlias(this.identity);
    const address = String(await pool.AUTHORIZATION_STATE());
    const state = await loadShieldedIdentityAuthorizationWitnessForMode(createIdentityAuthorizationContract(address, provider), alias, params.context.stateReadMode, { chainId: params.context.chainId, authorizationStateAddress: address });
    const result = await createShieldedReceiveCode({
      ...serializeIdentity(this.identity),
      keyMode: keys.keyMode,
      keyMaterial: keys,
      disclosure: params.disclosure ?? "anonymous",
      authorizationCounter: state.witness.authorizationCounter,
      expiresAt: params.expiresAt,
    });
    return { code: result.code };
  }

  async authorizeIdentityCounter(params: ShieldedAssetWorkerCallMap["authorizeIdentityCounter"]["params"]): Promise<ShieldedAssetWorkerCallMap["authorizeIdentityCounter"]["result"]> {
    requireValue(this.identity, "Unlock the identity owner credentials first.");
    const { provider, pool } = await this.context(params.context);
    const address = String(await pool.AUTHORIZATION_STATE());
    const snapshot = await loadShieldedIdentityAuthorizationWitnessForMode(createIdentityAuthorizationContract(address, provider), computeShieldedAuthorizationAlias(this.identity), params.context.stateReadMode, { chainId: params.context.chainId, authorizationStateAddress: address });
    const transition = prepareShieldedIdentityCounterAuthorization({ ...this.identity, authorizationCounter: snapshot.witness.authorizationCounter, chainId: params.context.chainId, authorizationStateAddress: address });
    const identity = this.identity;
    const { proof } = await generateShieldedProof({ circuit: "identityAuthorizationUpdate", expectedPublicSignals: transition.publicSignals.map(String), witness: {
      ...transition.witness,
      nameField: String(identity.nameField), derivedSecretField: String(identity.derivedSecretField),
      isBirthBC: Number(identity.identity.isBirthBC), birthYear: identity.identity.birthYear, birthMonth: identity.identity.birthMonth,
      birthDay: identity.identity.birthDay, gender: identity.identity.gender, suiteId: identity.identitySuiteId,
    } });
    const p = transition.publicSignals.map(String);
    return { address, args: [p[0], p[3], p[4], p[5], p[6], p[7], encodeGroth16AbcProofData(normalizeGroth16Proof(proof))] };
  }

  async recover(
    params: ShieldedAssetWorkerCallMap["recover"]["params"],
  ): Promise<ShieldedWalletSummary> {
    const current = this.sessionGuard();
    requireValue(
      this.identity || this.independentKeyMaterial,
      "Unlock identity credentials or restore the original independent key root first.",
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
    const recoveredSlots: Array<{
      slot: ShieldedKeySlot;
      wallet: LocalShieldedWalletSnapshot;
      notes: ReturnType<typeof listUnspentRecoveredShieldedNotes>;
    }> = [];
    const seenNotes = new Set<string>();
    this.wallets.clear();
    for (const slot of ["identity", "independent"] as const) {
      if ((slot === "identity" && !this.identity) || (slot === "independent" && !this.independentKeyMaterial))
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
      current();
      this.wallets.set(slot, wallet);
      const notes = listUnspentRecoveredShieldedNotes(wallet, keys);
      recoveredSlots.push({ slot, wallet, notes });
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
      if (slot === "independent" && this.historyCandidate() && this.confirmsCandidateRoot(notes)) {
        this.independentKey!.recoveryVerified = true;
        this.independentKey!.recoveryPath = "history";
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
    }
    const lineage = this.identity
      ? await (normalizeShieldedStateReadMode(ctx.stateReadMode) === "chain"
          ? loadTargetedLineageSnapshot(lineageIndex, family, {
              blockNumber: toBlock,
              parentIdentityCommitments: [this.identity.identityCommitment],
              eligibility: recoveredSlots.flatMap(({ notes }) => notes.flatMap(({ note }) =>
                note.kind === "budget" && note.rootVersionIndex <= BigInt(Number.MAX_SAFE_INTEGER)
                  ? [{ heirIdentityCommitment: this.identity!.identityCommitment,
                      rootIdentityCommitment: note.rootIdentityCommitment,
                      rootVersionIndex: Number(note.rootVersionIndex) }]
                  : [],
              )),
            })
          : loadLineageSnapshot(lineageIndex, family, { toBlock, selection: {
              parentIdentityCommitments: [this.identity.identityCommitment],
              eligibility: recoveredSlots.flatMap(({ notes }) => notes.flatMap(({ note }) =>
                note.kind === "budget" && note.rootVersionIndex <= BigInt(Number.MAX_SAFE_INTEGER)
                  ? [{ heirIdentityCommitment: this.identity!.identityCommitment,
                      rootIdentityCommitment: note.rootIdentityCommitment, rootVersionIndex: Number(note.rootVersionIndex) }]
                  : [],
              )),
            } })).catch((cause: unknown) => {
          summary.familyRecordsError =
            cause instanceof InheritanceError && cause.code === "lineageIncompatible"
              ? "incompatible"
              : "unavailable";
          return null;
        })
      : null;
    current();
    if (this.identity) summary.familyRecordsAvailable = !!lineage;
    for (const { slot, wallet, notes } of recoveredSlots) {
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
          totalRemaining: String(option.overview.totalRemaining),
          periodDays: String(option.notes[0].note.periodDays),
          status: option.overview.status,
          ...(option.overview.nextDueAt === undefined
            ? {}
            : { nextDueAt: String(option.overview.nextDueAt) }),
          ...(option.overview.nextPeriodIndex === undefined ||
          option.overview.futurePeriods === undefined
            ? {}
            : {
                nextPeriodIndex: String(option.overview.nextPeriodIndex),
                futurePeriods: String(option.overview.futurePeriods),
              }),
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

  private async recipient(code: string): Promise<VerifiedShieldedRecipient> {
    const result = await verifyShieldedReceiveCode(code);
    requireValue(
      result.ok,
      "The receiving code is incomplete or failed its identity and ownership proof.",
    );
    return {
      ...result,
      ...(result.identityCommitment === undefined ? {} : { identityCommitment: BigInt(result.identityCommitment) }),
      ownerCommitment: BigInt(result.ownerCommitment),
    } as unknown as VerifiedShieldedRecipient;
  }

  async preview(request: ShieldedAssetActionRequest): Promise<ShieldedActionPreview> {
    const current = this.sessionGuard();
    this.pending = null;
    const keys = this.keys(request.slot);
    const ctx = request.context;
    const summary = await this.recover({ context: ctx });
    const wallet = this.wallets.get(request.slot);
    requireValue(wallet, "Recover this independent key slot before preparing a transaction.");
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
        ? await this.recipient(request.recipientCode ?? "")
        : undefined;
    if (transferRecipient) recipient = transferRecipient.fingerprint;
    let withdrawalRecipient: string | undefined;
    if (request.action === "unshield") {
      requireValue(request.publicRecipient, "Choose a public withdrawal destination.");
      withdrawalRecipient = getAddress(request.publicRecipient);
      requireValue(BigInt(withdrawalRecipient) !== 0n, "Unshield recipient must be nonzero");
      requireValue(
        withdrawalRecipient !== getAddress(ctx.poolAddress),
        "Unshield recipient must not be the pool",
      );
    }
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
      current();
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
        ? await this.recipient(request.recipientCode)
        : undefined;
      if (kind === 0)
        requireValue(verified, "Private initial funding requires a verified receiving code.");
      if (verified)
        requireValue(
          kind === 0 &&
            verified.keyMode === mode &&
            verified.disclosure === "fund" && verified.personHash?.toLowerCase() === request.publicRecipient.toLowerCase(),
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
            lineage: normalizeShieldedStateReadMode(ctx.stateReadMode) === "chain"
              ? await loadTargetedLineageSnapshot(env.lineageIndex, env.family, {
                  eligibility: [{ heirIdentityCommitment: verified?.identityCommitment ?? await env.lineageIndex.identityCommitmentOf(request.publicRecipient),
                    rootIdentityCommitment: policy!.rootIdentityCommitment,
                    rootVersionIndex: Number(policy!.rootVersionIndex) }],
                })
              : await loadLineageSnapshot(env.lineageIndex, env.family, { selection: verified
                  ? { eligibility: [{ heirIdentityCommitment: verified.identityCommitment!,
                      rootIdentityCommitment: policy!.rootIdentityCommitment, rootVersionIndex: Number(policy!.rootVersionIndex) }] }
                  : { publicEligibility: [{ heirPersonHash: request.publicRecipient!,
                      rootIdentityCommitment: policy!.rootIdentityCommitment, rootVersionIndex: Number(policy!.rootVersionIndex) }] },
                }),
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
        "A independent key root alone cannot replace the budget's identity credentials.",
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
      const budget = wallet.ownedNotes.get(BigInt(claim.budgets[0]))?.note;
      requireValue(budget?.kind === "budget", "The selected budget is unavailable.");
      requireValue(budget.rootVersionIndex <= BigInt(Number.MAX_SAFE_INTEGER), "The budget root version is unsupported.");
      const lineage = normalizeShieldedStateReadMode(ctx.stateReadMode) === "chain"
        ? await loadTargetedLineageSnapshot(env.lineageIndex, env.family, {
            eligibility: [{ heirIdentityCommitment: this.identity.identityCommitment,
              rootIdentityCommitment: budget.rootIdentityCommitment,
              rootVersionIndex: Number(budget.rootVersionIndex) }],
          })
        : await loadLineageSnapshot(env.lineageIndex, env.family, { selection: {
            eligibility: [{ heirIdentityCommitment: this.identity.identityCommitment,
              rootIdentityCommitment: budget.rootIdentityCommitment, rootVersionIndex: Number(budget.rootVersionIndex) }],
          } });
      const result = await prepareShieldedClaim({
        ...scope,
        identity: serializeIdentity(this.identity),
        keyMaterial: keys,
        wallet,
        lineage,
        budgetCommitment: claim.budgets[0],
        ...(claim.budgets[1] ? { secondBudgetCommitment: claim.budgets[1] } : {}),
        asOf: lineage.timestamp,
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
      if (request.action === "fund" && first.kind === "merge") {
        requireValue(fundArgs, "Funding policy was not prepared.");
        // Validate the final destination before preparing any funding consolidation.
        await validateShieldedFundingDestination(fundArgs);
      }
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
        circuit = "privateTransfer";
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
        circuit = "privateTransfer";
      } else {
        requireValue(withdrawalRecipient, "Choose a public withdrawal destination.");
        const result = await prepareShieldedUnshield({
          ...scope,
          inputs: valueInputs,
          amount,
          recipient: withdrawalRecipient,
        });
        prepared = result;
        recipient = result.recipient;
        actionId = SHIELDED_POOL_ACTION.Unshield;
        circuit = "unshield";
      }
    }
    const receive: { credential: ReturnType<typeof decodeShieldedReceiveCredential>; salt: bigint; slot: number }[] = [];
    prepared.data.receiveAuthorizations = emptyShieldedReceiveAuthorizations();
    if ((actualAction === "fund" && Number(prepared.data.budgetKind) === 0) ||
      (actualAction === "privateTransfer" && request.action === "privateTransfer" && steps[0]?.inputs.join() === inputs.join() && firstStepIsFinal(steps))) {
      const credential = decodeShieldedReceiveCredential(request.recipientCode ?? "");
      requireValue(credential.disclosure === (actualAction === "fund" ? "fund" : "anonymous"), "Use the receive material for this operation.");
      const salt = generateShieldedRandomField();
      const binding = computeShieldedReceiveCredentialBinding({ credential, salt });
      prepared.data.receiveAuthorizations[0] = { checkpointId: 0n, asOf: 0n, expiresAt: credential.expiresAt, recipientBinding: binding, proof: "0x" };
      prepared.witness.receiveBindings = [String(binding), "0"];
      if (actualAction === "fund") {
        prepared.witness.receiveAuthorizationAlias = String(credential.authorizationAlias);
        prepared.witness.receiveSalt = String(salt);
      } else {
        const view = splitShieldedViewPublicKey(credential.viewingKey);
        prepared.witness.receiveAuthorizationAliases = [String(credential.authorizationAlias), "0"];
        prepared.witness.receiveSalts = [String(salt), "0"];
        prepared.witness.receiveKeyModes = [String(credential.keyMode), "0"];
        prepared.witness.receiveViewKeyLo = [String(view.viewKeyLo), "0"];
        prepared.witness.receiveViewKeyHi = [String(view.viewKeyHi), "0"];
      }
      receive.push({ credential, salt, slot: 0 });
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
    current();
    this.pending = { context: ctx, request, preview, prepared, circuit, actionId, receive };
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
      requireValue(
        getBigInt(pending.prepared.data.lineageCheckpointId) > 0n &&
          (await env.lineageIndex.isKnownCheckpoint(
            pending.prepared.data.lineageCheckpointId,
            pending.prepared.data.relation0,
            pending.prepared.data.relation1,
            pending.prepared.data.asOf,
            { blockTag: toBlock },
          )),
        "Family eligibility snapshot expired after preview. Prepare and confirm a fresh proof.",
      );
    }
    if (pending.receive?.length) {
      const authorizationAddress = String(await env.pool.AUTHORIZATION_STATE());
      const payloadHash = computeShieldedReceiveActionHash(pending.prepared.data);
      const authorizations = [...emptyShieldedReceiveAuthorizations()];
      for (const item of pending.receive) {
        const state = await loadShieldedIdentityAuthorizationWitnessForMode(createIdentityAuthorizationContract(authorizationAddress, env.provider), item.credential.authorizationAlias, params.context.stateReadMode, { chainId: params.context.chainId, authorizationStateAddress: authorizationAddress });
        const presentation = prepareShieldedReceivePresentation({ ...item, authorizationWitness: state.witness, authorizationStateRoot: state.stateRoot, checkpointId: state.checkpointId, asOf: state.asOf,
          chainId: params.context.chainId, consumer: params.context.poolAddress, action: pending.actionId === SHIELDED_POOL_ACTION.Fund ? 3 : 4,
          messageId: item.slot, payloadHash });
        const proof = await proveShieldedReceivePresentation(presentation.request, presentation.publicSignals);
        authorizations[item.slot] = { checkpointId: state.checkpointId, asOf: state.asOf, expiresAt: item.credential.expiresAt,
          recipientBinding: presentation.recipientBinding, proof: proof.proof };
      }
      pending.prepared.data.receiveAuthorizations = authorizations;
    }
    const expected = buildShieldedPoolPublicSignals({
      action: pending.actionId,
      chainId: BigInt(params.context.chainId),
      poolAddress: params.context.poolAddress,
      receiveAuthorizations: pending.prepared.data.receiveAuthorizations,
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
    const current = this.sessionGuard();
    requireValue(
      this.identity || this.independentKeyMaterial,
      "Unlock a key slot before recovering factory pools.",
    );
    const env = await this.context(params.context);
    const found = await discoverShieldedFactoryPools(env.factory, env.provider, {
      factoryDeploymentBlock: params.context.factoryDeploymentBlock,
      lineageIndexAddress: params.context.lineageIndexAddress,
      verifierAddress: env.verifierAddress,
      chainId: BigInt(params.context.chainId),
      timeoutMs: 10_000,
    });
    current();
    const pools: ShieldedAssetWorkerCallMap["discover"]["result"]["pools"] = [];
    // A candidate root may be confirmed by valid history in any verified factory pool.
    const candidate = this.historyCandidate();
    let candidateConfirmed = false;
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
        for (const slot of ["identity", "independent"] as const) {
          if ((slot === "identity" && !this.identity) || (slot === "independent" && !this.independentKeyMaterial))
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
          const notes = listUnspentRecoveredShieldedNotes(wallet, keys);
          current();
          if (slot === "independent" && candidate && this.confirmsCandidateRoot(notes))
            candidateConfirmed = true;
          for (const event of notes) {
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
    current();
    requireValue(
      anchor?.hash === found.blockHash,
      "Discovery block was reorganized. Re-run recovery.",
    );
    if (candidateConfirmed && this.independentKey && this.independentKey.keyFingerprint === candidate) {
      this.independentKey.recoveryVerified = true;
      this.independentKey.recoveryPath = "history";
    }
    return {
      complete: found.enumerationComplete && pools.every((pool) => pool.status === "recovered"),
      pools,
      ...(found.enumerationError ? { error: found.enumerationError } : {}),
      sessionState: this.state(),
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
        if ("signature" in params) params.signature = "";
      }
    }
  }
}

/** Cryptographic library failures must not serialize witnesses, signatures, or passwords. */
export function shieldedAssetErrorMessage(error: unknown): string {
  return error instanceof AssetSessionError
    ? error.message
    : "Asset operation could not be completed. The original root was not replaced; check the recovery words, Shielded Key, credentials, deployment, and chain history.";
}
