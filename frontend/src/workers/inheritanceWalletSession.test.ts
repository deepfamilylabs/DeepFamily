import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBytes, toBeHex, Interface, type ContractRunner } from "ethers";
import {
  computeReceiveAuthorization,
  decodeReceiveCode,
  decryptWalletBackup,
  deriveReceiveKeyMaterial,
  deriveIdentityMaterial,
  createWalletState,
  encryptWalletBackup,
  normalizeWalletState,
  computeRoleStatusIndex,
} from "@deepfamily/protocol-core";
import { poseidon3, poseidon5, poseidon7 } from "poseidon-lite";
import { WalletSession } from "./inheritanceWalletSession";
import { ReceiveService, type ProtocolProofProvider } from "../shared/zk/receiveProtocol";
import { ReceiveChain, RECEIVE_REGISTRY_ABI, POOL_ABI } from "../shared/clients/receiveChain";
import type { ReceiveWorkerContext } from "../shared/workers/receiveWorkerClient";
import type { WalletStateView } from "../shared/workers/walletWorkerTypes";
const proof = {
  pi_a: [1n, 2n, 1n],
  pi_b: [
    [3n, 4n],
    [5n, 6n],
    [1n, 0n],
  ],
  pi_c: [7n, 8n, 1n],
};
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
const chain = { deployment: context.deployment } as unknown as ReceiveChain;
const proofs: ProtocolProofProvider = {
  async verify() {
    return true;
  },
  async prove(circuit, witness) {
    if (circuit !== "code") throw new Error("Unexpected proof operation");
    const common = computeReceiveAuthorization({
      ...(witness as Record<string, bigint>),
      chainId: witness.chainId as bigint,
      authorizerScope: witness.authorizerScope as bigint,
      codeRootSecret: witness.codeRootSecret as bigint,
      codeSecret: witness.codeSecret as bigint,
      ownerSecret: witness.ownerSecret as bigint,
      nonce: witness.nonce as bigint,
      expiresAt: witness.expiresAt as bigint,
      viewingKey: getBytes(
        toBeHex(((witness.viewKeyHi as bigint) << 128n) | (witness.viewKeyLo as bigint), 32),
      ),
    });
    return { proof, publicSignals: common.publicSignals };
  },
};
const env = {
  context,
  chain,
  proofs,
  provider: {} as never,
  service: new ReceiveService(chain, proofs),
};
const password = "wallet worker backup password";
describe("wallet session backup and secret ownership", () => {
  let session: WalletSession;
  beforeEach(() => {
    session = new WalletSession();
  });
  it("reserves the change branch and backs up the next branch before exposing a new code", async () => {
    const created = (await session.run("walletCreate", { rawPassphrase: password }, env)) as {
      state: { codeCount: string };
      backup: Uint8Array;
    };
    expect(created.state.codeCount).toBe("1");
    expect(Object.keys(created).sort()).toEqual(["backup", "state"]);
    const issued = (await session.run(
      "walletCreateCode",
      { expiresAt: "2000000000", rawPassphrase: password },
      env,
    )) as { code: string; backup: Uint8Array; state: { codeCount: string } };
    const wallet = await decryptWalletBackup({ backup: issued.backup, rawPassphrase: password });
    expect(wallet.nextCodeIndex).toBe(2n);
    const expected = await deriveReceiveKeyMaterial({ ...wallet, codeIndex: 1n });
    expect(decodeReceiveCode(issued.code).ownerCommitment).toBe(expected.ownerCommitment);
    session.lock();
    await session.run("walletRestore", { rawPassphrase: password, backup: issued.backup }, env);
    const next = (await session.run(
      "walletCreateCode",
      { expiresAt: "2000000000", rawPassphrase: password },
      env,
    )) as { code: string; state: { codeCount: string } };
    expect(next.state.codeCount).toBe("3");
    expect(decodeReceiveCode(next.code).codeAlias).not.toBe(
      decodeReceiveCode(issued.code).codeAlias,
    );
  });
  it("keeps locked sessions closed and rejects a restored wallet from another registry", async () => {
    const created = (await session.run("walletCreate", { rawPassphrase: password }, env)) as {
      backup: Uint8Array;
    };
    session.lock();
    await expect(
      session.run("walletCreateCode", { expiresAt: "2000000000", rawPassphrase: password }, env),
    ).rejects.toThrow(/Unlock/);
    const other = {
      ...env,
      chain: {
        deployment: {
          ...context.deployment,
          registryAddress: "0x0000000000000000000000000000000000005678",
        },
      } as unknown as ReceiveChain,
    };
    await expect(
      session.run("walletRestore", { rawPassphrase: password, backup: created.backup }, other),
    ).rejects.toThrow();
    await expect(
      session.run("walletCreateCode", { expiresAt: "2000000000", rawPassphrase: password }, env),
    ).rejects.toThrow(/Unlock/);
  });
});

describe("family wallet qualifications", () => {
  const root = 23n;
  function credential(index: number, familyRoot = BigInt(index + 100)) {
    const item = {
      issueNonce: BigInt(index + 10),
      familyRoot,
      endorser: 43n,
      parentVersion: 1n,
      xChild: BigInt(index + 50),
      xEndorse: BigInt(index + 60),
      xTrust: BigInt(index + 70),
      credentialSalt: BigInt(index + 80),
      credentialIndex: BigInt(index),
    };
    const subject = poseidon3([73204n, root, item.issueNonce]);
    const fact = poseidon7([
      73101n,
      subject,
      item.familyRoot,
      item.endorser,
      item.parentVersion,
      item.xChild,
      item.xEndorse,
    ]);
    const trust = poseidon5([
      73102n,
      item.familyRoot,
      item.endorser,
      item.parentVersion,
      item.xTrust,
    ]);
    return {
      ...item,
      credentialCommitment: poseidon5([
        73400n,
        fact,
        trust,
        item.credentialSalt,
        poseidon3([74000n, 31337n, BigInt(context.deployment.registryAddress)]),
      ]),
    };
  }
  const credentials = [credential(0), credential(1), credential(2), credential(3, 100n)];
  function qualifiedEnvironment() {
    const issued = new Map(
      credentials.map((item) => [item.credentialIndex, item.credentialCommitment]),
    );
    const readCredentialProof = vi.fn(async (index: bigint) => {
      const leaf = issued.get(index);
      if (leaf === undefined) throw new Error("Credential has not been issued");
      return { leaf, root: leaf, depth: 0n, index: 0n, siblings: [] };
    });
    const registry = new Interface(RECEIVE_REGISTRY_ABI),
      pool = new Interface(POOL_ABI);
    const reverts = new Map<bigint, unknown>();
    const statusChain = new ReceiveChain(context.deployment, {
      provider: { getNetwork: async () => ({ chainId: 31337n }) },
      call: async (transaction: { to: string; data: string }) => {
        if (transaction.to.toLowerCase() === context.deployment.poolAddress.toLowerCase()) {
          const method = pool.parseTransaction({ data: transaction.data })!.name;
          return pool.encodeFunctionResult(method, [
            method === "protocolVersion" ? 1n : context.deployment.registryAddress,
          ]);
        }
        const root = BigInt(registry.parseTransaction({ data: transaction.data })!.args[0]);
        if (reverts.has(root)) throw reverts.get(root);
        return registry.encodeFunctionResult("validateBudgetRoleStatus", [true]);
      },
    } as unknown as ContractRunner);
    const checkClaimQualification = vi.fn(
      (status: Parameters<ReceiveChain["checkClaimQualification"]>[0]) =>
        statusChain.checkClaimQualification(status),
    );
    const createCode = vi.fn(async (_input: Parameters<ReceiveService["createCode"]>[0]) => ({
      code: "prepared-receiving-code",
    }));
    const qualifiedChain = {
      ...chain,
      readCredentialProof,
      checkClaimQualification,
    } as unknown as ReceiveChain;
    const qualifiedEnv = {
      ...env,
      chain: qualifiedChain,
      service: { ...env.service, createCode } as unknown as ReceiveService,
    };
    return { qualifiedEnv, issued, createCode, checkClaimQualification, reverts, registry };
  }
  async function sourceBackup(
    options: { root?: bigint; chainId?: bigint; qualifications?: typeof credentials } = {},
  ) {
    const wallet = await createWalletState({
      chainId: options.chainId ?? 31337n,
      authorizerScope: context.deployment.registryAddress,
      masterKey: new Uint8Array(32).fill(99),
      codeRootSecret: options.root ?? root,
      nextCodeIndex: 99n,
    });
    const normalized = normalizeWalletState({
      ...wallet,
      credentials:
        options.qualifications ??
        (options.root === undefined && options.chainId === undefined ? credentials : []),
    });
    return encryptWalletBackup({ wallet: normalized, rawPassphrase: password });
  }
  it("derives the family wallet identity inside the session and returns only its encrypted backup", async () => {
    const session = new WalletSession();
    const fields = {
      fullName: "Wallet Family Subject",
      isBirthBC: false,
      birthYear: 2000,
      birthMonth: 5,
      birthDay: 17,
      gender: 1,
    };
    const identityPassphrase = "original identity passphrase";
    const expected = await deriveIdentityMaterial({
      identity: fields,
      rawPassphrase: identityPassphrase,
    });
    const result = (await session.run(
      "walletCreate",
      { rawPassphrase: password, identity: { fields, rawPassphrase: identityPassphrase } },
      env,
    )) as { backup: Uint8Array; state: WalletStateView };
    const wallet = await decryptWalletBackup({ backup: result.backup, rawPassphrase: password });
    expect(wallet.codeRootSecret).toBe(expected.derivedSecretField);
    expect(Object.keys(result).sort()).toEqual(["backup", "state"]);
    expect(new TextDecoder().decode(result.backup)).not.toContain(identityPassphrase);
    // The page names the wallet by its person; no derived secret leaves the session.
    expect(result.state.identity).toEqual({
      fullName: "Wallet Family Subject",
      personHash: expected.personHash,
    });
    expect(
      JSON.stringify(result.state, (_, value) =>
        typeof value === "bigint" ? String(value) : value,
      ),
    ).not.toContain(String(expected.derivedSecretField));
  });
  it("uses renewed current qualification for an existing budget and checks its shared role indices", async () => {
    const session = new WalletSession(),
      { qualifiedEnv, checkClaimQualification, reverts, registry } = qualifiedEnvironment();
    const backup = await sourceBackup({ qualifications: [credentials[3], credentials[0]] });
    await session.run("walletRestore", { backup, rawPassphrase: password }, qualifiedEnv);
    const wallet = await decryptWalletBackup({ backup, rawPassphrase: password });
    const keyMaterial = await deriveReceiveKeyMaterial({ ...wallet, codeIndex: 1n });
    const note = {
      familyCommitment: 100n,
      parentVersion: 1n,
      codeNonce: keyMaterial.nonce,
      remaining: 100n,
    };
    Object.assign(session, {
      snapshotPool: context.deployment.poolAddress.toLowerCase(),
      notes: new Map([
        [
          "1001",
          {
            kind: "budget",
            note,
            keyMaterial,
            ciphertext: new Uint8Array(512),
            commitment: 1001n,
            shardId: 0n,
            leafIndex: 0n,
          },
        ],
      ]),
      snapshot: {
        shards: new Map([
          [0n, { generateProof: () => ({ leaf: 1001n, root: 1001n, index: 0, siblings: [] }) }],
        ]),
      },
    });
    const prepareClaim = vi.fn(async (_input: Parameters<ReceiveService["prepareClaim"]>[0]) => ({
      proof,
    }));
    const claimEnv = {
      ...qualifiedEnv,
      provider: { getBlock: async () => ({ timestamp: 1_900_000_000 }) } as never,
      service: { ...qualifiedEnv.service, prepareClaim } as unknown as ReceiveService,
    };
    reverts.set(credentials[0].credentialCommitment, {
      code: "CALL_EXCEPTION",
      data: registry.encodeErrorResult("QualificationRevoked", [0]),
    });
    const options = (await session.run("walletReadQualifications", {}, qualifiedEnv)) as {
      qualifications: { current: boolean; selected: boolean }[];
    };
    expect(
      options.qualifications.map((item) => ({ current: item.current, selected: item.selected })),
    ).toEqual([
      { current: true, selected: true },
      { current: false, selected: false },
    ]);
    await session.run("walletPrepareClaim", { noteHandle: "1001", periodIndex: "0" }, claimEnv);
    expect(prepareClaim.mock.calls[0][0].qualification.issueNonce).toBe(credentials[3].issueNonce);
    expect(checkClaimQualification).toHaveBeenLastCalledWith({
      issuanceRoot: credentials[3].credentialCommitment,
      childRoleIndex: computeRoleStatusIndex({ role: "child", roleSecret: credentials[3].xChild }),
      endorsementRoleIndex: computeRoleStatusIndex({
        role: "endorsement",
        roleSecret: credentials[3].xEndorse,
      }),
      trustedRoleIndex: computeRoleStatusIndex({
        role: "trusted",
        roleSecret: credentials[3].xTrust,
      }),
    });
    reverts.set(credentials[3].credentialCommitment, {
      code: "CALL_EXCEPTION",
      data: registry.encodeErrorResult("QualificationRevoked", [2]),
    });
    await expect(
      session.run("walletPrepareClaim", { noteHandle: "1001" }, claimEnv),
    ).rejects.toThrow(/current qualification/);
    expect(prepareClaim).toHaveBeenCalledTimes(1);
  });
});
