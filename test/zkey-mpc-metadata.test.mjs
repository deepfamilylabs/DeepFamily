import { expect } from "chai";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readZkeyMpcMetadata } from "../scripts/lib/zkeyMpcMetadata.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("zkey MPC metadata reader", function () {
  for (const [name, expectedContributionHash] of [
    [
      "person_commitment",
      "b7bace0468cee81c5f3b35aa656f08df5d03eabf63ff80f1c361dda0b846756b" +
        "e60a360ecfe77165f03a03e55bb3a282a543300239d78bddc6fff98267060abc",
    ],
    [
      "disclosure_binding",
      "0c47de1e667ab329eb20d9ef9ec040be09697395a83a70a8a1fec83524795610" +
        "c3bbec73e724376f8e1d9f4e6667d9a6b0217ca727d7516a0ed03769042d0535",
    ],
  ]) {
    it(`reads the real committed ${name} Groth16 MPC section`, async function () {
      const metadata = await readZkeyMpcMetadata(
        path.join(PROJECT_ROOT, "frontend", "public", "zk", `${name}_final.zkey`),
      );
      expect(metadata.circuitHash).to.match(/^[0-9a-f]{128}$/u);
      expect(metadata.contributionCount).to.equal(1);
      expect(metadata.contributions).to.have.length(1);
      expect(metadata.contributions[0]).to.include({
        sequence: 1,
        type: 0,
        name: "1st",
        contributionHash: expectedContributionHash,
        beaconHash: null,
        numIterationsExp: null,
      });
      expect(metadata.contributions[0].transcriptHash).to.match(/^[0-9a-f]{128}$/u);
    });
  }
});
