import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ZK_CEREMONY_CIRCUIT_FIELDS } from "../scripts/lib/zkArtifactTrust.mjs";
import { readZkeyMpcMetadata } from "../scripts/lib/zkeyMpcMetadata.mjs";
import {
  SINGLE_OPERATOR_BEACON_ITERATIONS_EXP,
  SINGLE_OPERATOR_BEACON_NAME,
  SINGLE_OPERATOR_PARTICIPANT_ID,
} from "../scripts/lib/zkProductionSetup.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("zkey MPC metadata reader", function () {
  for (const name of ["person_commitment", "disclosure_binding"]) {
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
        // Informal setups run the single-operator pipeline; development records attest none of it.
        expect(metadata.contributionCount).to.equal(2);
        expect(metadata.contributions).to.have.length(2);
        expect(metadata.contributions[0]).to.include({
          sequence: 1,
          type: 0,
          name: SINGLE_OPERATOR_PARTICIPANT_ID,
          beaconHash: null,
          numIterationsExp: null,
        });
        expect(metadata.contributions[1]).to.include({
          sequence: 2,
          type: 1,
          name: SINGLE_OPERATOR_BEACON_NAME,
          numIterationsExp: SINGLE_OPERATOR_BEACON_ITERATIONS_EXP,
        });
        expect(metadata.contributions[1].beaconHash).to.match(/^[0-9a-f]{64}$/u);
        for (const contribution of metadata.contributions) {
          expect(contribution.contributionHash).to.match(/^[0-9a-f]{128}$/u);
        }
      } else {
        expect(manifest.trustedSetup.status).to.equal("production");
        const transcript = JSON.parse(
          await fs.readFile(path.join(PROJECT_ROOT, manifest.trustedSetup.transcript.path), "utf8"),
        );
        const contributionHashField = ZK_CEREMONY_CIRCUIT_FIELDS[name].contributionHash;
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
