import { computeIdentityHash } from "../shared/crypto/identityHash";
import type { IdentityHashInput } from "../shared/crypto/identityHash";
import {
  decryptMetadataPayload,
  decryptMetadataPayloadV2,
  encryptMetadataJsonV2,
  passwordFingerprint,
  type EncryptedMetadataPayloadV2,
} from "../shared/crypto/metadataCrypto";
import { generateMetadataCID } from "../shared/ipfs/cid";
import {
  deriveKeyFromPersonData,
  type KeyPurpose,
  type KDFPreset,
} from "../shared/crypto/secureKeyDerivation";
import {
  deriveIdentitySecret,
  hexToBytes,
  type DerivedSecretBundle,
  type FileEncryptionKdfConfig,
  type IdentityKdfConfig,
} from "../shared/crypto/secretDerivation";

type CryptoWorkerMethods = {
  computeIdentityHash: {
    params: { input: IdentityHashInput };
    result: { identityHash: string };
  };
  passwordFingerprint: {
    params: { password: string };
    result: { passwordFingerprint: string };
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
  deriveIdentitySecret: {
    params: { passphrase: string; saltHex?: string; config?: IdentityKdfConfig };
    result: DerivedSecretBundle;
  };
  encryptMetadataBundleV2: {
    params: {
      plaintextJson: string;
      password: string;
      aad?: string;
      schema?: string;
      version?: string;
      fileKdfConfig?: FileEncryptionKdfConfig;
    };
    result: {
      encryptedJson: string;
      cid: string;
      plainHash: string;
      passwordFingerprint: string;
      payload: EncryptedMetadataPayloadV2;
    };
  };
  decryptMetadataBundleV2: {
    params: { payloadOrJson: string; password: string };
    result: { plaintext: string; data: any; hash: string; payload: EncryptedMetadataPayloadV2 };
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
    return { identityHash: await computeIdentityHash(input) };
  },
  passwordFingerprint: async ({ password }) => {
    return { passwordFingerprint: passwordFingerprint(password) };
  },
  deriveKey: async ({ input, purpose, preset }) => {
    return await deriveKeyFromPersonData(input, purpose ?? "PRIVATE_KEY", preset ?? "BALANCED");
  },
  deriveIdentitySecret: async ({ passphrase, saltHex, config }) => {
    return await deriveIdentitySecret({
      passphrase,
      salt: saltHex ? hexToBytes(saltHex) : undefined,
      config,
    });
  },
  encryptMetadataBundleV2: async ({ plaintextJson, password, aad, schema, version, fileKdfConfig }) => {
    const { payload, plainHash } = await encryptMetadataJsonV2(plaintextJson, password, {
      aad,
      schema,
      version,
      fileKdfConfig,
    });
    const encryptedJson = JSON.stringify(payload);
    const cid = await generateMetadataCID(encryptedJson);
    return {
      encryptedJson,
      cid,
      plainHash,
      passwordFingerprint: passwordFingerprint(password),
      payload,
    };
  },
  decryptMetadataBundleV2: async ({ payloadOrJson, password }) => {
    const { plaintext, data, hash, payload } = await decryptMetadataPayloadV2(payloadOrJson, password);
    return { plaintext, data, hash, payload };
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
