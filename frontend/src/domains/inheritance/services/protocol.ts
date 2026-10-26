import { JsonRpcProvider, type Signer } from "ethers";
import { ReceiveChain, type ReceiveDeployment } from "../../../shared/clients/receiveChain";
import { ReceiveWorkerClient, type ReceiveWorkerContext,
  type ReceiveWorkerCalls } from "../../../shared/workers/receiveWorkerClient";
import type { PinnedManifest } from "../../../shared/zk/receiveProtocol";

/** One application entry for the new protocol; codes never select a deployment or verification key. */
export class ReceiveProtocol {
  private readonly worker = new ReceiveWorkerClient();
  private readonly provider: JsonRpcProvider;
  private readonly reader: ReceiveChain;
  private readonly context: ReceiveWorkerContext;
  private transactionEpoch = 0;
  constructor(rpcUrl: string, deployment: ReceiveDeployment, manifest: PinnedManifest) {
    if (BigInt(deployment.chainId) !== BigInt(manifest.chainId) ||
        deployment.registryAddress.toLowerCase() !== manifest.registryAddress.toLowerCase()) {
      throw new Error(" deployment and trusted proof configuration differ");
    }
    this.context = { rpcUrl, deployment: { ...deployment }, manifest: structuredClone(manifest) };
    this.provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
    this.reader = new ReceiveChain(deployment, this.provider);
  }
  createCode(input: ReceiveWorkerCalls["createCode"]["input"]) {
    return this.worker.call("createCode", input, this.context);
  }
  verifyCode(code: string, asOf?: string | bigint) {
    return this.worker.call("verifyCode", { code, asOf }, this.context);
  }
  /** Both first deposit and append use the same action and recheck current eligibility. */
  prepareDeposit(input: ReceiveWorkerCalls["prepareDeposit"]["input"]) {
    return this.worker.call("prepareDeposit", input, this.context);
  }
  prepareClaim(input: ReceiveWorkerCalls["prepareClaim"]["input"]) {
    return this.worker.call("prepareClaim", input, this.context);
  }
  prepareTransfer(input: ReceiveWorkerCalls["prepareTransfer"]["input"]) {
    return this.worker.call("prepareTransfer", input, this.context);
  }
  prepareLetter(input: ReceiveWorkerCalls["prepareLetter"]["input"]) {
    return this.worker.call("prepareLetter", input, this.context);
  }
  proveIssue(input: ReceiveWorkerCalls["proveIssue"]["input"]) {
    return this.worker.call("proveIssue", input, this.context);
  }
  proveSource(input: ReceiveWorkerCalls["proveQualification"]["input"]) {
    return this.worker.call("proveQualification", input, this.context);
  }
  readBudgetRecord(key: bigint) { return this.reader.readBudgetRecord(key); }
  readSourcePaths(factLeafIndex: string | bigint, trustedLeafIndex: string | bigint) {
    return this.reader.readSourcePaths(factLeafIndex, trustedLeafIndex);
  }
  transactions(signer: Signer) {
    const epoch = this.transactionEpoch;
    const assertActive = () => {
      if (this.transactionEpoch !== epoch) throw new Error("Receive transaction preparation cancelled");
    };
    return new ReceiveChain(this.context.deployment, signer, {
      beforeTransaction: assertActive,

    });
  }
  cancel() { ++this.transactionEpoch; this.worker.cancel(); }
  close() { ++this.transactionEpoch; this.worker.close(); this.provider.destroy(); }
}
