import { expect } from "chai";
import fs from "node:fs/promises";

import { ESPACE_CHAIN_PROFILE } from "../scripts/lib/chainProfiles.mjs";
import {
  runMainnetReleaseCommand,
  runMainnetSafeCommand,
} from "../scripts/lib/mainnetCommandWrapper.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

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
      entryScript: "scripts/espace-mainnet-safe.mjs",
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
    });
    expect(calls[0].environment[ESPACE_CHAIN_PROFILE.mainnet.safeWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
    expect(calls[0].environment[ESPACE_CHAIN_PROFILE.mainnet.sharedWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
  });

  it("uses one sanitized environment for release preflight and the Mainnet release child", async function () {
    const calls = [];

    await runMainnetReleaseCommand({
      chainProfile: ESPACE_CHAIN_PROFILE,
      arguments_: [],
      entryScript: "scripts/espace-mainnet-release.mjs",
      environment: injectedEnvironment,
      root,
      preflightRunner: async (environment) => {
        calls.push({ kind: "preflight", environment });
      },
      hardhatRunner: async (_args, environment) => {
        calls.push({ kind: "hardhat", environment });
      },
    });

    expect(calls.map(({ kind }) => kind)).to.deep.equal(["preflight", "hardhat"]);
    for (const call of calls) expectSanitized(call.environment);
    expect(calls[1].environment).to.equal(calls[0].environment);
    expect(calls[0].environment[ESPACE_CHAIN_PROFILE.mainnet.releaseWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
    expect(calls[0].environment[ESPACE_CHAIN_PROFILE.mainnet.sharedWrapperTokenEnvironmentName])
      .to.be.a("string")
      .and.not.equal("");
  });
});
