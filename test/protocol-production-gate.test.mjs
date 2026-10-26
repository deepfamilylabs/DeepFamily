import assert from "node:assert/strict";
import { inspectProtocolProductionArtifacts, PRODUCTION_CIRCUITS } from "../scripts/lib/protocolProductionArtifacts.mjs";
import { main as setup } from "../scripts/zk-setup.mjs";
import { verifyProductionCeremony } from "../scripts/zk-ceremony-verify.mjs";
import { checkProtocolReleaseEvidence } from "../scripts/check-protocol-release.mjs";
import { runReleaseChecks, runReleasePreflight } from "../scripts/release-preflight.mjs";

describe("current production proof gate", function () {
  it("requires all 14 current relations in the same approval", function () {
    assert.equal(PRODUCTION_CIRCUITS.length,14);
    assert.equal(PRODUCTION_CIRCUITS.filter(name=>name.startsWith("protocol:")).length,9);
    assert.throws(()=>inspectProtocolProductionArtifacts(), /14-relation.*no reviewed production ceremony/u);
  });
  it("cannot promote local proof keys through setup, ceremony or release entry points", async function () {
    for (const operation of [() => setup([]), verifyProductionCeremony, checkProtocolReleaseEvidence, runReleaseChecks, runReleasePreflight])
      await assert.rejects(operation(), /Local development keys cannot authorize/u);
  });
});
