import { computeIdentityHash } from "../lib/identityHash";
import type { IdentityHashInput } from "../lib/identityHash";
import {
  decryptMetadataPayload,
  encryptMetadataJson,
  passwordFingerprint,
} from "../lib/metadataCrypto";
import { generateMetadataCID } from "../lib/cid";
import {
  deriveKeyFromPersonData,
  type KeyPurpose,
  type KDFPreset,
} from "../lib/secureKeyDerivation";

type CryptoWorkerMethods = {
  computeIdentityHash: {
    params: { input: IdentityHashInput };
    result: { identityHash: string };
  };
  passwordFingerprint: {
    params: { password: string };
    result: { passwordFingerprint: string };
  };
  encryptMetadataBundle: {
    params: { plaintextJson: string; password: string; tag?: string };
    result: { encryptedJson: string; cid: string; plainHash: string; passwordFingerprint: string };
  };
  decryptMetadataBundle: {
    params: { payloadOrJson: string; password: string };
    result: { plaintext: string; data: any; hash: string; payload: any };
  };
  deriveKey: {
    params: { input: IdentityHashInput; purpose?: KeyPurpose; preset?: KDFPreset };
    result: {
      key: string;
      address?: string;
      timestamp: number;
      kdfParams: { N: number; r: number; p: number };
      purpose: string;
    };
  };
};

type CryptoWorkerRequest = {
  id: number;
  method: keyof CryptoWorkerMethods;
  params: any;
};

type CryptoWorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: { message: string; name?: string } };

const getErrorShape = (err: unknown): { message: string; name?: string } => {
  if (err && typeof err === "object") {
    const anyErr = err as any;
    if (typeof anyErr.message === "string")
      return {
        message: anyErr.message,
        name: typeof anyErr.name === "string" ? anyErr.name : undefined,
      };
  }
  return { message: String(err) };
};

const handlers: {
  [K in keyof CryptoWorkerMethods]: (
    params: CryptoWorkerMethods[K]["params"],
  ) => Promise<CryptoWorkerMethods[K]["result"]> | CryptoWorkerMethods[K]["result"];
} = {
  computeIdentityHash: async ({ input }) => {
    return { identityHash: computeIdentityHash(input) };
  },
  passwordFingerprint: async ({ password }) => {
    return { passwordFingerprint: passwordFingerprint(password) };
  },
  encryptMetadataBundle: async ({ plaintextJson, password }) => {
    const { payload, plainHash } = await encryptMetadataJson(plaintextJson, password);
    const encryptedJson = JSON.stringify(payload);
    const cid = await generateMetadataCID(encryptedJson);
    return {
      encryptedJson,
      cid,
      plainHash,
      passwordFingerprint: passwordFingerprint(password),
    };
  },
  decryptMetadataBundle: async ({ payloadOrJson, password }) => {
    const { plaintext, data, hash, payload } = await decryptMetadataPayload(
      payloadOrJson,
      password,
    );
    return { plaintext, data, hash, payload };
  },
  deriveKey: async ({ input, purpose, preset }) => {
    return await deriveKeyFromPersonData(input, purpose ?? "PRIVATE_KEY", preset ?? "BALANCED");
  },
};

self.addEventListener("message", async (event: MessageEvent<CryptoWorkerRequest>) => {
  const { id, method, params } = event.data || ({} as any);
  const post = (resp: CryptoWorkerResponse) => {
    (self as any).postMessage(resp);
  };
  try {
    const handler = (handlers as any)[method];
    if (typeof id !== "number" || !method || typeof handler !== "function") {
      post({ id, ok: false, error: { message: "Invalid crypto worker request" } });
      return;
    }
    const result = await handler(params);
    post({ id, ok: true, result });
  } catch (err) {
    post({ id, ok: false, error: getErrorShape(err) });
  }
});
