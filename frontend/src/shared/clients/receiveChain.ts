import type { BoundarySubmission } from "../workers/walletWorkerTypes";
import { getPublicStateReadMode, type PublicStateReadMode } from "../config/env";
import { readRoleRevocationState } from "./receiveRevocations";
import {
  assertReceiveTreeAnchor,
  readReceiveTreeAnchor,
  readReceiveTreePath,
  type ReceiveTreeAnchor,
} from "./receiveTree";
import {
  computeShieldedCiphertextHashField,
  splitShieldedViewPublicKey,
  type ProtocolProof,
  type ReceiveCode,
  type Capability,
  type PreparedDeposit,
  type PreparedClaim,
  type PreparedTransfer,
  type ProtocolInteger,
  type ClaimRoleStatus,
  SNARK_SCALAR_FIELD,
  REVOCATION_SCAN_BATCH_SIZE,
  REVOCATION_SCAN_TAIL_SIZE,
} from "@deepfamily/protocol-core";
import {
  AbiCoder, Contract, getAddress, getBigInt, hexlify, isError, toBeHex,
  type BigNumberish, type ContractRunner, type ContractTransactionResponse, type Signer,
} from "ethers";

const CODE_TUPLE = "(uint256 codeAlias,uint256 commonBinding,uint256 revocationTag,uint256 nonce,uint256 ownerCommitment,uint256 viewKeyLo,uint256 viewKeyHi,uint64 expiresAt)";
const CAP_TUPLE = "(uint256 issuanceRoot,uint256 parentVersion,uint256 capabilityBinding,uint256 familyTag,uint256 childTag,uint256 endorsementTag,uint256 trustedTag)";
export const POOL_ACTION_TUPLE = "(uint256[] inputShardIds,uint256[] inputRoots,uint256[] inputNullifiers,uint256[2] outputCommitments,bytes[2] outputCiphertexts)";
const ACTION_TUPLE = POOL_ACTION_TUPLE;
export const RECEIVE_REGISTRY_ABI = [
  "error RevocationStateNotPrepared(uint8 role,uint256 checked,uint256 total)",
  "error QualificationRevoked(uint8 role)",
  "error UnknownIssuanceRoot()",
  `function verifyReceive(${CODE_TUPLE} code,bytes codeProof) view returns (bool)`,
  `function verifyBudgetCapability(${CODE_TUPLE} code,${CAP_TUPLE} capability,bytes codeProof,bytes capabilityProof) view returns (bool)`,
  "function isKnownIssuanceRoot(uint256 root) view returns (bool)",
  "function validateBudgetRoleStatus(uint256 issuanceRoot,uint256 nonce,uint256 childTag,uint256 endorsementTag,uint256 trustedTag) view returns (bool)",
  "function isCodeRevoked(uint256 tag) view returns (bool)",
  "function revokeCode(uint256 secret) returns (uint256)",
  "function issuanceRoot() view returns (uint256)",
  "function credentialCount() view returns (uint256)",
  "event CredentialIssued(uint256 indexed leafIndex,uint256 credential,uint256 root)",
  "function SOURCE() view returns (address)",
  "function registerCredential(uint256 credential,uint256 sourceRoot,uint256 trustedRoot,bytes proof) returns (uint256 leafIndex,uint256 root)",
  "function getCredentialProof(uint256 leafIndex) view returns (uint256 leaf,uint256 root,uint256 index,uint256 depth,uint256[] siblings)",
] as const;
export const ELIGIBILITY_SOURCE_ABI = [
  "error RevocationStateNotPrepared(uint8 role,uint256 checked,uint256 total)",
  "function MAX_REVOCATION_BATCH() view returns (uint256)",
  "function MAX_REVOCATION_TAIL() view returns (uint256)",
  "function revokedRoleCount(uint8 role) view returns (uint256)",
  "function roleScanProgress(uint8 role,uint256 nonce,uint256 tag) view returns (uint256)",
  "function revocationCheckpoint(uint8 role,uint256 count) view returns (uint256)",
  "function getRevokedRolePage(uint8 role,uint256 start,uint256 limit) view returns (uint256[])",
  "function prepareRoleScan(uint8 role,uint256 nonce,uint256 tag,uint256 start,uint256 end,bytes proof)",
  "function sourceRoot() view returns (uint256)",
  "function trustedRoot() view returns (uint256)",
  "function sourceSize(uint8 treeId) view returns (uint256)",
  "function getSourceProof(uint8 treeId,uint256 leafIndex) view returns (uint256 leaf,uint256 root,uint256 index,uint256 depth,uint256[] siblings)",
  "event SourceLeafPublished(uint8 indexed treeId,uint256 indexed leafIndex,uint256 leaf,uint256 root)",
  "function publishFact(uint256 childIdentity,uint256 parentIdentity,address endorser,uint256 parentVersion,uint256 factLeaf,uint256 childRoleCommitment,uint256 endorsementRoleCommitment,bytes proof) returns (uint256 leafIndex,uint256 root)",
  "function publishTrust(uint256 parentIdentity,address endorser,uint256 parentVersion,uint256 trustLeaf,uint256 trustRoleCommitment,bytes proof) returns (uint256 leafIndex,uint256 root)",
] as const;
export const POOL_ABI = [
  "error RevocationStateNotPrepared(uint8 role,uint256 checked,uint256 total)",
  "function protocolVersion() view returns (uint256)",
  "function RECEIVE_REGISTRY() view returns (address)",
  "function assetKind() view returns (uint8)",
  "function VERIFIER() view returns (address)",
  "function TOKEN() view returns (address)",
  "function nullifierCount() view returns (uint256)",
  "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
  "function nullifierSpent(uint256) view returns (bool)",
  "function creationBlock() view returns (uint256)",
  "function currentShardId() view returns (uint256)",
  "function noteShard(uint256 shardId) view returns (uint256 size,uint256 depth,uint256 root)",
  "function getNoteMerkleProof(uint256 shardId,uint256 leafIndex) view returns (uint256 leaf,uint256 proofRoot,uint256 proofIndex,uint256 proofDepth,uint256[] siblings)",
  "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
  "event NullifierSpent(uint256 nullifier)",
  `function shield(uint256 amount,${ACTION_TUPLE} data,bytes proof) payable`,
  `function unshield(address recipient,uint256 amount,${ACTION_TUPLE} data,bytes proof)`,
  "function budgetRecords(uint256) view returns (bool exists,uint256 commonBinding,uint256 policyCommitment,uint64 eligibleFrom,uint256 codeAlias,uint256 nonce,uint256 ownerCommitment,uint256 viewKeyLo,uint256 viewKeyHi)",
  `function depositBudget(${CODE_TUPLE} code,${CAP_TUPLE} capability,bytes codeProof,bytes capabilityProof,(uint256 policyCommitment,uint256 budgetKey,uint64 eligibleFrom) deposit,${ACTION_TUPLE} data,bytes proof)`,
  `function claimBudget((uint256 budgetKey,uint64 asOf,uint256 periodNullifier,uint256 issuanceRoot,uint256 childTag,uint256 endorsementTag,uint256 trustedTag) claimData,${ACTION_TUPLE} data,bytes proof)`,
  `function transfer(${CODE_TUPLE} code,bytes codeProof,${ACTION_TUPLE} data,bytes proof)`,
] as const;
export const LETTER_ABI = [
  "function RECEIVE_REGISTRY() view returns (address)",
  `function registerLetter(uint128 messageId,${CODE_TUPLE} code,bytes codeProof,bytes ciphertext)`,
] as const;

export interface RevocationScanSubmission {
  sourceAddress: string;
  role: 0 | 1 | 2;
  nonce: bigint;
  tag: bigint;
  start: bigint;
  end: bigint;
  startHash: bigint;
  endHash: bigint;
  publicSignals: bigint[];
  proof: ProtocolProof;
}
export type DepositSubmission = Omit<PreparedDeposit, "note" | "changeNote"> & { revocationScans?: RevocationScanSubmission[] };
export type ClaimSubmission = Omit<PreparedClaim, "note" | "valueNote"> & { revocationScans?: RevocationScanSubmission[] };
export type TransferSubmission = Omit<PreparedTransfer, "note" | "changeNote">;

export interface ReceiveDeployment {
  chainId: BigNumberish;
  registryAddress: string;
  poolAddress: string;
  lettersAddress?: string;
}
interface ReceiveChainOptions {
  stateReadMode?: PublicStateReadMode;
  beforeTransaction?: () => void;
  onRevocationPreparation?: (completed: number, total: number) => void;
  prepareRevocationScans?: (status: ClaimRoleStatus) => Promise<RevocationScanSubmission[]>;
}
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
/** The adapter expects abi.encode(a,b,c), including Solidity's reversed Fp2 coordinates. */
export function encodeProtocolProof(proof: ProtocolProof): string {
  if ((proof.protocol && proof.protocol !== "groth16") || (proof.curve && proof.curve !== "bn128")) throw new Error("Unsupported receiving proof format");
  if (proof.pi_a.length < 2 || proof.pi_b.length < 2 || proof.pi_b[0].length < 2 || proof.pi_b[1].length < 2 || proof.pi_c.length < 2) throw new Error("Malformed receiving proof");
  const coordinate = (value: BigNumberish) => {
    const parsed = getBigInt(value);
    if (parsed < 0n || parsed >= BASE_FIELD) throw new Error("Noncanonical receiving proof coordinate");
    return parsed;
  };
  const a = proof.pi_a.slice(0, 2).map(coordinate);
  const b = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]].map(row => row.map(coordinate));
  const c = proof.pi_c.slice(0, 2).map(coordinate);
  if (!a.some(Boolean) || !b.flat().some(Boolean) || !c.some(Boolean)) throw new Error("Receive proof point is infinity");
  if ((proof.pi_a.length > 2 && getBigInt(proof.pi_a[2]) !== 1n) || (proof.pi_c.length > 2 && getBigInt(proof.pi_c[2]) !== 1n)
      || (proof.pi_b.length > 2 && (getBigInt(proof.pi_b[2][0]) !== 1n || getBigInt(proof.pi_b[2][1]) !== 0n))) throw new Error("Receive proof must be affine");
  return AbiCoder.defaultAbiCoder().encode(["uint256[2]", "uint256[2][2]", "uint256[2]"], [a, b, c]);
}
export function receivingCodeStruct(code: ReceiveCode) {
  return { codeAlias: code.codeAlias, commonBinding: code.commonBinding, revocationTag: code.revocationTag,
    nonce: code.nonce, ownerCommitment: code.ownerCommitment, ...splitShieldedViewPublicKey(code.viewingKey), expiresAt: code.expiresAt };
}
export function receivingCapabilityStruct(cap: Capability) {
  return { issuanceRoot: cap.issuanceRoot, parentVersion: cap.parentVersion, capabilityBinding: cap.capabilityBinding,
    familyTag: cap.familyTag, childTag: cap.childTag, endorsementTag: cap.endorsementTag, trustedTag: cap.trustedTag };
}
export function buildActionData(input: {
  inputShardId: BigNumberish; inputRoot: BigNumberish; inputNullifier: BigNumberish;
  outputCommitments: readonly BigNumberish[]; outputCiphertexts: readonly Uint8Array[];
}) {
  const shardId = getBigInt(input.inputShardId);
  if (shardId < 0n || shardId >= 1n << 128n || input.outputCommitments.length !== 2 || input.outputCiphertexts.length !== 2
      || input.outputCiphertexts.some(bytes => bytes.length !== 512)) throw new Error("Invalid receiving action shape");
  return { inputShardIds: [shardId], inputRoots: [getBigInt(input.inputRoot)], inputNullifiers: [getBigInt(input.inputNullifier)],
    outputCommitments: input.outputCommitments.map(value => getBigInt(value)),
    outputCiphertexts: input.outputCiphertexts.map(hexlify) };
}
function assertCiphertexts(prepared: { outputCiphertexts: Uint8Array[]; ciphertextHashes: bigint[] }) {
  if (prepared.outputCiphertexts.length !== 2 || prepared.ciphertextHashes.length !== 2 || prepared.outputCiphertexts.some((bytes, i) => computeShieldedCiphertextHashField(bytes) !== prepared.ciphertextHashes[i])) throw new Error("Action ciphertext changed after proving");
}

/** A receive code uses the configured canonical deployment. */
export class ReceiveChain {
  readonly deployment: Readonly<{ chainId: bigint; registryAddress: string; poolAddress: string; lettersAddress?: string }>;
  private readonly registry: Contract;
  private readonly pool: Contract;
  private readonly letters?: Contract;
  readonly stateReadMode: PublicStateReadMode;
  constructor(
    deployment: ReceiveDeployment,
    private readonly runner: ContractRunner,
    private readonly options: ReceiveChainOptions = {},
  ) {
    this.stateReadMode = options.stateReadMode ?? getPublicStateReadMode();
    if (this.stateReadMode !== "rebuild" && this.stateReadMode !== "chain")
      throw new Error("Unsupported receiving state read mode");
    this.deployment = Object.freeze({
      chainId: getBigInt(deployment.chainId),
      registryAddress: getAddress(deployment.registryAddress),
      poolAddress: getAddress(deployment.poolAddress),
      ...(deployment.lettersAddress
        ? { lettersAddress: getAddress(deployment.lettersAddress) }
        : {}),
    });
    if (
      this.deployment.chainId <= 0n ||
      BigInt(this.deployment.registryAddress) === 0n ||
      BigInt(this.deployment.poolAddress) === 0n
    )
      throw new Error("Invalid receiving deployment");
    this.registry = new Contract(this.deployment.registryAddress, RECEIVE_REGISTRY_ABI, runner);
    this.pool = new Contract(this.deployment.poolAddress, POOL_ABI, runner);
    this.letters = this.deployment.lettersAddress
      ? new Contract(this.deployment.lettersAddress, LETTER_ABI, runner)
      : undefined;
  }
  private async assertDeployment(blockTag?: number) {
    const provider = this.runner.provider;
    if (!provider) throw new Error("Receive deployment requires a provider");
    const overrides = blockTag === undefined ? {} : { blockTag };
    const [network, registry, version] = await Promise.all([
      provider.getNetwork(),
      this.pool.RECEIVE_REGISTRY(overrides),
      this.pool.protocolVersion(overrides),
    ]);
    if (
      network.chainId !== this.deployment.chainId ||
      getAddress(registry) !== this.deployment.registryAddress ||
      BigInt(version) !== 1n
    )
      throw new Error("Receive deployment does not match the connected chain/pool");
  }
  private assertCode(code: ReceiveCode) {
    if (code.chainId !== this.deployment.chainId || code.authorizerScope !== BigInt(this.deployment.registryAddress)) throw new Error("Receive code belongs to another chain or registry");
  }
  private async sourceAt(anchor: ReceiveTreeAnchor) {
    const sourceAddress = getAddress(await this.registry.SOURCE({ blockTag: anchor.blockNumber }));
    if (BigInt(sourceAddress) === 0n)
      throw new Error("Receiving eligibility source is unavailable");
    const source = new Contract(sourceAddress, ELIGIBILITY_SOURCE_ABI, this.runner);
    return { sourceAddress, source };
  }
  private provider() {
    const provider = this.runner.provider;
    if (!provider) throw new Error("Receive deployment requires a provider");
    return provider;
  }
  async readSourceRoots() {
    const provider = this.provider(),
      anchor = await readReceiveTreeAnchor(provider);
    await this.assertDeployment(anchor.blockNumber);
    const { sourceAddress, source } = await this.sourceAt(anchor);
    const overrides = { blockTag: anchor.blockNumber };
    const [sourceRoot, trustedRoot] = await Promise.all([
      source.sourceRoot(overrides),
      source.trustedRoot(overrides),
    ]);
    await assertReceiveTreeAnchor(provider, anchor);
    return {
      sourceAddress,
      sourceRoot: BigInt(sourceRoot),
      trustedRoot: BigInt(trustedRoot),
      ...anchor,
    };
  }
  async sendCredentialRegistration(input: { proof: ProtocolProof; publicSignals: readonly ProtocolInteger[] }): Promise<ContractTransactionResponse> {
    const roots = await this.readSourceRoots();
    const signals = input.publicSignals.map(value => getBigInt(value));
    if (signals.length !== 5 || signals[1] !== this.deployment.chainId || signals[2] !== BigInt(this.deployment.registryAddress)
      || signals[3] !== roots.sourceRoot || signals[4] !== roots.trustedRoot) throw new Error("Receive issuance statement does not match current source roots");
    return this.registry.registerCredential(signals[0], signals[3], signals[4], encodeProtocolProof(input.proof));
  }
  async sendSourceFact(input: { proof: ProtocolProof; publicSignals: readonly ProtocolInteger[] }): Promise<ContractTransactionResponse> {
    const roots = await this.readSourceRoots();
    const signals = input.publicSignals.map(value => getBigInt(value));
    if (signals.length !== 10 || signals[3] !== this.deployment.chainId || signals[4] !== BigInt(roots.sourceAddress)) throw new Error("Receive source fact scope mismatch");
    return new Contract(roots.sourceAddress, ELIGIBILITY_SOURCE_ABI, this.runner).publishFact(signals[5], signals[6], getAddress(toBeHex(signals[7], 20)), signals[8],
      signals[0], signals[1], signals[2], encodeProtocolProof(input.proof));
  }
  async sendSourceTrust(input: { proof: ProtocolProof; publicSignals: readonly ProtocolInteger[] }): Promise<ContractTransactionResponse> {
    const roots = await this.readSourceRoots();
    const signals = input.publicSignals.map(value => getBigInt(value));
    if (signals.length !== 8 || signals[2] !== this.deployment.chainId || signals[3] !== BigInt(roots.sourceAddress)) throw new Error("Receive source trust scope mismatch");
    return new Contract(roots.sourceAddress, ELIGIBILITY_SOURCE_ABI, this.runner).publishTrust(signals[4], getAddress(toBeHex(signals[5], 20)), signals[6],
      signals[0], signals[1], encodeProtocolProof(input.proof));
  }
  async readBudgetRecord(budgetKey: bigint) {
    await this.assertDeployment();
    const result = await this.pool.budgetRecords(budgetKey);
    return { exists: Boolean(result.exists), commonBinding: BigInt(result.commonBinding), policyCommitment: BigInt(result.policyCommitment),
      eligibleFrom: BigInt(result.eligibleFrom), codeAlias: BigInt(result.codeAlias), nonce: BigInt(result.nonce),
      ownerCommitment: BigInt(result.ownerCommitment), viewKeyLo: BigInt(result.viewKeyLo), viewKeyHi: BigInt(result.viewKeyHi) };
  }
  async isPeriodSpent(nullifier: bigint): Promise<boolean> {
    await this.assertDeployment();
    return Boolean(await this.pool.nullifierSpent(nullifier));
  }
  async readCredentialProof(leafIndex: ProtocolInteger) {
    const index = getBigInt(leafIndex);
    if (index < 0n || index >= 1n << 32n) throw new Error("Invalid qualification leaf index");
    const provider = this.provider(),
      anchor = await readReceiveTreeAnchor(provider);
    await this.assertDeployment(anchor.blockNumber);
    return readReceiveTreePath({
      contract: this.registry,
      chainId: this.deployment.chainId,
      anchor,
      mode: this.stateReadMode,
      leafIndex: index,
    });
  }
  async readSourceProof(treeId: 0 | 1, leafIndex: ProtocolInteger) {
    if (treeId !== 0 && treeId !== 1) throw new Error("Invalid eligibility source tree");
    const provider = this.provider(),
      anchor = await readReceiveTreeAnchor(provider);
    await this.assertDeployment(anchor.blockNumber);
    const { source } = await this.sourceAt(anchor);
    return readReceiveTreePath({
      contract: source,
      chainId: this.deployment.chainId,
      anchor,
      mode: this.stateReadMode,
      treeId,
      leafIndex: getBigInt(leafIndex),
    });
  }
  /** Both Issue witnesses use the same Source address and canonical block. */
  async readSourcePaths(factLeafIndex: ProtocolInteger, trustedLeafIndex: ProtocolInteger) {
    const provider = this.provider(),
      anchor = await readReceiveTreeAnchor(provider);
    await this.assertDeployment(anchor.blockNumber);
    const { sourceAddress, source } = await this.sourceAt(anchor);
    const [sourcePath, trustedPath] = await Promise.all([
      readReceiveTreePath({
        contract: source,
        chainId: this.deployment.chainId,
        anchor,
        mode: this.stateReadMode,
        treeId: 0,
        leafIndex: getBigInt(factLeafIndex),
      }),
      readReceiveTreePath({
        contract: source,
        chainId: this.deployment.chainId,
        anchor,
        mode: this.stateReadMode,
        treeId: 1,
        leafIndex: getBigInt(trustedLeafIndex),
      }),
    ]);
    await assertReceiveTreeAnchor(provider, anchor);
    return {
      sourceAddress,
      sourceRoot: sourcePath.root,
      trustedRoot: trustedPath.root,
      sourcePath,
      trustedPath,
      ...anchor,
    };
  }
  async checkReceive(code: ReceiveCode): Promise<boolean> {
    await this.assertDeployment(); this.assertCode(code);
    return Boolean(await this.registry.verifyReceive(receivingCodeStruct(code), encodeProtocolProof(code.proof)));
  }
  async checkEligibility(code: ReceiveCode, cap: Capability): Promise<boolean> {
    await this.assertDeployment(); this.assertCode(code);
    try {
      return Boolean(await this.registry.verifyBudgetCapability(receivingCodeStruct(code), receivingCapabilityStruct(cap),
        encodeProtocolProof(code.proof), encodeProtocolProof(cap.proof)));
    } catch (error) {
      // The registry verifies both fixed-key proofs before asking Source for status.
      // Read-only preparation authenticates the public suffix when the on-chain cache
      // needs advancing. The final transaction still checks the canonical latest tail.
      if (!this.needsRevocationPreparation(error)) throw error;
      return !(await this.readQualificationRevocations({ issuanceRoot: cap.issuanceRoot, nonce: code.nonce,
        childTag: cap.childTag, endorsementTag: cap.endorsementTag, trustedTag: cap.trustedTag }, code)).some(state => state.revoked);
    }
  }
  private needsRevocationPreparation(error: unknown): boolean {
    if (!isError(error, "CALL_EXCEPTION") || typeof error.data !== "string") return false;
    try {
      const source = new Contract(this.deployment.registryAddress, ELIGIBILITY_SOURCE_ABI, this.runner);
      const decoded = source.interface.parseError(error.data);
      return decoded?.name === "RevocationStateNotPrepared" && BigInt(decoded.args[0]) <= 2n
        && BigInt(decoded.args[1]) >= 0n && BigInt(decoded.args[2]) < 1n << 64n
        && BigInt(decoded.args[2]) > BigInt(decoded.args[1]) + BigInt(REVOCATION_SCAN_TAIL_SIZE)
        && source.interface.encodeErrorResult(decoded.fragment, decoded.args).toLowerCase() === error.data.toLowerCase();
    } catch { return false; }
  }
  /** Authenticate public revocation logs without requiring a holder secret or a transaction. */
  async readQualificationRevocations(status: ClaimRoleStatus, code?: ReceiveCode, options: { maxEntries?: number } = {}) {
    const provider = this.provider(), anchor = await readReceiveTreeAnchor(provider);
    await this.assertDeployment(anchor.blockNumber);
    if (!await this.registry.isKnownIssuanceRoot(status.issuanceRoot, { blockTag: anchor.blockNumber }))
      throw new Error("Qualification root is not registered");
    if (code) {
      this.assertCode(code);
      if (!await this.registry.verifyReceive(receivingCodeStruct(code), encodeProtocolProof(code.proof), { blockTag: anchor.blockNumber }))
        throw new Error("Receive authorization is no longer valid");
    }
    const { source } = await this.sourceAt(anchor);
    const tags = [status.childTag, status.endorsementTag, status.trustedTag];
    const states = await Promise.all(tags.map((tag, role) => readRoleRevocationState({ source,
      chainId: this.deployment.chainId, anchor, role: role as 0 | 1 | 2,
      nonce: getBigInt(status.nonce), tag: getBigInt(tag), ...options })));
    await assertReceiveTreeAnchor(provider, anchor);
    return states;
  }
  async sendRevocationScans(scans: readonly RevocationScanSubmission[], status: ClaimRoleStatus): Promise<void> {
    if (!scans.length) return;
    const provider = this.provider(), anchor = await readReceiveTreeAnchor(provider);
    await this.assertDeployment(anchor.blockNumber);
    const { sourceAddress, source } = await this.sourceAt(anchor);
    const tags = [status.childTag, status.endorsementTag, status.trustedTag].map(value => getBigInt(value));
    // Validate the entire public plan before sending the first preparation transaction.
    for (const scan of scans) {
      if (![0, 1, 2].includes(scan.role) || getAddress(scan.sourceAddress) !== sourceAddress
        || scan.nonce !== getBigInt(status.nonce) || scan.tag !== tags[scan.role]
        || scan.start < 0n || scan.end <= scan.start || scan.end >= 1n << 64n
        || scan.end - scan.start > BigInt(REVOCATION_SCAN_BATCH_SIZE))
        throw new Error("Revocation preparation does not match this budget qualification");
      const expected = [this.deployment.chainId, BigInt(sourceAddress), BigInt(scan.role), scan.nonce,
        scan.tag, scan.start, scan.end, scan.startHash, scan.endHash];
      if (expected.some(value => value < 0n || value >= SNARK_SCALAR_FIELD)
        || scan.publicSignals.length !== expected.length || scan.publicSignals.some((value, index) => getBigInt(value) !== expected[index]))
        throw new Error("Revocation proof returned a different statement");
      encodeProtocolProof(scan.proof);
    }
    const roleProgress = new Map<number, { checked: bigint; count: bigint }>();
    const overrides = { blockTag: anchor.blockNumber };
    for (const scan of scans) {
      if (!roleProgress.has(scan.role)) {
        const [checked, count] = await Promise.all([
          source.roleScanProgress(scan.role, scan.nonce, scan.tag, overrides),
          source.revokedRoleCount(scan.role, overrides),
        ]);
        roleProgress.set(scan.role, { checked: getBigInt(checked), count: getBigInt(count) });
      }
      const progress = roleProgress.get(scan.role)!;
      const [startHash, endHash] = await Promise.all([
        source.revocationCheckpoint(scan.role, scan.start, overrides),
        source.revocationCheckpoint(scan.role, scan.end, overrides),
      ]);
      if (progress.checked < 0n || progress.checked > progress.count || scan.end > progress.count
        || getBigInt(startHash) !== scan.startHash || getBigInt(endHash) !== scan.endHash)
        throw new Error("Revocation preparation checkpoint does not match its source");
      if (scan.end > progress.checked) {
        if (scan.start !== progress.checked) throw new Error("Qualification preparation changed; refresh before retrying");
        progress.checked = scan.end;
      }
    }
    await assertReceiveTreeAnchor(provider, anchor);
    this.options.onRevocationPreparation?.(0, scans.length);
    let completed = 0;
    for (const scan of scans) {
      this.options.beforeTransaction?.();
      await this.assertDeployment();
      const checked = getBigInt(await source.roleScanProgress(scan.role, scan.nonce, scan.tag));
      if (checked < scan.end) {
        if (checked !== scan.start) throw new Error("Qualification preparation changed; refresh before retrying");
        this.options.beforeTransaction?.();
        const transaction = await source.prepareRoleScan(scan.role, scan.nonce, scan.tag, scan.start, scan.end, encodeProtocolProof(scan.proof));
        const receipt = await transaction.wait();
        if (!receipt || receipt.status !== 1) throw new Error("Qualification preparation transaction failed");
      }
      this.options.onRevocationPreparation?.(++completed, scans.length);
    }
  }
  private async synchronizeQualification(status: ClaimRoleStatus, initial: readonly RevocationScanSubmission[]) {
    let scans = initial;
    for (;;) {
      this.options.beforeTransaction?.();
      await this.sendRevocationScans(scans, status);
      if (!this.options.prepareRevocationScans) return;
      this.options.beforeTransaction?.();
      const next = await this.options.prepareRevocationScans(status);
      this.options.beforeTransaction?.();
      if (!next.length) return;
      if (next.every(candidate => scans.some(previous => previous.role === candidate.role
        && previous.nonce === candidate.nonce && previous.tag === candidate.tag && previous.end >= candidate.end)))
        throw new Error("Qualification preparation made no progress; refresh before retrying");
      scans = next;
    }
  }
  async checkClaimQualification(status: ClaimRoleStatus): Promise<boolean> {
    await this.assertDeployment();
    try {
      return Boolean(await this.registry.validateBudgetRoleStatus(status.issuanceRoot, status.nonce,
        status.childTag, status.endorsementTag, status.trustedTag));
    } catch (error) {
      if (this.needsRevocationPreparation(error))
        return !(await this.readQualificationRevocations(status)).some(state => state.revoked);
      if (isError(error, "CALL_EXCEPTION") && typeof error.data === "string") {
        try {
          const decoded = this.registry.interface.parseError(error.data);
          if (decoded && this.registry.interface.encodeErrorResult(decoded.fragment, decoded.args).toLowerCase() === error.data.toLowerCase()
            && (decoded.name === "UnknownIssuanceRoot" || (decoded.name === "QualificationRevoked" && BigInt(decoded.args[0]) <= 2n))) return false;
        } catch { /* Preserve malformed or unrelated RPC failures below. */ }
      }
      throw error;
    }
  }
  async sendShield(prepared: BoundarySubmission): Promise<ContractTransactionResponse> {
    await this.assertDeployment(); assertCiphertexts(prepared);
    const amount = getBigInt(prepared.amount), kind = BigInt(await this.pool.assetKind());
    if (amount <= 0n || prepared.inputRoots.length || prepared.inputNullifiers.length || prepared.inputShardIds.length) throw new Error("Invalid private deposit boundary");
    if (kind === 0n) {
      const signer = this.runner as Signer;
      if (!signer.getAddress) throw new Error("Connect a transaction wallet first");
      const token = new Contract(await this.pool.TOKEN(), ["function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)"], signer);
      if (BigInt(await token.allowance(await signer.getAddress(), this.deployment.poolAddress)) < amount) await (await token.approve(this.deployment.poolAddress, amount)).wait();
    }
    return this.pool.shield(amount, { inputShardIds: [], inputRoots: [], inputNullifiers: [], outputCommitments: prepared.outputCommitments,
      outputCiphertexts: prepared.outputCiphertexts.map(hexlify) }, encodeProtocolProof(prepared.proof), kind === 1n ? { value: amount } : {});
  }
  async sendUnshield(prepared: BoundarySubmission): Promise<ContractTransactionResponse> {
    await this.assertDeployment(); assertCiphertexts(prepared);
    if (!prepared.recipient) throw new Error("Missing withdrawal recipient");
    return this.pool.unshield(prepared.recipient, prepared.amount, { inputShardIds: prepared.inputShardIds,
      inputRoots: prepared.inputRoots, inputNullifiers: prepared.inputNullifiers, outputCommitments: prepared.outputCommitments,
      outputCiphertexts: prepared.outputCiphertexts.map(hexlify) }, encodeProtocolProof(prepared.proof));
  }
  async sendDeposit(prepared: DepositSubmission, inputShardId: BigNumberish): Promise<ContractTransactionResponse> {
    await this.assertDeployment(); this.assertCode(prepared.code); assertCiphertexts(prepared);
    const cap = prepared.code.capabilities[prepared.capabilityIndex];
    if (!cap) throw new Error("Missing prepared budget capability");
    await this.synchronizeQualification({ issuanceRoot: cap.issuanceRoot, nonce: prepared.code.nonce,
      childTag: cap.childTag, endorsementTag: cap.endorsementTag, trustedTag: cap.trustedTag }, prepared.revocationScans ?? []);
    this.options.beforeTransaction?.();
    return this.pool.depositBudget(receivingCodeStruct(prepared.code), receivingCapabilityStruct(cap),
      encodeProtocolProof(prepared.code.proof), encodeProtocolProof(cap.proof),
      { policyCommitment: prepared.policyCommitment, budgetKey: prepared.budgetKey, eligibleFrom: prepared.eligibleFrom },
      buildActionData({ inputShardId, inputRoot: prepared.publicInput.inputRoot, inputNullifier: prepared.publicInput.inputNullifier,
        outputCommitments: prepared.outputCommitments, outputCiphertexts: prepared.outputCiphertexts }), encodeProtocolProof(prepared.proof));
  }
  async sendClaim(prepared: ClaimSubmission, inputShardId: BigNumberish): Promise<ContractTransactionResponse> {
    await this.assertDeployment(); assertCiphertexts(prepared);
    const record = prepared.revocationScans?.length ? await this.readBudgetRecord(getBigInt(prepared.publicInput.budgetKey)) : undefined;
    if (record && !record.exists) throw new Error("Prepared budget does not exist");
    await this.synchronizeQualification({ issuanceRoot: getBigInt(prepared.publicInput.issuanceRoot),
      nonce: record?.nonce ?? getBigInt(prepared.publicInput.nonce), childTag: getBigInt(prepared.publicInput.childTag),
      endorsementTag: getBigInt(prepared.publicInput.endorsementTag), trustedTag: getBigInt(prepared.publicInput.trustedTag) }, prepared.revocationScans ?? []);
    this.options.beforeTransaction?.();
    return this.pool.claimBudget({ budgetKey: prepared.publicInput.budgetKey, asOf: prepared.publicInput.asOf, periodNullifier: prepared.periodNullifier,
      issuanceRoot: prepared.publicInput.issuanceRoot, childTag: prepared.publicInput.childTag,
      endorsementTag: prepared.publicInput.endorsementTag, trustedTag: prepared.publicInput.trustedTag },
      buildActionData({ inputShardId, inputRoot: prepared.publicInput.inputRoot, inputNullifier: prepared.publicInput.inputNullifier,
        outputCommitments: prepared.outputCommitments, outputCiphertexts: prepared.outputCiphertexts }), encodeProtocolProof(prepared.proof));
  }
  async sendTransfer(prepared: TransferSubmission, inputShardId: BigNumberish): Promise<ContractTransactionResponse> {
    await this.assertDeployment(); this.assertCode(prepared.code); assertCiphertexts(prepared);
    return this.pool.transfer(receivingCodeStruct(prepared.code), encodeProtocolProof(prepared.code.proof),
      buildActionData({ inputShardId, inputRoot: prepared.publicInput.inputRoot, inputNullifier: prepared.publicInput.inputNullifier,
        outputCommitments: prepared.outputCommitments, outputCiphertexts: prepared.outputCiphertexts }), encodeProtocolProof(prepared.proof));
  }
  async sendLetter(input: { code: ReceiveCode; messageId: BigNumberish; ciphertext: Uint8Array }): Promise<ContractTransactionResponse> {
    await this.assertDeployment(); this.assertCode(input.code);
    if (!this.letters || !this.deployment.lettersAddress) throw new Error("Receive letters are not configured");
    const registry = await this.letters.RECEIVE_REGISTRY();
    if (getAddress(registry) !== this.deployment.registryAddress) throw new Error("Receive letter registry mismatch");
    const id = getBigInt(input.messageId);
    if (id <= 0n || id >= 1n << 128n) throw new Error("Invalid receiving letter message number");
    return this.letters.registerLetter(id, receivingCodeStruct(input.code), encodeProtocolProof(input.code.proof), hexlify(input.ciphertext));
  }
}
