import assert from "node:assert/strict";
import path from "node:path";

import hre from "hardhat";

import { deployIntegratedFixture } from "./fixtures/integrated.mjs";
import { addPersonVersion } from "../lib/seedHelpers.js";
import { runShieldedAcceptanceSmoke } from "../scripts/lib/shieldedAcceptanceSmoke.mjs";

describe("integrated shielded acceptance smoke", function () {
  this.timeout(600_000);

  it("funds both budget paths with all five pool proofs, the shared DEEP token and actual lineage", async function () {
    const connection = await hre.network.create();
    const deployed = await deployIntegratedFixture(connection);
    const [signer] = await connection.ethers.getSigners();
    const person = {
      fullName: "Acceptance Child",
      passphrase: "local full shielded acceptance proof",
      isBirthBC: false,
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 1,
      gender: 255,
    };
    const father = {
      fullName: "Acceptance Father",
      passphrase: person.passphrase,
      isBirthBC: false,
      birthYear: 1960,
      birthMonth: 1,
      birthDay: 1,
      gender: 1,
    };
    const mother = {
      fullName: "Acceptance Mother",
      passphrase: person.passphrase,
      isBirthBC: false,
      birthYear: 1962,
      birthMonth: 1,
      birthDay: 1,
      gender: 2,
    };
    const proofArtifacts = {
      wasm: path.resolve("frontend/public/zk/person_commitment.wasm"),
      zkey: path.resolve("frontend/public/zk/person_commitment_final.zkey"),
    };
    const recordTx = async (_label, tx) => tx.wait();
    const personResult = await addPersonVersion({
      deepFamily: deployed.deepFamily,
      signer,
      personData: person,
      fatherData: father,
      motherData: mother,
      proofArtifacts,
    });
    const reward = await deployed.token.recentReward();
    await (await deployed.token.approve(await deployed.deepFamily.getAddress(), reward)).wait();
    await (await deployed.deepFamily.endorseVersion(personResult.personHash, 1)).wait();

    const result = await runShieldedAcceptanceSmoke({
      connection,
      deployed,
      signer,
      person,
      father,
      mother,
      personResult,
      recordTx,
      proofArtifacts,
    });
    assert.equal(result.status, "passed");
    assert.equal(Object.keys(result.proofs).length, 5);
    assert.equal(result.scenario.fundLabel, "shielded-action-fund");
    assert.equal(result.scenario.receiveCode.verified, true);
    assert.equal(result.proofs.claim.execution, "verifier-call");
    assert.equal(result.scenario.claimCount, 12);
    assert.equal(result.scenario.recoveredNotes, result.scenario.recoveryEventCount);
    assert.equal(result.scenario.totalShieldedAfter, "3400");
    assert.equal(result.scenario.poolTokenAfter, "3400");
    assert.equal(result.scenario.identityBudget.claimProof.execution, "verifier-call");
    assert.equal(result.scenario.identityBudget.fundingLabel, "shielded-action-fund-identity");
    assert.equal(result.scenario.identityBudget.fundProof.publicSignals[3], "1");
    assert.deepEqual(
      result.scenario.identityBudget.claimProof.publicSignals.slice(8, 20),
      result.proofs.claim.publicSignals.slice(8, 20),
    );
  });
});
