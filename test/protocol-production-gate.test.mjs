import assert from "node:assert/strict";
import { inspectProtocolProductionArtifacts, PRODUCTION_CIRCUITS } from "../scripts/lib/protocolProductionArtifacts.mjs";
import { main as setup } from "../scripts/zk-setup.mjs";
import { verifyProductionCeremony } from "../scripts/zk-ceremony-verify.mjs";
import { checkProtocolReleaseEvidence } from "../scripts/check-protocol-release.mjs";
import { runReleaseChecks, runReleasePreflight } from "../scripts/release-preflight.mjs";

describe("current production proof gate", function () {
  it("requires all 13 current relations in the same approval", function () {
    assert.equal(PRODUCTION_CIRCUITS.length,13);
    assert.equal(PRODUCTION_CIRCUITS.filter(name=>name.startsWith("protocol:")).length,8);
    assert.throws(()=>inspectProtocolProductionArtifacts(), /13-relation.*no reviewed production ceremony/u);
  });
  it("cannot promote local proof keys through setup, ceremony or release entry points", async function () {
    for (const operation of [() => setup([]), verifyProductionCeremony, checkProtocolReleaseEvidence, runReleaseChecks, runReleasePreflight])
      await assert.rejects(operation(), /Local development keys cannot authorize/u);
  });
});
