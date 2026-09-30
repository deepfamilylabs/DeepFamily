/// <reference types="vite/client" />

/** The receive-code Groth16 verification key, embedded by vite.config.ts at build time. */
declare const __SHIELDED_RECEIVE_CODE_VKEY__: Readonly<Record<string, unknown>>;

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
