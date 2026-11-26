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
import { IDBFactory } from "fake-indexeddb";
import { Interface, ZeroAddress, keccak256, type Contract, type ContractRunner } from "ethers";
import { describe, expect, it, vi } from "vitest";
import DeepFamily from "../../../abi/DeepFamily.json";
import DeepFamilyArchive from "../../../abi/DeepFamilyArchive.json";
import { createDeepFamilyContract } from "../../../shared/clients/contractFactory";
import {
  findPublicTreeIdentityEvidence,
  findRebuiltPublicTreeIdentityEvidence,
  PUBLIC_TREE_METADATA_UNAVAILABLE_MESSAGE,
} from "./shieldedPublicTreeIdentity";

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
const blockHash = `0x${"ab".repeat(32)}`;

type ChainVersion = { envelope: Uint8Array; context: MetadataContextInput };

/**
 * Serves the family and Archive reads through the real ABIs, with each version's envelope as a
 * single-segment Archive blob. Every read records its block tag.
 */
function chain(
  versions: ChainVersion[],
  options: { failRead?: boolean; failCodeAt?: number; indexAddress?: string } = {},
) {
  const reads: { name: string; args: unknown[]; blockTag: unknown }[] = [];
  const byPerson = new Map<string, ChainVersion[]>();
  const indexedVersions = versions.map((version) => {
    const personHash = version.context.personHash;
    const own = byPerson.get(personHash) ?? [];
    own.push(version);
    byPerson.set(personHash, own);
    return { personHash, versionIndex: own.length };
  });
  const pointer = (ordinal: number) => `0x${(ordinal + 1).toString(16).padStart(40, "0")}`;
  const results = (name: string, args: readonly unknown[]): unknown[] => {
    const own = byPerson.get(String(args[0])) ?? [];
    switch (name) {
      case "archive":
        return [archiveAddress];
      case "personVersionsCount":
        return [BigInt(own.length)];
      case "personVersionAt": {
        const index = Number(args[1]);
        const { context } = own[index];
        return [
          [
            context.personHash,
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
        const version = own[Number(args[1]) - 1];
        const { envelope } = version;
        return [[keccak256(envelope), pointer(versions.indexOf(version)), envelope.length, 1]];
      }
    }
    throw new Error(`Unexpected read ${name}`);
  };
  const provider = {
    get provider() {
      return provider;
    },
    getBlock: vi.fn(async (number: number) => {
      reads.push({ name: "getBlock", args: [], blockTag: number });
      return { number, hash: blockHash };
    }),
    getCode: vi.fn(async (address: string, at: unknown) => {
      reads.push({ name: "getCode", args: [address], blockTag: at });
      const ordinal = Number(BigInt(address)) - 1;
      if (options.failRead || ordinal === options.failCodeAt) throw new Error("RPC unavailable");
      return `0x00${bytesToHex(versions[ordinal].envelope).slice(2)}`;
    }),
    call: vi.fn(async (tx: { to: string; data: string; blockTag?: unknown }) => {
      const abi = tx.to.toLowerCase() === archiveAddress ? archiveAbi : familyAbi;
      const parsed = abi.parseTransaction({ data: tx.data })!;
      const args = [...parsed.args];
      reads.push({ name: parsed.name, args, blockTag: tx.blockTag });
      return abi.encodeFunctionResult(parsed.name, results(parsed.name, args));
    }),
  };
  const family = createDeepFamilyContract(
    publicContext.deepFamilyProxy,
    provider as unknown as ContractRunner,
  );
  const lineageIndex = {
    getAddress: async () => options.indexAddress ?? "0x8888888888888888888888888888888888888888",
    async versionMetadataCount(at: { blockTag: number }) {
      reads.push({ name: "versionMetadataCount", args: [], blockTag: at.blockTag });
      return BigInt(indexedVersions.length);
    },
    async getVersionPage(start: number, limit: number, at: { blockTag: number }) {
      reads.push({ name: "getVersionPage", args: [start, limit], blockTag: at.blockTag });
      return indexedVersions.slice(start, start + limit);
    },
  } as unknown as Contract;
  const lineage = {
    blockNumber: blockTag,
    blockHash,
    versions: new Map([...byPerson].map(([personHash, own]) => [personHash, own.map((_, index) => ({
      personHash,
      versionIndex: index + 1,
      identityCommitment: 1n,
      fatherIdentityCommitment: 0n,
      motherIdentityCommitment: 0n,
    }))])),
  };
  return { family, lineageIndex, lineage, reads };
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
    const { family, reads } = chain([
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
    const { family, reads } = chain([
      { envelope: record.envelope, context: record.context },
    ]);
    await expect(find(family, record.personHash)).resolves.toBeNull();
    expect(reads.some((read) => read.name === "getCode")).toBe(true);
  });

  it("requires the empty passphrase to reproduce the identity, not only to open the envelope", async () => {
    const record = await protectedRecord("correct horse battery staple", "");
    const { family } = chain([
      { envelope: record.envelope, context: record.context },
    ]);
    await expect(find(family, record.personHash)).resolves.toBeNull();
  });

  it("checks every version and refuses to decide when one cannot be read", async () => {
    const versions = [
      { envelope: await disguisedEnvelope(), context: publicContext },
      { envelope: asUint8Array(vector.envelope.envelopeHex), context: publicContext },
    ];
    const { family } = chain(versions);
    // The first, non-conforming envelope hides the public identity; the second reveals it.
    await expect(find(family, vector.context.personHash)).resolves.toEqual({ versionIndex: 2 });
    const unreadable = chain(versions, { failRead: true });
    await expect(find(unreadable.family, vector.context.personHash)).rejects.toThrow();
    await expect(find(family, "0x1234")).rejects.toThrow("person hash is invalid");
  });

  it("synchronizes the same public batch before checking different recipients in rebuild mode", async () => {
    const publicVersion = { envelope: asUint8Array(vector.envelope.envelopeHex), context: publicContext };
    const protectedVersion = await protectedRecord("correct horse battery staple");
    const a = chain([publicVersion, protectedVersion]);
    const b = chain([publicVersion, protectedVersion]);
    const chainId = BigInt(publicContext.chainId);
    await expect(findRebuiltPublicTreeIdentityEvidence({
      ...a, chainId, personHash: publicContext.personHash,
    })).resolves.toEqual({ versionIndex: 1 });
    await expect(findRebuiltPublicTreeIdentityEvidence({
      ...b, chainId, personHash: protectedVersion.personHash,
    })).resolves.toBeNull();
    expect(a.reads).toEqual(b.reads);
    expect(a.reads.filter((read) => read.name === "getVersionPage").map((read) => read.args))
      .toEqual([[0, 2]]);
    expect(a.reads.filter((read) => read.name === "getCode")).toHaveLength(2);
    expect(a.reads.every((read) => read.blockTag === blockTag && read.name !== "personVersionsCount"))
      .toBe(true);
  });

  it("checks warm public metadata locally and refuses a changed snapshot", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    try {
      const publicVersion = { envelope: asUint8Array(vector.envelope.envelopeHex), context: publicContext };
      const { family, lineageIndex, lineage, reads } = chain([publicVersion]);
      const input = { family, lineageIndex, lineage, chainId: BigInt(publicContext.chainId), personHash: publicContext.personHash };
      await expect(findRebuiltPublicTreeIdentityEvidence(input)).resolves.toEqual({ versionIndex: 1 });
      reads.length = 0;
      await expect(findRebuiltPublicTreeIdentityEvidence(input)).resolves.toEqual({ versionIndex: 1 });
      expect(reads.every((read) => ["archive", "versionMetadataCount", "getBlock"].includes(read.name))).toBe(true);
      await expect(findRebuiltPublicTreeIdentityEvidence({
        ...input, lineage: { ...lineage, blockHash: `0x${"cd".repeat(32)}` },
      })).rejects.toThrow(PUBLIC_TREE_METADATA_UNAVAILABLE_MESSAGE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resumes an interrupted metadata sync before returning evidence from the first page", async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    try {
      const personHash = publicContext.personHash;
      const chainId = BigInt(publicContext.chainId);
      const indexAddress = "0x7777777777777777777777777777777777777777";
      const versions = Array.from({ length: 17 }, () => ({
        envelope: asUint8Array(vector.envelope.envelopeHex), context: publicContext,
      }));
      const interrupted = chain(versions, { indexAddress, failCodeAt: 16 });
      await expect(findRebuiltPublicTreeIdentityEvidence({
        ...interrupted, personHash, chainId,
      })).rejects.toThrow(PUBLIC_TREE_METADATA_UNAVAILABLE_MESSAGE);
      const resumed = chain(versions, { indexAddress });
      await expect(findRebuiltPublicTreeIdentityEvidence({
        ...resumed, personHash, chainId,
      })).resolves.toEqual({ versionIndex: 1 });
      expect(resumed.reads.filter((read) => read.name === "getVersionPage").map((read) => read.args))
        .toEqual([[16, 1]]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
