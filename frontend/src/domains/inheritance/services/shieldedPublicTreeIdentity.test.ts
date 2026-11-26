import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  asUint8Array,
  bytesToHex,
  computePersonVersionContentCommitment,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  parseCanonicalPersonVersion,
  type MetadataContextInput,
  type PersonVersionMetadata,
} from "@deepfamily/protocol-core";
import { Interface, ZeroAddress, keccak256, type ContractRunner } from "ethers";
import { describe, expect, it, vi } from "vitest";
import DeepFamily from "../../../abi/DeepFamily.json";
import DeepFamilyArchive from "../../../abi/DeepFamilyArchive.json";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import { findPublicTreeIdentityEvidence } from "./shieldedPublicTreeIdentity";

const vector = JSON.parse(
  fs.readFileSync(
    fileURLToPath(
      new URL("../../../../../protocol-vectors/onchain-biography-v1.json", import.meta.url),
    ),
    "utf8",
  ),
);
// The committed vector is a public-tree record: its identity uses the empty passphrase.
const publicMetadata = parseCanonicalPersonVersion(asUint8Array(vector.metadata.canonicalJsonHex));
const publicContext: MetadataContextInput = {
  chainId: BigInt(vector.context.chainId),
  deepFamilyProxy: vector.context.deepFamilyProxy,
  personHash: vector.context.personHash,
  fatherHash: vector.context.fatherHash,
  fatherVersionIndex: BigInt(vector.context.fatherVersionIndex),
  motherHash: vector.context.motherHash,
  motherVersionIndex: BigInt(vector.context.motherVersionIndex),
  versionCommitment: BigInt(vector.context.versionCommitment),
};
const { personHash: _publicHash, ...identity } = publicMetadata.person;
const familyAbi = new Interface(DeepFamily.abi);
const archiveAbi = new Interface(DeepFamilyArchive.abi);
const archiveAddress = "0x9999999999999999999999999999999999999999";
const blockTag = 21;

type ChainVersion = { envelope: Uint8Array; context: MetadataContextInput };

/**
 * Serves the family and Archive reads through the real ABIs, with each version's envelope as a
 * single-segment Archive blob. Every read records its block tag.
 */
function chain(personHash: string, versions: ChainVersion[], options: { failRead?: boolean } = {}) {
  const reads: { name: string; args: unknown[]; blockTag: unknown }[] = [];
  const pointer = (versionIndex: number) => `0x${versionIndex.toString(16).padStart(40, "0")}`;
  const results = (name: string, args: readonly unknown[]): unknown[] => {
    switch (name) {
      case "archive":
        return [archiveAddress];
      case "personVersionsCount":
        return [BigInt(versions.length)];
      case "personVersionAt": {
        const index = Number(args[1]);
        const { context } = versions[index];
        return [
          [
            personHash,
            context.fatherHash,
            context.motherHash,
            BigInt(index + 1),
            context.fatherVersionIndex,
            context.motherVersionIndex,
            context.versionCommitment,
            ZeroAddress,
            0n,
          ],
        ];
      }
      case "metadataRef": {
        const { envelope } = versions[Number(args[1]) - 1];
        return [[keccak256(envelope), pointer(Number(args[1])), envelope.length, 1]];
      }
    }
    throw new Error(`Unexpected read ${name}`);
  };
  const provider = {
    get provider() {
      return provider;
    },
    getCode: vi.fn(async (address: string, at: unknown) => {
      reads.push({ name: "getCode", args: [address], blockTag: at });
      if (options.failRead) throw new Error("RPC unavailable");
      return `0x00${bytesToHex(versions[Number(BigInt(address)) - 1].envelope).slice(2)}`;
    }),
    call: vi.fn(async (tx: { to: string; data: string; blockTag?: unknown }) => {
      const abi = tx.to.toLowerCase() === archiveAddress ? archiveAbi : familyAbi;
      const parsed = abi.parseTransaction({ data: tx.data })!;
      reads.push({ name: parsed.name, args: [...parsed.args], blockTag: tx.blockTag });
      return abi.encodeFunctionResult(parsed.name, results(parsed.name, parsed.args));
    }),
  };
  const family = createDeepFamilyContract(
    publicContext.deepFamilyProxy,
    provider as unknown as ContractRunner,
  );
  return { family, reads };
}

async function protectedRecord(rawPassphrase: string, envelopePassphrase = rawPassphrase) {
  const material = await deriveIdentityMaterial({ identity, rawPassphrase, identitySuiteId: 1 });
  const metadata: PersonVersionMetadata = {
    ...publicMetadata,
    person: { ...publicMetadata.person, personHash: material.personHash },
  };
  const { versionCommitment } = computePersonVersionContentCommitment({
    metadata,
    derivedSecretField: material.derivedSecretField,
  });
  const context = { ...publicContext, personHash: material.personHash, versionCommitment };
  const { envelope } = await encryptPersonVersionEnvelope({
    metadata,
    rawPassphrase: envelopePassphrase,
    identitySuiteId: 1,
    context,
  });
  return { personHash: material.personHash, envelope, context };
}

/** A non-conforming record: empty identity passphrase, but a protected metadata envelope. */
async function disguisedEnvelope() {
  const { envelope } = await encryptPersonVersionEnvelope({
    metadata: publicMetadata,
    rawPassphrase: "metadata only secret",
    identitySuiteId: 1,
    context: publicContext,
  });
  return envelope;
}

const find = (family: ReturnType<typeof chain>["family"], personHash: string) =>
  findPublicTreeIdentityEvidence({
    family,
    chainId: BigInt(vector.context.chainId),
    personHash,
    blockTag,
  });

describe("public-tree recipient identities", () => {
  it("detects an identity whose own envelope opens with the empty passphrase", async () => {
    const envelope = asUint8Array(vector.envelope.envelopeHex);
    const { family, reads } = chain(vector.context.personHash, [
      { envelope, context: publicContext },
    ]);
    const mixedCase = `0x${vector.context.personHash.slice(2).toUpperCase()}`;
    await expect(find(family, mixedCase)).resolves.toEqual({ versionIndex: 1 });
    expect(reads.map((read) => read.name)).toEqual(
      expect.arrayContaining(["archive", "personVersionAt", "metadataRef", "getCode"]),
    );
    expect(reads.find((read) => read.name === "personVersionAt")?.args).toEqual([
      vector.context.personHash,
      0n,
    ]);
    expect(reads.every((read) => read.blockTag === blockTag)).toBe(true);
  });

  it("keeps a passphrase-protected identity eligible", async () => {
    const record = await protectedRecord("correct horse battery staple");
    const { family, reads } = chain(record.personHash, [
      { envelope: record.envelope, context: record.context },
    ]);
    await expect(find(family, record.personHash)).resolves.toBeNull();
    expect(reads.some((read) => read.name === "getCode")).toBe(true);
  });

  it("requires the empty passphrase to reproduce the identity, not only to open the envelope", async () => {
    const record = await protectedRecord("correct horse battery staple", "");
    const { family } = chain(record.personHash, [
      { envelope: record.envelope, context: record.context },
    ]);
    await expect(find(family, record.personHash)).resolves.toBeNull();
  });

  it("checks every version and refuses to decide when one cannot be read", async () => {
    const versions = [
      { envelope: await disguisedEnvelope(), context: publicContext },
      { envelope: asUint8Array(vector.envelope.envelopeHex), context: publicContext },
    ];
    const { family } = chain(vector.context.personHash, versions);
    // The first, non-conforming envelope hides the public identity; the second reveals it.
    await expect(find(family, vector.context.personHash)).resolves.toEqual({ versionIndex: 2 });
    const unreadable = chain(vector.context.personHash, versions, { failRead: true });
    await expect(find(unreadable.family, vector.context.personHash)).rejects.toThrow();
    await expect(find(family, "0x1234")).rejects.toThrow("person hash is invalid");
  });
});
