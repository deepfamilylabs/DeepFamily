import fs from "node:fs/promises";
import { expect } from "chai";

describe("eSpace Mainnet Safe command wiring", function () {
  it("exposes separate plan/deploy and status npm entry points", async function () {
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    expect(packageJson.scripts["espace:mainnet:safe"]).to.equal(
      "node scripts/espace-mainnet-safe-command.mjs",
    );
    expect(packageJson.scripts["espace:mainnet:safe:status"]).to.equal(
      "node scripts/espace-mainnet-safe-command.mjs --status",
    );
    expect(packageJson.scripts["espace:mainnet:release"]).to.equal(
      "node scripts/espace-mainnet-release-command.mjs",
    );
  });

  it("hard-wires the Safe wrapper to Conflux mainnet without compiling unrelated contracts", async function () {
    const source = await fs.readFile("scripts/espace-mainnet-safe-command.mjs", "utf8");
    expect(source).to.include('".mainnet-command.lock"');
    expect(source).to.include('".mainnet-safe-command.lock"');
    expect(source).to.include('"--network"');
    expect(source).to.include('"conflux"');
    expect(source).to.include('"--no-compile"');
    expect(source).not.to.include('"compile"');
    expect(source).not.to.include('"confluxTestnet"');
  });

  it("shares a production-command mutex with the protocol release wrapper", async function () {
    const [safeWrapper, releaseWrapper, safeRunner, releaseRunner] = await Promise.all([
      fs.readFile("scripts/espace-mainnet-safe-command.mjs", "utf8"),
      fs.readFile("scripts/espace-mainnet-release-command.mjs", "utf8"),
      fs.readFile("scripts/espace-mainnet-safe.mjs", "utf8"),
      fs.readFile("scripts/espace-mainnet-release.mjs", "utf8"),
    ]);
    expect(safeWrapper).to.include('".mainnet-command.lock"');
    expect(releaseWrapper).to.include('".mainnet-command.lock"');
    expect(safeWrapper).to.include("acquireExclusiveCommandLock");
    expect(releaseWrapper).to.include("acquireExclusiveCommandLock");
    for (const source of [safeWrapper, releaseWrapper, safeRunner, releaseRunner]) {
      expect(source).to.include("DEEPFAMILY_ESPACE_MAINNET_COMMAND_WRAPPER_TOKEN");
    }
    expect(safeRunner).to.include("SHARED_COMMAND_LOCK_PATH");
    expect(releaseRunner).to.include("SHARED_COMMAND_LOCK_PATH");
  });

  it("does not import owner signing or test-wallet derivation into the production creator", async function () {
    const source = await fs.readFile("scripts/espace-mainnet-safe.mjs", "utf8");
    for (const forbidden of [
      "signCanonicalSafeTransaction",
      "deriveAcceptanceWallets",
      "Wallet.createRandom",
      "signerPrivateKeys",
    ]) {
      expect(source, forbidden).not.to.include(forbidden);
    }
    expect(source).to.include("prepareCanonicalSafeDeployment");
    expect(source).to.include("assertCanonicalSafeDeploymentReceipt");
    expect(source).to.include("assertCanonicalSafeOperationalAcceptance");
  });

  it("recomputes the owner/salt prediction during status instead of trusting checkpoint data alone", async function () {
    const source = await fs.readFile("scripts/espace-mainnet-safe.mjs", "utf8");
    const statusStart = source.indexOf("const runStatus =");
    const mainStart = source.indexOf("export const main =", statusStart);
    const statusSource = source.slice(statusStart, mainStart);

    expect(statusStart).to.be.greaterThan(-1);
    expect(mainStart).to.be.greaterThan(statusStart);
    expect(statusSource).to.include("prepareCanonicalSafeDeployment");
    expect(statusSource).to.include("buildAndValidateSafeCreationIntent");
    expect(statusSource).to.include("predictedSafeAddress");
    expect(statusSource).to.include("checkpoint.safeAddress");
    expect(statusSource).to.include("gitWorkingTreeState");
    expect(statusSource).to.include("hashESpaceMainnetSafeInputs");
    expect(statusSource).not.to.include("decodedSetupFromFingerprint");
  });

  it("does not mislabel an interrupted execution as a fresh no-broadcast plan", async function () {
    const source = await fs.readFile("scripts/espace-mainnet-safe.mjs", "utf8");
    expect(source).to.include("An incomplete Safe deployment checkpoint");
    expect(source).to.include(
      "cannot create a new plan or claim that no transaction was broadcast",
    );
    expect(source).to.include("approvedPlan");
    expect(source).to.include("currentValidator");
    expect(source).to.include("exactlyMatchesApprovedPlan");
  });

  it("rechecks a hashless factory step after taking the execution lock", async function () {
    const source = await fs.readFile("scripts/espace-mainnet-safe.mjs", "utf8");
    const lockStart = source.indexOf("const releaseLock =");
    const factoryBroadcast = source.indexOf("const receipt = await transactionExecutor", lockStart);
    const lockedSource = source.slice(lockStart, factoryBroadcast);

    expect(lockStart).to.be.greaterThan(-1);
    expect(factoryBroadcast).to.be.greaterThan(lockStart);
    expect(lockedSource).to.include("lockedEntry.status");
    expect(lockedSource).to.include("provider.getCode(predictedSafeAddress)");
    expect(lockedSource).to.include("simulateFactoryCreation");
  });

  it("does not mislabel an interrupted or completed protocol release as a fresh plan", async function () {
    const source = await fs.readFile("scripts/espace-mainnet-release.mjs", "utf8");
    expect(source).to.include("An incomplete protocol release checkpoint");
    expect(source).to.include(
      "cannot create a new plan or claim that no transaction was broadcast",
    );
    expect(source).to.include(
      "eSpace Mainnet release is already complete; read-only revalidation passed",
    );
    expect(source).to.include("governanceSafeOperationalAcceptance");
    expect(source).to.include("safeOperationalAcceptance?.finality");
  });

  it("documents every Safe-specific authorization, budget and recovery input", async function () {
    const example = await fs.readFile(".env.example", "utf8");
    for (const name of [
      "ESPACE_MAINNET_SAFE_SALT_NONCE",
      "ESPACE_MAINNET_SAFE_MAX_CFX",
      "ESPACE_MAINNET_SAFE_CONFIRMATIONS",
      "ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT",
      "ESPACE_MAINNET_SAFE_CONFIRM",
      "ESPACE_MAINNET_SAFE_PLAN_DIGEST",
      "ESPACE_MAINNET_SAFE_RECOVERY_TX",
      "ESPACE_MAINNET_SAFE_ACCEPTANCE_TX",
    ]) {
      expect(example, name).to.include(`${name}=`);
    }
  });
});
