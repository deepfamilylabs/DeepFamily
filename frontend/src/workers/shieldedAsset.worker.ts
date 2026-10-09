import { ShieldedAssetSession, shieldedAssetErrorMessage } from "./shieldedAssetSession";
import { installTrustedWorkerUrlPolicy } from "../shared/workers/trustedWorkerUrls";
import type { ShieldedAssetWorkerCallMap } from "../shared/workers/shieldedAssetWorkerTypes";

installTrustedWorkerUrlPolicy();
const session = new ShieldedAssetSession();
// Serialize mutations: a late KDF/proof cannot race a different unlock or root import.
let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent) => {
  const request = event.data as { id: number; method: keyof ShieldedAssetWorkerCallMap; params: never };
  queue = queue.then(async () => {
    try {
      const result = await session.call(request.method, request.params);
      self.postMessage({ id: request.id, ok: true, result });
    } catch (error) {
      self.postMessage({ id: request.id, ok: false, error: { message: shieldedAssetErrorMessage(error) } });
    } finally {
      request.params = undefined as never;
    }
  });
});
