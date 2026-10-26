import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  SNARK_SCALAR_FIELD,
  wrapIdentityCommitmentAsPersonHash,
  type ProtocolInteger,
  type ProtocolProof,
} from "@deepfamily/protocol-core";
import {
  Contract,
  Interface,
  getAddress,
  getBigInt,
  keccak256,
  toBeHex,
  toUtf8Bytes,
  type ContractRunner,
  type ContractTransactionResponse,
  type Provider,
} from "ethers";
import { poseidon2 } from "poseidon-lite";
import {
  assertReceiveTreeAnchor,
  readReceiveTreeAnchor,
  validateReceiveTreePath,
  type ReceiveTreeAnchor,
  type ReceiveTreePath,
} from "./receiveTree";
import type { PublicStateReadMode } from "../config/env";

export const QUALIFICATION_SOURCE_ABI = [
  "function LINEAGE_INDEX() view returns(address)",
  "function DEEP_FAMILY() view returns(address)",
  "function sourceRoot() view returns(uint256)",
  "function trustedRoot() view returns(uint256)",
  "function sourceSize(uint8 treeId) view returns(uint256)",
  "function getSourceLeafPage(uint8 treeId,uint256 start,uint256 limit) view returns(uint256[])",
  "function getSourceProof(uint8 treeId,uint256 leafIndex) view returns(uint256 leaf,uint256 root,uint256 index,uint256 depth,uint256[] siblings)",
  "function roleRecord(uint8 role,uint256 commitment) view returns(address controller,bytes32 parentHash,uint64 parentVersion,bool registered,bool revoked)",
  "function isRoleRevoked(uint8 role,uint256 roleIndex) view returns(bool)",
  "function publishFact(uint256 childIdentity,uint256 parentIdentity,address endorser,uint256 parentVersion,uint256 factLeaf,uint256 childRoleCommitment,uint256 endorsementRoleCommitment,bytes proof) returns(uint256 leafIndex,uint256 root)",
  "function publishTrust(uint256 parentIdentity,address endorser,uint256 parentVersion,uint256 trustLeaf,uint256 trustRoleCommitment,bytes proof) returns(uint256 leafIndex,uint256 root)",
  "event SourceLeafPublished(uint8 indexed treeId,uint256 indexed leafIndex,uint256 leaf,uint256 root)",
] as const;
export const QUALIFICATION_LINEAGE_ABI = [
  "function DEEP_FAMILY() view returns(address)",
  "function indexKind() view returns(bytes32)",
  "function apiVersion() view returns(uint256)",
  "function root(uint8 treeId) view returns(uint256)",
  "function size(uint8 treeId) view returns(uint256)",
  "function getLeafPage(uint8 treeId,uint256 start,uint256 limit) view returns(uint256[])",
  "function identityCommitmentOf(bytes32 personHash) view returns(uint256)",
  "function versionParents(bytes32 personHash,uint256 versionIndex) view returns(uint256 fatherIdentityCommitment,uint256 motherIdentityCommitment)",
  "function endorsementLeafIndex(bytes32 personHash,address endorser) view returns(bool exists,uint256 leafIndex)",
  "function getEndorsementMetadata(bytes32 personHash,address endorser) view returns(uint256 versionIndex,uint64 writtenAt)",
  "function trustedLeafIndex(bytes32 personHash,uint256 versionIndex,address account) view returns(bool exists,uint256 leafIndex)",
  "function getMerkleProof(uint8 treeId,uint256 leafIndex) view returns(uint256 leaf,uint256 proofRoot,uint256 proofIndex,uint256 proofDepth,uint256[] siblings)",
] as const;
export const QUALIFICATION_FAMILY_ABI = [
  "function eligibilitySource() view returns(address)",
  "function lineageIndex() view returns(address)",
  "function isTrustedEndorserManager(bytes32 personHash,uint256 versionIndex,address account) view returns(bool)",
  "function endorsedVersionIndex(bytes32 personHash,address account) view returns(uint256)",
  "function revokeEligibilityRoles(uint8[] roles,uint256[] secrets)",
  "function withEligibilityRevocations(uint8[] roles,uint256[] secrets,bytes mutation)",
  "function cancelEndorsement(bytes32 personHash)",
  "function removeTrustedEndorser(bytes32 personHash,uint256 versionIndex,address account)",
] as const;

export interface QualificationBindings extends ReceiveTreeAnchor {
  sourceAddress: string;
  lineageAddress: string;
  deepFamilyAddress: string;
}
export interface SourceFactRequest {
  childIdentity: ProtocolInteger;
  parentIdentity: ProtocolInteger;
  endorser: string;
  parentVersion: ProtocolInteger;
}
export interface SourceTrustRequest {
  parentIdentity: ProtocolInteger;
  endorser: string;
  parentVersion: ProtocolInteger;
}
export interface SourceFactContext extends QualificationBindings {
  chainId: bigint;
  childIdentity: bigint;
  parentIdentity: bigint;
  endorser: string;
  parentVersion: bigint;
  childVersion: bigint;
  fatherIdentity: bigint;
  motherIdentity: bigint;
  rootIsMother: bigint;
  writtenAt: bigint;
  endorsementRoot: bigint;
  endorsementDepth: bigint;
  endorsementIndex: bigint;
  endorsementSiblings: bigint[];
}
export interface SourceTrustContext extends QualificationBindings {
  chainId: bigint;
  parentIdentity: bigint;
  endorser: string;
  parentVersion: bigint;
  trustedRoot: bigint;
  trustedDepth: bigint;
  trustedIndex: bigint;
  trustedSiblings: bigint[];
}
export type QualificationProof = {
  proof: ProtocolProof;
  publicSignals: readonly ProtocolInteger[];
};
export type QualificationRole = 0 | 1 | 2;
export interface QualificationRoleQuery {
  role: QualificationRole;
  roleIndex: ProtocolInteger;
  commitment?: ProtocolInteger;
}
export interface QualificationRoleStatus {
  role: QualificationRole;
  roleIndex: bigint;
  revoked: boolean;
  registered?: boolean;
  controller?: string;
  parentHash?: string;
  parentVersion?: bigint;
}
export type QualificationMutation =
  | { kind: "cancelEndorsement"; childIdentity: ProtocolInteger }
  | {
      kind: "removeTrustedEndorser";
      parentIdentity: ProtocolInteger;
      parentVersion: ProtocolInteger;
      endorser: string;
    };
export interface RoleRevocationSubmission {
  roles: QualificationRole[];
  secrets: ProtocolInteger[];
  mutation?: QualificationMutation;
}
interface Connection {
  registry: Contract;
  runner: ContractRunner;
  chainId: bigint;
  stateReadMode: PublicStateReadMode;
  assertDeployment(blockTag?: number): Promise<void>;
  beforeTransaction?: () => void;
  encodeProof(proof: ProtocolProof): string;
}
type BoundContracts = QualificationBindings & {
  source: Contract;
  lineage: Contract;
  family: Contract;
};
const field = (value: ProtocolInteger, label: string, nonzero = true): bigint => {
  const parsed = getBigInt(value);
  if (parsed < 0n || parsed >= SNARK_SCALAR_FIELD || (nonzero && parsed === 0n))
    throw new Error(`Invalid qualification ${label}`);
  return parsed;
};
const version = (value: ProtocolInteger): bigint => {
  const parsed = getBigInt(value);
  if (parsed <= 0n || parsed >= 1n << 64n) throw new Error("Invalid qualification version");
  return parsed;
};
const roleNumber = (value: number): QualificationRole => {
  if (value !== 0 && value !== 1 && value !== 2) throw new Error("Invalid qualification role");
  return value;
};
const publicBindings = ({
  sourceAddress,
  lineageAddress,
  deepFamilyAddress,
  blockNumber,
  blockHash,
}: QualificationBindings): QualificationBindings => ({
  sourceAddress,
  lineageAddress,
  deepFamilyAddress,
  blockNumber,
  blockHash,
});

/** Canonical lineage authentication and controller transactions for the qualification lifecycle. */
export class QualificationChain {
  constructor(private readonly connection: Connection) {}
  private provider(): Provider {
    const provider = this.connection.runner.provider;
    if (!provider) throw new Error("Qualification operations require a provider");
    return provider;
  }
  private async bindings(anchor: ReceiveTreeAnchor): Promise<BoundContracts> {
    const { registry, runner, chainId } = this.connection;
    await this.connection.assertDeployment(anchor.blockNumber);
    if ((await this.provider().getNetwork()).chainId !== chainId)
      throw new Error("Qualification belongs to another chain");
    const at = { blockTag: anchor.blockNumber };
    const sourceAddress = getAddress(await registry.SOURCE(at));
    if (BigInt(sourceAddress) === 0n) throw new Error("Qualification source is unavailable");
    const source = new Contract(sourceAddress, QUALIFICATION_SOURCE_ABI, runner);
    const [rawLineage, rawFamily] = await Promise.all([
      source.LINEAGE_INDEX(at),
      source.DEEP_FAMILY(at),
    ]);
    const lineageAddress = getAddress(rawLineage),
      deepFamilyAddress = getAddress(rawFamily);
    if (BigInt(lineageAddress) === 0n || BigInt(deepFamilyAddress) === 0n)
      throw new Error("Qualification dependencies are unavailable");
    const lineage = new Contract(lineageAddress, QUALIFICATION_LINEAGE_ABI, runner);
    const family = new Contract(deepFamilyAddress, QUALIFICATION_FAMILY_ABI, runner);
    const [lineageFamily, familySource, familyLineage, kind, api] = await Promise.all([
      lineage.DEEP_FAMILY(at),
      family.eligibilitySource(at),
      family.lineageIndex(at),
      lineage.indexKind(at),
      lineage.apiVersion(at),
    ]);
    if (
      getAddress(lineageFamily) !== deepFamilyAddress ||
      getAddress(familySource) !== sourceAddress ||
      getAddress(familyLineage) !== lineageAddress ||
      kind !== keccak256(toUtf8Bytes("deepfamily.lineage-index.v1")) ||
      getBigInt(api) !== 1n
    )
      throw new Error("Qualification deployment bindings do not match");
    await assertReceiveTreeAnchor(this.provider(), anchor);
    return { ...anchor, sourceAddress, lineageAddress, deepFamilyAddress, source, lineage, family };
  }
  async readBindings(): Promise<QualificationBindings> {
    return publicBindings(await this.bindings(await readReceiveTreeAnchor(this.provider())));
  }
  async readParent(personHash: string) {
    if (!/^0x[\da-f]{64}$/iu.test(personHash)) throw new Error("Invalid parent person hash");
    const contracts = await this.bindings(await readReceiveTreeAnchor(this.provider()));
    const parentIdentity = field(
      await contracts.lineage.identityCommitmentOf(personHash, { blockTag: contracts.blockNumber }),
      "parent identity",
    );
    if (
      wrapIdentityCommitmentAsPersonHash(parentIdentity).toLowerCase() !== personHash.toLowerCase()
    )
      throw new Error("Parent identity does not match its public person hash");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return { ...publicBindings(contracts), parentIdentity };
  }
  async readController(
    input: SourceTrustRequest & { kind: "fact" | "trust"; actor: string },
  ): Promise<boolean> {
    const actor = getAddress(input.actor),
      endorser = getAddress(input.endorser);
    const parentIdentity = field(input.parentIdentity, "parent identity"),
      parentVersion = version(input.parentVersion);
    const contracts = await this.bindings(await readReceiveTreeAnchor(this.provider()));
    let allowed;
    if (input.kind === "fact") allowed = actor === endorser;
    else if (input.kind === "trust")
      allowed = await contracts.family.isTrustedEndorserManager(
        wrapIdentityCommitmentAsPersonHash(parentIdentity),
        parentVersion,
        actor,
        { blockTag: contracts.blockNumber },
      );
    else throw new Error("Invalid qualification controller kind");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return allowed === true;
  }
  /** Public full partitions allow interrupted publication to resume without a private index query. */
  async findLeaf(leaf: ProtocolInteger, treeId?: 0 | 1): Promise<bigint | null> {
    if (treeId !== undefined && treeId !== 0 && treeId !== 1)
      throw new Error("Invalid source tree");
    const wantedLeaf = field(leaf, treeId === undefined ? "credential" : "source leaf");
    const contracts = await this.bindings(await readReceiveTreeAnchor(this.provider()));
    const at = { blockTag: contracts.blockNumber },
      source = treeId !== undefined;
    const [rawSize, rawRoot] = await Promise.all(
      source
        ? [
            contracts.source.sourceSize(treeId, at),
            treeId === 0 ? contracts.source.sourceRoot(at) : contracts.source.trustedRoot(at),
          ]
        : [this.connection.registry.credentialCount(at), this.connection.registry.issuanceRoot(at)],
    );
    const size = getBigInt(rawSize),
      root = field(rawRoot, "tree root", false),
      maxDepth = source ? 64n : 32n;
    if (size < 0n || size > 1n << maxDepth || (size === 0n) !== (root === 0n))
      throw new Error("Invalid qualification tree state");
    const tree = createLineageTree();
    let found: bigint | null = null;
    for (let start = 0n; start < size; start += 256n) {
      const leaves = source
        ? await contracts.source.getSourceLeafPage(treeId, start, 256, at)
        : await this.connection.registry.getCredentialPage(start, 256, at);
      const count = Number(size - start < 256n ? size - start : 256n);
      if (!Array.isArray(leaves) || leaves.length !== count)
        throw new Error("Qualification tree page is incomplete");
      for (const rawLeaf of leaves) {
        const current = field(rawLeaf, "tree leaf");
        if (current === wantedLeaf) {
          if (found !== null) throw new Error("Qualification tree contains a duplicate leaf");
          found = tree.sizeBigInt;
        }
        tree.insert(current);
      }
    }
    if (tree.sizeBigInt !== size || tree.root !== root)
      throw new Error("Qualification tree reconstruction does not match current root");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return found;
  }
  private async lineagePath(
    contracts: BoundContracts,
    treeId: 0 | 1,
    leafIndex: bigint,
  ): Promise<ReceiveTreePath> {
    const { lineage } = contracts,
      at = { blockTag: contracts.blockNumber };
    const [rawSize, rawRoot] = await Promise.all([
      lineage.size(treeId, at),
      lineage.root(treeId, at),
    ]);
    const size = getBigInt(rawSize),
      root = field(rawRoot, "lineage root");
    if (size <= 0n || size > 1n << 64n || leafIndex < 0n || leafIndex >= size)
      throw new Error("Invalid qualification lineage slot");
    let path;
    if (this.connection.stateReadMode === "chain") {
      const result = await lineage.getMerkleProof(treeId, leafIndex, at);
      path = {
        leaf: result.leaf,
        root: result.proofRoot,
        index: result.proofIndex,
        depth: result.proofDepth,
        siblings: [...result.siblings],
      };
    } else {
      const tree = createLineageTree();
      for (let start = 0n; start < size; start += 256n) {
        const wanted = Number(size - start < 256n ? size - start : 256n);
        const leaves = await lineage.getLeafPage(treeId, start, 256, at);
        if (!Array.isArray(leaves) || leaves.length !== wanted)
          throw new Error("Qualification lineage page is incomplete");
        for (const leaf of leaves) tree.insert(field(leaf, "lineage leaf", false));
      }
      if (tree.sizeBigInt !== size || tree.root !== root)
        throw new Error("Qualification lineage reconstruction does not match current root");
      const proof = tree.generateProof(leafIndex);
      path = { ...proof, depth: BigInt(proof.siblings.length) };
    }
    return validateReceiveTreePath(path, root, 64, { leafIndex, size });
  }
  async readFactContext(input: SourceFactRequest): Promise<SourceFactContext> {
    const childIdentity = field(input.childIdentity, "child identity"),
      parentIdentity = field(input.parentIdentity, "parent identity");
    const parentVersion = version(input.parentVersion),
      endorser = getAddress(input.endorser);
    const contracts = await this.bindings(await readReceiveTreeAnchor(this.provider()));
    const { lineage } = contracts,
      at = { blockTag: contracts.blockNumber };
    const childHash = wrapIdentityCommitmentAsPersonHash(childIdentity),
      parentHash = wrapIdentityCommitmentAsPersonHash(parentIdentity);
    const [registeredChild, registeredParent, slot, metadata] = await Promise.all([
      lineage.identityCommitmentOf(childHash, at),
      lineage.identityCommitmentOf(parentHash, at),
      lineage.endorsementLeafIndex(childHash, endorser, at),
      lineage.getEndorsementMetadata(childHash, endorser, at),
    ]);
    if (
      getBigInt(registeredChild) !== childIdentity ||
      getBigInt(registeredParent) !== parentIdentity ||
      slot.exists !== true ||
      getBigInt(metadata.versionIndex) === 0n
    )
      throw new Error("An active registered endorsement is required");
    const childVersion = version(metadata.versionIndex),
      writtenAt = getBigInt(metadata.writtenAt);
    if (writtenAt <= 0n || writtenAt >= 1n << 64n) throw new Error("Invalid endorsement timestamp");
    const parents = await lineage.versionParents(childHash, childVersion, at);
    const fatherIdentity = field(parents.fatherIdentityCommitment, "father identity", false);
    const motherIdentity = field(parents.motherIdentityCommitment, "mother identity", false);
    if (parentIdentity !== fatherIdentity && parentIdentity !== motherIdentity)
      throw new Error("The selected family is not a parent of the endorsed subject");
    const path = await this.lineagePath(contracts, 0, getBigInt(slot.leafIndex));
    const expected = computeLineageEndorsementLeaf({
      identityCommitment: childIdentity,
      parentsDigest: computeLineageParentsDigest({
        fatherIdentityCommitment: fatherIdentity,
        motherIdentityCommitment: motherIdentity,
      }),
      versionIndex: childVersion,
      endorser,
      writtenAt,
    });
    if (path.leaf !== expected)
      throw new Error("Endorsement metadata does not match its authenticated leaf");
    // A real parent version must exist, even when its selected trusted controller is different.
    const parentSlot = await lineage.trustedLeafIndex(parentHash, parentVersion, endorser, at);
    if (parentSlot.exists !== true)
      throw new Error("The selected parent version has no trusted recommendation");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return {
      ...publicBindings(contracts),
      chainId: this.connection.chainId,
      childIdentity,
      parentIdentity,
      endorser,
      parentVersion,
      childVersion,
      fatherIdentity,
      motherIdentity,
      rootIsMother: parentIdentity === fatherIdentity ? 0n : 1n,
      writtenAt,
      endorsementRoot: path.root,
      endorsementDepth: path.depth,
      endorsementIndex: path.index,
      endorsementSiblings: [...path.siblings, ...Array(64 - path.siblings.length).fill(0n)],
    };
  }
  async readTrustContext(input: SourceTrustRequest): Promise<SourceTrustContext> {
    const parentIdentity = field(input.parentIdentity, "parent identity"),
      parentVersion = version(input.parentVersion);
    const endorser = getAddress(input.endorser),
      contracts = await this.bindings(await readReceiveTreeAnchor(this.provider()));
    const { lineage } = contracts,
      at = { blockTag: contracts.blockNumber };
    const parentHash = wrapIdentityCommitmentAsPersonHash(parentIdentity);
    const [identity, slot] = await Promise.all([
      lineage.identityCommitmentOf(parentHash, at),
      lineage.trustedLeafIndex(parentHash, parentVersion, endorser, at),
    ]);
    if (getBigInt(identity) !== parentIdentity || slot.exists !== true)
      throw new Error("An active registered trusted recommendation is required");
    const path = await this.lineagePath(contracts, 1, getBigInt(slot.leafIndex));
    if (
      path.leaf !==
      computeLineageTrustedLeaf({
        rootIdentityCommitment: parentIdentity,
        rootVersionIndex: parentVersion,
        account: endorser,
      })
    )
      throw new Error("The trusted recommendation is no longer current");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return {
      ...publicBindings(contracts),
      chainId: this.connection.chainId,
      parentIdentity,
      parentVersion,
      endorser,
      trustedRoot: path.root,
      trustedDepth: path.depth,
      trustedIndex: path.index,
      trustedSiblings: [...path.siblings, ...Array(64 - path.siblings.length).fill(0n)],
    };
  }
  private async signerAddress(): Promise<string> {
    const runner = this.connection.runner as ContractRunner & {
      getAddress?: () => Promise<string>;
    };
    if (typeof runner.getAddress !== "function")
      throw new Error("Connect a transaction wallet first");
    return getAddress(await runner.getAddress());
  }
  private async guardSigner(expected: string): Promise<void> {
    if (
      (await this.signerAddress()) !== expected ||
      (await this.provider().getNetwork()).chainId !== this.connection.chainId
    )
      throw new Error("Qualification transaction wallet changed");
    this.connection.beforeTransaction?.();
  }
  async sendFact(input: QualificationProof): Promise<ContractTransactionResponse> {
    const signer = await this.signerAddress(),
      values = input.publicSignals.map((value) => field(value, "public signal", false));
    if (values.length !== 10) throw new Error("Invalid source fact signal count");
    const context = await this.readFactContext({
      childIdentity: values[5],
      parentIdentity: values[6],
      endorser: getAddress(toBeHex(values[7], 20)),
      parentVersion: values[8],
    });
    if (
      values[3] !== this.connection.chainId ||
      values[4] !== BigInt(context.sourceAddress) ||
      values[9] !== context.endorsementRoot
    )
      throw new Error("Source fact proof does not use the current lineage root and scope");
    if (signer !== context.endorser)
      throw new Error("Only the endorsement controller may publish this source fact");
    const source = new Contract(
      context.sourceAddress,
      QUALIFICATION_SOURCE_ABI,
      this.connection.runner,
    );
    await this.guardSigner(signer);
    return source.publishFact(
      values[5],
      values[6],
      context.endorser,
      values[8],
      values[0],
      values[1],
      values[2],
      this.connection.encodeProof(input.proof),
    );
  }
  async sendTrust(input: QualificationProof): Promise<ContractTransactionResponse> {
    const signer = await this.signerAddress(),
      values = input.publicSignals.map((value) => field(value, "public signal", false));
    if (values.length !== 8) throw new Error("Invalid source trust signal count");
    const context = await this.readTrustContext({
      parentIdentity: values[4],
      endorser: getAddress(toBeHex(values[5], 20)),
      parentVersion: values[6],
    });
    if (
      values[2] !== this.connection.chainId ||
      values[3] !== BigInt(context.sourceAddress) ||
      values[7] !== context.trustedRoot
    )
      throw new Error("Source trust proof does not use the current lineage root and scope");
    const family = new Contract(
      context.deepFamilyAddress,
      QUALIFICATION_FAMILY_ABI,
      this.connection.runner,
    );
    if (
      !(await family.isTrustedEndorserManager(
        wrapIdentityCommitmentAsPersonHash(context.parentIdentity),
        context.parentVersion,
        signer,
      ))
    )
      throw new Error("Only the current parent manager may publish this source trust");
    const source = new Contract(
      context.sourceAddress,
      QUALIFICATION_SOURCE_ABI,
      this.connection.runner,
    );
    await this.guardSigner(signer);
    return source.publishTrust(
      values[4],
      context.endorser,
      values[6],
      values[0],
      values[1],
      this.connection.encodeProof(input.proof),
    );
  }
  async readRoleStatuses(input: { roles: QualificationRoleQuery[] }) {
    if (!Array.isArray(input.roles) || input.roles.length > 192)
      throw new Error("Invalid qualification role selection");
    const contracts = await this.bindings(await readReceiveTreeAnchor(this.provider()));
    const at = { blockTag: contracts.blockNumber };
    const roles = await Promise.all(
      input.roles.map(async (query) => {
        const role = roleNumber(query.role),
          roleIndex = field(query.roleIndex, "role index");
        const revoked = await contracts.source.isRoleRevoked(role, roleIndex, at);
        if (typeof revoked !== "boolean") throw new Error("Invalid qualification role status");
        const result: QualificationRoleStatus = { role, roleIndex, revoked };
        if (query.commitment !== undefined) {
          const record = await contracts.source.roleRecord(
            role,
            field(query.commitment, "role commitment"),
            at,
          );
          if (typeof record.registered !== "boolean" || typeof record.revoked !== "boolean")
            throw new Error("Invalid qualification role record");
          Object.assign(result, {
            registered: record.registered,
            controller: getAddress(record.controller),
            parentHash: record.parentHash,
            parentVersion: getBigInt(record.parentVersion),
          });
          if (record.registered && record.revoked !== revoked)
            throw new Error("Qualification role record and status disagree");
        }
        return result;
      }),
    );
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return { ...publicBindings(contracts), roles };
  }
  async sendRevocation(input: RoleRevocationSubmission): Promise<ContractTransactionResponse> {
    if (
      !Array.isArray(input.roles) ||
      !input.roles.length ||
      input.roles.length !== input.secrets.length ||
      input.roles.length > 192
    )
      throw new Error("Choose qualification roles to revoke");
    const signer = await this.signerAddress(),
      roles = input.roles.map(roleNumber),
      secrets = input.secrets.map((value) => field(value, "role secret"));
    const seen = new Set<string>();
    const queries = roles.map((role, index) => {
      const secret = secrets[index],
        key = `${role}:${secret}`;
      if (seen.has(key)) throw new Error("Duplicate qualification role revocation");
      seen.add(key);
      return {
        role,
        roleIndex: poseidon2([74321n + BigInt(role), secret]),
        commitment: poseidon2([74201n + BigInt(role), secret]),
      };
    });
    const status = await this.readRoleStatuses({ roles: queries });
    const family = new Contract(
      status.deepFamilyAddress,
      QUALIFICATION_FAMILY_ABI,
      this.connection.runner,
    );
    for (const record of status.roles) {
      if (!record.registered || record.revoked)
        throw new Error("Qualification role is missing or already revoked");
      if (record.role === 2) {
        if (
          !(await family.isTrustedEndorserManager(record.parentHash, record.parentVersion, signer))
        )
          throw new Error("Only the current parent manager may revoke this qualification role");
      } else if (record.controller !== signer)
        throw new Error("Only the endorsement controller may revoke this qualification role");
    }
    let mutation: string | undefined;
    if (input.mutation?.kind === "cancelEndorsement") {
      if (roles.some((role) => role === 2))
        throw new Error("Endorsement withdrawal can revoke only child and endorsement roles");
      const personHash = wrapIdentityCommitmentAsPersonHash(
        field(input.mutation.childIdentity, "child identity"),
      );
      if (getBigInt(await family.endorsedVersionIndex(personHash, signer)) === 0n)
        throw new Error("The connected wallet has no active endorsement to withdraw");
      mutation = new Interface(QUALIFICATION_FAMILY_ABI).encodeFunctionData("cancelEndorsement", [
        personHash,
      ]);
    } else if (input.mutation?.kind === "removeTrustedEndorser") {
      if (roles.some((role) => role !== 2))
        throw new Error("Trusted withdrawal can revoke only trusted roles");
      const personHash = wrapIdentityCommitmentAsPersonHash(
        field(input.mutation.parentIdentity, "parent identity"),
      );
      const selectedVersion = version(input.mutation.parentVersion),
        endorser = getAddress(input.mutation.endorser);
      if (
        status.roles.some(
          (record) =>
            record.parentHash?.toLowerCase() !== personHash.toLowerCase() ||
            record.parentVersion !== selectedVersion,
        )
      )
        throw new Error("Trusted revocations belong to another parent version");
      if (!(await family.isTrustedEndorserManager(personHash, selectedVersion, signer)))
        throw new Error("The connected wallet cannot withdraw this trusted recommendation");
      mutation = new Interface(QUALIFICATION_FAMILY_ABI).encodeFunctionData(
        "removeTrustedEndorser",
        [personHash, selectedVersion, endorser],
      );
    } else if (input.mutation !== undefined)
      throw new Error("Unsupported qualification relationship change");
    await this.guardSigner(signer);
    return mutation === undefined
      ? family.revokeEligibilityRoles(roles, secrets)
      : family.withEligibilityRevocations(roles, secrets, mutation);
  }
  private async receipt(transactionHash: string) {
    if (!/^0x[\da-f]{64}$/iu.test(transactionHash))
      throw new Error("Invalid qualification transaction hash");
    const receipt = await this.provider().getTransactionReceipt(transactionHash);
    if (
      !receipt ||
      receipt.status !== 1 ||
      receipt.hash.toLowerCase() !== transactionHash.toLowerCase()
    )
      throw new Error("Qualification transaction is not successfully confirmed");
    const anchor = { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash };
    await assertReceiveTreeAnchor(this.provider(), anchor);
    const contracts = await this.bindings(anchor);
    return { receipt, contracts };
  }
  async confirmSourcePublication(
    transactionHash: string,
    expected: { treeId: 0 | 1; leaf: ProtocolInteger },
  ) {
    if (expected.treeId !== 0 && expected.treeId !== 1) throw new Error("Invalid source tree");
    const leaf = field(expected.leaf, "source leaf"),
      { receipt, contracts } = await this.receipt(transactionHash);
    if (!receipt.to || getAddress(receipt.to) !== contracts.sourceAddress)
      throw new Error("Source publication transaction targets another contract");
    const events = receipt.logs.flatMap((log) => {
      if (getAddress(log.address) !== contracts.sourceAddress) return [];
      try {
        const event = contracts.source.interface.parseLog(log);
        return event?.name === "SourceLeafPublished" ? [event] : [];
      } catch {
        return [];
      }
    });
    if (
      events.length !== 1 ||
      getBigInt(events[0].args.treeId) !== BigInt(expected.treeId) ||
      getBigInt(events[0].args.leaf) !== leaf
    )
      throw new Error("Source publication receipt does not match this qualification");
    const event = events[0],
      leafIndex = getBigInt(event.args.leafIndex),
      at = { blockTag: contracts.blockNumber };
    const size = getBigInt(await contracts.source.sourceSize(expected.treeId, at));
    const root = getBigInt(
      await (expected.treeId === 0
        ? contracts.source.sourceRoot(at)
        : contracts.source.trustedRoot(at)),
    );
    const path = validateReceiveTreePath(
      await contracts.source.getSourceProof(expected.treeId, leafIndex, at),
      root,
      64,
      { leafIndex, size },
    );
    if (path.leaf !== leaf) throw new Error("Published source leaf is absent from canonical state");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return {
      ...publicBindings(contracts),
      transactionHash: receipt.hash,
      treeId: expected.treeId,
      leafIndex,
      leaf,
      root: field(event.args.root, "source publication root"),
      confirmationRoot: path.root,
    };
  }
  async confirmCredentialRegistration(
    transactionHash: string,
    expected: { credential: ProtocolInteger },
  ) {
    const credential = field(expected.credential, "credential"),
      { receipt, contracts } = await this.receipt(transactionHash);
    const registryAddress = getAddress(await this.connection.registry.getAddress());
    if (!receipt.to || getAddress(receipt.to) !== registryAddress)
      throw new Error("Qualification registration transaction targets another contract");
    const events = receipt.logs.flatMap((log) => {
      if (getAddress(log.address) !== registryAddress) return [];
      try {
        const event = this.connection.registry.interface.parseLog(log);
        return event?.name === "CredentialIssued" ? [event] : [];
      } catch {
        return [];
      }
    });
    if (events.length !== 1 || getBigInt(events[0].args.credential) !== credential)
      throw new Error("Qualification registration receipt does not match this credential");
    const event = events[0],
      credentialIndex = getBigInt(event.args.leafIndex),
      at = { blockTag: contracts.blockNumber };
    const registry = this.connection.registry;
    const [size, root, rawPath, known] = await Promise.all([
      registry.credentialCount(at),
      registry.issuanceRoot(at),
      registry.getCredentialProof(credentialIndex, at),
      registry.isKnownIssuanceRoot(event.args.root, at),
    ]);
    const path = validateReceiveTreePath(rawPath, getBigInt(root), 32, {
      leafIndex: credentialIndex,
      size: getBigInt(size),
    });
    if (path.leaf !== credential || known !== true)
      throw new Error("Credential registration is absent from canonical state");
    await assertReceiveTreeAnchor(this.provider(), contracts);
    return {
      ...publicBindings(contracts),
      transactionHash: receipt.hash,
      credentialIndex,
      credentialCommitment: credential,
      root: field(event.args.root, "credential issuance root"),
      confirmationRoot: path.root,
    };
  }
  readSigner() {
    return this.signerAddress();
  }
  async assertIssuanceSigner(expected: string) {
    await this.guardSigner(expected);
  }
}
