import { expect } from "chai";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sourceBundleSha256 } from "../scripts/zk-shielded-release-check.mjs";

describe("shielded release source digest", function () {
  it("binds deployment code, docs, frontend build code, and browser-served proof files", function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shielded-release-digest-"));
    const tracked = [
      "hardhat/deploy.mjs",
      "lib/deployment.mjs",
      "tasks/lib/timelockUpgrade.mjs",
      "frontend/vite.config.ts",
      "frontend/package.json",
      "frontend/scripts/sync-abi.mjs",
      "frontend/public/zk/shielded/shielded_shield.wasm",
      "docs/notes.md",
    ];
    try {
      execFileSync("git", ["init", "-q", root]);
      for (const file of [...tracked, "unrelated.txt"]) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), "original");
      }
      execFileSync("git", ["add", "-A"], { cwd: root });
      const baseline = sourceBundleSha256(root);
      for (const file of tracked) {
        fs.writeFileSync(path.join(root, file), "modified");
        expect(sourceBundleSha256(root), `${file} must affect the release digest`).not.to.equal(
          baseline,
        );
        fs.writeFileSync(path.join(root, file), "original");
      }
      fs.writeFileSync(path.join(root, "unrelated.txt"), "modified");
      expect(sourceBundleSha256(root)).to.equal(baseline);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
