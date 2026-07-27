import { expect } from "chai";
import { ethers } from "ethers";

import {
  buildAndValidateSafeCreationIntent,
  assertSafeCreationCheckpointIntent,
} from "../scripts/lib/mainnetSafeIntent.mjs";
import {
  CANONICAL_SAFE_DEPLOYMENT_TYPE,
  CANONICAL_SAFE_VERSION,
  getCanonicalSafeDeploymentMetadata,
} from "../scripts/lib/safeGovernance.mjs";

const CHAIN_ID = 1030n;
const DEPLOYER = "0x1000000000000000000000000000000000000001";
const SAFE_ADDRESS = "0x4000000000000000000000000000000000000004";
const OTHER_ADDRESS = "0x9000000000000000000000000000000000000009";
const OWNERS = Object.freeze([
  "0x2000000000000000000000000000000000000002",
  "0x3000000000000000000000000000000000000003",
  "0x5000000000000000000000000000000000000005",
]);
const DEPLOYER_NONCE = 17;
const SALT_NONCE = "8675309";

const metadata = getCanonicalSafeDeploymentMetadata(CHAIN_ID);
const setupInterface = new ethers.Interface(metadata.singleton.abi);
const factoryInterface = new ethers.Interface(metadata.proxyFactory.abi);

const infrastructure = () => ({
  chainId: CHAIN_ID,
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
  canonicalProxyCodeHash: `0x${"ab".repeat(32)}`,
});

const fixture = ({
  setupOwners = OWNERS,
  threshold = 2,
  setupTarget = ethers.ZeroAddress,
  setupData = "0x",
  fallbackHandler = metadata.fallbackHandler.address,
  paymentToken = ethers.ZeroAddress,
  payment = 0,
  paymentReceiver = ethers.ZeroAddress,
  singleton = metadata.singleton.address,
  factorySaltNonce = SALT_NONCE,
  deploymentTarget = metadata.proxyFactory.address,
  deploymentValue = 0n,
  preparedMetadata = metadata,
  accountConfig,
  deploymentConfig,
  canonicalInfrastructure = infrastructure(),
} = {}) => {
  const initializer = setupInterface.encodeFunctionData("setup", [
    setupOwners,
    threshold,
    setupTarget,
    setupData,
    fallbackHandler,
    paymentToken,
    payment,
    paymentReceiver,
  ]);
  const deploymentData = factoryInterface.encodeFunctionData("createProxyWithNonce", [
    singleton,
    initializer,
    factorySaltNonce,
  ]);
  const preparedSafe = {
    safeAddress: SAFE_ADDRESS,
    deploymentTransaction: {
      to: deploymentTarget,
      value: deploymentValue,
      data: deploymentData,
    },
    safeAccountConfig: accountConfig ?? {
      owners: [...OWNERS],
      threshold: 2,
      to: ethers.ZeroAddress,
      data: "0x",
      fallbackHandler: metadata.fallbackHandler.address,
      paymentToken: ethers.ZeroAddress,
      payment: 0,
      paymentReceiver: ethers.ZeroAddress,
    },
    safeDeploymentConfig: deploymentConfig ?? {
      saltNonce: SALT_NONCE,
      safeVersion: CANONICAL_SAFE_VERSION,
      deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
    },
    metadata: preparedMetadata,
  };
  return {
    input: {
      ethers,
      preparedSafe,
      expectedDeployer: DEPLOYER,
      deployerNonce: DEPLOYER_NONCE,
      chainId: CHAIN_ID,
      orderedOwners: [...OWNERS],
      saltNonce: SALT_NONCE,
      canonicalInfrastructure,
    },
    initializer,
    deploymentData,
  };
};

const build = (options) => buildAndValidateSafeCreationIntent(fixture(options).input);

const checkpointFor = ({ intent, predictedSafeAddress }) => ({
  safeAddress: predictedSafeAddress,
  addresses: {
    deployer: intent.from,
    governanceSafe: predictedSafeAddress,
  },
  transactions: {
    createGovernanceSafe: {
      label: intent.label,
      kind: intent.kind,
      status: "planned",
      from: intent.from,
      request: {
        to: intent.to,
        value: intent.value,
        data: intent.data,
        nonce: intent.nonce,
        chainId: intent.chainId,
        gasLimit: "100000",
        gasPrice: "1",
      },
      dataHash: intent.dataHash,
      predictedAddress: null,
      maximumCostWei: "100000",
      hash: null,
      receipt: null,
    },
  },
});

describe("eSpace mainnet Safe creation intent", function () {
  it("strictly decodes the canonical factory call and zero-risk 2-of-3 setup", function () {
    const { intent, predictedSafeAddress, decodedSetup } = build();

    expect(intent).to.deep.include({
      label: "createGovernanceSafe",
      kind: "call",
      nonce: DEPLOYER_NONCE,
      from: ethers.getAddress(DEPLOYER),
      chainId: CHAIN_ID.toString(),
      to: metadata.proxyFactory.address,
      value: "0",
      predictedAddress: null,
    });
    expect(intent.dataHash).to.equal(ethers.keccak256(intent.data));
    expect(predictedSafeAddress).to.equal(ethers.getAddress(SAFE_ADDRESS));
    expect(decodedSetup).to.deep.include({
      proxyFactory: metadata.proxyFactory.address,
      singleton: metadata.singleton.address,
      threshold: "2",
      to: ethers.ZeroAddress,
      data: "0x",
      fallbackHandler: metadata.fallbackHandler.address,
      paymentToken: ethers.ZeroAddress,
      payment: "0",
      paymentReceiver: ethers.ZeroAddress,
      saltNonce: SALT_NONCE,
    });
    expect(decodedSetup.owners).to.deep.equal(OWNERS.map(ethers.getAddress));
    expect(decodedSetup.initializerHash).to.equal(ethers.keccak256(decodedSetup.initializer));
    expect(Object.isFrozen(intent)).to.equal(true);
    expect(Object.isFrozen(decodedSetup)).to.equal(true);
    expect(Object.isFrozen(decodedSetup.owners)).to.equal(true);
  });

  it("rejects a noncanonical factory, singleton, call value, or salt", function () {
    const cases = [
      [{ deploymentTarget: OTHER_ADDRESS }, /deployment factory differs/i],
      [{ singleton: OTHER_ADDRESS }, /singleton differs/i],
      [{ deploymentValue: 1n }, /value must be zero/i],
      [{ factorySaltNonce: "123" }, /salt nonce differs/i],
      [
        {
          deploymentConfig: {
            saltNonce: "123",
            safeVersion: CANONICAL_SAFE_VERSION,
            deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
          },
        },
        /deployment salt nonce differs/i,
      ],
    ];
    for (const [options, pattern] of cases) {
      expect(() => build(options)).to.throw(pattern);
    }
  });

  it("rejects changed owner order and every privileged or paid setup field", function () {
    const reordered = [OWNERS[1], OWNERS[0], OWNERS[2]];
    const cases = [
      [{ setupOwners: reordered }, /owners differ/i],
      [{ threshold: 1 }, /threshold must be 2/i],
      [{ setupTarget: OTHER_ADDRESS }, /delegatecall target must be the zero address/i],
      [{ setupData: "0x1234" }, /delegatecall data must be empty/i],
      [{ fallbackHandler: OTHER_ADDRESS }, /fallback handler differs/i],
      [{ paymentToken: OTHER_ADDRESS }, /payment token must be the zero address/i],
      [{ payment: 1 }, /payment must be zero/i],
      [{ paymentReceiver: OTHER_ADDRESS }, /payment receiver must be the zero address/i],
    ];
    for (const [options, pattern] of cases) {
      expect(() => build(options)).to.throw(pattern);
    }
  });

  it("rejects prepared account/deployment config that disagrees with decoded calldata", function () {
    expect(() =>
      build({
        accountConfig: {
          owners: [...OWNERS],
          threshold: 1,
          to: ethers.ZeroAddress,
          data: "0x",
          fallbackHandler: metadata.fallbackHandler.address,
          paymentToken: ethers.ZeroAddress,
          payment: 0,
          paymentReceiver: ethers.ZeroAddress,
        },
      }),
    ).to.throw(/account threshold must be 2/i);

    expect(() =>
      build({
        deploymentConfig: {
          saltNonce: SALT_NONCE,
          safeVersion: "1.4.1",
          deploymentType: CANONICAL_SAFE_DEPLOYMENT_TYPE,
        },
      }),
    ).to.throw(/pinned canonical profile/i);
  });

  it("rejects metadata and live infrastructure evidence that do not agree", function () {
    const badMetadata = {
      ...metadata,
      proxyFactory: { ...metadata.proxyFactory, address: OTHER_ADDRESS },
    };
    expect(() => build({ preparedMetadata: badMetadata })).to.throw(
      /proxyFactory address differs/i,
    );

    const badInfrastructure = infrastructure();
    badInfrastructure.components.singleton.actualCodeHash = `0x${"cd".repeat(32)}`;
    expect(() => build({ canonicalInfrastructure: badInfrastructure })).to.throw(
      /singleton infrastructure actualCodeHash/i,
    );

    const wrongRpc = infrastructure();
    wrongRpc.rpcChainId = "0x47";
    expect(() => build({ canonicalInfrastructure: wrongRpc })).to.throw(/different network/i);
  });

  it("accepts only the single checkpoint journal entry matching the call intent", function () {
    const built = build();
    const checkpoint = checkpointFor(built);
    const evidence = assertSafeCreationCheckpointIntent({
      checkpoint,
      intent: built.intent,
      predictedSafeAddress: built.predictedSafeAddress,
    });

    expect(evidence).to.deep.equal({
      label: "createGovernanceSafe",
      deployer: ethers.getAddress(DEPLOYER),
      nonce: DEPLOYER_NONCE,
      chainId: CHAIN_ID.toString(),
      dataHash: built.intent.dataHash,
      safeAddress: ethers.getAddress(SAFE_ADDRESS),
    });
    expect(Object.isFrozen(evidence)).to.equal(true);
  });

  it("rejects extra journal entries and any immutable checkpoint mismatch", function () {
    const built = build();
    const run = (mutate, intent = structuredClone(built.intent)) => {
      const checkpoint = checkpointFor(built);
      mutate(checkpoint, intent);
      return () =>
        assertSafeCreationCheckpointIntent({
          checkpoint,
          intent,
          predictedSafeAddress: built.predictedSafeAddress,
        });
    };

    expect(
      run((checkpoint) => {
        checkpoint.transactions.unreviewed = {};
      }),
    ).to.throw(/must contain only/i);
    expect(
      run((checkpoint) => {
        checkpoint.transactions.createGovernanceSafe.request.data = "0x1234";
      }),
    ).to.throw(/calldata differs/i);
    expect(
      run((checkpoint) => {
        checkpoint.transactions.createGovernanceSafe.request.nonce += 1;
      }),
    ).to.throw(/nonce differs/i);
    expect(
      run((checkpoint) => {
        checkpoint.transactions.createGovernanceSafe.predictedAddress = SAFE_ADDRESS;
      }),
    ).to.throw(/checkpoint predictedAddress must be null/i);
    expect(
      run((checkpoint, intent) => {
        intent.predictedAddress = SAFE_ADDRESS;
      }),
    ).to.throw(/intent predictedAddress must be null/i);
    expect(
      run((checkpoint) => {
        checkpoint.addresses.deployer = OTHER_ADDRESS;
      }),
    ).to.throw(/deployer address differs/i);
    expect(
      run((checkpoint) => {
        checkpoint.addresses.governanceSafe = OTHER_ADDRESS;
      }),
    ).to.throw(/governance Safe address differs/i);
    expect(
      run((checkpoint) => {
        checkpoint.safeAddress = OTHER_ADDRESS;
      }),
    ).to.throw(/safeAddress differs/i);
  });
});
