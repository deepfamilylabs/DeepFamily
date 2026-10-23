import { expect } from "chai";
import fs from "node:fs/promises";
import path from "node:path";

import { ESPACE_CHAIN_PROFILE } from "../scripts/lib/chainProfiles.mjs";
import {
  parseMainnetReleaseCommandArguments,
  parseMainnetSafeCommandArguments,
  runMainnetReleaseCommand,
  runMainnetSafeCommand,
} from "../scripts/lib/mainnetCommandWrapper.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";
import { productionBuildLockPath } from "../scripts/lib/exclusiveCommandLock.mjs";
import { RELEASE_CHECK_BOUNDARY_ENV } from "../scripts/lib/releaseCheckBoundary.mjs";

const injectedEnvironment = Object.freeze({
  PATH: "/trusted/bin",
  RELEASE_VALUE: "preserved",
  NODE_OPTIONS: "--require=/untrusted/node-hook.cjs",
  node_path: "/untrusted/node-modules",
  LD_PRELOAD: "/untrusted/native-hook.so",
  ld_library_path: "/untrusted/native-libraries",
  DYLD_INSERT_LIBRARIES: "/untrusted/native-hook.dylib",
  dyld_library_path: "/untrusted/native-libraries",
  NPM_CONFIG_SCRIPT_SHELL: "/untrusted/shell",
  npm_config_node_options: "--require=/untrusted/npm-hook.cjs",
  GIT_CONFIG_COUNT: "1",
  git_config_key_0: "core.fsmonitor",
  DOTENV_CONFIG_PATH: "/untrusted/.env",
});
const PLAN_DIGEST = `0x${"ab".repeat(32)}`;
const RECOVERY_HASH = `0x${"cd".repeat(32)}`;
const CHECK_RESULT = Object.freeze({
  status: "checks-passed",
  releaseCommit: "a".repeat(40),
  zkManifestSha256: "b".repeat(64),
  zkTranscriptSha256: "c".repeat(64),
  protocolManifestSha256: "d".repeat(64),
  receiveManifestSha256: "e".repeat(64),
});

const releaseLockPaths = (root) => {
  const directory = path.join(
    root,
    "deployments",
    ESPACE_CHAIN_PROFILE.mainnet.deploymentDirectoryName,
  );
  return [
    productionBuildLockPath(root),
    path.join(directory, ".mainnet-command.lock"),
    path.join(directory, ".mainnet-release-command.lock"),
  ];
};

const pathExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const expectSanitized = (environment) => {
  expect(environment.PATH).to.equal("/trusted/bin");
  expect(environment.RELEASE_VALUE).to.equal("preserved");
  for (const name of Object.keys(injectedEnvironment).filter(
    (name) => !["PATH", "RELEASE_VALUE"].includes(name),
  )) {
    expect(environment).not.to.have.property(name);
  }
};

describe("mainnet command wrapper child environments", function () {
  let root;

  beforeEach(async function () {
    root = await createCanonicalTemporaryDirectory("deepfamily-mainnet-command-wrapper-");
  });

  afterEach(async function () {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("sanitizes the Mainnet Safe production child environment", async function () {
    const calls = [];

    await runMainnetSafeCommand({
      chainProfile: ESPACE_CHAIN_PROFILE,
      arguments_: ["--status"],
      entryScript: "scripts/evm-mainnet-safe.mjs",
      environment: injectedEnvironment,
      root,
      hardhatRunner: async (args, environment, label) => {
        calls.push({ args, environment, label });
      },
    });

    expect(calls).to.have.length(1);
    expectSanitized(calls[0].environment);
    expect(calls[0].environment).to.include({
      [ESPACE_CHAIN_PROFILE.mainnet.safeWrapperModeEnvironmentName]: "status",
      [ESPACE_CHAIN_PROFILE.mainnet.safePlanDigestEnvironmentName]: "",
      [ESPACE_CHAIN_PROFILE.mainnet.safeRecoveryTransactionEnvironmentName]: "",
    });
    expect(calls[0].environment[ESPACE_CHAIN_PROFILE.mainnet.safeWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
    expect(calls[0].environment[ESPACE_CHAIN_PROFILE.mainnet.sharedWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
  });

  it("uses explicit Safe plan/execute arguments and overrides stale authorization environment", async function () {
    const calls = [];
    const mainnet = ESPACE_CHAIN_PROFILE.mainnet;
    const environment = {
      ...injectedEnvironment,
      [mainnet.safePlanDigestEnvironmentName]: RECOVERY_HASH,
      [mainnet.safeRecoveryTransactionEnvironmentName]: PLAN_DIGEST,
    };
    const run = (arguments_) =>
      runMainnetSafeCommand({
        chainProfile: ESPACE_CHAIN_PROFILE,
        arguments_,
        entryScript: "scripts/evm-mainnet-safe.mjs",
        environment,
        root,
        hardhatRunner: async (_args, childEnvironment) => calls.push(childEnvironment),
      });

    await run(["--plan"]);
    await run(["--execute", "--digest", PLAN_DIGEST, "--recovery-tx", RECOVERY_HASH]);

    expect(calls[0]).to.include({
      [mainnet.safeWrapperModeEnvironmentName]: "plan",
      [mainnet.safePlanDigestEnvironmentName]: "",
      [mainnet.safeRecoveryTransactionEnvironmentName]: "",
    });
    expect(calls[1]).to.include({
      [mainnet.safeWrapperModeEnvironmentName]: "execute",
      [mainnet.safePlanDigestEnvironmentName]: PLAN_DIGEST,
      [mainnet.safeRecoveryTransactionEnvironmentName]: RECOVERY_HASH,
    });
  });

  it("keeps one-shot approval data out of release preflight", async function () {
    const calls = [];
    const heldTokens = [];
    const inspectLocks = async () => {
      const locks = await Promise.all(
        releaseLockPaths(root).map(async (file) => JSON.parse(await fs.readFile(file, "utf8"))),
      );
      heldTokens.push(locks.map(({ token }) => token));
    };

    await runMainnetReleaseCommand({
      chainProfile: ESPACE_CHAIN_PROFILE,
      arguments_: ["--plan"],
      entryScript: "scripts/evm-mainnet-release.mjs",
      environment: {
        ...injectedEnvironment,
        [RELEASE_CHECK_BOUNDARY_ENV]: "caller-supplied evidence",
        [RELEASE_CHECK_BOUNDARY_ENV.toLowerCase()]: "ambiguous caller evidence",
      },
      root,
      preflightRunner: async (environment) => {
        calls.push({ kind: "preflight", environment });
        await inspectLocks();
        return CHECK_RESULT;
      },
      hardhatRunner: async (args, environment) => {
        calls.push({ kind: "hardhat", args, environment });
        await inspectLocks();
      },
    });

    expect(calls.map(({ kind }) => kind)).to.deep.equal(["preflight", "hardhat"]);
    expect(calls[1].args).to.include("--no-compile");
    expect(heldTokens[1]).to.deep.equal(heldTokens[0]);
    for (const file of releaseLockPaths(root)) expect(await pathExists(file)).to.equal(false);
    for (const call of calls) expectSanitized(call.environment);
    expect(calls[0].environment).not.to.have.property(RELEASE_CHECK_BOUNDARY_ENV);
    expect(calls[0].environment).not.to.have.property(RELEASE_CHECK_BOUNDARY_ENV.toLowerCase());
    expect(calls[1].environment).not.to.have.property(RELEASE_CHECK_BOUNDARY_ENV.toLowerCase());
    expect(JSON.parse(calls[1].environment[RELEASE_CHECK_BOUNDARY_ENV])).to.deep.equal({
      schemaVersion: 1,
      ...CHECK_RESULT,
    });
    expect(calls[0].environment).to.include({
      [ESPACE_CHAIN_PROFILE.mainnet.planDigestEnvironmentName]: "",
      [ESPACE_CHAIN_PROFILE.mainnet.planApprovalSignaturesEnvironmentName]: "",
      [ESPACE_CHAIN_PROFILE.mainnet.recoveryTransactionsEnvironmentName]: "",
    });
    expect(calls[0].environment).not.to.have.property(
      ESPACE_CHAIN_PROFILE.mainnet.releaseWrapperTokenEnvironmentName,
    );
    expect(calls[1].environment[ESPACE_CHAIN_PROFILE.mainnet.releaseWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
    expect(calls[1].environment[ESPACE_CHAIN_PROFILE.mainnet.sharedWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
    expect(calls[1].environment).to.include({
      [ESPACE_CHAIN_PROFILE.mainnet.releaseWrapperModeEnvironmentName]: "plan",
      [ESPACE_CHAIN_PROFILE.mainnet.planDigestEnvironmentName]: "",
      [ESPACE_CHAIN_PROFILE.mainnet.planApprovalSignaturesEnvironmentName]: "",
      [ESPACE_CHAIN_PROFILE.mainnet.recoveryTransactionsEnvironmentName]: "",
    });
  });

  for (const failedPhase of ["checks", "release"]) {
    it(`releases all three locks when the ${failedPhase} phase fails and stops subsequent work`, async function () {
      const failure = new Error(`${failedPhase} failed`);
      const calls = [];
      const phase = async (name) => {
        calls.push(name);
        for (const file of releaseLockPaths(root)) expect(await pathExists(file)).to.equal(true);
        if (name === failedPhase) throw failure;
        return CHECK_RESULT;
      };
      let error;
      try {
        await runMainnetReleaseCommand({
          chainProfile: ESPACE_CHAIN_PROFILE,
          arguments_: ["--plan"],
          entryScript: "scripts/evm-mainnet-release.mjs",
          environment: injectedEnvironment,
          root,
          preflightRunner: async () => phase("checks"),
          hardhatRunner: async () => phase("release"),
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).to.equal(failure);
      expect(calls).to.deep.equal(failedPhase === "checks" ? ["checks"] : ["checks", "release"]);
      for (const file of releaseLockPaths(root)) expect(await pathExists(file)).to.equal(false);
    });
  }

  it("does not start the final release process without complete checks-passed evidence", async function () {
    for (const result of [
      undefined,
      { status: "failed" },
      { ...CHECK_RESULT, status: "passed" },
      { ...CHECK_RESULT, releaseCommit: undefined },
      { ...CHECK_RESULT, zkManifestSha256: "invalid" },
    ]) {
      let childRan = false;
      let error;
      try {
        await runMainnetReleaseCommand({
          chainProfile: ESPACE_CHAIN_PROFILE,
          arguments_: ["--plan"],
          entryScript: "scripts/evm-mainnet-release.mjs",
          environment: {
            [RELEASE_CHECK_BOUNDARY_ENV]: JSON.stringify({ schemaVersion: 1, ...CHECK_RESULT }),
          },
          root,
          preflightRunner: async () => result,
          hardhatRunner: async () => {
            childRan = true;
          },
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).to.be.instanceOf(Error);
      expect(childRan).to.equal(false);
      for (const file of releaseLockPaths(root)) expect(await pathExists(file)).to.equal(false);
    }
  });

  it("loads one release approval file and an optional recovery file for execute/resume", async function () {
    const mainnet = ESPACE_CHAIN_PROFILE.mainnet;
    const approvalPath = "inputs/approval.json";
    const recoveryPath = "inputs/recovery.json";
    await fs.mkdir(`${root}/inputs`, { recursive: true });
    await fs.writeFile(
      `${root}/${approvalPath}`,
      JSON.stringify({ planDigest: PLAN_DIGEST, signatures: ["0xsig-a", "0xsig-b"] }),
    );
    await fs.writeFile(
      `${root}/${recoveryPath}`,
      JSON.stringify({ governanceTimelock: RECOVERY_HASH }),
    );
    const calls = [];

    await runMainnetReleaseCommand({
      chainProfile: ESPACE_CHAIN_PROFILE,
      arguments_: ["--execute", "--approval-file", approvalPath, "--recovery-file", recoveryPath],
      entryScript: "scripts/evm-mainnet-release.mjs",
      environment: {
        ...injectedEnvironment,
        [mainnet.planDigestEnvironmentName]: RECOVERY_HASH,
        [mainnet.planApprovalSignaturesEnvironmentName]: "stale",
        [mainnet.recoveryTransactionsEnvironmentName]: "stale",
      },
      root,
      preflightRunner: async (environment) => {
        calls.push(environment);
        return CHECK_RESULT;
      },
      hardhatRunner: async (_args, environment) => calls.push(environment),
    });

    expect(calls).to.have.length(2);
    expect(calls[0]).to.include({
      [mainnet.planDigestEnvironmentName]: "",
      [mainnet.planApprovalSignaturesEnvironmentName]: "",
      [mainnet.recoveryTransactionsEnvironmentName]: "",
    });
    expect(calls[0]).not.to.have.property(mainnet.releaseWrapperTokenEnvironmentName);
    expect(calls[1]).to.include({
      [mainnet.releaseWrapperModeEnvironmentName]: "execute",
      [mainnet.planDigestEnvironmentName]: PLAN_DIGEST,
      [mainnet.planApprovalSignaturesEnvironmentName]: '["0xsig-a","0xsig-b"]',
      [mainnet.recoveryTransactionsEnvironmentName]: `{"governanceTimelock":"${RECOVERY_HASH}"}`,
    });
  });

  it("rejects implicit or malformed Mainnet command modes", function () {
    for (const arguments_ of [
      [],
      ["--execute"],
      ["--execute", "--digest", "0x12"],
      ["--plan", "--digest", PLAN_DIGEST],
    ]) {
      expect(() => parseMainnetSafeCommandArguments(ESPACE_CHAIN_PROFILE, arguments_)).to.throw();
    }
    for (const arguments_ of [
      [],
      ["--execute"],
      ["--execute", "--approval-file"],
      ["--plan", "--approval-file", "approval.json"],
    ]) {
      expect(() =>
        parseMainnetReleaseCommandArguments(ESPACE_CHAIN_PROFILE, arguments_),
      ).to.throw();
    }
  });
});
