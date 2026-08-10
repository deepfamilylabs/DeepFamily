import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
import { normalizePortableCommand } from "../scripts/lib/portableCommand.mjs";

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
      entryScript:
        chainProfile.id === "espace"
          ? "scripts/espace-acceptance.mjs"
          : "scripts/ethereum-acceptance.mjs",
      arguments_,
      environment: {
        ...process.env,
        [acceptance.modeEnvironmentName]: mode,
        ...overrides,
      },
      childRunner: async (invocation) => calls.push(invocation),
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
    expect(ESPACE_CHAIN_PROFILE.mainnet).not.to.have.property(
      "testnetReleaseReportEnvironmentName",
    );
    expect(ETHEREUM_CHAIN_PROFILE.mainnet).not.to.have.property(
      "testnetReleaseReportEnvironmentName",
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
    it(`runs ${chainProfile.id} diagnostics without the production preflight`, async function () {
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

    it(`requires the complete preflight before ${chainProfile.id} release rehearsal`, async function () {
      const calls = await runFixture({ chainProfile, mode: "release-rehearsal" });
      expect(calls).to.have.length(2);
      const expectedPreflight = normalizePortableCommand({
        executable: "npm",
        args: ["run", "release:preflight"],
        platform: process.platform,
        env: calls[0].environment,
      });
      expect(calls[0]).to.include({
        executable: expectedPreflight.executable,
        label: "Production release preflight",
      });
      expect(calls[0].args).to.deep.equal(expectedPreflight.args);
      expect(calls[1].args).to.include("--no-compile");
      const tokenName = chainProfile.acceptance.wrapperTokenEnvironmentName;
      expect(calls[0].environment[tokenName]).to.be.a("string").and.not.equal("");
      expect(calls[1].environment[tokenName]).to.equal(calls[0].environment[tokenName]);
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

  it("fails before spawning for an invalid mode or arguments", async function () {
    const calls = [];
    const options = {
      chainProfile: ESPACE_CHAIN_PROFILE,
      entryScript: "scripts/espace-acceptance.mjs",
      childRunner: async (invocation) => calls.push(invocation),
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
      await runAcceptanceCommand({
        chainProfile,
        entryScript: "scripts/espace-acceptance.mjs",
        arguments_: [],
        environment: {
          [acceptance.modeEnvironmentName]: "release-rehearsal",
        },
        root,
        childRunner: async (invocation) => {
          calls.push(invocation);
          const [commandLock, buildLock] = await Promise.all([
            fs.readFile(commandLockPath, "utf8").then(JSON.parse),
            fs.readFile(buildLockPath, "utf8").then(JSON.parse),
          ]);
          expect(invocation.environment[acceptance.wrapperTokenEnvironmentName]).to.equal(
            commandLock.token,
          );
          expect(buildLock.token).to.be.a("string").and.not.equal("");
          await assertAcceptanceReleaseRehearsalWrapper({
            chainProfile,
            environment: invocation.environment,
            root,
          });
        },
      });
      expect(calls).to.have.length(2);
      expect(await pathExists(commandLockPath)).to.equal(false);
      expect(await pathExists(buildLockPath)).to.equal(false);
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
          entryScript: "scripts/espace-acceptance.mjs",
          arguments_: [],
          environment: {
            [acceptance.modeEnvironmentName]: "release-rehearsal",
          },
          root,
          childRunner: async (invocation) => calls.push(invocation),
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
    const rpcConnect = source.indexOf("await hre.network.connect()");
    expect(wrapperCheck).to.be.greaterThan(-1);
    expect(rpcConnect).to.be.greaterThan(wrapperCheck);
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
