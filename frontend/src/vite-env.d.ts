/// <reference types="vite/client" />

/** The receive-code Groth16 verification key, embedded by vite.config.ts at build time. */
declare const __SHIELDED_RECEIVE_CODE_VKEY__: Readonly<Record<string, unknown>>;

/** Origin and path prefix of the R2 proving-file host; empty when served from /zk. */
declare const __ZK_ASSET_BASE_URL__: string;

/** SHA-256 of each proving file by its /zk path, from the circuit manifests. */
declare const __ZK_ASSET_DIGESTS__: Readonly<Record<string, string>>;

declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "*.png" {
  const content: string;
  export default content;
}

declare module "*.jpg" {
  const content: string;
  export default content;
}

declare module "*.jpeg" {
  const content: string;
  export default content;
}

declare module "*.gif" {
  const content: string;
  export default content;
}

declare module "*.webp" {
  const content: string;
  export default content;
}
