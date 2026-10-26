import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Interface,
  keccak256,
  toBeHex,
  toUtf8Bytes,
  type Contract,
  type ContractRunner,
  type TransactionReceipt,
} from "ethers";
import {
  computeLineageEndorsementLeaf,
  computeLineageParentsDigest,
  computeLineageTrustedLeaf,
  createLineageTree,
  wrapIdentityCommitmentAsPersonHash,
} from "@deepfamily/protocol-core";
import { poseidon2 } from "poseidon-lite";
import {
  QualificationChain,
  QUALIFICATION_SOURCE_ABI,
  QUALIFICATION_FAMILY_ABI,
  QUALIFICATION_LINEAGE_ABI,
} from "./qualificationChain";
import { RECEIVE_REGISTRY_ABI } from "./receiveChain";
import SourceArtifact from "../../abi/EligibilitySource.json";
import FamilyArtifact from "../../abi/DeepFamily.json";
import LineageArtifact from "../../abi/DeepFamilyLineageIndex.json";

const contracts = vi.hoisted(() => new Map<string, unknown>());
vi.mock("ethers", async (original) => ({
  ...(await original<typeof import("ethers")>()),
  Contract: class {
    constructor(address: string) {
      const contract = contracts.get(address.toLowerCase());
      if (!contract) throw new Error(`Unexpected contract ${address}`);
      return contract;
    }
  },
}));
const address = (number: bigint) => toBeHex(number, 20);
const sourceAddress = address(101n),
  lineageAddress = address(102n),
  familyAddress = address(103n),
  registryAddress = address(104n);
const actor = address(201n),
  other = address(202n);
const childIdentity = 303n,
  parentIdentity = 301n,
  motherIdentity = 302n,
  parentVersion = 1n;
const hash = toBeHex(999n, 32),
  transactionHash = toBeHex(1000n, 32);
const childHash = wrapIdentityCommitmentAsPersonHash(childIdentity),
  parentHash = wrapIdentityCommitmentAsPersonHash(parentIdentity);
const proof = {
  pi_a: [1n, 2n, 1n],
  pi_b: [
    [3n, 4n],
    [5n, 6n],
    [1n, 0n],
  ],
  pi_c: [7n, 8n, 1n],
};

function fixture(mode: "chain" | "rebuild" = "chain") {
  const endorsement = computeLineageEndorsementLeaf({
    identityCommitment: childIdentity,
    parentsDigest: computeLineageParentsDigest({
      fatherIdentityCommitment: parentIdentity,
      motherIdentityCommitment: motherIdentity,
    }),
    versionIndex: 2n,
    endorser: actor,
    writtenAt: 1800000000n,
  });
  const trusted = computeLineageTrustedLeaf({
    rootIdentityCommitment: parentIdentity,
    rootVersionIndex: parentVersion,
    account: actor,
  });
  const trees = [createLineageTree([17n, endorsement, 23n]), createLineageTree([trusted, 29n])];
  const sourceTrees = [createLineageTree([41n, 43n]), createLineageTree([47n])];
  const credentials = createLineageTree([53n, 59n]);
  const path = (tree: ReturnType<typeof createLineageTree>, index: bigint) => {
    const p = tree.generateProof(index);
    return { ...p, depth: BigInt(p.siblings.length) };
  };
  let signer = actor,
    canonicalHash = hash,
    manager = true;
  const provider = {
    getNetwork: vi.fn(async () => ({ chainId: 31337n })),
    getBlockNumber: vi.fn(async () => 10),
    getBlock: vi.fn(async () => ({ number: 10, hash: canonicalHash })),
    getTransactionReceipt: vi.fn(),
  };
  const runner = { provider, getAddress: vi.fn(async () => signer) } as unknown as ContractRunner;
  const source = {
    LINEAGE_INDEX: vi.fn(async () => lineageAddress),
    DEEP_FAMILY: vi.fn(async () => familyAddress),
    sourceRoot: vi.fn(async () => sourceTrees[0].root),
    trustedRoot: vi.fn(async () => sourceTrees[1].root),
    sourceSize: vi.fn(async (treeId: 0 | 1) => sourceTrees[treeId].sizeBigInt),
    getSourceLeafPage: vi.fn(async (treeId: 0 | 1, start: bigint) =>
      sourceTrees[treeId].leaves.slice(Number(start), Number(start) + 256),
    ),
    getSourceProof: vi.fn(async (treeId: 0 | 1, index: bigint) => path(sourceTrees[treeId], index)),
    isRoleRevoked: vi.fn(async () => false),
    roleRecord: vi.fn(async (role: number) => ({
      registered: true,
      revoked: false,
      controller: role === 2 ? address(0n) : actor,
      parentHash,
      parentVersion: 1n,
    })),
    publishFact: vi.fn(async () => ({ hash: transactionHash })),
    publishTrust: vi.fn(async () => ({ hash: transactionHash })),
    interface: new Interface(QUALIFICATION_SOURCE_ABI),
  };
  const lineage = {
    DEEP_FAMILY: vi.fn(async () => familyAddress),
    indexKind: vi.fn(async () => keccak256(toUtf8Bytes("deepfamily.lineage-index.v1"))),
    apiVersion: vi.fn(async () => 1n),
    identityCommitmentOf: vi.fn(
      async (person: string): Promise<bigint> =>
        person === childHash ? childIdentity : person === parentHash ? parentIdentity : 0n,
    ),
    endorsementLeafIndex: vi.fn(async () => ({ exists: true, leafIndex: 1n })),
    getEndorsementMetadata: vi.fn(async () => ({ versionIndex: 2n, writtenAt: 1800000000n })),
    versionParents: vi.fn(async () => ({
      fatherIdentityCommitment: parentIdentity,
      motherIdentityCommitment: motherIdentity,
    })),
    trustedLeafIndex: vi.fn(async () => ({ exists: true, leafIndex: 0n })),
    root: vi.fn(async (treeId: 0 | 1) => trees[treeId].root),
    size: vi.fn(async (treeId: 0 | 1) => trees[treeId].sizeBigInt),
    getLeafPage: vi.fn(async (treeId: 0 | 1, start: bigint) =>
      trees[treeId].leaves.slice(Number(start), Number(start) + 256),
    ),
    getMerkleProof: vi.fn(async (treeId: 0 | 1, index: bigint) => {
      const p = path(trees[treeId], index);
      return {
        leaf: p.leaf,
        proofRoot: p.root,
        proofIndex: p.index,
        proofDepth: p.depth,
        siblings: p.siblings,
      };
    }),
  };
  const family = {
    eligibilitySource: vi.fn(async () => sourceAddress),
    lineageIndex: vi.fn(async () => lineageAddress),
    isTrustedEndorserManager: vi.fn(async () => manager),
    endorsedVersionIndex: vi.fn(async () => 2n),
    revokeEligibilityRoles: vi.fn(async () => ({ hash: transactionHash })),
    withEligibilityRevocations: vi.fn(async () => ({ hash: transactionHash })),
  };
  const registry = {
    SOURCE: vi.fn(async () => sourceAddress),
    getAddress: vi.fn(async () => registryAddress),
    credentialCount: vi.fn(async () => credentials.sizeBigInt),
    issuanceRoot: vi.fn(async () => credentials.root),
    getCredentialPage: vi.fn(async (start: bigint) =>
      credentials.leaves.slice(Number(start), Number(start) + 256),
    ),
    getCredentialProof: vi.fn(async (index: bigint) => path(credentials, index)),
    isKnownIssuanceRoot: vi.fn(async () => true),
    interface: new Interface(RECEIVE_REGISTRY_ABI),
  };
  contracts.set(sourceAddress, source);
  contracts.set(lineageAddress, lineage);
  contracts.set(familyAddress, family);
  const beforeTransaction = vi.fn(),
    assertDeployment = vi.fn(async () => {});
  const chain = new QualificationChain({
    registry: registry as unknown as Contract,
    runner,
    chainId: 31337n,
    stateReadMode: mode,
    beforeTransaction,
    assertDeployment,
    encodeProof: () => "0x1234",
  });
  const receipt = (kind: "source" | "credential", values: bigint[]) => {
    const iface = kind === "source" ? source.interface : registry.interface;
    const event = iface.encodeEventLog(
      iface.getEvent(kind === "source" ? "SourceLeafPublished" : "CredentialIssued")!,
      values,
    );
    return {
      hash: transactionHash,
      status: 1,
      blockNumber: 10,
      blockHash: hash,
      to: kind === "source" ? sourceAddress : registryAddress,
      logs: [{ address: kind === "source" ? sourceAddress : registryAddress, ...event }],
    } as unknown as TransactionReceipt;
  };
  return {
    chain,
    source,
    lineage,
    family,
    registry,
    provider,
    beforeTransaction,
    assertDeployment,
    endorsement,
    trusted,
    sourceTrees,
    credentials,
    path,
    receipt,
    changeSigner: (value: string) => {
      signer = value;
    },
    reorg: () => {
      canonicalHash = toBeHex(1001n, 32);
    },
    setManager: (value: boolean) => {
      manager = value;
    },
  };
}
beforeEach(() => {
  contracts.clear();
});

describe("qualification canonical lineage and controller transport", () => {
  it("matches the compiled Source, lineage and family ABIs", () => {
    for (const [declared, artifact] of [
      [QUALIFICATION_SOURCE_ABI, SourceArtifact],
      [QUALIFICATION_LINEAGE_ABI, LineageArtifact],
      [QUALIFICATION_FAMILY_ABI, FamilyArtifact],
    ] as const) {
      const actual = new Interface(declared),
        expected = new Interface(artifact.abi);
      actual.forEachFunction((fragment) =>
        expect(fragment.format("sighash")).toBe(
          expected.getFunction(fragment.name)?.format("sighash"),
        ),
      );
    }
  });
  it.each(["chain", "rebuild"] as const)(
    "authenticates exact metadata and current compact lineage paths with %s reads",
    async (mode) => {
      const f = fixture(mode);
      const fact = await f.chain.readFactContext({
        childIdentity,
        parentIdentity,
        parentVersion,
        endorser: actor,
      });
      expect(fact).toMatchObject({
        childVersion: 2n,
        parentVersion: 1n,
        fatherIdentity: parentIdentity,
        motherIdentity,
        rootIsMother: 0n,
        endorsementDepth: 2n,
        endorsementIndex: 1n,
      });
      expect(fact.endorsementSiblings).toHaveLength(64);
      const trust = await f.chain.readTrustContext({
        parentIdentity,
        parentVersion,
        endorser: actor,
      });
      expect(trust).toMatchObject({ trustedDepth: 1n, trustedIndex: 0n });
      expect(trust.trustedSiblings).toHaveLength(64);
      expect(await f.chain.readParent(parentHash)).toMatchObject({ parentIdentity });
      if (mode === "chain") expect(f.lineage.getLeafPage).not.toHaveBeenCalled();
      else expect(f.lineage.getMerkleProof).not.toHaveBeenCalled();
      for (const call of f.lineage.root.mock.calls as unknown[][])
        expect(call[call.length - 1]).toEqual({ blockTag: 10 });
      f.lineage.getEndorsementMetadata.mockResolvedValue({
        versionIndex: 2n,
        writtenAt: 1800000001n,
      });
      await expect(
        f.chain.readFactContext({ childIdentity, parentIdentity, parentVersion, endorser: actor }),
      ).rejects.toThrow(/authenticated leaf/);
    },
  );
  it("rejects a substituted parent identity, current relationship, or lineage deployment", async () => {
    const f = fixture();
    f.lineage.identityCommitmentOf.mockResolvedValue(1n);
    await expect(f.chain.readParent(parentHash)).rejects.toThrow(/does not match/);
    f.lineage.identityCommitmentOf.mockImplementation(async (p) =>
      p === childHash ? childIdentity : parentIdentity,
    );
    f.lineage.versionParents.mockResolvedValue({
      fatherIdentityCommitment: 333n,
      motherIdentityCommitment: motherIdentity,
    });
    await expect(
      f.chain.readFactContext({ childIdentity, parentIdentity, parentVersion, endorser: actor }),
    ).rejects.toThrow(/not a parent/);
    f.family.eligibilitySource.mockResolvedValue(address(999n));
    await expect(f.chain.readBindings()).rejects.toThrow(/bindings/);
  });
  it("rejects stale source roots and signer/controller changes before a transaction request", async () => {
    const f = fixture();
    const context = await f.chain.readFactContext({
      childIdentity,
      parentIdentity,
      parentVersion,
      endorser: actor,
    });
    const publicSignals = [
      41n,
      43n,
      47n,
      31337n,
      BigInt(sourceAddress),
      childIdentity,
      parentIdentity,
      BigInt(actor),
      1n,
      context.endorsementRoot,
    ];
    await f.chain.sendFact({ proof, publicSignals });
    expect(f.source.publishFact).toHaveBeenCalledOnce();
    expect(f.beforeTransaction).toHaveBeenCalledOnce();
    await expect(
      f.chain.sendFact({ proof, publicSignals: [...publicSignals.slice(0, 9), 1n] }),
    ).rejects.toThrow(/current lineage/);
    f.changeSigner(other);
    await expect(f.chain.sendFact({ proof, publicSignals })).rejects.toThrow(
      /endorsement controller/,
    );
    f.changeSigner(actor);
    const trust = await f.chain.readTrustContext({
      parentIdentity,
      parentVersion,
      endorser: actor,
    });
    f.setManager(false);
    await expect(
      f.chain.sendTrust({
        proof,
        publicSignals: [
          47n,
          53n,
          31337n,
          BigInt(sourceAddress),
          parentIdentity,
          BigInt(actor),
          1n,
          trust.trustedRoot,
        ],
      }),
    ).rejects.toThrow(/parent manager/);
    f.setManager(true);
    f.family.isTrustedEndorserManager.mockImplementation(async () => {
      f.changeSigner(other);
      return true;
    });
    await expect(
      f.chain.sendTrust({
        proof,
        publicSignals: [
          47n,
          53n,
          31337n,
          BigInt(sourceAddress),
          parentIdentity,
          BigInt(actor),
          1n,
          trust.trustedRoot,
        ],
      }),
    ).rejects.toThrow(/wallet changed/);
    expect(f.source.publishTrust).not.toHaveBeenCalled();
  });
  it("cancels source writes after asynchronous reads finish", async () => {
    const f = fixture(),
      trust = await f.chain.readTrustContext({ parentIdentity, parentVersion, endorser: actor });
    f.beforeTransaction.mockImplementation(() => {
      throw new Error("cancelled");
    });
    await expect(
      f.chain.sendTrust({
        proof,
        publicSignals: [
          47n,
          53n,
          31337n,
          BigInt(sourceAddress),
          parentIdentity,
          BigInt(actor),
          1n,
          trust.trustedRoot,
        ],
      }),
    ).rejects.toThrow(/cancelled/);
    expect(f.source.publishTrust).not.toHaveBeenCalled();
  });
  it("finds interrupted publications only after authenticating complete public tree partitions", async () => {
    const f = fixture();
    expect(await f.chain.findLeaf(43n, 0)).toBe(1n);
    expect(await f.chain.findLeaf(59n)).toBe(1n);
    expect(await f.chain.findLeaf(61n)).toBe(null);
    f.source.getSourceLeafPage.mockResolvedValue([41n]);
    await expect(f.chain.findLeaf(43n, 0)).rejects.toThrow(/incomplete/);
  });
  it("authenticates successful transaction receipts against contract, leaf, state and canonical block", async () => {
    const f = fixture();
    f.provider.getTransactionReceipt.mockResolvedValue(
      f.receipt("source", [0n, 1n, 43n, f.sourceTrees[0].root]),
    );
    expect(
      await f.chain.confirmSourcePublication(transactionHash, { treeId: 0, leaf: 43n }),
    ).toMatchObject({ leafIndex: 1n, leaf: 43n });
    await expect(
      f.chain.confirmSourcePublication(transactionHash, { treeId: 0, leaf: 41n }),
    ).rejects.toThrow(/does not match/);
    const badReceipt = f.receipt("source", [0n, 1n, 43n, f.sourceTrees[0].root]);
    f.provider.getTransactionReceipt.mockResolvedValue({ ...badReceipt, to: other });
    await expect(
      f.chain.confirmSourcePublication(transactionHash, { treeId: 0, leaf: 43n }),
    ).rejects.toThrow(/targets another/);
    f.provider.getTransactionReceipt.mockResolvedValue(
      f.receipt("credential", [1n, 59n, f.credentials.root]),
    );
    expect(
      await f.chain.confirmCredentialRegistration(transactionHash, { credential: 59n }),
    ).toMatchObject({ credentialIndex: 1n, credentialCommitment: 59n });
    f.reorg();
    await expect(
      f.chain.confirmCredentialRegistration(transactionHash, { credential: 59n }),
    ).rejects.toThrow(/reorganized/);
  });
  it("checks every registered role controller and encodes supported relationship mutations atomically", async () => {
    const f = fixture();
    const roles = [0, 1] as Array<0 | 1>,
      secrets = [71n, 73n];
    const status = await f.chain.readRoleStatuses({
      roles: roles.map((role, index) => ({
        role,
        roleIndex: poseidon2([74321n + BigInt(role), secrets[index]]),
        commitment: poseidon2([74201n + BigInt(role), secrets[index]]),
      })),
    });
    expect(status.roles.every((role) => role.registered && !role.revoked)).toBe(true);
    await f.chain.sendRevocation({
      roles,
      secrets,
      mutation: { kind: "cancelEndorsement", childIdentity },
    });
    const mutation = f.family.withEligibilityRevocations.mock.calls[0] as unknown[];
    expect(mutation.slice(0, 2)).toEqual([roles, secrets]);
    const parsed = new Interface(QUALIFICATION_FAMILY_ABI).parseTransaction({
      data: mutation[2] as string,
    });
    expect(parsed?.name).toBe("cancelEndorsement");
    expect(parsed?.args[0]).toBe(childHash);
    await f.chain.sendRevocation({
      roles: [2],
      secrets: [79n],
      mutation: { kind: "removeTrustedEndorser", parentIdentity, parentVersion, endorser: actor },
    });
    expect(
      new Interface(QUALIFICATION_FAMILY_ABI).parseTransaction({
        data: (f.family.withEligibilityRevocations.mock.calls as unknown[][])[1][2] as string,
      })?.name,
    ).toBe("removeTrustedEndorser");
    await expect(
      f.chain.sendRevocation({
        roles: [2],
        secrets: [79n],
        mutation: {
          kind: "removeTrustedEndorser",
          parentIdentity,
          parentVersion: 2n,
          endorser: actor,
        },
      }),
    ).rejects.toThrow(/another parent version/);
    f.changeSigner(other);
    await expect(f.chain.sendRevocation({ roles: [0], secrets: [71n] })).rejects.toThrow(
      /endorsement controller/,
    );
    f.changeSigner(actor);
    f.setManager(false);
    await expect(f.chain.sendRevocation({ roles: [2], secrets: [79n] })).rejects.toThrow(
      /parent manager/,
    );
    await expect(f.chain.sendRevocation({ roles: [0, 0], secrets: [71n, 71n] })).rejects.toThrow(
      /Duplicate/,
    );
  });
});
