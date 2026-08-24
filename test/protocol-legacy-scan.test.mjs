import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  assertNoProtocolLegacySources,
  scanProtocolLegacySources,
} from "../scripts/check-protocol-legacy.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("fresh-v1 protocol legacy source audit", function () {
  it("accepts the repository production/runtime source roots", function () {
    assert.equal(assertNoProtocolLegacySources({ root: ROOT }).status, "passed");
  });

  it("reports forbidden runtime identifiers while excluding test-only fixtures", function () {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "deepfamily-legacy-scan-"));
    try {
      fs.mkdirSync(path.join(root, "lib", "test"), { recursive: true });
      fs.writeFileSync(path.join(root, "lib", "fresh.js"), "const metadataCID = 'legacy';\n");
      fs.writeFileSync(
        path.join(root, "lib", "test", "fixture.js"),
        "const proofSystemId = 'test-only';\n",
      );

      assert.deepEqual(scanProtocolLegacySources({ root, runtimeRoots: ["lib"] }), [
        "legacy protocol identifier metadataCID in lib/fresh.js",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects restoration of a removed legacy key-generation entrypoint", function () {
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "deepfamily-legacy-scan-"));
    try {
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(root, "scripts", "test-keygen-demo.mjs"), "export {};\n");

      assert.deepEqual(scanProtocolLegacySources({ root, runtimeRoots: [] }), [
        "removed protocol artifact was restored: scripts/test-keygen-demo.mjs",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
