import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  inspectProtocolReleaseManifest,
  PROTOCOL_RELEASE_MANIFEST_PATH,
} from "../scripts/lib/protocolReleaseManifest.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("protocol release manifest", function () {
  it("freezes the v1 cross-component constants and public-signal ABI", function () {
    const evidence = inspectProtocolReleaseManifest({ root: ROOT });

    assert.match(evidence.manifestSha256, /^[0-9a-f]{64}$/);
    assert.equal(evidence.manifest.proofRoutes[0].publicSignals.length, 5);
    assert.equal(evidence.manifest.proofRoutes[1].publicSignals.length, 4);
    assert.equal(
      evidence.manifest.goldenVectors.sha256,
      "537afdf6135f526a44c02e7fc1538571de22e90d1cb362a8e2f697e364aa1d80",
    );
  });

  it("fails the production gate while benchmark, ceremony, artifacts and deployment are pending", function () {
    assert.throws(
      () => inspectProtocolReleaseManifest({ root: ROOT, requireProduction: true }),
      /releaseStatus is not production/,
    );
  });

  it("rejects a moved universal self-suite offset", function () {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-protocol-manifest-"));
    try {
      const manifest = structuredClone(
        inspectProtocolReleaseManifest({ root: ROOT }).manifest,
      );
      manifest.envelope.universalPrefix.selfIdentitySuiteId.offset = 17;
      fs.writeFileSync(
        path.join(directory, PROTOCOL_RELEASE_MANIFEST_PATH),
        `${JSON.stringify(manifest)}\n`,
      );
      assert.throws(
        () => inspectProtocolReleaseManifest({ root: directory }),
        /self identity suite offset must be 16/,
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
