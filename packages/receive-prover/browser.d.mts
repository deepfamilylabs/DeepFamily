export interface ReceiveProofResult {
  solidityProof: string;
  nativeProof: string;
  publicSignals: string[];
  verified: boolean;
  proveMillis: number;
  verifyMillis: number;
}
export interface ReceiveProverOptions {
  artifactBaseUrl: string;
  wasmUrl?: string;
  workerUrl?: string | URL;
  allowDevelopmentArtifacts?: boolean;
  expectedKind?: "anonymous" | "fund" | "attachment";
  expectedIssuerVkSha256?: string;
  expectedManifestSha256?: string;
  assetHost?: { baseUrl: string; digests: Readonly<Record<string, string>> };
  onProgress?: (progress: { phase: string; kind?: string }) => void;
}
export function prove(request: { kind: "anonymous" | "fund" | "attachment"; [key: string]: unknown }, options?: Partial<ReceiveProverOptions> & { artifactRoot?: string }): Promise<{ proof: string; publicSignals: string[] }>;
export const RECEIVE_CIRCUIT_VERSION: string;
export function createReceiveProver(options: ReceiveProverOptions): {
  ready: Promise<{ kind: string; publicSignals: number }>;
  prove(request: unknown): Promise<ReceiveProofResult>;
  terminate(): void;
};
export function loadReceiveProver(options: ReceiveProverOptions): Promise<{
  manifest: { kind: string; publicSignals: number };
  prove(request: unknown): Promise<ReceiveProofResult>;
}>;
