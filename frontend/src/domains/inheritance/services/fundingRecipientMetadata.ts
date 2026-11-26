import { readArchiveBlob, type MetadataContextInput } from "@deepfamily/protocol-core";
import { isHexString, keccak256, type Contract, type Provider } from "ethers";
import { createArchiveContract } from "../../../shared/clients/contractFactory";
import {
  hasPersistentPublicStateStorage,
  openPublicStateStore,
  withPublicStateLock,
  type PublicStateHead,
} from "../../../shared/clients/publicStateStore";
import { reportPublicStateSyncProgress } from "../../../shared/workers/publicStateSyncProgress";
import { lineageReaderAt } from "./lineageIdentitySuite";

type MetadataSource = {
  family: Contract;
  archive: Contract;
  deepFamilyProxy: string;
  chainId: bigint;
  blockNumber: number;
  provider: Provider;
};
type VersionMetadata = {
  context: MetadataContextInput;
  payloadHash: string;
  envelope: Uint8Array;
};
type Snapshot = {
  family: Contract;
  lineageIndex: Contract;
  chainId: bigint;
  blockNumber: number;
  blockHash: string;
};
const PAGE = 16;
const metadataKey = (personHash: string, version: number) => `${personHash}:${version}`;

export async function fundingMetadataSource(
  family: Contract,
  chainId: bigint,
  blockNumber: number,
): Promise<MetadataSource> {
  const provider = family.runner?.provider;
  if (!provider) throw new Error("The family contract has no provider");
  const [deepFamilyProxy, archiveAddress] = await Promise.all([
    family.getAddress(),
    family.archive({ blockTag: blockNumber }),
  ]);
  return {
    family,
    provider,
    chainId,
    blockNumber,
    deepFamilyProxy,
    archive: createArchiveContract(archiveAddress, provider),
  };
}

export async function readFundingVersionMetadata(
  source: MetadataSource,
  personHash: string,
  versionIndex: number,
): Promise<VersionMetadata> {
  const { family, archive, provider, blockNumber, chainId, deepFamilyProxy } = source;
  const at = { blockTag: blockNumber };
  const [version, ref] = await Promise.all([
    family.personVersionAt(personHash, versionIndex - 1, at),
    archive.metadataRef(personHash, versionIndex, at),
  ]);
  if (
    String(version.personHash).toLowerCase() !== personHash ||
    BigInt(version.versionIndex) !== BigInt(versionIndex)
  ) {
    throw new Error("Funding metadata does not match its indexed family version");
  }
  // Validate the Archive bytes here. Format dispatch is local to the selected person's records.
  const { payload, payloadHash } = await readArchiveBlob({
    pointer: ref.pointer,
    payloadHash: ref.payloadHash,
    payloadLength: ref.payloadLength,
    segmentCount: ref.segmentCount,
    blockTag: blockNumber,
    getCode: (pointer, blockTag) => provider.getCode(pointer, blockTag),
  });
  return {
    envelope: payload,
    payloadHash,
    context: {
      chainId,
      deepFamilyProxy,
      personHash,
      fatherHash: version.fatherHash,
      fatherVersionIndex: version.fatherVersionIndex,
      motherHash: version.motherHash,
      motherVersionIndex: version.motherVersionIndex,
      versionCommitment: version.versionCommitment,
    },
  };
}

/** Synchronize full, fixed-size public pages before looking up any recipient locally. */
export async function loadRebuiltFundingMetadata(
  snapshot: Snapshot,
  personHash: string,
  versionIndices: readonly number[],
): Promise<VersionMetadata[]> {
  const { family, lineageIndex, chainId, blockNumber, blockHash } = snapshot;
  const source = await fundingMetadataSource(family, chainId, blockNumber);
  const { archive, provider, deepFamilyProxy } = source;
  const canonical = async (number: number, hash: string) =>
    (await provider.getBlock(number))?.hash === hash;
  const assertAnchor = async () => {
    if (!(await canonical(blockNumber, blockHash))) {
      throw new Error("Funding metadata snapshot was reorganized");
    }
  };
  await assertAnchor();
  const index = await lineageReaderAt(lineageIndex, blockNumber);
  const at = { blockTag: blockNumber };
  const total = Number(await index.versionMetadataCount(at));
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error("Invalid global family version count");
  const readPage = async (start: number) => {
    const limit = Math.min(PAGE, total - start);
    const rows = (await index.getVersionPage(start, limit, at)) as {
      personHash: string;
      versionIndex: bigint;
    }[];
    if (rows.length !== limit) throw new Error("Incomplete global family version page");
    const entries = await Promise.all(
      rows.map(async (row) => {
        const hash = String(row.personHash).toLowerCase();
        const version = Number(row.versionIndex);
        if (!isHexString(hash, 32) || !Number.isSafeInteger(version) || version < 1) {
          throw new Error("Invalid indexed family version");
        }
        return {
          kind: "metadata",
          key: metadataKey(hash, version),
          value: await readFundingVersionMetadata(source, hash, version),
        };
      }),
    );
    await assertAnchor();
    return entries;
  };
  const keys = versionIndices.map((version) => metadataKey(personHash, version));
  const report = (completed: number, phase: "download" | "complete") =>
    reportPublicStateSyncProgress({ domain: "metadata", phase, completed, total });
  const checked = (records: (VersionMetadata | undefined)[]) => {
    const verified = records.map((record) => {
      if (
        !record ||
        record.context.personHash !== personHash ||
        keccak256(record.envelope) !== record.payloadHash
      ) {
        throw new Error("Local funding metadata is incomplete or invalid");
      }
      return record;
    });
    report(total, "complete");
    return verified;
  };
  if (!hasPersistentPublicStateStorage()) {
    const wanted = new Set(keys);
    const selected = new Map<string, VersionMetadata>();
    for (let start = 0; start < total; start += PAGE) {
      report(start, "download");
      for (const { key, value } of await readPage(start)) {
        if (wanted.has(key)) selected.set(key, value);
      }
    }
    return checked(keys.map((key) => selected.get(key)));
  }
  const scope = `funding-metadata:1:${chainId}:${deepFamilyProxy.toLowerCase()}:${(await archive.getAddress()).toLowerCase()}:${(await index.getAddress()).toLowerCase()}`;
  const store = await openPublicStateStore(scope);
  return withPublicStateLock(scope, async () => {
    let { head } = await store.envelope();
    while (head && !(await canonical(head.blockNumber, head.blockHash))) {
      const previous: PublicStateHead | undefined = await store.rollback(head);
      if (!previous) await store.invalidateHead(head);
      head = previous;
    }
    const anchor = (downloaded: number) => ({ blockNumber, blockHash, data: { downloaded } });
    if (!head) head = await store.finishPending(await store.startPending(anchor(0)));
    let downloaded = Number(head.data.downloaded);
    if (
      !Number.isSafeInteger(downloaded) ||
      downloaded < 0 ||
      (downloaded > total && head.blockNumber <= blockNumber)
    ) {
      throw new Error("Global family version count does not match the local snapshot");
    }
    while (downloaded < total) {
      report(downloaded, "download");
      const entries = await readPage(downloaded);
      downloaded += entries.length;
      head = await store.commit(head, anchor(downloaded), entries);
    }
    const records = await store.read(head, (view) =>
      Promise.all(keys.map((key) => view.get<VersionMetadata>("metadata", key))),
    );
    await assertAnchor();
    try {
      return checked(records);
    } catch (error) {
      await store.invalidateHead(head);
      throw error;
    }
  });
}
