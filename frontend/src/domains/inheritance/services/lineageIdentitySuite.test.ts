import { Contract, Interface, keccak256 } from "ethers";
import { describe, expect, it, vi } from "vitest";
import LineageIndex from "../../../abi/DeepFamilyLineageIndex.json";
import { archivedIdentitySuite, lineageReaderAt } from "./lineageIdentitySuite";
import { createArchiveContract } from "../../../shared/clients/contractFactory";

vi.mock("../../../shared/clients/contractFactory", () => ({ createArchiveContract: vi.fn() }));

const address = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "22".repeat(32);

describe("historical lineage identity suites", () => {
  it("decodes a v1 multi-row page and its original event topic at the snapshot", async () => {
    const old = new Interface([
      "function getVersionPage(uint256,uint256) view returns (tuple(bytes32,uint256,uint256,uint256,uint256)[])",
      "event VersionIndexed(bytes32 indexed,uint256 indexed,uint256,uint256,uint256)",
    ]);
    const call = vi.fn(async () =>
      old.encodeFunctionResult("getVersionPage", [
        [
          [hash, 1n, 17n, 18n, 19n],
          [hash, 2n, 17n, 21n, 22n],
        ],
      ]),
    );
    const index = {
      apiVersion: vi.fn(async () => 1n),
      interface: new Interface(LineageIndex.abi),
      getAddress: async () => address,
      runner: { call },
    };
    const reader = await lineageReaderAt(index as unknown as Contract, 21);
    const rows = await reader.getVersionPage(0, 2, { blockTag: 21 });
    expect(rows[1].motherIdentityCommitment).toBe(22n);
    expect(reader.interface.getEvent("VersionIndexed")?.topicHash).toBe(
      old.getEvent("VersionIndexed")?.topicHash,
    );
    expect(index.apiVersion).toHaveBeenCalledWith({ blockTag: 21 });
  });

  it("recovers the suite from a hash-verified legacy header at the same block", async () => {
    const envelope = "0x44464d3101000000000000000000000000000002";
    const ref = {
      pointer: address,
      payloadHash: keccak256(envelope),
      payloadLength: 20n,
      segmentCount: 1n,
    };
    const metadataRef = vi.fn(async () => ref);
    vi.mocked(createArchiveContract).mockReturnValue({ metadataRef } as unknown as Contract);
    const getCode = vi.fn(async () => "0x00" + envelope.slice(2));
    const family = {
      runner: { provider: { getCode } },
      archive: async () => address,
    } as unknown as Contract;
    await expect(archivedIdentitySuite(family, hash, 1, 21)).resolves.toBe(2);
    expect(metadataRef).toHaveBeenCalledWith(hash, 1, { blockTag: 21 });
    expect(getCode).toHaveBeenCalledWith(address, 21);
    ref.payloadHash = hash;
    await expect(archivedIdentitySuite(family, hash, 1, 21)).rejects.toThrow();
  });
});
