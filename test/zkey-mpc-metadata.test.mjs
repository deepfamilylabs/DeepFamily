import { expect } from "chai";
import fs from "node:fs/promises";
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
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(PROJECT_ROOT, "circuits", "zk-artifacts-manifest.json"),
          "utf8",
        ),
      );
      const metadata = await readZkeyMpcMetadata(
        path.join(PROJECT_ROOT, "frontend", "public", "zk", `${name}_final.zkey`),
      );
      expect(metadata.circuitHash).to.match(/^[0-9a-f]{128}$/u);
      if (manifest.trustedSetup.status === "development") {
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
      } else {
        expect(manifest.trustedSetup.status).to.equal("production");
        const transcript = JSON.parse(
          await fs.readFile(path.join(PROJECT_ROOT, manifest.trustedSetup.transcript.path), "utf8"),
        );
        const contributionHashField =
          name === "person_commitment"
            ? "personCommitmentContributionHash"
            : "disclosureBindingContributionHash";
        const expectedContributions = [
          ...transcript.contributions.map((contribution, index) => ({
            sequence: index + 1,
            type: 0,
            name: contribution.participantId,
            contributionHash: contribution[contributionHashField],
            beaconHash: null,
            numIterationsExp: null,
          })),
          {
            sequence: transcript.contributions.length + 1,
            type: 1,
            name: transcript.beacon.name,
            contributionHash: transcript.beacon[contributionHashField],
            beaconHash: transcript.beacon.hash,
            numIterationsExp: transcript.beacon.numIterationsExp,
          },
        ];
        expect(metadata.contributionCount).to.equal(expectedContributions.length);
        expect(metadata.contributions).to.have.length(expectedContributions.length);
        for (const [index, expected] of expectedContributions.entries()) {
          expect(metadata.contributions[index]).to.include(expected);
        }
      }
      for (const contribution of metadata.contributions) {
        expect(contribution.transcriptHash).to.match(/^[0-9a-f]{128}$/u);
      }
    });
  }
});
