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
  if (error instanceof ProtocolError && error.code === "INVALID_QUALIFICATION")
    return { code: "INVALID_QUALIFICATION", message: "This qualification file is invalid or belongs to another wallet. Check the request and deployment." };
  const safe: Record<string, { code: string; message: string }> = {
    "Create or restore a family wallet before requesting qualification": { code: "QUALIFICATION_WALLET_REQUIRED", message: "Create or restore the matching family wallet first." },
    "Source qualification is unavailable or revoked": { code: "QUALIFICATION_SOURCE_REVOKED", message: "This source qualification is unavailable or revoked. Ask its controller for a new qualification." },
    "This qualification was revoked before confirmation": { code: "QUALIFICATION_SOURCE_REVOKED", message: "This qualification was revoked before confirmation. Request a new qualification." },
    "The connected wallet cannot issue this qualification source": { code: "QUALIFICATION_CONTROLLER_REQUIRED", message: "Connect the endorser or authorized parent manager for this source." },
    "This wallet has no matching qualification request": { code: "QUALIFICATION_REQUEST_MISMATCH", message: "Restore the receiving wallet backup that created this request." },
    "Import both authenticated source qualifications before issuing": { code: "QUALIFICATION_SOURCE_NOT_READY", message: "Import the fact and trusted recommendation packages before issuing." },
    "This qualification is already issued; create a new request to reissue": { code: "QUALIFICATION_ALREADY_ISSUED", message: "This request is already issued. Create a new request to renew it." },
    "Create a new request to replace an existing source qualification": { code: "QUALIFICATION_REQUEST_MISMATCH", message: "This request already has a different source. Create a new request for replacement." },
    "Confirm the source transaction before handing it over": { code: "QUALIFICATION_CONFIRMATION_REQUIRED", message: "Confirm the source transaction before exporting its encrypted package." },
    "Qualification operation cancelled": { code: "QUALIFICATION_CANCELLED", message: "Qualification operation cancelled. Restore the latest backup before continuing." },
    "These source roles have already been revoked": { code: "QUALIFICATION_SOURCE_REVOKED", message: "These source roles have already been revoked." },
    "This source is already published; restore its confirmation before handing it over": { code: "QUALIFICATION_CONFIRMATION_REQUIRED", message: "This source is already published. Restore its on-chain confirmation to export the encrypted package." },
    "This qualification is already registered; restore its confirmation": { code: "QUALIFICATION_CONFIRMATION_REQUIRED", message: "This qualification is already registered. Restore its on-chain confirmation to install it." },
    "This source transaction has not been confirmed on chain": { code: "QUALIFICATION_NOT_CONFIRMED", message: "This source transaction is not confirmed yet. Wait for confirmation and try again." },
    "This qualification transaction has not been confirmed on chain": { code: "QUALIFICATION_NOT_CONFIRMED", message: "This qualification transaction is not confirmed yet. Wait for confirmation and try again." },
    "An active registered endorsement is required": { code: "QUALIFICATION_ENDORSEMENT_REQUIRED", message: "This subject needs a current endorsement from the selected endorser before a fact can be issued." },
    "An active registered trusted recommendation is required": { code: "QUALIFICATION_TRUST_REQUIRED", message: "Add the selected endorser as a trusted recommendation for this parent version first." },
    "The selected parent version has no trusted recommendation": { code: "QUALIFICATION_TRUST_REQUIRED", message: "This parent version has no trusted recommendation for the selected endorser." },
    "The selected family is not a parent of the endorsed subject": { code: "QUALIFICATION_PARENT_MISMATCH", message: "Select a parent of the endorsed subject." },
    "Qualification transaction is not successfully confirmed": { code: "QUALIFICATION_NOT_CONFIRMED", message: "This transaction is not successfully confirmed yet. Check the transaction and try again." },
    "Qualification request belongs to another chain or registry": { code: "QUALIFICATION_REQUEST_MISMATCH", message: "This request belongs to another chain or registry. Switch to its deployment or create a new request." },
    "Qualification request belongs to another source deployment": { code: "QUALIFICATION_REQUEST_MISMATCH", message: "This request belongs to another source deployment. Create a new request for the current deployment." },
  };
  if (error instanceof Error && safe[error.message]) return safe[error.message];
  if (error && typeof error === "object" && "code" in error && error.code === "NETWORK_ERROR")
    return { code: "QUALIFICATION_NETWORK_ERROR", message: "Chain state is unavailable. Reconnect and refresh before continuing." };
  return { message: "Receive proof operation failed" };
}

/** Explicit public-result whitelist; never post notes, credentials, private witness or recovery keys. */
export function publicWorkerResult(method: ReceiveWorkerMethod, value: unknown): unknown {
  const result = value as Record<string, unknown>;
  const fields: Record<ReceiveWorkerMethod, readonly string[]> = {
    walletCreate: ["state", "backup"], walletRestore: ["state"], walletBackup: ["state", "backup"], walletLock: ["state"],
    walletCreateCode: ["state", "code", "backup"], walletRecover: ["state", "notes", "letters"], walletCreateRule: ["rule"],
    walletReadQualifications: ["qualifications"],
    walletCreateQualificationRequest: ["request", "requestId", "state", "backup"],
    walletReadQualificationManagement: ["requests", "sources", "canRequest"],
    walletPrepareSourcePublication: ["draftId", "kind", "proof", "publicSignals", "state", "backup"],
    walletConfirmSourcePublication: ["state", "backup", "package"],
    walletImportSourcePackage: ["requestId", "state", "backup"],
    walletPrepareQualificationIssue: ["requestId", "proof", "publicSignals", "state", "backup"],
    walletConfirmQualificationIssue: ["state", "backup"],
    walletPrepareRoleRevocation: ["roles", "secrets", "mutation"],
    walletExportSourcePackage: ["package"],
    walletPrepareShield: ["amount", "inputShardIds", "inputRoots", "inputNullifiers", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicSignals", "proof"],
    walletPrepareUnshield: ["amount", "recipient", "inputShardIds", "inputRoots", "inputNullifiers", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicSignals", "proof"],
    walletPrepareDeposit: ["kind", "code", "capabilityIndex", "policyCommitment", "budgetKey", "eligibleFrom", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof", "inputShardId"],
    walletPrepareClaim: ["periodNullifier", "inputNullifier", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof", "inputShardId"],
    walletPrepareTransfer: ["code", "inputNullifier", "outputCommitments", "ciphertextHashes", "outputCiphertexts", "publicInput", "publicSignals", "proof", "inputShardId"],
    walletPrepareLetter: ["code", "messageId", "ciphertext"],
    createCode: ["code"],
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
  if (cleaned.state) cleaned.state = pick(cleaned.state as Record<string, unknown>, ["unlocked", "codeCount", "credentialCount", "backupChanged"]);
  if (Array.isArray(cleaned.requests)) cleaned.requests = cleaned.requests.map(item => pick(item,
    ["id", "request", "childPersonHash", "parentPersonHash", "parentVersion", "endorser", "hasFact", "hasTrust", "issued"]));
  if (Array.isArray(cleaned.sources)) cleaned.sources = cleaned.sources.map(item => pick(item,
    ["id", "kind", "requestId", "request", "childPersonHash", "parentPersonHash", "parentVersion", "endorser", "controller", "published", "revoked"]));
  if (cleaned.mutation) {
    const mutation = cleaned.mutation as Record<string, unknown>;
    cleaned.mutation = pick(mutation, mutation.kind === "cancelEndorsement" ? ["kind", "childIdentity"]
      : ["kind", "parentIdentity", "parentVersion", "endorser"]);
  }
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
