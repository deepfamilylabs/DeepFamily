import { expect } from "chai";
import { ethers } from "ethers";

import {
  ESPACE_MAINNET_CONFIRMATION,
  deriveMainnetPlanDigest,
  parseESpaceMainnetReleaseConfig,
  parseMainnetAuthorization,
} from "../scripts/lib/espaceMainnetReleaseSafety.mjs";

const SAFE = "0x1000000000000000000000000000000000000001";
const DEPLOYER = "0x2000000000000000000000000000000000000002";
const OWNERS = [
  "0x3000000000000000000000000000000000000003",
  "0x4000000000000000000000000000000000000004",
  "0x5000000000000000000000000000000000000005",
];
const PLAN_DIGEST = `0x${"ab".repeat(32)}`;

const baseEnv = (overrides = {}) => ({
  ESPACE_MAINNET_CONFIRM: "",
  ESPACE_MAINNET_PLAN_DIGEST: "",
  ESPACE_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  ESPACE_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  ESPACE_MAINNET_MAX_CFX: "12.5",
  ESPACE_MAINNET_CONFIRMATIONS: "2",
  ESPACE_MAINNET_FINALITY_TIMEOUT: "3600",
  GOVERNANCE_MULTISIG: SAFE,
  GOVERNANCE_MULTISIG_PROFILE: "conflux-safe-1.3.0-2of3",
  GOVERNANCE_OWNER: "",
  MIN_DELAY: "172800",
  ...overrides,
});

const parse = (overrides = {}, context = {}) =>
  parseESpaceMainnetReleaseConfig({
    env: baseEnv(overrides),
    networkName: context.networkName ?? "conflux",
    chainId: context.chainId ?? 1030n,
  });

describe("eSpace Mainnet release safety", function () {
  it("uses blank confirmation for plan mode and the exact mainnet string for execute mode", function () {
    expect(parseMainnetAuthorization(baseEnv()).mode).to.equal("plan");
    const config = parse({
      ESPACE_MAINNET_CONFIRM: ESPACE_MAINNET_CONFIRMATION,
      ESPACE_MAINNET_PLAN_DIGEST: PLAN_DIGEST,
    });
    expect(config.mode).to.equal("execute");
    expect(config.configuredPlanDigest).to.equal(PLAN_DIGEST);
  });

  it("rejects a wrong non-empty confirmation before release configuration is accepted", function () {
    expect(() => parseMainnetAuthorization(baseEnv({ ESPACE_MAINNET_CONFIRM: "yes" }))).to.throw(
      "blank for a read-only plan",
    );
  });

  it("hard-locks the Hardhat network and raw chain identity", function () {
    expect(() => parse({}, { networkName: "confluxTestnet" })).to.throw(
      "restricted to network conflux",
    );
    expect(() => parse({}, { chainId: 71n })).to.throw("requires chainId 1030");
  });

  it("requires the exact Safe profile and independent three-owner allowlist", function () {
    expect(() => parse({ GOVERNANCE_MULTISIG_PROFILE: "" })).to.throw(
      "requires GOVERNANCE_MULTISIG_PROFILE",
    );
    expect(() => parse({ ESPACE_MAINNET_SAFE_OWNERS: OWNERS.slice(0, 2).join(",") })).to.throw(
      "exactly three",
    );
    expect(() =>
      parse({ ESPACE_MAINNET_SAFE_OWNERS: [OWNERS[0], OWNERS[0], OWNERS[2]].join(",") }),
    ).to.throw("three distinct");
    expect(() => parse({ ESPACE_MAINNET_EXPECTED_DEPLOYER: OWNERS[1] })).to.throw(
      "must not be one of the Safe owners",
    );
  });

  it("enforces the production delay floor, finality, verification and an explicit budget", function () {
    expect(() => parse({ MIN_DELAY: "86399" })).to.throw("between 86400");
    expect(() => parse({ ESPACE_MAINNET_VERIFY: "0" })).to.throw("mandatory");
    expect(() => parse({ ESPACE_MAINNET_REQUIRE_FINALITY: "0" })).to.throw("mandatory");
    expect(() => parse({ ESPACE_MAINNET_MAX_CFX: "" })).to.throw("explicitly set");
    expect(() => parse({ ESPACE_MAINNET_CONFIRMATIONS: "1" })).to.throw("between 2 and 100");
  });

  it("forbids force-new and a caller-supplied governance owner", function () {
    expect(() => parse({ FORCE_NEW_DEPLOYMENT: "1" })).to.throw("forbidden");
    expect(() => parse({ GOVERNANCE_OWNER: SAFE })).to.throw("must be blank");
  });

  it("strictly parses recovery transaction hashes without accepting arbitrary JSON", function () {
    expect(() => parse({ ESPACE_MAINNET_RECOVERY_TXS: "[]" })).to.throw("JSON object");
    expect(() => parse({ ESPACE_MAINNET_RECOVERY_TXS: '{"bad label":"0x12"}' })).to.throw(
      "invalid label",
    );
    expect(() =>
      parse({
        ESPACE_MAINNET_RECOVERY_TXS: JSON.stringify({
          unknownReleaseStep: `0x${"12".repeat(32)}`,
        }),
      }),
    ).to.throw("unknown release label");
    const hash = `0x${"12".repeat(32)}`;
    expect(
      parse({ ESPACE_MAINNET_RECOVERY_TXS: JSON.stringify({ deepFamilyToken: hash }) })
        .recoveryTransactions.deepFamilyToken,
    ).to.equal(hash);
  });

  it("derives a deterministic digest that changes with any reviewed release input", function () {
    const fingerprint = {
      chainId: 1030n,
      safe: SAFE,
      owners: OWNERS,
      deployer: DEPLOYER,
      nonce: 9,
      budget: ethers.parseEther("12.5"),
    };
    const first = deriveMainnetPlanDigest(fingerprint);
    expect(deriveMainnetPlanDigest({ ...fingerprint })).to.equal(first);
    expect(deriveMainnetPlanDigest({ ...fingerprint, nonce: 10 })).not.to.equal(first);
    expect(deriveMainnetPlanDigest({ ...fingerprint, owners: [...OWNERS].reverse() })).not.to.equal(
      first,
    );
  });
});
