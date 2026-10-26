import { JsonRpcProvider } from "ethers";
import { ReceiveChain } from "../shared/clients/receiveChain";
import { ReceiveService, createProtocolProofProvider } from "../shared/zk/receiveProtocol";
import { WalletSession } from "./inheritanceWalletSession";
import type { WalletCalls } from "../shared/workers/walletWorkerTypes";
const walletSession = new WalletSession();
import type { ReceiveWorkerMethod, ReceiveWorkerRequest } from "../shared/workers/receiveWorkerClient";
import { installTrustedWorkerUrlPolicy } from "../shared/workers/trustedWorkerUrls";
import { ProtocolError } from "@deepfamily/protocol-core";

// snarkjs creates blob workers for proving; apply the same trusted URL policy
// as the existing proof worker inside this separate realm.
installTrustedWorkerUrlPolicy();

/** Only fixed status text may cross the worker boundary; prover details can contain secrets. */
export function publicWorkerError(error: unknown): { code?: string; message: string } {
  if (error instanceof ProtocolError && error.code === "QUALIFICATION_REVOKED")
    return { code: "QUALIFICATION_REVOKED", message: "This qualification has been revoked." };
  return { message: "Receive proof operation failed" };
}

/** Explicit public-result whitelist; never post notes, credentials, private witness or recovery keys. */
export function publicWorkerResult(method: ReceiveWorkerMethod, value: unknown): unknown {
  const result = value as Record<string, unknown>;
  const fields: Record<ReceiveWorkerMethod, readonly string[]> = {
    walletCreate: ["state", "backup"], walletRestore: ["state"], walletBackup: ["state", "backup"], walletLock: ["state"],
    walletCreateCode: ["state", "code", "backup"], walletRecover: ["state", "notes", "letters"], walletCreateRule: ["rule"],
    walletReadQualifications: ["qualifications"], walletImportQualifications: ["state", "backup"],
    walletPrepareShield: ["amount", "inputShardIds", "inputRoots", "inputNullifiers", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicSignals", "proof"],
    walletPrepareUnshield: ["amount", "recipient", "inputShardIds", "inputRoots", "inputNullifiers", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicSignals", "proof"],
    walletPrepareDeposit: ["kind", "code", "capabilityIndex", "policyCommitment", "budgetKey", "eligibleFrom", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof", "inputShardId"],
    walletPrepareClaim: ["periodNullifier", "inputNullifier", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof", "inputShardId"],
    walletPrepareTransfer: ["code", "inputNullifier", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof", "inputShardId"],
    walletPrepareLetter: ["code", "messageId", "ciphertext"],
    createCode: ["code"],
    proveQualification: ["proof", "publicSignals"],
    proveIssue: ["proof", "publicSignals"],
    verifyCode: ["chainId", "authorizerScope", "nonce", "codeAlias", "commonBinding", "revocationTag", "ownerCommitment", "viewingKey", "expiresAt", "version", "proof", "publicSignals", "capabilities"],
    prepareDeposit: ["kind", "code", "capabilityIndex", "policyCommitment", "budgetKey", "eligibleFrom", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof"],
    prepareClaim: ["periodNullifier", "inputNullifier", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof"],
    prepareTransfer: ["code", "inputNullifier", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof"],
    prepareLetter: ["code", "messageId", "ciphertext"],
  };
  const pick = (input: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(names.filter(name => Object.prototype.hasOwnProperty.call(input, name)).map(name => [name, input[name]]));
  const proof = (input: unknown) => pick(input as Record<string, unknown>, ["pi_a", "pi_b", "pi_c", "protocol", "curve"]);
  const code = (input: unknown) => {
    if (typeof input === "string") return input;
    const original = input as Record<string, unknown>;
    const cleaned = pick(original, fields.verifyCode);
    if (cleaned.proof) cleaned.proof = proof(cleaned.proof);
    if (Array.isArray(original.capabilities)) cleaned.capabilities = original.capabilities.map(cap => {
      const cleanedCap = pick(cap, ["issuanceRoot", "parentVersion", "familyTag", "childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex", "capabilityBinding", "proof", "publicSignals"]);
      if (cleanedCap.proof) cleanedCap.proof = proof(cleanedCap.proof);
      return cleanedCap;
    });
    return cleaned;
  };
  const cleaned = method === "verifyCode" ? code(result) as Record<string, unknown> : pick(result, fields[method]);
  if (cleaned.proof) cleaned.proof = proof(cleaned.proof);
  if (cleaned.code) cleaned.code = code(cleaned.code);
  if (cleaned.publicInput) cleaned.publicInput = pick(cleaned.publicInput as Record<string, unknown>, ["commonBinding", "codeAlias", "nonce", "ownerCommitment", "viewKeyLo", "viewKeyHi", "capabilityBinding", "familyTag", "parentVersion", "policyCommitment", "budgetKey", "eligibleFrom", "asOf", "inputRoot", "inputNullifier", "periodNullifier", "outputCommitments", "ciphertextHashes", "authorizerScope", "issuanceRoot", "childRoleIndex", "endorsementRoleIndex", "trustedRoleIndex"]);
  return cleaned;
}
export async function runReceiveWorkerRequest(message: ReceiveWorkerRequest): Promise<unknown> {
  const provider = new JsonRpcProvider(message.context.rpcUrl, undefined, { cacheTimeout: -1 });
  try {
    const chain = new ReceiveChain(message.context.deployment, provider);
    const proofs = createProtocolProofProvider(message.context.manifest);
    const service = new ReceiveService(chain, proofs);
    if (message.method.startsWith("wallet")) {
      const result = await walletSession.run(message.method as keyof WalletCalls,
        message.input as WalletCalls[keyof WalletCalls]["input"], { context: message.context, provider, chain, service, proofs });
      return publicWorkerResult(message.method, result);
    }
    let result: unknown;
    switch (message.method) {
      case "createCode": result = await service.createCode(message.input); break;
      case "proveQualification": result = await service.proveQualification(message.input); break;
      case "proveIssue": result = await service.proveIssue(message.input); break;
      case "verifyCode": result = await service.verifyCode(message.input.code, message.input.asOf); break;
      case "prepareDeposit": result = await service.prepareDeposit(message.input); break;
      case "prepareClaim": result = await service.prepareClaim(message.input); break;
      case "prepareTransfer": result = await service.prepareTransfer(message.input); break;
      case "prepareLetter": result = await service.prepareLetter(message.input); break;
      default: throw new Error("Unknown receiving worker operation");
    }
    return publicWorkerResult(message.method, result);
  } finally {
    // postMessage cloned these bytes into the worker. Erase our copy after each creation job.
    if (message.method === "createCode" && message.input.masterKey instanceof Uint8Array) message.input.masterKey.fill(0);
    const privateInput = message.input as unknown as Record<string, unknown>;
    for (const key of Object.keys(privateInput)) delete privateInput[key];
    provider.destroy();
  }
}
const workerScope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<ReceiveWorkerRequest>) => void): void;
  postMessage(message: unknown): void;
};
if (typeof window === "undefined" && typeof workerScope.postMessage === "function") {
  let requests = Promise.resolve();
  workerScope.addEventListener("message", event => {
    // Serialize access to the private wallet so a slow proof cannot restore a
    // state that a later backup, restore or lock operation has already replaced.
    requests = requests.then(async () => {
      try {
        const result = await runReceiveWorkerRequest(event.data);
        workerScope.postMessage({ id: event.data.id, ok: true, result });
      } catch (error) {
        // Prover errors may contain private witness values. Do not cross the worker boundary with them.
        workerScope.postMessage({ id: event.data?.id, ok: false, error: publicWorkerError(error) });
      }
    });
  });
}
