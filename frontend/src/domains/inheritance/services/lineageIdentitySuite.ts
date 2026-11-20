import { createChainContract } from "@deepfamily/chain-client";
import { readMetadataEnvelopeFromRef } from "@deepfamily/protocol-core";
import type { Contract } from "ethers";
import { createArchiveContract } from "../../../shared/clients/contractFactory";

const v1Metadata = [
  "event VersionIndexed(bytes32 indexed personHash,uint256 indexed versionIndex,uint256 identityCommitment,uint256 fatherIdentityCommitment,uint256 motherIdentityCommitment)",
  "function getVersionPage(uint256,uint256) view returns (tuple(bytes32 personHash,uint256 versionIndex,uint256 identityCommitment,uint256 fatherIdentityCommitment,uint256 motherIdentityCommitment)[])",
  "function versionParents(bytes32,uint256) view returns (uint256 fatherIdentityCommitment,uint256 motherIdentityCommitment)",
];

/** v1 used different event topics and tuple widths. Decode it with the ABI that wrote the data. */
export async function lineageReaderAt(index: Contract, blockTag: number): Promise<Contract> {
  if (typeof index.apiVersion !== "function") return index;
  const version = BigInt(await index.apiVersion({ blockTag }));
  if (version === 2n) return index;
  if (version !== 1n) throw new Error("Unsupported lineage index version");
  const current = index.interface.fragments.filter(
    (fragment) =>
      !(
        "name" in fragment &&
        ["VersionIndexed", "getVersionPage", "versionParents"].includes(String(fragment.name))
      ),
  );
  return createChainContract(await index.getAddress(), [...current, ...v1Metadata], index.runner);
}

/** For legacy entries the immutable, hash-verified DFM1 header carries the same proof-bound suite. */
export async function archivedIdentitySuite(
  family: Contract,
  personHash: string,
  versionIndex: number,
  blockTag: number,
) {
  const provider = family.runner?.provider;
  if (!provider) throw new Error("The family archive has no provider");
  const archive = createArchiveContract(await family.archive({ blockTag }), provider);
  const ref = await archive.metadataRef(personHash, versionIndex, { blockTag });
  const { prefix } = await readMetadataEnvelopeFromRef({
    pointer: ref.pointer,
    payloadHash: ref.payloadHash,
    payloadLength: ref.payloadLength,
    segmentCount: ref.segmentCount,
    blockTag,
    getCode: (pointer, at) => provider.getCode(pointer, at),
  });
  return prefix.identitySuiteId;
}
