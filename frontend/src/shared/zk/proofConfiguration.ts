import type { PinnedManifest } from "./receiveProtocol";

// Build configuration comes from the checked circuit export. Scanned codes and
// RPC responses cannot provide or replace the accepted verification keys.
export const configuredProofManifest = Object.values(
  import.meta.glob("../../proof-artifacts.local.json", { eager: true, import: "default" }),
)[0] as PinnedManifest | undefined;
