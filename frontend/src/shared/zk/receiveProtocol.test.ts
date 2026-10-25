import { createHash } from "node:crypto";
import { getBytes, toBeHex } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeFamilyTag, computeRoleTag, buildCapabilityPublicSignals, computeCapabilityBinding,
  computeReceiveAuthorization, decodeReceiveCode, computeIdentityFromDerivedSecret, createSourceFact,
  createSourceTrust, prepareEligibilityIssue } from "@deepfamily/protocol-core";
import { ReceiveChain } from "../clients/receiveChain";
import { ReceiveService, createProtocolProofProvider, createReceiveService,
  type ProtocolProofProvider, type PinnedManifest } from "./receiveProtocol";
const backend = vi.hoisted(() => ({ fullProve: vi.fn(), verify: vi.fn() }));
vi.mock("snarkjs", () => ({ groth16: backend }));
const proof = { pi_a: ["1", "2", "1"], pi_b: [["3", "4"], ["5", "6"], ["1", "0"]], pi_c: ["7", "8", "1"] };
const deployment = { chainId: 31337n, registryAddress: "0x0000000000000000000000000000000000001234",
  poolAddress: "0x0000000000000000000000000000000000004321" };
const chain = { deployment } as unknown as ReceiveChain;
const params = { masterKey: new Uint8Array(32).fill(37), chainId: deployment.chainId,
  authorizerScope: deployment.registryAddress, codeIndex: 7n, codeRootSecret: 23n, expiresAt: 2_000_000_000n };
function prover(): ProtocolProofProvider {
  return { verify: async () => true, async prove(circuit, witness) {
    const viewingKey = getBytes(toBeHex((witness.viewKeyHi as bigint) << 128n | witness.viewKeyLo as bigint, 32));
    const common = computeReceiveAuthorization({ ...(witness as Record<string, bigint>),
      chainId: witness.chainId as bigint, authorizerScope: witness.authorizerScope as bigint,
      nonce: witness.nonce as bigint, ownerSecret: witness.ownerSecret as bigint, codeSecret: witness.codeSecret as bigint,
      expiresAt: witness.expiresAt as bigint, codeRootSecret: (witness.codeRootSecret ?? witness.derivedSecretField) as bigint, viewingKey });
    if (circuit === "code") return { proof, publicSignals: common.publicSignals };
    const cap = { issuanceRoot: witness.issuanceRoot as bigint, parentVersion: witness.parentVersion as bigint,
      familyTag: computeFamilyTag({ familyCommitment: witness.familyRoot as bigint, nonce: common.nonce }),
      childTag: computeRoleTag({ role: "child", roleSecret: witness.xChild as bigint, nonce: common.nonce }),
      endorsementTag: computeRoleTag({ role: "endorsement", roleSecret: witness.xEndorse as bigint, nonce: common.nonce }),
      trustedTag: computeRoleTag({ role: "trusted", roleSecret: witness.xTrust as bigint, nonce: common.nonce }) };
    return { proof, publicSignals: buildCapabilityPublicSignals(common, { ...cap, capabilityBinding: computeCapabilityBinding(common, cap) }) };
  } };
}
function artifacts(count = 10) {
  const bytes = { wasm: Uint8Array.of(1, 2), zkey: Uint8Array.of(3, 4),
    vkey: new TextEncoder().encode(JSON.stringify({ protocol: "groth16", curve: "bn128", nPublic: count })) };
  const pin = (name: keyof typeof bytes) => ({ url: `/zk/protocol/${name}`, sha256: createHash("sha256").update(bytes[name]).digest("hex") });
  const manifest: PinnedManifest = { version: 1, chainId: "31337", registryAddress: deployment.registryAddress,
    circuits: { code: { circuit: "receive_code", wasm: pin("wasm"), zkey: pin("zkey"), vkey: pin("vkey") } } };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true,
    arrayBuffer: async () => bytes[url.slice(url.lastIndexOf("/") + 1) as keyof typeof bytes].slice().buffer })));
  return { bytes, manifest };
}

describe("explicit receiving receive service", () => {
  beforeEach(() => { backend.verify.mockReset().mockResolvedValue(true); backend.fullProve.mockReset().mockResolvedValue({ proof, publicSignals: Array(10).fill("1") }); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("generates one generic code without credentials and binds multiple optional credentials to the same code", async () => {
    const provider = prover();
    const service = new ReceiveService(chain, provider);
    const generic = await service.createCode(params);
    expect(Object.keys(generic)).toEqual(["code"]);
    expect(decodeReceiveCode(generic.code).capabilities).toHaveLength(0);
    const credential = { issuanceRoot: 997n, parentVersion: 1n, issueNonce: 11n, familyRoot: 101n,
      endorser: 13n, xChild: 17n, xEndorse: 19n, xTrust: 23n, credentialSalt: 29n,
      credentialDepth: 0n, credentialIndex: 0n, credentialSiblings: [] };
    const prove = vi.spyOn(provider, "prove");
    const restoredCredential = { ...credential, credentialCommitment: 123n };
    const qualified = await service.createCode({ ...params, credentials: [restoredCredential, { ...credential, familyRoot: 107n, issueNonce: 31n }] });
    const decoded = decodeReceiveCode(qualified.code);
    expect(decoded.capabilities).toHaveLength(2);
    expect(decoded.codeAlias).toBe(decodeReceiveCode(generic.code).codeAlias);
    expect(decoded.capabilities[0].familyTag).not.toBe(decoded.capabilities[1].familyTag);
    expect(decoded.capabilities.every(cap => cap.publicSignals[8] === decoded.commonBinding)).toBe(true);
    for (const [circuit, witness] of prove.mock.calls) if (circuit === "capability") expect(witness).not.toHaveProperty("credentialCommitment");
    await expect(service.createCode({ ...params, codeRootSecret: undefined, credentials: [credential] })).rejects.toThrow(/canonical identity/);
    expect(Object.prototype.hasOwnProperty.call(decoded, "codeIndex")).toBe(false);
  });
  it("rejects a prover statement that binds other receiving material and a code from another registry", async () => {
    const base = prover();
    const wrong: ProtocolProofProvider = { ...base, prove: async (...args) => {
      const result = await base.prove(...args);
      return { ...result, publicSignals: result.publicSignals.map((v, i) => i === 0 ? BigInt(v) + 1n : v) };
    } };
    await expect(new ReceiveService(chain, wrong).createCode(params)).rejects.toThrow(/different statement/);
    const code = (await new ReceiveService(chain, base).createCode(params)).code;
    const elsewhere = { deployment: { ...deployment, registryAddress: "0x0000000000000000000000000000000000001235" } } as unknown as ReceiveChain;
    await expect(new ReceiveService(elsewhere, base).verifyCode(code)).rejects.toThrow(/another registry/);
  });
  it("hash-checks all local artifacts, verifies using the pinned key and caches only accepted bytes", async () => {
    const { manifest } = artifacts();
    const provider = createProtocolProofProvider(manifest);
    const result = await provider.prove("code", {});
    expect(result.publicSignals).toHaveLength(10);
    expect(backend.fullProve).toHaveBeenCalledOnce();
    expect(backend.verify).toHaveBeenCalledOnce();
    await provider.verify("code", proof, Array(10).fill(1n));
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(provider.prove("fund", {})).rejects.toThrow(/unavailable/);
  });
  it("rejects replaced same-origin files, incompatible verification keys and invalid proofs", async () => {
    const { bytes, manifest } = artifacts();
    bytes.wasm[0] ^= 1;
    await expect(createProtocolProofProvider(manifest).prove("code", {})).rejects.toThrow(/digest mismatch/);
    expect(backend.fullProve).not.toHaveBeenCalled();
    const incompatible = artifacts(11);
    await expect(createProtocolProofProvider(incompatible.manifest).verify("code", proof, Array(10).fill(1n))).rejects.toThrow(/ABI mismatch/);
    const valid = artifacts();
    backend.verify.mockResolvedValue(false);
    await expect(createProtocolProofProvider(valid.manifest).prove("code", {})).rejects.toThrow(/Invalid receiving/);
  });
  it("issues only against current authenticated source roots and returns no private credential opening", async () => {
    const identity = { fullName: " subject", isBirthBC: false, birthYear: 2010, birthMonth: 5, birthDay: 17, gender: 1 };
    const common = { chainId: 31337n, authorizerScope: BigInt(deployment.registryAddress),
      parentIdentity: 41n, parentVersion: 1n, endorser: 43n, familySalt: 47n, xChild: 53n, xEndorse: 59n,
      xTrust: 61n, sourceFactSalt: 67n, sourceTrustSalt: 71n, issueNonce: 73n, credentialSalt: 79n };
    const child = computeIdentityFromDerivedSecret({ identity, identitySuiteId: 1, derivedSecretField: 23n });
    const fact = createSourceFact({ ...common, childIdentity: child.identityCommitment });
    const trusted = createSourceTrust(common);
    const input = { ...common, identity, identitySuiteId: 1, derivedSecretField: 23n,
      sourcePath: { root: fact.factLeaf, depth: 0n, index: 0n, siblings: [] },
      trustedPath: { root: trusted.trustLeaf, depth: 0n, index: 0n, siblings: [] } };
    const expected = prepareEligibilityIssue(input);
    const sourceChain = { deployment, readSourceRoots: async () => ({ sourceRoot: fact.factLeaf, trustedRoot: trusted.trustLeaf }) } as unknown as ReceiveChain;
    const provider: ProtocolProofProvider = { verify: async () => true, prove: vi.fn(async () => ({ proof, publicSignals: expected.publicSignals })) };
    const service = new ReceiveService(sourceChain, provider);
    const result = await service.proveIssue(input);
    expect(Object.keys(result)).toEqual(["proof", "publicSignals"]);
    expect(result.publicSignals).toEqual(expected.publicSignals);
    await expect(service.proveIssue({ ...input, issueNonce: undefined })).rejects.toThrow(/Persist private/);
    const changed = { deployment, readSourceRoots: async () => ({ sourceRoot: 1n, trustedRoot: trusted.trustLeaf }) } as unknown as ReceiveChain;
    await expect(new ReceiveService(changed, provider).proveIssue(input)).rejects.toThrow(/no longer current/);
  });
  it("requires the trusted manifest to name the configured chain and registry", () => {
    const { manifest } = artifacts();
    expect(() => createReceiveService(chain, { ...manifest, chainId: "1" })).toThrow(/deployment/);
    expect(() => createProtocolProofProvider({ ...manifest, version: 0 } as unknown as PinnedManifest)).toThrow(/artifact configuration/);
  });
  it("rejects unsupported letter fields before producing an unreadable archived message", async () => {
    const service = new ReceiveService(chain, prover());
    await expect(service.prepareLetter({ code: "unused", asOf: 1n, messageId: 1n, body: "hello",
      attachment: { chainId: 31337n, poolAddress: deployment.poolAddress, budgetCommitment: 1n },
    } as unknown as Parameters<ReceiveService["prepareLetter"]>[0])).rejects.toThrow("Unsupported letter field");
  });
});
