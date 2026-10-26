import {
  SNARK_SCALAR_FIELD,
  RECEIVE_MAX_CAPABILITIES,
  computeFamilyTag,
  computeRoleStatusIndex,
  buildCapabilityPublicSignals,
  buildReceivePublicSignals,
  computeCapabilityBinding,
  computeReceiveAuthorization,
  deriveReceiveKeyMaterial,
  encodeReceiveCode,
  verifyReceiveCode,
  prepareBudgetDeposit,
  prepareBudgetClaim,
  prepareTransfer,
  createShieldedLetterEnvelope,
  encryptShieldedLetter,
  prepareEligibilityIssue,
  type ProtocolInteger,
  type ProtocolProof,
  type PoolScope,
  type ReceiveCode,
  type LocalProver,
} from "@deepfamily/protocol-core";
import { getBigInt } from "ethers";
// @ts-ignore snarkjs does not publish complete browser typings.
import * as snarkjs from "snarkjs";
import { ReceiveChain } from "../clients/receiveChain";
import { fetchPinnedZkAsset } from "./zkAssets";

export const PROTOCOL_CIRCUITS = Object.freeze({
  shield: { name: "shielded_shield", count: 7 },
  unshield: { name: "shielded_unshield", count: 11 },
  unshield4: { name: "shielded_unshield_4", count: 20 },
  sourceFact: { name: "eligibility_source_fact", count: 10 },
  sourceTrust: { name: "eligibility_source_trust", count: 8 },
  issue: { name: "eligibility_issue", count: 5 },
  code: { name: "receive_code", count: 10 },
  capability: { name: "budget_capability", count: 10 },
  fund: { name: "budget_deposit", count: 20 },
  claim: { name: "budget_claim", count: 23 },
  transfer: { name: "value_transfer", count: 12 },
});
export type Circuit = keyof typeof PROTOCOL_CIRCUITS;
export interface PinnedArtifact {
  readonly url: string;
  readonly sha256: string;
}
/** Passed by trusted deployment configuration. Never consume a manifest or verification key from a receive code. */
export interface PinnedManifest {
  readonly version: 1;
  readonly chainId: string;
  readonly registryAddress: string;
  readonly circuits: Readonly<
    Partial<
      Record<
        Circuit,
        {
          readonly circuit: string;
          readonly wasm: PinnedArtifact;
          readonly zkey: PinnedArtifact;
          readonly vkey: PinnedArtifact;
        }
      >
    >
  >;
}
export interface ProtocolProofProvider {
  prove: (
    circuit: Circuit,
    witness: Record<string, bigint | bigint[] | bigint[][]>,
  ) => ReturnType<LocalProver>;
  verify: (
    circuit: Circuit,
    proof: ProtocolProof,
    publicSignals: readonly ProtocolInteger[],
  ) => Promise<boolean>;
}
const publicSignalsOf = (circuit: Circuit, values: readonly ProtocolInteger[]) => {
  if (values.length !== PROTOCOL_CIRCUITS[circuit].count)
    throw new Error(`Invalid receiving ${circuit} public signal count`);
  return values.map((value) => {
    const parsed = getBigInt(value);
    if (parsed < 0n || parsed >= SNARK_SCALAR_FIELD)
      throw new Error("Noncanonical receiving public signal");
    return parsed;
  });
};
function assertSignals(
  circuit: Circuit,
  actual: readonly ProtocolInteger[],
  expected: readonly ProtocolInteger[],
) {
  const parsed = publicSignalsOf(circuit, actual),
    wanted = publicSignalsOf(circuit, expected);
  if (parsed.some((value, i) => value !== wanted[i]))
    throw new Error(` ${circuit} proof returned a different statement`);
}

/** Hash-check every artifact, including local files and verification keys, before invoking snarkjs. */
export function createProtocolProofProvider(manifest: PinnedManifest): ProtocolProofProvider {
  if (manifest.version !== 1)
    throw new Error("Receive protocol artifact configuration is required");
  // Snapshot the trusted pins so later mutation cannot replace the accepted circuit.
  const entries = Object.fromEntries(
    Object.entries(manifest.circuits).map(([key, entry]) => [
      key,
      entry
        ? {
            circuit: entry.circuit,
            wasm: { ...entry.wasm },
            zkey: { ...entry.zkey },
            vkey: { ...entry.vkey },
          }
        : undefined,
    ]),
  );
  const assets = new Map<string, Promise<Uint8Array>>();
  const keys = new Map<Circuit, Promise<unknown>>();
  function configured(circuit: Circuit) {
    const entry = entries[circuit];
    if (!entry || entry.circuit !== PROTOCOL_CIRCUITS[circuit].name)
      throw new Error(`Pinned receiving ${circuit} artifacts are unavailable`);
    return entry;
  }
  async function artifact(pin: PinnedArtifact, proving = false) {
    if (!/^[0-9a-f]{64}$/iu.test(pin.sha256))
      throw new Error("Missing pinned receiving artifact digest");
    const cacheKey = `${proving ? "proving" : "verification"}:${pin.url}:${pin.sha256}`;
    const existing = assets.get(cacheKey);
    if (existing) return existing;
    const pending = (async () => {
      if (proving) return fetchPinnedZkAsset(pin);
      const response = await fetch(pin.url, { cache: "no-cache", credentials: "same-origin" });
      if (!response.ok) throw new Error(`Receive artifact unavailable: ${pin.url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (actual !== pin.sha256.toLowerCase())
        throw new Error(`Receive artifact digest mismatch: ${pin.url}`);
      return bytes;
    })().catch((error) => {
      assets.delete(cacheKey);
      throw error;
    });
    assets.set(cacheKey, pending);
    return pending;
  }
  function verificationKey(circuit: Circuit) {
    const existing = keys.get(circuit);
    if (existing) return existing;
    const pending = artifact(configured(circuit).vkey)
      .then((bytes) => {
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (
          parsed.protocol !== "groth16" ||
          parsed.curve !== "bn128" ||
          parsed.nPublic !== PROTOCOL_CIRCUITS[circuit].count
        )
          throw new Error("Receive verification key ABI mismatch");
        return parsed;
      })
      .catch((error) => {
        keys.delete(circuit);
        throw error;
      });
    keys.set(circuit, pending);
    return pending;
  }
  return {
    async prove(circuit, witness) {
      const entry = configured(circuit);
      const [wasm, zkey, vkey] = await Promise.all([
        artifact(entry.wasm, true),
        artifact(entry.zkey, true),
        verificationKey(circuit),
      ]);
      const result = await snarkjs.groth16.fullProve(witness, wasm, zkey);
      const publicSignals = publicSignalsOf(circuit, result.publicSignals);
      if (!(await snarkjs.groth16.verify(vkey, publicSignals.map(String), result.proof)))
        throw new Error(`Invalid receiving ${circuit} proof`);
      return { proof: result.proof as ProtocolProof, publicSignals };
    },
    async verify(circuit, proof, values) {
      const signals = publicSignalsOf(circuit, values);
      return (
        (await snarkjs.groth16.verify(
          await verificationKey(circuit),
          signals.map(String),
          proof,
        )) === true
      );
    },
  };
}

export interface CredentialWitness {
  issuanceRoot: ProtocolInteger;
  parentVersion: ProtocolInteger;
  issueNonce: ProtocolInteger;
  familyRoot: ProtocolInteger;
  endorser: ProtocolInteger;
  xChild: ProtocolInteger;
  xEndorse: ProtocolInteger;
  xTrust: ProtocolInteger;
  credentialSalt: ProtocolInteger;
  credentialDepth: ProtocolInteger;
  credentialIndex: ProtocolInteger;
  credentialSiblings: readonly ProtocolInteger[];
}

/** The service runs inside the wallet's ZK worker; private code indices and credentials stay there. */
export class ReceiveService {
  readonly scope: PoolScope;
  constructor(
    readonly chain: ReceiveChain,
    private readonly proofs: ProtocolProofProvider,
  ) {
    this.scope = { chainId: chain.deployment.chainId, poolAddress: chain.deployment.poolAddress };
  }
  async createCode(
    input: Parameters<typeof deriveReceiveKeyMaterial>[0] & {
      expiresAt: ProtocolInteger;
      credentials?: readonly CredentialWitness[];
    },
  ): Promise<{ code: string }> {
    if (
      getBigInt(input.chainId) !== this.chain.deployment.chainId ||
      getBigInt(input.authorizerScope) !== BigInt(this.chain.deployment.registryAddress)
    )
      throw new Error("Receive key scope does not match deployment");
    if ((input.credentials?.length ?? 0) > RECEIVE_MAX_CAPABILITIES)
      throw new Error("Too many receiving budget capabilities");
    if (input.credentials?.length && input.codeRootSecret === undefined)
      throw new Error("Qualified receive codes require the canonical identity secret");
    const key = await deriveReceiveKeyMaterial(input);
    const common = computeReceiveAuthorization({ ...key, expiresAt: input.expiresAt });
    const commonWitness = {
      chainId: key.chainId,
      authorizerScope: key.authorizerScope,
      nonce: key.nonce,
      ownerCommitment: key.ownerCommitment,
      viewKeyLo: key.viewKeyLo,
      viewKeyHi: key.viewKeyHi,
      expiresAt: getBigInt(input.expiresAt),
      codeSecret: key.codeSecret,
      ownerSecret: key.ownerSecret,
    };
    const generic = await this.proofs.prove("code", {
      ...commonWitness,
      codeRootSecret: key.codeRootSecret,
    });
    assertSignals("code", generic.publicSignals, buildReceivePublicSignals(common));
    const capabilities = [];
    for (const credential of input.credentials ?? []) {
      const cap = {
        issuanceRoot: getBigInt(credential.issuanceRoot),
        parentVersion: getBigInt(credential.parentVersion),
        familyTag: computeFamilyTag({ familyCommitment: credential.familyRoot, nonce: key.nonce }),
        childRoleIndex: computeRoleStatusIndex({ role: "child", roleSecret: credential.xChild }),
        endorsementRoleIndex: computeRoleStatusIndex({
          role: "endorsement",
          roleSecret: credential.xEndorse,
        }),
        trustedRoleIndex: computeRoleStatusIndex({
          role: "trusted",
          roleSecret: credential.xTrust,
        }),
      };
      const capabilityBinding = computeCapabilityBinding(common, cap);
      const credentialFields = [
        "issuanceRoot",
        "parentVersion",
        "issueNonce",
        "familyRoot",
        "endorser",
        "xChild",
        "xEndorse",
        "xTrust",
        "credentialSalt",
        "credentialDepth",
        "credentialIndex",
        "credentialSiblings",
      ] as const;
      const witness = Object.fromEntries(
        credentialFields.map((name) => {
          const value = credential[name];
          return [
            name,
            Array.isArray(value)
              ? value.map((item) => getBigInt(item))
              : getBigInt(value as ProtocolInteger),
          ];
        }),
      ) as Record<string, bigint | bigint[]>;
      const siblings = witness.credentialSiblings as bigint[];
      if (!Array.isArray(siblings) || siblings.length > 32)
        throw new Error("Invalid receiving credential path");
      while (siblings.length < 32) siblings.push(0n);
      const proved = await this.proofs.prove("capability", {
        ...witness,
        ...commonWitness,
        commonBinding: common.commonBinding,
        derivedSecretField: key.codeRootSecret,
      });
      assertSignals(
        "capability",
        proved.publicSignals,
        buildCapabilityPublicSignals(common, { ...cap, capabilityBinding }),
      );
      capabilities.push({ ...cap, capabilityBinding, proof: proved.proof });
    }
    return { code: encodeReceiveCode({ ...common, proof: generic.proof, capabilities }) };
  }
  async proveIssue(input: Parameters<typeof prepareEligibilityIssue>[0]) {
    if (
      getBigInt(input.chainId) !== this.chain.deployment.chainId ||
      getBigInt(input.authorizerScope) !== BigInt(this.chain.deployment.registryAddress)
    )
      throw new Error("Receive issuance scope does not match deployment");
    if (input.issueNonce === undefined || input.credentialSalt === undefined)
      throw new Error(
        "Persist private credential nonces before issuing an receiving qualification",
      );
    const prepared = prepareEligibilityIssue({
      ...input,
      chainId: this.chain.deployment.chainId,
      authorizerScope: BigInt(this.chain.deployment.registryAddress),
      endorser: getBigInt(input.endorser),
      identitySuiteId: input.identitySuiteId ?? 1,
    });
    const roots = await this.chain.readSourceRoots();
    if (
      prepared.publicSignals[3] !== roots.sourceRoot ||
      prepared.publicSignals[4] !== roots.trustedRoot
    )
      throw new Error("Receive source path is no longer current");
    const result = await this.proofs.prove("issue", prepared.witness);
    assertSignals("issue", result.publicSignals, prepared.publicSignals);
    return { proof: result.proof, publicSignals: result.publicSignals };
  }
  async verifyCode(code: string, asOf?: ProtocolInteger): Promise<ReceiveCode> {
    return verifyReceiveCode({
      code,
      chainId: this.chain.deployment.chainId,
      authorizerScope: BigInt(this.chain.deployment.registryAddress),
      asOf,
      verifyAuthorization: (proof, signals) => this.proofs.verify("code", proof, signals),
      verifyCapability: (proof, signals) => this.proofs.verify("capability", proof, signals),
    });
  }
  async prepareDeposit(
    input: Omit<
      Parameters<typeof prepareBudgetDeposit>[0],
      | "authorizerScope"
      | "readBudgetRecord"
      | "verifyAuthorization"
      | "verifyCapability"
      | "checkEligibility"
      | "proveFund"
      | "verifyFund"
    >,
  ) {
    return prepareBudgetDeposit(
      {
        ...input,
        authorizerScope: BigInt(this.chain.deployment.registryAddress),
        readBudgetRecord: (key) => this.chain.readBudgetRecord(key),
        checkEligibility: (code, cap) => this.chain.checkEligibility(code, cap),
        verifyAuthorization: (proof, signals) => this.proofs.verify("code", proof, signals),
        verifyCapability: (proof, signals) => this.proofs.verify("capability", proof, signals),
        proveFund: (witness) => this.proofs.prove("fund", witness),
        verifyFund: (proof, signals) => this.proofs.verify("fund", proof, signals),
      },
      this.scope,
    );
  }
  async prepareClaim(
    input: Omit<
      Parameters<typeof prepareBudgetClaim>[0],
      "authorizerScope" | "checkQualification" | "proveClaim" | "verifyClaim" | "isPeriodSpent"
    >,
  ) {
    return prepareBudgetClaim(
      {
        ...input,
        authorizerScope: BigInt(this.chain.deployment.registryAddress),
        checkQualification: (status) => this.chain.checkClaimQualification(status),
        isPeriodSpent: (nf) => this.chain.isPeriodSpent(nf),
        proveClaim: (witness) => this.proofs.prove("claim", witness),
        verifyClaim: (proof, signals) => this.proofs.verify("claim", proof, signals),
      },
      this.scope,
    );
  }
  async prepareTransfer(
    input: Omit<
      Parameters<typeof prepareTransfer>[0],
      | "authorizerScope"
      | "verifyAuthorization"
      | "verifyCapability"
      | "proveTransfer"
      | "verifyTransfer"
    >,
  ) {
    const code = await this.verifyCode(
      typeof input.code === "string" ? input.code : encodeReceiveCode(input.code),
      input.asOf,
    );
    if (!(await this.chain.checkReceive(code)))
      throw new Error("Receive authorization is no longer valid");
    return prepareTransfer(
      {
        ...input,
        code,
        authorizerScope: BigInt(this.chain.deployment.registryAddress),
        verifyAuthorization: (proof, signals) => this.proofs.verify("code", proof, signals),
        verifyCapability: (proof, signals) => this.proofs.verify("capability", proof, signals),
        proveTransfer: (witness) => this.proofs.prove("transfer", witness),
        verifyTransfer: (proof, signals) => this.proofs.verify("transfer", proof, signals),
      },
      this.scope,
    );
  }
  async prepareLetter(input: {
    code: string;
    asOf: ProtocolInteger;
    messageId: ProtocolInteger;
    body: string;
    salt?: ProtocolInteger;
  }) {
    if (
      Object.keys(input).some((key) => !["code", "asOf", "messageId", "body", "salt"].includes(key))
    )
      throw new Error("Unsupported letter field");
    const code = await this.verifyCode(input.code, input.asOf);
    if (!this.chain.deployment.lettersAddress)
      throw new Error("Receive letters are not configured");
    if (!(await this.chain.checkReceive(code)))
      throw new Error("Receive authorization is no longer valid");
    const envelope = createShieldedLetterEnvelope({
      body: input.body,
      ...(input.salt === undefined ? {} : { salt: input.salt }),
    });
    const ciphertext = await encryptShieldedLetter({
      chainId: code.chainId,
      lettersAddress: this.chain.deployment.lettersAddress,
      messageId: input.messageId,
      recipientPublicKey: code.viewingKey,
      envelope,
    });
    return { code, messageId: getBigInt(input.messageId), ciphertext };
  }
}

export function createReceiveService(chain: ReceiveChain, manifest: PinnedManifest) {
  if (
    getBigInt(manifest.chainId) !== chain.deployment.chainId ||
    getBigInt(manifest.registryAddress) !== BigInt(chain.deployment.registryAddress)
  )
    throw new Error("Pinned receiving artifacts do not match deployment");
  return new ReceiveService(chain, createProtocolProofProvider(manifest));
}
