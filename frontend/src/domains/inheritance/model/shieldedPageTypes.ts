import type { ReceiveWorkerContext } from "../../../shared/workers/receiveWorkerClient";

/** The verified deployment of the selected asset's pool. */
export interface ShieldedPageModules {
  context: ReceiveWorkerContext;
  assetAddress: string;
  assetSymbol: string;
  /** Null means show integer base units, never guess token precision. */
  tokenDecimals: number | null;
}
