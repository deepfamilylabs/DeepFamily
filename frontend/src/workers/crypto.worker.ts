import {
  handleCryptoWorkerRequest,
  type CryptoWorkerRequest,
  type CryptoWorkerResponse,
} from "./cryptoWorkerHandlers";

self.addEventListener("message", async (event: MessageEvent<CryptoWorkerRequest>) => {
  await handleCryptoWorkerRequest(event.data, (response: CryptoWorkerResponse) => {
    (self as any).postMessage(response);
  });
});
