import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import hre from "hardhat";
import {
  deployIntegratedSystem,
  assertIntegratedShieldedWiring,
} from "../hardhat/integratedDeployment.mjs";
import {
  INTEGRATED_DEPLOYMENT_RECORDS,
  integratedDeploymentAddresses,
} from "../scripts/lib/zkDeploymentCatalog.mjs";
import { selectCircuitNames } from "../scripts/lib/zkCircuitSelection.mjs";

describe("Canonical receive deployment", function () {
  this.timeout(180000);
  it("builds exactly identity, value boundaries and protocol relations by default", function () {
    const selected = selectCircuitNames("all");
    assert.equal(selected.length, 14);
    assert.equal(selected.filter((name) => name.startsWith("protocol:")).length, 9);
    assert.deepEqual(selectCircuitNames("shielded"), [
      "shielded:shield",
      "shielded:unshield",
      "shielded:unshield4",
    ]);
    for (const retired of [
      "shielded:fund",
      "shielded:claim",
      "shielded:privateTransfer",
      "shielded:credential",
    ])
      assert.ok(!selected.includes(retired));
    assert.ok(
      !INTEGRATED_DEPLOYMENT_RECORDS.some((record) =>
        /IdentityAuthorization|Presentation|PrivateLetterArchive$/u.test(record.deploymentName),
      ),
    );
  });
  it("fresh main deployment uses one registry, factory and fixed verifier graph with no retired receive modules", async function () {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-deploy-"));
    try {
      const connection = await hre.network.create();
      const { ethers } = connection;
      const deployed = await deployIntegratedSystem(connection, {
        writeDeployments: true,
        artifacts: hre.artifacts,
        deploymentDirectory: directory,
      });
      await assertIntegratedShieldedWiring(deployed);
      assert.equal(await deployed.shieldedNativePool.protocolVersion(), 1n);
      assert.equal(await deployed.shieldedErc20Pool.protocolVersion(), 1n);
      for (const name of [
        "AUTHORIZATION_STATE",
        "RECEIVE_VERIFIER",
        "LINEAGE_INDEX",
        "fund",
        "claim",
        "privateTransfer",
      ])
        assert.equal(deployed.shieldedNativePool.interface.getFunction(name), null);
      for (const field of [
        "identityAuthorizationState",
        "receivePresentationVerifierRouter",
        "retiredReceiveVerifier",
      ])
        assert.equal(deployed[field], undefined);
      const addresses = await integratedDeploymentAddresses(deployed);
      assert.equal(addresses.receiveRegistry, await deployed.receiveRegistry.getAddress());
      assert.equal(
        addresses.shieldedBoundaryVerifierAdapter,
        await deployed.shieldedBoundaryVerifierAdapter.getAddress(),
      );
      const files = (await fs.readdir(directory)).sort();
      assert.equal(files.length, INTEGRATED_DEPLOYMENT_RECORDS.length);
      assert.ok(files.includes("ReceiveRegistry.json"));
      assert.ok(!files.includes("IdentityAuthorizationState.json"));
      const token = await ethers.deployContract("ShieldedPoolTokenMock");
      await deployed.shieldedPoolFactory.createPool(await token.getAddress());
      const pool = await ethers.getContractAt(
        "ShieldedErc20Pool",
        await deployed.shieldedPoolFactory.poolFor(await token.getAddress()),
      );
      assert.equal(await pool.RECEIVE_REGISTRY(), await deployed.receiveRegistry.getAddress());
      assert.equal(
        await pool.VERIFIER(),
        await deployed.shieldedBoundaryVerifierAdapter.getAddress(),
      );
      assert.equal(await deployed.shieldedPoolFactory.poolCount(), 3n);
      await deployed.shieldedPoolFactory.createPool(await token.getAddress());
      assert.equal(await deployed.shieldedPoolFactory.poolCount(), 3n);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
