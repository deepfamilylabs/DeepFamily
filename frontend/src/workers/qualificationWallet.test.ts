import { describe, expect, it, vi } from "vitest";
import {
  createSourceFact,
  createSourceTrust,
  decodeQualificationRequest,
  decryptWalletBackup,
  computeIdentityFromDerivedSecret,
  encryptQualificationPackage,
  type ProtocolProof,
  type WalletState,
} from "@deepfamily/protocol-core";
import { keccak256, toBeHex } from "ethers";
import { WalletSession } from "./inheritanceWalletSession";
import { ReceiveService, type ProtocolProofProvider } from "../shared/zk/receiveProtocol";
import type { ReceiveChain } from "../shared/clients/receiveChain";
import type { ReceiveWorkerContext } from "../shared/workers/receiveWorkerClient";
import type { WalletCalls } from "../shared/workers/walletWorkerTypes";

const password = "qualification worker backup password";
const fields = {
  fullName: "Worker Qualification Child",
  birthYear: 2000,
  birthMonth: 5,
  birthDay: 17,
  gender: 1,
  isBirthBC: false,
};
const endorser = "0x0000000000000000000000000000000000001111";
const sourceAddress = "0x0000000000000000000000000000000000005678";
const parentIdentity = 123456n,
  parentPersonHash = keccak256(toBeHex(parentIdentity, 32));
const context: ReceiveWorkerContext = {
  rpcUrl: "http://localhost:8545",
  deployment: {
    chainId: 31337n,
    registryAddress: "0x0000000000000000000000000000000000001234",
    poolAddress: "0x0000000000000000000000000000000000004321",
  },
  manifest: {
    version: 1,
    chainId: "31337",
    registryAddress: "0x0000000000000000000000000000000000001234",
    circuits: {},
  },
};
const proof: ProtocolProof = {
  pi_a: [1n, 2n, 1n],
  pi_b: [
    [3n, 4n],
    [5n, 6n],
    [1n, 0n],
  ],
  pi_c: [7n, 8n, 1n],
};
type Result<M extends keyof WalletCalls> = WalletCalls[M]["result"];
const last = <T>(items: T[]) => items[items.length - 1];
function setup() {
  const bindings = {
    sourceAddress,
    deepFamilyAddress: "0x0000000000000000000000000000000000009876",
    lineageAddress: "0x0000000000000000000000000000000000006543",
    blockNumber: 10,
    blockHash: "0x" + "ab".repeat(32),
  };
  const leaves = [new Map<bigint, bigint>(), new Map<bigint, bigint>()];
  const roles = new Map<
    string,
    {
      registered: boolean;
      revoked: boolean;
      controller: string;
      parentHash: string;
      parentVersion: bigint;
    }
  >();
  const credentials = new Map<bigint, bigint>();
  const transactions = new Map<
    string,
    {
      treeId?: 0 | 1;
      leafIndex?: bigint;
      leaf?: bigint;
      credentialIndex?: bigint;
      credential?: bigint;
    }
  >();
  const path = (treeId: 0 | 1, index: bigint) => {
    const leaf = leaves[treeId].get(BigInt(index));
    if (leaf === undefined) throw new Error("Unknown source leaf");
    return { leaf, root: leaf, depth: 0n, index: 0n, siblings: [] };
  };
  const chain = {
    deployment: context.deployment,
    readQualificationBindings: vi.fn(async () => bindings),
    readQualificationParent: vi.fn(async () => ({ ...bindings, parentIdentity })),
    readQualificationController: vi.fn(
      async (input: { actor: string }) => input.actor === endorser,
    ),
    readSourceFactContext: vi.fn(async () => ({
      ...bindings,
      endorsementRoot: 123n,
      childVersion: 1n,
      fatherIdentity: parentIdentity,
      motherIdentity: 987654n,
      rootIsMother: 0n,
      writtenAt: 1900000000n,
      endorsementDepth: 0n,
      endorsementIndex: 0n,
      endorsementSiblings: [],
    })),
    readSourceTrustContext: vi.fn(async () => ({
      ...bindings,
      trustedRoot: 456n,
      trustedDepth: 0n,
      trustedIndex: 0n,
      trustedSiblings: [],
    })),
    findSourceLeafIndex: vi.fn(
      async (treeId: 0 | 1, leaf: bigint) =>
        [...leaves[treeId]].find(([, value]) => value === BigInt(leaf))?.[0] ?? null,
    ),
    readSourceProof: vi.fn(async (treeId: 0 | 1, index: bigint) => path(treeId, BigInt(index))),
    readRoleStatuses: vi.fn(
      async ({
        roles: queries,
      }: {
        roles: Array<{ role: 0 | 1 | 2; roleIndex: bigint; commitment?: bigint }>;
      }) => ({
        ...bindings,
        roles: queries.map((query) => ({
          ...query,
          ...(roles.get(`${query.role}:${query.commitment}`) ?? {
            registered: false,
            revoked: false,
            controller: endorser,
            parentHash: parentPersonHash,
            parentVersion: 1n,
          }),
        })),
      }),
    ),
    confirmSourcePublication: vi.fn(
      async (transactionHash: string, expected: { treeId: 0 | 1; leaf: bigint }) => {
        const event = transactions.get(transactionHash);
        if (!event || event.treeId !== expected.treeId || event.leaf !== BigInt(expected.leaf))
          throw new Error("Invalid source receipt");
        return { ...bindings, ...event, transactionHash };
      },
    ),
    readSourcePaths: vi.fn(async (factIndex: bigint, trustIndex: bigint) => ({
      ...bindings,
      sourceRoot: path(0, BigInt(factIndex)).root,
      trustedRoot: path(1, BigInt(trustIndex)).root,
      sourcePath: path(0, BigInt(factIndex)),
      trustedPath: path(1, BigInt(trustIndex)),
    })),
    readSourceRoots: vi.fn(async () => ({
      ...bindings,
      sourceRoot: last([...leaves[0].values()])!,
      trustedRoot: last([...leaves[1].values()])!,
    })),
    findCredentialIndex: vi.fn(
      async (commitment: bigint) =>
        [...credentials].find(([, leaf]) => leaf === BigInt(commitment))?.[0] ?? null,
    ),
    readCredentialProof: vi.fn(async (index: bigint) => {
      const leaf = credentials.get(BigInt(index));
      if (leaf === undefined) throw new Error("Unknown qualification");
      return { leaf, root: leaf, depth: 0n, index: 0n, siblings: [] };
    }),
    confirmCredentialRegistration: vi.fn(
      async (transactionHash: string, expected: { credential: bigint }) => {
        const event = transactions.get(transactionHash);
        if (!event || event.credential !== BigInt(expected.credential))
          throw new Error("Invalid qualification receipt");
        return {
          ...bindings,
          credentialIndex: event.credentialIndex!,
          credentialCommitment: event.credential!,
          transactionHash,
        };
      },
    ),
    checkClaimQualification: vi.fn(async () => true),
  } as unknown as ReceiveChain;
  const proofs: ProtocolProofProvider = {
    verify: async () => true,
    prove: vi.fn(async (circuit, witness) => {
      const w = witness as Record<string, bigint>;
      if (circuit === "sourceFact") {
        const fact = createSourceFact(w as unknown as Parameters<typeof createSourceFact>[0]);
        return {
          proof,
          publicSignals: [
            fact.factLeaf,
            fact.childRoleCommitment,
            fact.endorsementRoleCommitment,
            w.chainId,
            w.sourceAddress,
            w.childIdentity,
            w.parentIdentity,
            w.endorser,
            w.parentVersion,
            w.endorsementRoot,
          ],
        };
      }
      if (circuit === "sourceTrust") {
        const trust = createSourceTrust(w as unknown as Parameters<typeof createSourceTrust>[0]);
        return {
          proof,
          publicSignals: [
            trust.trustLeaf,
            trust.trustRoleCommitment,
            w.chainId,
            w.sourceAddress,
            w.parentIdentity,
            w.endorser,
            w.parentVersion,
            w.trustedRoot,
          ],
        };
      }
      if (circuit === "issue")
        return {
          proof,
          publicSignals: [
            // The real SDK computes the credential before this mocked prover boundary.
            issueCommitment(w),
            w.chainId,
            w.authorizerScope,
            w.sourceRoot,
            w.trustedRoot,
          ],
        };
      throw new Error("Unexpected proof circuit");
    }),
  };
  const env = {
    context,
    chain,
    proofs,
    service: new ReceiveService(chain, proofs),
    provider: {} as never,
  };
  const call = async <M extends keyof WalletCalls>(
    session: WalletSession,
    method: M,
    input: WalletCalls[M]["input"],
  ) => (await session.run(method, input, env)) as Result<M>;
  const publishSource = (prepared: Result<"walletPrepareSourcePublication">) => {
    const treeId = prepared.kind === "fact" ? 0 : 1,
      leafIndex = BigInt(leaves[treeId].size),
      leaf = prepared.publicSignals[0];
    leaves[treeId].set(leafIndex, leaf);
    for (const role of prepared.kind === "fact" ? [0, 1] : [2])
      roles.set(`${role}:${prepared.publicSignals[prepared.kind === "fact" ? role + 1 : 1]}`, {
        registered: true,
        revoked: false,
        controller:
          prepared.kind === "fact" ? endorser : "0x0000000000000000000000000000000000000000",
        parentHash: parentPersonHash,
        parentVersion: 1n,
      });
    const transactionHash = "0x" + (transactions.size + 1).toString(16).padStart(64, "0");
    transactions.set(transactionHash, { treeId, leafIndex, leaf });
    return transactionHash;
  };
  const publishIssue = (prepared: Result<"walletPrepareQualificationIssue">) => {
    const credentialIndex = BigInt(credentials.size),
      credential = prepared.publicSignals[0];
    credentials.set(credentialIndex, credential);
    const transactionHash = "0x" + (transactions.size + 1).toString(16).padStart(64, "0");
    transactions.set(transactionHash, { credentialIndex, credential });
    return transactionHash;
  };
  return { env, call, publishSource, publishIssue, roles, chain };
}
import { poseidon3, poseidon5, poseidon7 } from "poseidon-lite";
function issueCommitment(w: Record<string, bigint>) {
  const family = poseidon3([73201n, w.parentIdentity, w.familySalt]);
  const subject = poseidon3([73204n, w.derivedSecretField, w.issueNonce]);
  return poseidon5([
    73400n,
    poseidon7([73101n, subject, family, w.endorser, w.parentVersion, w.xChild, w.xEndorse]),
    poseidon5([73102n, family, w.endorser, w.parentVersion, w.xTrust]),
    w.credentialSalt,
    poseidon3([74000n, w.chainId, w.authorizerScope]),
  ]);
}
const readBackup = (backup: Uint8Array) => decryptWalletBackup({ backup, rawPassphrase: password });

describe("qualification wallet lifecycle and secret ownership", () => {
  it("persists controller drafts before publication and restores source/Q confirmations from canonical state without rebroadcast", async () => {
    const { call, publishSource, publishIssue, roles } = setup();
    let controller = new WalletSession(),
      recipient = new WalletSession();
    await call(controller, "walletCreate", { rawPassphrase: password });
    const created = await call(recipient, "walletCreate", {
      rawPassphrase: password,
      identity: { fields, rawPassphrase: "family identity password" },
    });
    const original = await readBackup(created.backup);
    const requested = await call(recipient, "walletCreateQualificationRequest", {
      parentPersonHash,
      parentVersion: "1",
      endorser,
      rawPassphrase: password,
    });
    const request = decodeQualificationRequest(requested.request);
    expect(request.childIdentity).toBe(
      String(
        computeIdentityFromDerivedSecret({
          identity: fields,
          identitySuiteId: 1,
          derivedSecretField: original.codeRootSecret,
        }).identityCommitment,
      ),
    );
    let latestRecipientBackup = requested.backup;
    let latestControllerBackup: Uint8Array | undefined;
    for (const kind of ["fact", "trust"] as const) {
      const prepared = await call(controller, "walletPrepareSourcePublication", {
        kind,
        request: requested.request,
        controller: endorser,
        rawPassphrase: password,
      });
      expect(Object.keys(prepared).sort()).toEqual([
        "backup",
        "draftId",
        "kind",
        "proof",
        "publicSignals",
        "state",
      ]);
      const draftWallet = await readBackup(prepared.backup);
      expect(last(draftWallet.qualification.sources)?.publication).toBeNull();
      expect(draftWallet.revocationRoles.length).toBe(kind === "fact" ? 2 : 3);
      publishSource(prepared);
      // The controller closes after mining but before confirmation, then recovers without the tx hash.
      controller.lock();
      controller = new WalletSession();
      await call(controller, "walletRestore", { backup: prepared.backup, rawPassphrase: password });
      await expect(
        call(controller, "walletPrepareSourcePublication", {
          kind,
          request: requested.request,
          controller: endorser,
          rawPassphrase: password,
          draftId: prepared.draftId,
        }),
      ).rejects.toThrow(/already published/);
      const confirmed = await call(controller, "walletConfirmSourcePublication", {
        draftId: prepared.draftId,
        rawPassphrase: password,
      });
      latestControllerBackup = confirmed.backup;
      const confirmedWallet = await readBackup(confirmed.backup);
      expect(last(confirmedWallet.qualification.sources)?.publication?.transactionHash).toBeNull();
      recipient.lock();
      recipient = new WalletSession();
      await call(recipient, "walletRestore", {
        backup: latestRecipientBackup,
        rawPassphrase: password,
      });
      const imported = await call(recipient, "walletImportSourcePackage", {
        package: confirmed.package,
        rawPassphrase: password,
      });
      expect(imported.requestId).toBe(requested.requestId);
      latestRecipientBackup = imported.backup;
    }
    const prepared = await call(recipient, "walletPrepareQualificationIssue", {
      requestId: requested.requestId,
      rawPassphrase: password,
    });
    publishIssue(prepared);
    recipient.lock();
    recipient = new WalletSession();
    await call(recipient, "walletRestore", { backup: prepared.backup, rawPassphrase: password });
    await expect(
      call(recipient, "walletPrepareQualificationIssue", {
        requestId: requested.requestId,
        rawPassphrase: password,
      }),
    ).rejects.toThrow(/already registered/);
    const confirmed = await call(recipient, "walletConfirmQualificationIssue", {
      requestId: requested.requestId,
      rawPassphrase: password,
    });
    const qualified = await readBackup(confirmed.backup);
    expect(qualified.credentials).toHaveLength(1);
    expect(qualified.codeRootSecret).toBe(original.codeRootSecret);
    expect(qualified.masterKey).toEqual(original.masterKey);
    expect(qualified.nextCodeIndex).toBe(original.nextCodeIndex);
    expect(qualified.qualification.requests[0].credentialIndex).toBe("0");
    const control = await readBackup(latestControllerBackup!);
    expect(control.qualification.families).toHaveLength(1);
    const revoke = await call(controller, "walletPrepareRoleRevocation", {
      sourceId: control.qualification.sources[0].id,
    });
    expect(revoke.roles).toEqual([0, 1]);
    expect(revoke.secrets).toEqual(control.revocationRoles.slice(0, 2).map((item) => item.secret));
    for (const [key, value] of roles) if (key.startsWith("0:")) value.revoked = true;
    await expect(
      call(recipient, "walletPrepareQualificationIssue", {
        requestId: requested.requestId,
        rawPassphrase: password,
      }),
    ).rejects.toThrow(/already issued/);
    const renewedRequest = await call(recipient, "walletCreateQualificationRequest", {
      parentPersonHash,
      parentVersion: "1",
      endorser,
      rawPassphrase: password,
    });
    const renewedTrust = await call(controller, "walletPrepareSourcePublication", {
      kind: "trust",
      request: renewedRequest.request,
      controller: endorser,
      rawPassphrase: password,
    });
    const renewedController = await readBackup(renewedTrust.backup);
    expect(last(renewedController.qualification.sources)?.familySalt).toBe(
      control.qualification.families[0].familySalt,
    );
  });

  it("does not install unbacked source state, lets ordinary wallets remain ordinary, and never returns source openings in management views", async () => {
    const { call } = setup();
    const controller = new WalletSession(),
      recipient = new WalletSession();
    const ordinary = await call(controller, "walletCreate", { rawPassphrase: password });
    await expect(
      call(controller, "walletCreateQualificationRequest", {
        parentPersonHash,
        parentVersion: "1",
        endorser,
        rawPassphrase: password,
      }),
    ).rejects.toThrow(/family wallet/);
    await call(recipient, "walletCreate", {
      rawPassphrase: password,
      identity: { fields, rawPassphrase: "identity secret password" },
    });
    const request = await call(recipient, "walletCreateQualificationRequest", {
      parentPersonHash,
      parentVersion: "1",
      endorser,
      rawPassphrase: password,
    });
    await expect(
      call(controller, "walletPrepareSourcePublication", {
        kind: "trust",
        request: request.request,
        controller: endorser,
        rawPassphrase: "\u0000",
      }),
    ).rejects.toThrow();
    const unchanged = await call(controller, "walletBackup", { rawPassphrase: password });
    expect(await readBackup(unchanged.backup)).toEqual(await readBackup(ordinary.backup));
    const prepared = await call(controller, "walletPrepareSourcePublication", {
      kind: "trust",
      request: request.request,
      controller: endorser,
      rawPassphrase: password,
    });
    const privateWallet: WalletState = await readBackup(prepared.backup);
    const view = await call(controller, "walletReadQualificationManagement", {});
    expect(view.canRequest).toBe(false);
    expect(view.sources).toHaveLength(1);
    const serialized = JSON.stringify(view);
    for (const secret of [
      privateWallet.qualification.sources[0].xTrust,
      privateWallet.qualification.families[0].familySalt,
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("masterKey");
    expect(serialized).not.toContain("sourceTrustSalt");
  });
  it("authenticates imported source openings to the actual leaf and rejects revoked packages without replacing recipient state", async () => {
    const { call, publishSource, roles } = setup();
    const controller = new WalletSession(),
      recipient = new WalletSession();
    await call(controller, "walletCreate", { rawPassphrase: password });
    await call(recipient, "walletCreate", {
      rawPassphrase: password,
      identity: { fields, rawPassphrase: "identity secret password" },
    });
    const requested = await call(recipient, "walletCreateQualificationRequest", {
      parentPersonHash,
      parentVersion: "1",
      endorser,
      rawPassphrase: password,
    });
    const prepared = await call(controller, "walletPrepareSourcePublication", {
      kind: "fact",
      request: requested.request,
      controller: endorser,
      rawPassphrase: password,
    });
    const transactionHash = publishSource(prepared);
    const confirmed = await call(controller, "walletConfirmSourcePublication", {
      draftId: prepared.draftId,
      transactionHash,
      rawPassphrase: password,
    });
    const controllerWallet = await readBackup(confirmed.backup),
      source = controllerWallet.qualification.sources[0];
    const request = decodeQualificationRequest(requested.request);
    // A different role is registered and current, but it is not the authenticated source leaf for this request.
    const substituted = {
      ...source,
      xChild: String(BigInt(source.xChild) + 1n),
      leafIndex: source.publication!.leafIndex,
    };
    const different = createSourceFact({
      childIdentity: request.childIdentity,
      parentIdentity: request.parentIdentity,
      parentVersion: request.parentVersion,
      endorser: BigInt(endorser),
      xChild: substituted.xChild,
      xEndorse: substituted.xEndorse,
      sourceFactSalt: substituted.sourceFactSalt,
    });
    roles.set(`0:${different.childRoleCommitment}`, {
      registered: true,
      revoked: false,
      controller: endorser,
      parentHash: parentPersonHash,
      parentVersion: 1n,
    });
    const tampered = await encryptQualificationPackage({
      request: requested.request,
      source: substituted,
    });
    await expect(
      call(recipient, "walletImportSourcePackage", { package: tampered, rawPassphrase: password }),
    ).rejects.toThrow(/authenticate/);
    const originalRole = [...roles].find(
      ([key]) => key.startsWith("0:") && key !== `0:${different.childRoleCommitment}`,
    )![1];
    originalRole.revoked = true;
    await expect(
      call(recipient, "walletImportSourcePackage", {
        package: confirmed.package,
        rawPassphrase: password,
      }),
    ).rejects.toThrow(/revoked/);
    const after = await call(recipient, "walletBackup", { rawPassphrase: password });
    expect(await readBackup(after.backup)).toEqual(await readBackup(requested.backup));
  });
  it("cannot resurrect a controller session locked while a source proof is running", async () => {
    const { call, env } = setup();
    const controller = new WalletSession(),
      recipient = new WalletSession();
    await call(controller, "walletCreate", { rawPassphrase: password });
    await call(recipient, "walletCreate", {
      rawPassphrase: password,
      identity: { fields, rawPassphrase: "identity secret password" },
    });
    const requested = await call(recipient, "walletCreateQualificationRequest", {
      parentPersonHash,
      parentVersion: "1",
      endorser,
      rawPassphrase: password,
    });
    const prove = env.proofs.prove;
    let release!: () => void, started!: () => void;
    const entered = new Promise<void>((done) => {
      started = done;
    });
    const barrier = new Promise<void>((done) => {
      release = done;
    });
    env.proofs.prove = async (circuit, witness) => {
      started();
      await barrier;
      return prove(circuit, witness);
    };
    const pending = call(controller, "walletPrepareSourcePublication", {
      kind: "trust",
      request: requested.request,
      controller: endorser,
      rawPassphrase: password,
    });
    await entered;
    controller.lock();
    release();
    await expect(pending).rejects.toThrow();
    await expect(call(controller, "walletReadQualificationManagement", {})).rejects.toThrow(
      /Unlock/,
    );
  });
});
