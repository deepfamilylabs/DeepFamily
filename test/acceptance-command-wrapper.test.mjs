import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { getChainErrorDetails, waitForTransactionHashReceipt } from "@deepfamily/chain-client";

import { ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE } from "../scripts/lib/chainProfiles.mjs";
import {
  acceptanceCommandLockPath,
  assertAcceptanceReleaseRehearsalWrapper,
  runAcceptanceCommand,
} from "../scripts/lib/acceptanceCommandWrapper.mjs";
import {
  acquireExclusiveCommandLock,
  productionBuildLockPath,
} from "../scripts/lib/exclusiveCommandLock.mjs";
import { RELEASE_CHECK_BOUNDARY_ENV } from "../scripts/lib/releaseCheckBoundary.mjs";

const CHECK_RESULT = Object.freeze({
  status: "checks-passed",
  releaseCommit: "a".repeat(40),
  zkManifestSha256: "b".repeat(64),
  zkTranscriptSha256: "c".repeat(64),
  protocolManifestSha256: "d".repeat(64),
  receiveManifestSha256: "e".repeat(64),
});

async function acceptanceReceiptRecorder({ confirmations = 3, waitForTransaction }) {
  const source = await fs.readFile("scripts/evm-acceptance.mjs", "utf8");
  const parsed = ts.createSourceFile("evm-acceptance.mjs", source, ts.ScriptTarget.Latest, true);
  let initializer;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "recordReceipt")
      initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  expect(initializer, "the real acceptance receipt recorder").to.exist;
  const report = { transactions: {} };
  let saves = 0;
  const record = vm.runInNewContext(`(${initializer.getText(parsed)})`, {
    assertCondition: (value, message) => { if (!value) throw new Error(message); },
    config: { confirmations }, TX_TIMEOUT_MS: 7500,
    provider: { waitForTransaction }, waitForTransactionHashReceipt,
    publicReceipt: (receipt) => receipt, report,
    saveReport: async () => { saves++; },
  });
  return { record, report, saves: () => saves };
}

const runFixture = async ({
  chainProfile,
  mode = "diagnostic",
  overrides = {},
  arguments_ = [],
}) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-acceptance-wrapper-"));
  const calls = [];
  const acceptance = chainProfile.acceptance;
  try {
    await runAcceptanceCommand({
      chainProfile,
      entryScript: "scripts/evm-acceptance.mjs",
      arguments_,
      environment: {
        ...process.env,
        [acceptance.modeEnvironmentName]: mode,
        ...overrides,
      },
      childRunner: async (invocation) => calls.push(invocation),
      preflightRunner: async (environment) => {
        calls.push({ kind: "checks", environment });
        return CHECK_RESULT;
      },
      root,
    });
    return calls;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
};

const pathExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

describe("acceptance command wrapper", function () {
  it("shares public EVM settings while keeping chain identities and wrapper tokens isolated", function () {
    const espace = ESPACE_CHAIN_PROFILE.acceptance;
    const ethereum = ETHEREUM_CHAIN_PROFILE.acceptance;
    const publicEnvironmentNames = {
      envPrefix: "EVM_E2E",
      modeEnvironmentName: "EVM_E2E_MODE",
      minDelayEnvironmentName: "EVM_E2E_MIN_DELAY",
      confirmationsEnvironmentName: "EVM_E2E_CONFIRMATIONS",
      maximumCostEnvironmentName: "EVM_E2E_MAX_NATIVE",
      runIdEnvironmentName: "EVM_E2E_RUN_ID",
      recoverEnvironmentName: "EVM_E2E_RECOVER",
      verifyEnvironmentName: "EVM_E2E_VERIFY",
      requireFinalityEnvironmentName: "EVM_E2E_REQUIRE_FINALITY",
      finalityTimeoutEnvironmentName: "EVM_E2E_FINALITY_TIMEOUT",
    };

    expect(espace).to.include(publicEnvironmentNames);
    expect(ethereum).to.include(publicEnvironmentNames);
    expect(espace.runIdDigestDomain).not.to.equal(ethereum.runIdDigestDomain);
    expect(espace.walletDerivationDomain).not.to.equal(ethereum.walletDerivationDomain);
    expect(espace.wrapperTokenEnvironmentName).to.equal("DEEPFAMILY_ESPACE_E2E_WRAPPER_TOKEN");
    expect(ethereum.wrapperTokenEnvironmentName).to.equal("DEEPFAMILY_ETHEREUM_E2E_WRAPPER_TOKEN");

    const mainnetPublicEnvironmentNames = {
      expectedDeployerEnvironmentName: "EVM_MAINNET_EXPECTED_DEPLOYER",
      safeOwnersEnvironmentName: "EVM_MAINNET_SAFE_OWNERS",
      safeSaltNonceEnvironmentName: "EVM_MAINNET_SAFE_SALT_NONCE",
      safeMaximumCostEnvironmentName: "EVM_MAINNET_SAFE_MAX_NATIVE",
      safeConfirmationsEnvironmentName: "EVM_MAINNET_CONFIRMATIONS",
      safeFinalityTimeoutEnvironmentName: "EVM_MAINNET_FINALITY_TIMEOUT",
      safePlanDigestEnvironmentName: "EVM_MAINNET_SAFE_PLAN_DIGEST",
      safeRecoveryTransactionEnvironmentName: "EVM_MAINNET_SAFE_RECOVERY_TX",
      safeAcceptanceTransactionEnvironmentName: "EVM_MAINNET_SAFE_ACCEPTANCE_TX",
      planDigestEnvironmentName: "EVM_MAINNET_PLAN_DIGEST",
      planApprovalSignaturesEnvironmentName: "EVM_MAINNET_PLAN_APPROVAL_SIGNATURES",
      maximumCostEnvironmentName: "EVM_MAINNET_MAX_NATIVE",
      confirmationsEnvironmentName: "EVM_MAINNET_CONFIRMATIONS",
      finalityTimeoutEnvironmentName: "EVM_MAINNET_FINALITY_TIMEOUT",
      recoveryTransactionsEnvironmentName: "EVM_MAINNET_RECOVERY_TXS",
    };
    expect(ESPACE_CHAIN_PROFILE.mainnet).to.include(mainnetPublicEnvironmentNames);
    expect(ETHEREUM_CHAIN_PROFILE.mainnet).to.include(mainnetPublicEnvironmentNames);
    expect(ESPACE_CHAIN_PROFILE.mainnet.testnetReleaseReportRelativePath).to.equal(
      "tmp/release-evidence/espace-release-rehearsal.json",
    );
    expect(ETHEREUM_CHAIN_PROFILE.mainnet.testnetReleaseReportRelativePath).to.equal(
      "tmp/release-evidence/ethereum-release-rehearsal.json",
    );
    expect(ESPACE_CHAIN_PROFILE.mainnet.safePlanDigestDomain).not.to.equal(
      ETHEREUM_CHAIN_PROFILE.mainnet.safePlanDigestDomain,
    );
    expect(ESPACE_CHAIN_PROFILE.mainnet.releasePlanDigestDomain).not.to.equal(
      ETHEREUM_CHAIN_PROFILE.mainnet.releasePlanDigestDomain,
    );
    expect(ESPACE_CHAIN_PROFILE.mainnet.releasePlanApprovalDomain).not.to.equal(
      ETHEREUM_CHAIN_PROFILE.mainnet.releasePlanApprovalDomain,
    );
  });

  for (const chainProfile of [ESPACE_CHAIN_PROFILE, ETHEREUM_CHAIN_PROFILE]) {
    it(`runs ${chainProfile.id} diagnostics without release checks`, async function () {
      const calls = await runFixture({ chainProfile });
      expect(calls).to.have.length(1);
      expect(calls[0].executable).to.equal(process.execPath);
      expect(calls[0].args).to.include.members([
        "--build-profile",
        "production",
        "--network",
        chainProfile.acceptance.networkName,
      ]);
      expect(calls[0].args).not.to.include("--no-compile");
    });

    it(`runs release checks before the final ${chainProfile.id} rehearsal verifier`, async function () {
      const calls = await runFixture({ chainProfile, mode: "release-rehearsal" });
      expect(calls).to.have.length(2);
      expect(calls[0].kind).to.equal("checks");
      expect(calls[1].executable).to.equal(process.execPath);
      expect(calls[1].args).to.include("--no-compile");
      const tokenName = chainProfile.acceptance.wrapperTokenEnvironmentName;
      expect(calls[0].environment[tokenName]).to.be.a("string").and.not.equal("");
      expect(calls[1].environment[tokenName]).to.equal(calls[0].environment[tokenName]);
      expect(calls[0].environment).not.to.have.property(RELEASE_CHECK_BOUNDARY_ENV);
      expect(JSON.parse(calls[1].environment[RELEASE_CHECK_BOUNDARY_ENV])).to.deep.equal({
        schemaVersion: 1,
        ...CHECK_RESULT,
      });
    });
  }

  it("sanitizes diagnostic and release-rehearsal child environments", async function () {
    const injected = {
      RELEASE_VALUE: "preserved",
      NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
      node_path: "/untrusted/node-modules",
      LD_PRELOAD: "/untrusted/native-hook.so",
      dYlD_insert_libraries: "/untrusted/native-hook.dylib",
      NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
      npm_config_node_options: "--require=/untrusted/npm-hook.cjs",
      GIT_CONFIG_COUNT: "1",
      dotenv_config_path: "/untrusted/.env",
    };
    for (const mode of ["diagnostic", "release-rehearsal"]) {
      const calls = await runFixture({
        chainProfile: ESPACE_CHAIN_PROFILE,
        mode,
        overrides: injected,
      });
      for (const invocation of calls) {
        expect(invocation.environment.RELEASE_VALUE).to.equal("preserved");
        for (const name of Object.keys(injected).filter((name) => name !== "RELEASE_VALUE")) {
          expect(invocation.environment, `${mode}: ${name}`).not.to.have.property(name);
        }
      }
    }
  });

  it("clears caller-supplied release evidence before checks and binds only their new result", async function () {
    const lowerName = RELEASE_CHECK_BOUNDARY_ENV.toLowerCase();
    for (const mode of ["diagnostic", "release-rehearsal"]) {
      const calls = await runFixture({
        chainProfile: ESPACE_CHAIN_PROFILE,
        mode,
        overrides: {
          [RELEASE_CHECK_BOUNDARY_ENV]: "caller-supplied evidence",
          [lowerName]: "ambiguous caller evidence",
        },
      });
      for (const call of calls) expect(call.environment).not.to.have.property(lowerName);
      expect(calls[0].environment).not.to.have.property(RELEASE_CHECK_BOUNDARY_ENV);
      if (mode === "release-rehearsal") {
        expect(JSON.parse(calls[1].environment[RELEASE_CHECK_BOUNDARY_ENV])).to.deep.equal({
          schemaVersion: 1,
          ...CHECK_RESULT,
        });
      }
    }
  });

  it("fails before spawning for an invalid mode or arguments", async function () {
    const calls = [];
    const options = {
      chainProfile: ESPACE_CHAIN_PROFILE,
      entryScript: "scripts/evm-acceptance.mjs",
      childRunner: async (invocation) => calls.push(invocation),
      preflightRunner: async (environment) => calls.push({ kind: "checks", environment }),
    };
    for (const variant of [
      {
        environment: {
          EVM_E2E_MODE: "unsafe",
        },
      },
      {
        environment: {
          EVM_E2E_MODE: "diagnostic",
        },
        arguments_: ["--network", "mainnet"],
      },
    ]) {
      let error;
      try {
        await runAcceptanceCommand({ ...options, ...variant });
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(Error);
    }
    expect(calls).to.deep.equal([]);
  });

  it("holds both wrapper and production-build locks through preflight and acceptance", async function () {
    const chainProfile = ESPACE_CHAIN_PROFILE;
    const acceptance = chainProfile.acceptance;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-acceptance-locks-"));
    const commandLockPath = acceptanceCommandLockPath(chainProfile, root);
    const buildLockPath = productionBuildLockPath(root);
    const calls = [];
    try {
      const assertHeldLocks = async (environment) => {
        const [commandLock, buildLock] = await Promise.all([
          fs.readFile(commandLockPath, "utf8").then(JSON.parse),
          fs.readFile(buildLockPath, "utf8").then(JSON.parse),
        ]);
        expect(environment[acceptance.wrapperTokenEnvironmentName]).to.equal(commandLock.token);
        expect(buildLock.token).to.be.a("string").and.not.equal("");
        await assertAcceptanceReleaseRehearsalWrapper({ chainProfile, environment, root });
      };
      await runAcceptanceCommand({
        chainProfile,
        entryScript: "scripts/evm-acceptance.mjs",
        arguments_: [],
        environment: {
          ...process.env,
          [acceptance.modeEnvironmentName]: "release-rehearsal",
        },
        root,
        preflightRunner: async (environment) => {
          calls.push("checks");
          await assertHeldLocks(environment);
          return CHECK_RESULT;
        },
        childRunner: async (invocation) => {
          calls.push("acceptance");
          await assertHeldLocks(invocation.environment);
        },
      });
      expect(calls).to.deep.equal(["checks", "acceptance"]);
      expect(await pathExists(commandLockPath)).to.equal(false);
      expect(await pathExists(buildLockPath)).to.equal(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  for (const failedPhase of ["checks", "acceptance"]) {
    it(`releases both locks when the ${failedPhase} phase fails and stops subsequent work`, async function () {
      const chainProfile = ESPACE_CHAIN_PROFILE;
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-acceptance-failure-"));
      const failure = new Error(`${failedPhase} failed`);
      const calls = [];
      const phase = async (name) => {
        calls.push(name);
        expect(await pathExists(acceptanceCommandLockPath(chainProfile, root))).to.equal(true);
        expect(await pathExists(productionBuildLockPath(root))).to.equal(true);
        if (name === failedPhase) throw failure;
        return CHECK_RESULT;
      };
      try {
        let error;
        try {
          await runAcceptanceCommand({
            chainProfile,
            entryScript: "scripts/evm-acceptance.mjs",
            arguments_: [],
            environment: { [chainProfile.acceptance.modeEnvironmentName]: "release-rehearsal" },
            root,
            preflightRunner: async () => phase("checks"),
            childRunner: async () => phase("acceptance"),
          });
        } catch (caught) {
          error = caught;
        }
        expect(error).to.equal(failure);
        expect(calls).to.deep.equal(
          failedPhase === "checks" ? ["checks"] : ["checks", "acceptance"],
        );
        expect(await pathExists(acceptanceCommandLockPath(chainProfile, root))).to.equal(false);
        expect(await pathExists(productionBuildLockPath(root))).to.equal(false);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });
  }

  it("does not start the final rehearsal without complete checks-passed evidence", async function () {
    const chainProfile = ESPACE_CHAIN_PROFILE;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-acceptance-boundary-"));
    try {
      for (const result of [
        undefined,
        { status: "failed" },
        { ...CHECK_RESULT, status: "passed" },
        { ...CHECK_RESULT, receiveManifestSha256: undefined },
        { ...CHECK_RESULT, zkTranscriptSha256: "invalid" },
      ]) {
        let childRan = false;
        let error;
        try {
          await runAcceptanceCommand({
            chainProfile,
            entryScript: "scripts/evm-acceptance.mjs",
            arguments_: [],
            environment: {
              [chainProfile.acceptance.modeEnvironmentName]: "release-rehearsal",
              [RELEASE_CHECK_BOUNDARY_ENV]: JSON.stringify({ schemaVersion: 1, ...CHECK_RESULT }),
            },
            root,
            preflightRunner: async () => result,
            childRunner: async () => {
              childRan = true;
            },
          });
        } catch (caught) {
          error = caught;
        }
        expect(error).to.be.instanceOf(Error);
        expect(childRan).to.equal(false);
        expect(await pathExists(acceptanceCommandLockPath(chainProfile, root))).to.equal(false);
        expect(await pathExists(productionBuildLockPath(root))).to.equal(false);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects direct release-rehearsal invocation without the wrapper lock and token", async function () {
    const chainProfile = ETHEREUM_CHAIN_PROFILE;
    const acceptance = chainProfile.acceptance;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-acceptance-direct-"));
    try {
      let error;
      try {
        await assertAcceptanceReleaseRehearsalWrapper({
          chainProfile,
          environment: {},
          root,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).to.include("direct release-rehearsal script execution is forbidden");

      error = undefined;
      try {
        await assertAcceptanceReleaseRehearsalWrapper({
          chainProfile,
          environment: { [acceptance.wrapperTokenEnvironmentName]: "not-a-wrapper-token" },
          root,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).to.include("wrapper lock is missing");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("releases its command lock when the shared production-build lock is already held", async function () {
    const chainProfile = ESPACE_CHAIN_PROFILE;
    const acceptance = chainProfile.acceptance;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-acceptance-race-"));
    const buildLock = await acquireExclusiveCommandLock({
      lockPath: productionBuildLockPath(root),
      label: "test production build",
    });
    const calls = [];
    try {
      let error;
      try {
        await runAcceptanceCommand({
          chainProfile,
          entryScript: "scripts/evm-acceptance.mjs",
          arguments_: [],
          environment: {
            [acceptance.modeEnvironmentName]: "release-rehearsal",
          },
          root,
          childRunner: async (invocation) => calls.push(invocation),
          preflightRunner: async (environment) => calls.push({ kind: "checks", environment }),
        });
      } catch (caught) {
        error = caught;
      }
      expect(error?.message).to.include("shared production build lock already exists");
      expect(calls).to.deep.equal([]);
      expect(await pathExists(acceptanceCommandLockPath(chainProfile, root))).to.equal(false);
    } finally {
      await buildLock.release();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("checks the release-rehearsal wrapper before opening the RPC", async function () {
    const source = await fs.readFile("scripts/evm-acceptance.mjs", "utf8");
    const wrapperCheck = source.indexOf("await assertAcceptanceReleaseRehearsalWrapper");
    const rpcConnect = source.indexOf("await hre.network.create()");
    expect(wrapperCheck).to.be.greaterThan(-1);
    expect(rpcConnect).to.be.greaterThan(wrapperCheck);
  });

  it("passes the deployed Archive into the acceptance NFT mint", async function () {
    // Execute only the real call expression: running the acceptance engine itself sends transactions.
    const source = await fs.readFile("scripts/evm-acceptance.mjs", "utf8");
    const parsed = ts.createSourceFile("evm-acceptance.mjs", source, ts.ScriptTarget.Latest, true);
    const mintCalls = [];
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          node.expression.text === "mintPersonVersionNFT") mintCalls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    expect(mintCalls).to.have.lengthOf(1);
    const archive = Object.freeze({ address: "deployed archive" });
    const deepFamily = Object.freeze({ address: "deployed family" });
    const runDeployer = Object.freeze({ address: "run deployer" });
    const input = vm.runInNewContext(mintCalls[0].getText(parsed), {
      mintPersonVersionNFT: (args) => args,
      archive, deepFamily, runDeployer,
      personHash: "test person hash", person: { fullName: "Acceptance test" },
      config: { runId: "test" }, CHAIN_PROFILE: { displayName: "Test chain" },
      disclosureProofArtifactPaths: {},
    });
    expect(input.archive).to.equal(archive);
    expect(input.deepFamily).to.equal(deepFamily);
    expect(input.signer).to.equal(runDeployer);
  });

  it("waits for configured confirmations before recording a helper's receipt", async function () {
    const receipt = { hash: `0x${"ab".repeat(32)}`, status: 1, blockNumber: 10 };
    let release;
    const wait = new Promise((resolve) => { release = resolve; });
    const calls = [];
    const fixture = await acceptanceReceiptRecorder({
      waitForTransaction: (...args) => { calls.push(args); return wait; },
    });
    const pending = fixture.record("helper-mint", receipt);
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).to.deep.equal([[receipt.hash, 3, 7500]]);
    expect(fixture.saves()).to.equal(0);
    expect(fixture.report.transactions).not.to.have.property("helper-mint");
    release(receipt);
    await pending;
    expect(fixture.report.transactions["helper-mint"]).to.equal(receipt);
    expect(fixture.saves()).to.equal(1);
  });

  it("does not record or resend a helper transaction when confirmation waiting times out", async function () {
    const receipt = { hash: `0x${"bc".repeat(32)}`, status: 1, blockNumber: 10 };
    const timeout = Object.assign(new Error("confirmation timeout"), { code: "TIMEOUT" });
    let waits = 0;
    const fixture = await acceptanceReceiptRecorder({
      waitForTransaction: async () => { waits++; throw timeout; },
    });
    let failure;
    try { await fixture.record("helper-mint", receipt); } catch (error) { failure = error; }
    expect(failure).to.equal(timeout);
    expect(getChainErrorDetails(failure)).to.include({ transactionHash: receipt.hash, retryable: false });
    expect(waits).to.equal(1);
    expect(fixture.saves()).to.equal(0);
    expect(fixture.report.transactions).to.deep.equal({});
  });

  for (const [name, confirmations, options] of [
    ["a one-confirmation receipt", 1, undefined],
    ["an executor receipt that already satisfies the policy", 3, { confirmationsSatisfied: true }],
  ]) it(`does not wait again for ${name}`, async function () {
    let waits = 0;
    const fixture = await acceptanceReceiptRecorder({
      confirmations, waitForTransaction: async () => { waits++; throw new Error("unexpected extra wait"); },
    });
    const receipt = { hash: `0x${"cd".repeat(32)}`, status: 1, blockNumber: 10 };
    await fixture.record("helper-mint", receipt, options);
    expect(waits).to.equal(0);
    expect(fixture.saves()).to.equal(1);
  });

  it("self-validates and publishes release evidence before reporting a passed rehearsal", async function () {
    const source = await fs.readFile("scripts/evm-acceptance.mjs", "utf8");
    const selfValidation = source.indexOf("await validateTestnetReleaseEvidence");
    const publication = source.indexOf("await publishTestnetReleaseEvidence");
    const passedMessage = source.indexOf("RELEASE REHEARSAL PASSED");
    expect(selfValidation).to.be.greaterThan(-1);
    expect(publication).to.be.greaterThan(selfValidation);
    expect(passedMessage).to.be.greaterThan(publication);
    expect(source).to.include('report.failedStep = "release-evidence-publication"');
    expect(source).to.include("report.releaseReady = false");
  });
});
