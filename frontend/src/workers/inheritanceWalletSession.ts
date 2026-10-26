import {
  createWalletState,
  allocateWalletCode,
  encryptWalletBackup,
  decryptWalletBackup,
  recoverWalletNotes,
  deriveReceiveKeyMaterial,
  computePeriodNullifier,
  prepareShield,
  prepareUnshield,
  generateShieldedRandomField,
  decryptShieldedLetter,
  readArchiveBlob,
  computePolicyCommitment,
  deriveIdentityMaterial,
  computeIdentityFromDerivedSecret,
  wipeBytes,
  computeRoleStatusIndex,
  RECEIVE_MAX_CAPABILITIES,
  type ProtocolInteger,
  type BudgetPolicyInput,
} from "@deepfamily/protocol-core";
import { Contract, getBytes, getBigInt, type JsonRpcProvider } from "ethers";
import { POOL_ABI, type ReceiveChain } from "../shared/clients/receiveChain";
import type {
  ProtocolProofProvider,
  ReceiveService,
  CredentialWitness,
} from "../shared/zk/receiveProtocol";
import type {
  WalletCalls,
  WalletStateView,
  WalletNoteView,
  WalletLetterView,
  WalletQualificationView,
} from "../shared/workers/walletWorkerTypes";
import type { ReceiveWorkerContext } from "../shared/workers/receiveWorkerClient";
import {
  loadShieldedPoolSnapshot,
  type PublicShieldedNote,
  type ShieldedPoolSnapshot,
} from "../domains/inheritance/services/shieldedPoolChain";
import { getEventScanConfig, getLetterArchiveDeploymentBlock } from "../shared/config/env";
import { decodeBudgetRule, encodeBudgetRule } from "../shared/zk/budgetRule";
import { poseidon2 } from "poseidon-lite";
import { QUALIFICATION_WALLET_METHODS, runQualificationWallet } from "./qualificationWallet";

type Wallet = Awaited<ReturnType<typeof createWalletState>>;
type Recovered = Awaited<ReturnType<typeof recoverWalletNotes>>[number];
type SessionEnvironment = {
  context: ReceiveWorkerContext;
  provider: JsonRpcProvider;
  chain: ReceiveChain;
  service: ReceiveService;
  proofs: ProtocolProofProvider;
};
const BLOB = "(bytes32 payloadHash,address pointer,uint64 payloadLength,uint32 segmentCount)";
const LETTER_EVENT = `event LetterRegistered(uint128 indexed messageId,uint256 indexed commonBinding,address indexed sender,${BLOB} blob)`;
function decodeRule(encoded: string, chainId: bigint, pool: string): BudgetPolicyInput {
  const rule = decodeBudgetRule(encoded);
  if (rule.chainId !== String(chainId) || rule.poolAddress.toLowerCase() !== pool.toLowerCase())
    throw new Error("Budget rule belongs to another asset pool");
  const result = rule.policy as unknown as BudgetPolicyInput;
  computePolicyCommitment(result, { chainId, poolAddress: pool });
  return result;
}

/** Private master material, credential openings and recovered notes stay in this worker realm. */
export class WalletSession {
  private wallet: Wallet | null = null;
  private scope = "";
  private backupChanged = false;
  private notes = new Map<string, Recovered>();
  private snapshot: ShieldedPoolSnapshot<never> | null = null;
  private snapshotPool = "";
  private qualificationEpoch = 0;
  lock(): WalletStateView {
    ++this.qualificationEpoch;
    this.wallet?.masterKey.fill(0);
    this.wallet = null;
    this.scope = "";
    this.notes.clear();
    this.snapshot = null;
    this.backupChanged = false;
    return this.view();
  }
  private view(): WalletStateView {
    const identity = this.wallet?.identity
      ? computeIdentityFromDerivedSecret({
          identity: this.wallet.identity.fields,
          identitySuiteId: this.wallet.identity.identitySuiteId,
          derivedSecretField: this.wallet.codeRootSecret,
        })
      : null;
    return {
      unlocked: this.wallet !== null,
      codeCount: String(this.wallet?.nextCodeIndex ?? 0),
      credentialCount: this.wallet?.credentials.length ?? 0,
      backupChanged: this.backupChanged,
      // The page names a family wallet by its person; the secret stays here.
      ...(identity
        ? { identity: { fullName: identity.identity.fullName, personHash: identity.personHash } }
        : {}),
    };
  }
  private current(env: SessionEnvironment): Wallet {
    const expected = `${env.chain.deployment.chainId}:${env.chain.deployment.registryAddress.toLowerCase()}`;
    if (!this.wallet || expected !== this.scope)
      throw new Error("Unlock this receiving wallet first");
    return this.wallet;
  }
  private install(wallet: Wallet, env: SessionEnvironment) {
    this.lock();
    this.wallet = wallet;
    this.scope = `${env.chain.deployment.chainId}:${env.chain.deployment.registryAddress.toLowerCase()}`;
  }
  private async key(wallet: Wallet, codeIndex: bigint) {
    return deriveReceiveKeyMaterial({
      masterKey: wallet.masterKey,
      chainId: wallet.chainId,
      authorizerScope: wallet.authorizerScope,
      codeIndex,
      codeRootSecret: wallet.codeRootSecret,
    });
  }
  private async credential(env: SessionEnvironment, index: number): Promise<CredentialWitness> {
    const item = this.current(env).credentials[index];
    if (!item) throw new Error("A current receiving qualification is required");
    return this.authenticatedCredential(item, env);
  }
  private async authenticatedCredential(
    item: Wallet["credentials"][number],
    env: SessionEnvironment,
  ): Promise<CredentialWitness> {
    const path = await env.chain.readCredentialProof(item.credentialIndex);
    if (BigInt(path.leaf) !== BigInt(item.credentialCommitment))
      throw new Error("Qualification path does not match the private credential");
    if (
      path.depth < 0n ||
      path.depth > 32n ||
      path.siblings.length !== Number(path.depth) ||
      path.index < 0n ||
      path.index >= 1n << path.depth
    )
      throw new Error("Invalid qualification membership path");
    let hash = BigInt(item.credentialCommitment);
    path.siblings.forEach((sibling, level) => {
      hash =
        (path.index >> BigInt(level)) & 1n
          ? poseidon2([sibling, hash])
          : poseidon2([hash, sibling]);
    });
    if (hash !== path.root)
      throw new Error("Qualification membership path does not authenticate the credential");
    return {
      ...item,
      issuanceRoot: path.root,
      credentialDepth: path.depth,
      credentialIndex: path.index,
      credentialSiblings: path.siblings,
    };
  }
  private async currentQualification(credential: CredentialWitness, env: SessionEnvironment) {
    return env.chain.checkClaimQualification({
      issuanceRoot: getBigInt(credential.issuanceRoot),
      childRoleIndex: computeRoleStatusIndex({ role: "child", roleSecret: credential.xChild }),
      endorsementRoleIndex: computeRoleStatusIndex({
        role: "endorsement",
        roleSecret: credential.xEndorse,
      }),
      trustedRoleIndex: computeRoleStatusIndex({ role: "trusted", roleSecret: credential.xTrust }),
    });
  }
  private async qualificationOptions(
    wallet: Wallet,
    env: SessionEnvironment,
  ): Promise<WalletQualificationView[]> {
    if (!wallet.credentials.length) return [];
    const options = await Promise.all(
      wallet.credentials.map(async (_, index) => {
        const credential = await this.credential(env, index);
        return {
          index,
          current: await this.currentQualification(credential, env),
          selected: false,
        };
      }),
    );
    const families = new Set<string>();
    let selected = 0;
    for (
      let index = options.length - 1;
      index >= 0 && selected < RECEIVE_MAX_CAPABILITIES;
      index--
    ) {
      const option = options[index],
        family = String(wallet.credentials[index].familyRoot);
      if (!option.current || families.has(family)) continue;
      families.add(family);
      option.selected = true;
      selected++;
    }
    return options;
  }
  private membership(note: Recovered) {
    const tree = this.snapshot?.shards.get(BigInt(note.shardId));
    if (!tree) throw new Error("Refresh the private balance before spending");
    const proof = tree.generateProof(Number(note.leafIndex));
    if (BigInt(proof.leaf) !== BigInt(note.commitment))
      throw new Error("Recovered note tree changed");
    return {
      root: proof.root,
      depth: BigInt(proof.siblings.length),
      index: BigInt(proof.index),
      siblings: proof.siblings,
    };
  }
  private donor(handle: string) {
    const note = this.notes.get(handle);
    if (!note || note.kind !== "value") throw new Error("Select an available private balance note");
    const value = note.note as { amount: bigint; nonce: bigint };
    return {
      record: note,
      input: {
        ownerSecret: note.keyMaterial.ownerSecret,
        ownerCommitment: note.keyMaterial.ownerCommitment,
        amount: value.amount,
        nonce: value.nonce,
        ciphertext: note.ciphertext,
        viewingKey: note.keyMaterial.viewingKey,
        membership: this.membership(note),
        shardId: BigInt(note.shardId),
      },
    };
  }
  private async now(env: SessionEnvironment) {
    const block = await env.provider.getBlock("latest");
    if (!block) throw new Error("Latest chain time unavailable");
    return BigInt(block.timestamp);
  }
  private async recover(env: SessionEnvironment) {
    const wallet = this.current(env);
    const pool = new Contract(
      env.chain.deployment.poolAddress,
      [
        ...POOL_ABI,
        "function nullifierCount() view returns (uint256)",
        "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
      ],
      env.provider,
    );
    const events: PublicShieldedNote[] = [];
    const snapshot = await loadShieldedPoolSnapshot<never>(
      pool,
      async (event) => {
        events.push(event);
        return null;
      },
      { fromBlock: Number(await pool.creationBlock()) },
    );
    const notes: Recovered[] = [];
    for (let first = 0n; first < wallet.nextCodeIndex; first += 512n) {
      notes.push(
        ...(await recoverWalletNotes(
          {
            wallet,
            events,
            spentNullifiers: snapshot.spentNullifiers,
            firstCodeIndex: first,
            lastCodeIndex:
              first + 512n < wallet.nextCodeIndex ? first + 512n : wallet.nextCodeIndex,
          },
          env.service.scope,
        )),
      );
    }
    this.notes = new Map(notes.map((note) => [String(note.commitment), note]));
    this.snapshot = snapshot;
    this.snapshotPool = env.chain.deployment.poolAddress.toLowerCase();
    const now = await this.now(env);
    const views: WalletNoteView[] = [];
    for (const item of notes) {
      const value = item.note as {
        amount?: bigint;
        remaining?: bigint;
        rate?: bigint;
        periodDays?: bigint;
        eligibleFrom?: bigint;
        familyCommitment?: bigint;
        parentVersion?: bigint;
        policySalt?: bigint;
        allocationKeyCommitment?: bigint;
      };
      const view: WalletNoteView = {
        handle: String(item.commitment),
        kind: item.kind,
        amount: String(value.amount ?? value.remaining ?? 0),
        codeIndex: String(item.codeIndex),
      };
      if (item.kind === "budget") {
        view.rate = String(value.rate);
        view.periodDays = String(value.periodDays);
        view.eligibleFrom = String(value.eligibleFrom);
        const periods =
          now > value.eligibleFrom!
            ? (now - value.eligibleFrom!) / (value.periodDays! * 86400n)
            : 0n;
        const policy = computePolicyCommitment(
          value as unknown as BudgetPolicyInput,
          env.service.scope,
        );
        for (
          let period = 0n;
          period < periods && period < 10000n && value.remaining! >= value.rate!;
          period++
        ) {
          const nf = computePeriodNullifier(
            {
              derivedSecretField: wallet.codeRootSecret,
              policyCommitment: policy,
              periodIndex: period,
            },
            env.service.scope,
          );
          if (!snapshot.spentNullifiers.has(nf)) {
            view.claimPeriod = String(period);
            break;
          }
        }
      }
      views.push(view);
    }
    return { state: this.view(), notes: views, letters: await this.letters(env, wallet) };
  }
  private async letters(env: SessionEnvironment, wallet: Wallet): Promise<WalletLetterView[]> {
    if (!env.chain.deployment.lettersAddress || wallet.nextCodeIndex === 0n) return [];
    const archive = new Contract(env.chain.deployment.lettersAddress, [LETTER_EVENT], env.provider);
    const event = archive.interface.getEvent("LetterRegistered")!;
    const toBlock = await env.provider.getBlockNumber(),
      anchor = await env.provider.getBlock(toBlock);
    const keys = await Promise.all(
      Array.from({ length: Number(wallet.nextCodeIndex) }, (_, i) => this.key(wallet, BigInt(i))),
    );
    const messages: WalletLetterView[] = [];
    const chunk = getEventScanConfig().blockChunk;
    for (
      let start = getLetterArchiveDeploymentBlock(Number(wallet.chainId));
      start <= toBlock;
      start += chunk
    ) {
      const logs = await env.provider.getLogs({
        address: env.chain.deployment.lettersAddress,
        topics: [event.topicHash],
        fromBlock: start,
        toBlock: Math.min(toBlock, start + chunk - 1),
      });
      for (const log of logs) {
        const args = archive.interface.parseLog(log)?.args;
        if (!args) throw new Error("Invalid letter event");
        const blob = await readArchiveBlob({
          ...args.blob.toObject(),
          blockTag: toBlock,
          getCode: (pointer, blockTag) => env.provider.getCode(pointer, blockTag),
        });
        for (const key of keys) {
          try {
            const opened = await decryptShieldedLetter({
              chainId: wallet.chainId,
              lettersAddress: env.chain.deployment.lettersAddress,
              messageId: args.messageId,
              hpkeIkm: key.hpkeIkm,
              ciphertext: blob.payload,
              relationCommitment: 0n,
            });
            const block = await env.provider.getBlock(log.blockNumber);
            messages.push({
              messageId: String(args.messageId),
              sender: String(args.sender),
              body: opened.body,
              transactionHash: log.transactionHash,
              registeredAt: String(block?.timestamp ?? 0),
            });
            break;
          } catch {
            /* Public inbox candidates are decrypted locally with no recipient RPC query. */
          }
        }
      }
    }
    if ((await env.provider.getBlock(toBlock))?.hash !== anchor?.hash)
      throw new Error("Letter history changed; refresh again");
    return messages;
  }
  async run<M extends keyof WalletCalls>(
    method: M,
    input: WalletCalls[M]["input"],
    env: SessionEnvironment,
  ): Promise<unknown> {
    if (method === "walletLock") return { state: this.lock() };
    if (method === "walletCreate") {
      const parameters = input as WalletCalls["walletCreate"]["input"];
      if (parameters.identity && parameters.codeRootSecret !== undefined)
        throw new Error("Choose one wallet identity source");
      let material: Awaited<ReturnType<typeof deriveIdentityMaterial>> | undefined;
      try {
        if (parameters.identity)
          material = await deriveIdentityMaterial({
            identity: parameters.identity.fields,
            rawPassphrase: parameters.identity.rawPassphrase,
            identitySuiteId: parameters.identity.identitySuiteId ?? 1,
          });
        const wallet = await createWalletState({
          chainId: env.chain.deployment.chainId,
          authorizerScope: BigInt(env.chain.deployment.registryAddress),
          codeRootSecret: material?.derivedSecretField ?? parameters.codeRootSecret,
          nextCodeIndex: 1n,
          identity: material
            ? { fields: material.identity, identitySuiteId: material.identitySuiteId }
            : null,
        });
        const backup = await encryptWalletBackup({
          wallet,
          rawPassphrase: parameters.rawPassphrase,
        });
        this.install(wallet, env);
        return { state: this.view(), backup };
      } finally {
        wipeBytes(material?.identitySalt);
        wipeBytes(material?.derivedSecretBytes);
      }
    }
    if (method === "walletRestore") {
      const parameters = input as WalletCalls["walletRestore"]["input"];
      const wallet = await decryptWalletBackup({
        ...parameters,
        chainId: env.chain.deployment.chainId,
        authorizerScope: BigInt(env.chain.deployment.registryAddress),
      });
      this.install(wallet.nextCodeIndex === 0n ? { ...wallet, nextCodeIndex: 1n } : wallet, env);
      this.backupChanged = wallet.nextCodeIndex === 0n;
      return { state: this.view() };
    }
    const wallet = this.current(env);
    if (QUALIFICATION_WALLET_METHODS.includes(method)) {
      const epoch = this.qualificationEpoch;
      const result = await runQualificationWallet(
        method as Parameters<typeof runQualificationWallet>[0],
        input as Parameters<typeof runQualificationWallet>[1],
        {
          wallet,
          chain: env.chain,
          service: env.service,
          proofs: env.proofs,
          save: async (next, rawPassphrase) => {
            try {
              if (this.qualificationEpoch !== epoch || this.wallet !== wallet)
                throw new Error("Qualification operation cancelled");
              const backup = await encryptWalletBackup({ wallet: next, rawPassphrase });
              if (this.qualificationEpoch !== epoch || this.wallet !== wallet)
                throw new Error("Qualification operation cancelled");
              this.wallet = next;
              this.backupChanged = false;
              wipeBytes(wallet.masterKey);
              return { state: this.view(), backup };
            } catch (error) {
              wipeBytes(next.masterKey);
              throw error;
            }
          },
        },
      );
      if (this.qualificationEpoch !== epoch) throw new Error("Qualification operation cancelled");
      return result;
    }
    if (method === "walletReadQualifications")
      return { qualifications: await this.qualificationOptions(wallet, env) };
    if (method === "walletBackup") {
      const backup = await encryptWalletBackup({
        wallet,
        rawPassphrase: (input as WalletCalls["walletBackup"]["input"]).rawPassphrase,
      });
      this.backupChanged = false;
      return { state: this.view(), backup };
    }
    if (method === "walletCreateCode") {
      const parameters = input as WalletCalls["walletCreateCode"]["input"];
      const allocation = allocateWalletCode(wallet);
      const indices =
        parameters.credentialIndices ??
        (await this.qualificationOptions(wallet, env))
          .filter((item) => item.selected)
          .map((item) => item.index);
      if (
        indices.length > RECEIVE_MAX_CAPABILITIES ||
        new Set(indices).size !== indices.length ||
        indices.some(
          (index) =>
            !Number.isSafeInteger(index) || index < 0 || index >= wallet.credentials.length,
        )
      )
        throw new Error("Choose at most two current qualifications");
      const credentials = await Promise.all(indices.map((index) => this.credential(env, index)));
      for (const credential of credentials)
        if (!(await this.currentQualification(credential, env)))
          throw new Error(
            "A selected qualification is no longer current; use ordinary receipt or choose another qualification",
          );
      const result = await env.service.createCode({
        masterKey: wallet.masterKey,
        chainId: wallet.chainId,
        authorizerScope: wallet.authorizerScope,
        codeIndex: allocation.codeIndex,
        codeRootSecret: wallet.codeRootSecret,
        expiresAt: parameters.expiresAt,
        credentials,
      });
      const backup = await encryptWalletBackup({
        wallet: allocation.state,
        rawPassphrase: parameters.rawPassphrase,
      });
      this.wallet = allocation.state;
      this.backupChanged = false;
      return { ...result, state: this.view(), backup };
    }
    if (method === "walletRecover") return this.recover(env);
    if (method === "walletPrepareLetter") {
      const parameters = input as WalletCalls["walletPrepareLetter"]["input"];
      return env.service.prepareLetter({
        ...parameters,
        asOf: await this.now(env),
        messageId: generateShieldedRandomField() & ((1n << 128n) - 1n),
      });
    }
    if (method === "walletCreateRule") {
      const parameters = input as WalletCalls["walletCreateRule"]["input"];
      const credential = await this.credential(env, parameters.credentialIndex);
      const policy = {
        familyCommitment: credential.familyRoot,
        parentVersion: credential.parentVersion,
        rate: parameters.rate,
        periodDays: parameters.periodDays,
        policySalt: generateShieldedRandomField(),
        allocationKeyCommitment: generateShieldedRandomField(),
      };
      computePolicyCommitment(policy, env.service.scope);
      return {
        rule: encodeBudgetRule(
          Object.fromEntries(
            Object.entries({
              chainId: wallet.chainId,
              poolAddress: env.chain.deployment.poolAddress,
              ...policy,
            }).map(([k, v]) => [k, String(v)]),
          ),
        ),
      };
    }
    if (method === "walletPrepareShield") {
      if (this.backupChanged) throw new Error("Back up this wallet before adding funds");
      const keyMaterial = await this.key(wallet, 0n);
      const amount = (input as WalletCalls["walletPrepareShield"]["input"]).amount;
      const result = await prepareShield(
        {
          amount,
          keyMaterial,
          proveShield: (witness) => env.proofs.prove("shield", witness),
          verifyShield: (proof, signals) => env.proofs.verify("shield", proof, signals),
        },
        env.service.scope,
      );
      return { ...result, amount, inputShardIds: [], inputRoots: [], inputNullifiers: [] };
    }
    if (this.snapshotPool !== env.chain.deployment.poolAddress.toLowerCase())
      throw new Error("Refresh this asset before spending");
    if (method === "walletPrepareClaim") {
      const parameters = input as WalletCalls["walletPrepareClaim"]["input"];
      const record = this.notes.get(parameters.noteHandle);
      if (!record || record.kind !== "budget") throw new Error("Select an available budget");
      const note = record.note as {
        familyCommitment: ProtocolInteger;
        parentVersion: ProtocolInteger;
        codeNonce: ProtocolInteger;
      };
      let qualification: CredentialWitness | undefined;
      for (let index = wallet.credentials.length - 1; index >= 0; index--) {
        const item = wallet.credentials[index];
        if (
          BigInt(item.familyRoot) !== BigInt(note.familyCommitment) ||
          BigInt(item.parentVersion) !== BigInt(note.parentVersion)
        )
          continue;
        const candidate = await this.credential(env, index);
        if (await this.currentQualification(candidate, env)) {
          qualification = candidate;
          break;
        }
      }
      if (!qualification)
        throw new Error("A current qualification for this budget family and version is required");
      const result = await env.service.prepareClaim({
        note: record.note as Parameters<ReceiveService["prepareClaim"]>[0]["note"],
        ciphertext: record.ciphertext,
        noteCommitment: record.commitment,
        keyMaterial: record.keyMaterial,
        qualification,
        membership: this.membership(record),
        asOf: await this.now(env),
        periodIndex: parameters.periodIndex ?? "0",
      });
      return { ...result, inputShardId: BigInt(record.shardId) };
    }
    const parameters = input as { noteHandle: string },
      donor = this.donor(parameters.noteHandle);
    if (method === "walletPrepareTransfer") {
      const result = await env.service.prepareTransfer({
        ...(input as WalletCalls["walletPrepareTransfer"]["input"]),
        donor: donor.input,
        asOf: await this.now(env),
      });
      return { ...result, inputShardId: BigInt(donor.record.shardId) };
    }
    if (method === "walletPrepareDeposit") {
      const parameters = input as WalletCalls["walletPrepareDeposit"]["input"];
      const policy = decodeRule(
        parameters.rule.trim(),
        wallet.chainId,
        env.chain.deployment.poolAddress,
      );
      const result = await env.service.prepareDeposit({
        code: parameters.code,
        policy,
        budgetPeriods: parameters.budgetPeriods,
        donor: donor.input,
        asOf: await this.now(env),
      });
      return { ...result, inputShardId: BigInt(donor.record.shardId) };
    }
    if (method === "walletPrepareUnshield") {
      const parameters = input as WalletCalls["walletPrepareUnshield"]["input"];
      const result = await prepareUnshield(
        {
          donor: donor.input,
          amount: parameters.amount,
          recipient: parameters.recipient,
          proveUnshield: (witness, capacity) =>
            env.proofs.prove(capacity === 4 ? "unshield4" : "unshield", witness),
          verifyUnshield: (proof, signals) =>
            env.proofs.verify(signals.length === 20 ? "unshield4" : "unshield", proof, signals),
        },
        env.service.scope,
      );
      return {
        ...result,
        ...result.publicInput,
        amount: parameters.amount,
        recipient: parameters.recipient,
      };
    }
    throw new Error("Unsupported receiving wallet operation");
  }
}
