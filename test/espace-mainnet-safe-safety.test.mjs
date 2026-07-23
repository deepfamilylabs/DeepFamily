import { expect } from "chai";
import { ethers } from "ethers";

import {
  ESPACE_MAINNET_SAFE_CONFIRMATION,
  ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN,
  assertMainnetSafePlanMatchesCheckpoint,
  buildMainnetSafePlanFingerprint,
  canonicalMainnetSafePlanJson,
  deriveMainnetSafePlanDigest,
  parseESpaceMainnetSafeAuthorization,
  parseESpaceMainnetSafeConfig,
  parseMainnetSafeAuthorization,
} from "../scripts/lib/espaceMainnetSafeSafety.mjs";
import { getCanonicalSafeDeploymentMetadata } from "../scripts/lib/safeGovernance.mjs";

const DEPLOYER = "0x2000000000000000000000000000000000000002";
const PREDICTED_SAFE = "0x1000000000000000000000000000000000000001";
const OWNERS = [
  "0x3000000000000000000000000000000000000003",
  "0x4000000000000000000000000000000000000004",
  "0x5000000000000000000000000000000000000005",
];
const PLAN_DIGEST = `0x${"ab".repeat(32)}`;
const RECOVERY_TX = `0x${"cd".repeat(32)}`;
const RELEASE_COMMIT = "12".repeat(20);

const baseEnv = (overrides = {}) => ({
  ESPACE_MAINNET_SAFE_CONFIRM: "",
  ESPACE_MAINNET_SAFE_PLAN_DIGEST: "",
  ESPACE_MAINNET_EXPECTED_DEPLOYER: DEPLOYER,
  ESPACE_MAINNET_SAFE_OWNERS: OWNERS.join(","),
  ESPACE_MAINNET_SAFE_SALT_NONCE: "123456789",
  ESPACE_MAINNET_SAFE_MAX_CFX: "0.25",
  ESPACE_MAINNET_SAFE_CONFIRMATIONS: "2",
  ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT: "3600",
  GOVERNANCE_MULTISIG_PROFILE: "conflux-safe-1.3.0-2of3",
  ...overrides,
});

const parse = (overrides = {}, context = {}) =>
  parseESpaceMainnetSafeConfig({
    env: baseEnv(overrides),
    networkName: context.networkName ?? "conflux",
    chainId: context.chainId ?? 1030n,
  });

const canonicalInfrastructure = (overrides = {}) => {
  const metadata = getCanonicalSafeDeploymentMetadata(1030n);
  return {
    chainId: 1030n,
    rpcChainId: "0x406",
    components: Object.fromEntries(
      ["singleton", "proxyFactory", "fallbackHandler"].map((name) => [
        name,
        {
          address: metadata[name].address,
          expectedCodeHash: metadata[name].codeHash,
          actualCodeHash: metadata[name].codeHash,
          matched: true,
        },
      ]),
    ),
    canonicalProxyCodeHash: `0x${"55".repeat(32)}`,
    ...overrides,
  };
};

const fingerprintArguments = (overrides = {}) => {
  const metadata = getCanonicalSafeDeploymentMetadata(1030n);
  return {
    config: parse(),
    releaseCommit: RELEASE_COMMIT,
    safeToolInputs: {
      digest: `0x${"11".repeat(32)}`,
      files: {
        "package-lock.json": `0x${"22".repeat(32)}`,
        "scripts/lib/safeGovernance.mjs": `0x${"33".repeat(32)}`,
      },
    },
    deployerNonce: 7,
    predictedSafeAddress: PREDICTED_SAFE,
    deploymentTransaction: {
      to: metadata.proxyFactory.address,
      value: 0n,
      data: "0x1234",
    },
    canonicalInfrastructure: canonicalInfrastructure(),
    ...overrides,
  };
};

describe("eSpace Mainnet Safe creation safety", function () {
  it("uses an atomic blank authorization pair for plan mode", function () {
    const authorization = parseESpaceMainnetSafeAuthorization(baseEnv());
    expect(authorization).to.deep.equal({
      mode: "plan",
      confirmation: null,
      configuredPlanDigest: null,
    });
    // Planning must not depend on or even inspect a deployer private key.
    expect(parse({ PRIVATE_KEY: undefined }).mode).to.equal("plan");
    expect(parseMainnetSafeAuthorization(baseEnv())).to.deep.equal(authorization);
  });

  it("requires the exact confirmation and a 32-byte reviewed digest for execute mode", function () {
    const config = parse({
      ESPACE_MAINNET_SAFE_CONFIRM: ESPACE_MAINNET_SAFE_CONFIRMATION,
      ESPACE_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST.toUpperCase().replace("0X", "0x"),
    });
    expect(config.mode).to.equal("execute");
    expect(config.confirmation).to.equal(ESPACE_MAINNET_SAFE_CONFIRMATION);
    expect(config.configuredPlanDigest).to.equal(PLAN_DIGEST);

    expect(() =>
      parseESpaceMainnetSafeAuthorization(
        baseEnv({
          ESPACE_MAINNET_SAFE_CONFIRM: ESPACE_MAINNET_SAFE_CONFIRMATION,
          ESPACE_MAINNET_SAFE_PLAN_DIGEST: "",
        }),
      ),
    ).to.throw("must either both be blank");
    expect(() =>
      parseESpaceMainnetSafeAuthorization(
        baseEnv({
          ESPACE_MAINNET_SAFE_CONFIRM: "",
          ESPACE_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST,
        }),
      ),
    ).to.throw("must either both be blank");
    expect(() =>
      parseESpaceMainnetSafeAuthorization(
        baseEnv({
          ESPACE_MAINNET_SAFE_CONFIRM: "yes",
          ESPACE_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST,
        }),
      ),
    ).to.throw(`must be exactly ${ESPACE_MAINNET_SAFE_CONFIRMATION}`);
    expect(() =>
      parseESpaceMainnetSafeAuthorization(
        baseEnv({
          ESPACE_MAINNET_SAFE_CONFIRM: ESPACE_MAINNET_SAFE_CONFIRMATION,
          ESPACE_MAINNET_SAFE_PLAN_DIGEST: "0x1234",
        }),
      ),
    ).to.throw("32-byte digest");
  });

  it("hard-locks network, chain and the canonical 2-of-3 Safe profile", function () {
    expect(() => parse({}, { networkName: "confluxTestnet" })).to.throw(
      "restricted to network conflux",
    );
    expect(() => parse({}, { chainId: 71n })).to.throw("requires chainId 1030");
    expect(() => parse({ GOVERNANCE_MULTISIG_PROFILE: "" })).to.throw(
      "requires GOVERNANCE_MULTISIG_PROFILE=conflux-safe-1.3.0-2of3",
    );
  });

  it("requires exactly three distinct nonzero owners and preserves reviewed input order", function () {
    expect(() => parse({ ESPACE_MAINNET_SAFE_OWNERS: OWNERS.slice(0, 2).join(",") })).to.throw(
      "exactly 3",
    );
    expect(() =>
      parse({ ESPACE_MAINNET_SAFE_OWNERS: [OWNERS[0], OWNERS[0], OWNERS[2]].join(",") }),
    ).to.throw("three distinct");
    expect(() =>
      parse({
        ESPACE_MAINNET_SAFE_OWNERS: [OWNERS[0], ethers.ZeroAddress, OWNERS[2]].join(","),
      }),
    ).to.throw("nonzero EVM address");
    expect(() => parse({ ESPACE_MAINNET_EXPECTED_DEPLOYER: OWNERS[1] })).to.throw(
      "must not be one of the Safe owners",
    );

    const reviewedOrder = [OWNERS[2], OWNERS[0], OWNERS[1]];
    expect(
      parse({ ESPACE_MAINNET_SAFE_OWNERS: reviewedOrder.join(",") }).expectedSafeOwners,
    ).to.deep.equal(reviewedOrder.map(ethers.getAddress));
  });

  it("requires an explicit canonical decimal uint256 salt", function () {
    expect(parse({ ESPACE_MAINNET_SAFE_SALT_NONCE: "0" }).saltNonce).to.equal("0");
    expect(
      parse({ ESPACE_MAINNET_SAFE_SALT_NONCE: ethers.MaxUint256.toString() }).saltNonce,
    ).to.equal(ethers.MaxUint256.toString());
    for (const invalid of ["", "-1", "+1", "01", "1.0", "1e3", "0x01"]) {
      expect(() => parse({ ESPACE_MAINNET_SAFE_SALT_NONCE: invalid })).to.throw(
        "must be explicitly set",
      );
    }
    expect(() =>
      parse({ ESPACE_MAINNET_SAFE_SALT_NONCE: (ethers.MaxUint256 + 1n).toString() }),
    ).to.throw("fit in uint256");
  });

  it("enforces a positive Safe-only CFX cap and bounded finality settings", function () {
    expect(parse().maxCfxWei).to.equal(ethers.parseEther("0.25"));
    for (const invalid of ["", "0", "-1", "1e2", "1.0000000000000000001"]) {
      expect(() => parse({ ESPACE_MAINNET_SAFE_MAX_CFX: invalid })).to.throw(
        invalid === "0" ? "greater than zero" : "explicitly set",
      );
    }
    expect(() => parse({ ESPACE_MAINNET_SAFE_CONFIRMATIONS: "1" })).to.throw("between 2 and 100");
    expect(() => parse({ ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT: "59" })).to.throw(
      "between 60 and 604800",
    );
  });

  it("accepts a recovery hash only in confirmed execute mode", function () {
    expect(parse().recoveryTransaction).to.equal(null);
    expect(() => parse({ ESPACE_MAINNET_SAFE_RECOVERY_TX: "0x12" })).to.throw("blank or a 32-byte");
    expect(() => parse({ ESPACE_MAINNET_SAFE_RECOVERY_TX: RECOVERY_TX })).to.throw(
      "only in confirmed execute mode",
    );
    expect(
      parse({
        ESPACE_MAINNET_SAFE_CONFIRM: ESPACE_MAINNET_SAFE_CONFIRMATION,
        ESPACE_MAINNET_SAFE_PLAN_DIGEST: PLAN_DIGEST,
        ESPACE_MAINNET_SAFE_RECOVERY_TX: RECOVERY_TX.toUpperCase().replace("0X", "0x"),
      }).recoveryTransaction,
    ).to.equal(RECOVERY_TX);
  });

  it("allows a fresh bootstrap without GOVERNANCE_MULTISIG and parses optional post-deploy evidence", function () {
    expect(parse({ GOVERNANCE_MULTISIG: "" }).governanceMultisig).to.equal(null);
    expect(
      parse({ GOVERNANCE_MULTISIG: PREDICTED_SAFE.toLowerCase() }).governanceMultisig,
    ).to.equal(PREDICTED_SAFE);
    expect(() => parse({ GOVERNANCE_MULTISIG: "0x1234" })).to.throw(
      "GOVERNANCE_MULTISIG must be an explicit nonzero EVM address",
    );

    expect(parse().acceptanceTransaction).to.equal(null);
    expect(
      parse({
        ESPACE_MAINNET_SAFE_ACCEPTANCE_TX: RECOVERY_TX.toUpperCase().replace("0X", "0x"),
      }).acceptanceTransaction,
    ).to.equal(RECOVERY_TX);
    expect(() => parse({ ESPACE_MAINNET_SAFE_ACCEPTANCE_TX: "0x12" })).to.throw(
      "blank or a 32-byte transaction hash",
    );
  });

  it("builds a stable, deeply frozen fingerprint over every critical review input", function () {
    const args = fingerprintArguments();
    const fingerprint = buildMainnetSafePlanFingerprint(args);
    expect(fingerprint.domain).to.equal(ESPACE_MAINNET_SAFE_PLAN_DIGEST_DOMAIN);
    expect(fingerprint.governanceSafe.owners).to.deep.equal(OWNERS);
    expect(fingerprint.governanceSafe.threshold).to.equal(2);
    expect(fingerprint.factoryTransaction.dataHash).to.equal(ethers.keccak256("0x1234"));
    expect(Object.isFrozen(fingerprint)).to.equal(true);
    expect(Object.isFrozen(fingerprint.safeToolInputs.files)).to.equal(true);

    const digest = deriveMainnetSafePlanDigest(fingerprint);
    expect(
      deriveMainnetSafePlanDigest(
        buildMainnetSafePlanFingerprint({
          ...args,
          safeToolInputs: {
            files: {
              "scripts/lib/safeGovernance.mjs": `0x${"33".repeat(32)}`,
              "package-lock.json": `0x${"22".repeat(32)}`,
            },
            digest: `0x${"11".repeat(32)}`,
          },
        }),
      ),
    ).to.equal(digest);

    const changedInputs = [
      { releaseCommit: "34".repeat(20) },
      {
        safeToolInputs: {
          ...args.safeToolInputs,
          digest: `0x${"44".repeat(32)}`,
        },
      },
      {
        safeToolInputs: {
          ...args.safeToolInputs,
          files: {
            ...args.safeToolInputs.files,
            "package-lock.json": `0x${"66".repeat(32)}`,
          },
        },
      },
      { deployerNonce: 8 },
      { predictedSafeAddress: "0x6000000000000000000000000000000000000006" },
      {
        deploymentTransaction: {
          ...args.deploymentTransaction,
          data: "0x1235",
        },
      },
      {
        canonicalInfrastructure: canonicalInfrastructure({
          canonicalProxyCodeHash: `0x${"77".repeat(32)}`,
        }),
      },
      {
        config: parse({
          ESPACE_MAINNET_SAFE_OWNERS: [...OWNERS].reverse().join(","),
        }),
      },
      { config: parse({ ESPACE_MAINNET_SAFE_SALT_NONCE: "123456790" }) },
      {
        config: parse({
          ESPACE_MAINNET_EXPECTED_DEPLOYER: "0x7000000000000000000000000000000000000007",
        }),
      },
      { config: parse({ ESPACE_MAINNET_SAFE_MAX_CFX: "0.26" }) },
      { config: parse({ ESPACE_MAINNET_SAFE_CONFIRMATIONS: "3" }) },
      { config: parse({ ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT: "3601" }) },
    ];
    for (const change of changedInputs) {
      const changed = buildMainnetSafePlanFingerprint({ ...args, ...change });
      expect(deriveMainnetSafePlanDigest(changed)).not.to.equal(digest);
    }
  });

  it("rejects fingerprints that omit provenance or do not target pinned infrastructure", function () {
    const args = fingerprintArguments();
    expect(() =>
      buildMainnetSafePlanFingerprint({
        ...args,
        safeToolInputs: { digest: `0x${"11".repeat(32)}`, files: {} },
      }),
    ).to.throw("non-empty path-to-digest map");
    expect(() =>
      buildMainnetSafePlanFingerprint({
        ...args,
        deploymentTransaction: {
          ...args.deploymentTransaction,
          to: PREDICTED_SAFE,
        },
      }),
    ).to.throw("canonical Safe ProxyFactory");
    expect(() =>
      buildMainnetSafePlanFingerprint({
        ...args,
        deploymentTransaction: {
          ...args.deploymentTransaction,
          value: 1n,
        },
      }),
    ).to.throw("value must be zero");
  });

  it("canonicalizes object keys while preserving owner array order", function () {
    expect(canonicalMainnetSafePlanJson({ b: 2, a: { d: 4, c: 3 } })).to.equal(
      '{"a":{"c":3,"d":4},"b":2}',
    );
    expect(canonicalMainnetSafePlanJson({ owners: OWNERS })).not.to.equal(
      canonicalMainnetSafePlanJson({ owners: [...OWNERS].reverse() }),
    );
  });

  it("compares the approved digest and immutable checkpoint fingerprint", function () {
    const fingerprint = buildMainnetSafePlanFingerprint(fingerprintArguments());
    const planDigest = deriveMainnetSafePlanDigest(fingerprint);
    const checkpoint = {
      schemaVersion: 1,
      planDigest,
      fingerprint,
    };
    expect(() =>
      assertMainnetSafePlanMatchesCheckpoint({ checkpoint, fingerprint, planDigest }),
    ).not.to.throw();
    expect(() =>
      assertMainnetSafePlanMatchesCheckpoint({
        checkpoint: { ...checkpoint, planDigest: PLAN_DIGEST },
        fingerprint,
        planDigest,
      }),
    ).to.throw("checkpoint digest");
    expect(() =>
      assertMainnetSafePlanMatchesCheckpoint({
        checkpoint,
        fingerprint: {
          ...fingerprint,
          executionPolicy: {
            ...fingerprint.executionPolicy,
            confirmations: 3,
          },
        },
        planDigest,
      }),
    ).to.throw("do not match the approved plan digest");
  });
});
