import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import {
  assertProductionTimelockDelay,
  parseGovernanceMultisig,
  parsePositiveSafeInteger,
  resolveTimelockDeploymentConfig,
} from "../scripts/lib/timelockDeployment.mjs";
import { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE } from "../scripts/lib/governanceSafety.mjs";
import { deployIntegratedSystem } from "../hardhat/integratedDeployment.mjs";

describe("Timelock deployment configuration", function () {
  const deployer = "0x0000000000000000000000000000000000000001";
  const multisig = "0x0000000000000000000000000000000000000002";
  const provider = ({ chainId = 1n, code = {} } = {}) => ({
    getNetwork: async () => ({ chainId }),
    getCode: async (address) => code[address.toLowerCase()] ?? "0x",
  });

  const inspectMultisig = async ({ provider: rpc, address, label }) => {
    const code = await rpc.getCode(address);
    if (code === "0x") throw new Error(`${label} ${address} has no contract code`);
    return { threshold: 2n, owners: [deployer, multisig] };
  };

  const resolve = (options = {}) =>
    resolveTimelockDeploymentConfig({
      connection: options.connection ?? { networkConfig: { type: "http" } },
      ethers: hre.ethers,
      env: options.env ?? {},
      deployerAddress: deployer,
      provider: options.provider ?? provider(),
      inspectMultisig: options.inspectMultisig ?? inspectMultisig,
    });

  it("keeps the 120-second deployer defaults on edr-simulated networks", async () => {
    const config = await resolve({
      connection: { networkConfig: { type: "edr-simulated", chainId: 999 } },
      provider: provider({ chainId: 999n }),
    });

    expect(config).to.deep.equal({
      isLocal: true,
      minDelay: 120,
      governanceMultisig: deployer,
    });
  });

  it("keeps local defaults for the explicitly named localhost network", async () => {
    const config = await resolve({
      connection: { networkName: "localhost", networkConfig: { type: "http", chainId: 31337 } },
      provider: provider({ chainId: 31337n }),
    });

    expect(config.isLocal).to.equal(true);
    expect(config.minDelay).to.equal(120);
    expect(config.governanceMultisig).to.equal(deployer);
  });

  it("does not trust chainId 31337 when the HTTP network is not explicitly local", async () => {
    await expect(resolve({ provider: provider({ chainId: 31337n }) })).to.be.rejectedWith(
      /requires explicit MIN_DELAY, GOVERNANCE_SAFE_ADDRESS/i,
    );
  });

  it("requires every live-network setting explicitly", async () => {
    await expect(resolve()).to.be.rejectedWith(
      /requires explicit MIN_DELAY, GOVERNANCE_SAFE_ADDRESS/i,
    );
    await expect(
      resolve({ env: { MIN_DELAY: "604800", GOVERNANCE_SAFE_ADDRESS: " " } }),
    ).to.be.rejectedWith(/requires explicit GOVERNANCE_SAFE_ADDRESS/i);
  });

  it("accepts only positive safe integer delays", function () {
    expect(parsePositiveSafeInteger("604800", "MIN_DELAY")).to.equal(604800);

    for (const invalid of ["", "0", "-1", "1.5", "seconds", "9007199254740992"]) {
      expect(() => parsePositiveSafeInteger(invalid, "MIN_DELAY")).to.throw(
        /positive safe integer/i,
      );
    }
  });

  it("requires seven days on both mainnets before inspecting the governance wallet", async () => {
    for (const chainId of [1n, 1030n]) {
      for (const minDelay of [86400, 172800, 604799]) {
        await expect(
          resolve({
            env: { MIN_DELAY: String(minDelay), GOVERNANCE_SAFE_ADDRESS: multisig },
            provider: provider({ chainId }),
          }),
        ).to.be.rejectedWith(/at least 604800 seconds \(7 days\) on mainnet/i);
      }
      for (const minDelay of [604800, 1209600]) {
        const config = await resolve({
          env: { MIN_DELAY: String(minDelay), GOVERNANCE_SAFE_ADDRESS: multisig },
          provider: provider({ chainId, code: { [multisig.toLowerCase()]: "0x60006000" } }),
        });
        expect(config.minDelay).to.equal(minDelay);
      }
    }
  });

  it("checks the actual HTTP chain even with a testnet or localhost network name", async () => {
    for (const networkName of ["sepolia", "localhost"]) {
      await expect(
        resolve({
          connection: { networkName, networkConfig: { type: "http", chainId: 31337 } },
          env: { MIN_DELAY: "120", GOVERNANCE_SAFE_ADDRESS: multisig },
          provider: provider({ chainId: 1n }),
        }),
      ).to.be.rejectedWith(/at least 604800 seconds/i);
    }
    await expect(
      resolve({
        connection: { networkName: "localhost", networkConfig: { type: "http", chainId: 31337 } },
        env: { MIN_DELAY: "604800" },
        provider: provider({ chainId: 1n }),
      }),
    ).to.be.rejectedWith(/requires explicit GOVERNANCE_SAFE_ADDRESS/i);
  });

  it("preserves short diagnostic Timelocks on both testnets", async () => {
    for (const chainId of [71n, 11155111n]) {
      const config = await resolve({
        env: { MIN_DELAY: "30", GOVERNANCE_SAFE_ADDRESS: multisig },
        provider: provider({ chainId, code: { [multisig.toLowerCase()]: "0x60006000" } }),
      });
      expect(config.minDelay).to.equal(30);
    }
  });

  it("keeps simulated networks independent of the production chain ID policy", async () => {
    const config = await resolve({
      connection: { networkConfig: { type: "edr-simulated", chainId: 1 } },
      provider: provider({ chainId: 1n }),
    });
    expect(config.minDelay).to.equal(120);
  });

  it("applies the same policy to an existing Timelock selected for a new mainnet deployment", async () => {
    await expect(
      assertProductionTimelockDelay({
        connection: { networkConfig: { type: "http" } },
        provider: provider(),
        minDelay: 172800n,
        label: "GovernanceTimelock minDelay",
      }),
    ).to.be.rejectedWith(/GovernanceTimelock minDelay must be at least 604800 seconds/i);
  });

  it("checks the selected Timelock before broadcasting a new mainnet protocol deployment", async () => {
    const [deployerSigner, firstOwner, secondOwner] = await hre.ethers.getSigners();
    const multisigContract = await hre.ethers.deployContract("TwoOfTwoMultisigMock", [
      firstOwner.address,
      secondOwner.address,
    ]);
    await multisigContract.waitForDeployment();
    const multisigAddress = await multisigContract.getAddress();
    const Timelock = await hre.ethers.getContractFactory("GovernanceTimelock");
    const shorter = await Timelock.deploy(604799, multisigAddress);
    const accepted = await Timelock.deploy(604800, multisigAddress);
    await Promise.all([shorter.waitForDeployment(), accepted.waitForDeployment()]);
    const nonceBefore = await deployerSigner.getNonce();

    for (const chainId of [1n, 1030n]) {
      // Keep every EVM read local; substitute only the RPC's reported chain identity.
      const mainnetProvider = new Proxy(hre.ethers.provider, {
        get(target, key) {
          if (key === "getNetwork") return async () => ({ chainId });
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const mainnetEthers = new Proxy(hre.ethers, {
        get(target, key) {
          if (key === "provider") return mainnetProvider;
          return Reflect.get(target, key, target);
        },
      });
      const connection = {
        networkName: "localhost",
        networkConfig: { type: "http", chainId: 31337 },
        ethers: mainnetEthers,
      };
      let broadcasts = 0;
      const options = {
        artifacts: hre.artifacts,
        governanceMultisig: multisigAddress,
        governanceMultisigProfile: "",
        transactionExecutor: async () => {
          broadcasts += 1;
          throw new Error("deployment preflight accepted; no broadcast");
        },
      };
      await expect(
        deployIntegratedSystem(connection, {
          ...options,
          governanceOwner: await shorter.getAddress(),
        }),
      ).to.be.rejectedWith(/at least 604800 seconds \(7 days\) on mainnet/i);
      expect(broadcasts).to.equal(0);
      await expect(
        deployIntegratedSystem(connection, {
          ...options,
          governanceOwner: await accepted.getAddress(),
        }),
      ).to.be.rejectedWith(/no approved production artifact set/i);
      expect(broadcasts).to.equal(0);
    }
    expect(await deployerSigner.getNonce()).to.equal(nonceBefore);
  });

  it("validates the single governance multisig address", function () {
    expect(parseGovernanceMultisig({ ethers: hre.ethers, value: multisig })).to.equal(multisig);
    expect(() => parseGovernanceMultisig({ ethers: hre.ethers, value: "not-an-address" })).to.throw(
      /valid address/i,
    );
    expect(() =>
      parseGovernanceMultisig({ ethers: hre.ethers, value: hre.ethers.ZeroAddress }),
    ).to.throw(/zero address/i);
  });

  it("requires a deployed, inspectable multisig on live networks", async () => {
    const env = { MIN_DELAY: "604800", GOVERNANCE_SAFE_ADDRESS: multisig };
    await expect(resolve({ env })).to.be.rejectedWith(
      new RegExp(`${multisig}.*no contract code`, "i"),
    );

    const deployed = provider({ code: { [multisig.toLowerCase()]: "0x60006000" } });
    const config = await resolve({ env, provider: deployed });

    expect(config).to.deep.equal({
      isLocal: false,
      minDelay: 604800,
      governanceMultisig: multisig,
    });
  });

  it("propagates multisig policy inspection failures", async () => {
    const env = { MIN_DELAY: "604800", GOVERNANCE_SAFE_ADDRESS: multisig };
    await expect(
      resolve({
        env,
        inspectMultisig: async () => {
          throw new Error("threshold=1; production requires at least 2");
        },
      }),
    ).to.be.rejectedWith(/threshold=1/i);
  });

  it("treats the injected env as authoritative when no wallet profile is supplied", async () => {
    const [, ownerA, ownerB] = await hre.ethers.getSigners();
    const Multisig = await hre.ethers.getContractFactory("TwoOfTwoMultisigMock");
    const deployedMultisig = await Multisig.deploy(
      await ownerA.getAddress(),
      await ownerB.getAddress(),
    );
    await deployedMultisig.waitForDeployment();
    const deployedAddress = await deployedMultisig.getAddress();
    const originalProfile = process.env.GOVERNANCE_SAFE_PROFILE;
    process.env.GOVERNANCE_SAFE_PROFILE = CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE;

    try {
      const config = await resolveTimelockDeploymentConfig({
        connection: { networkConfig: { type: "http" } },
        ethers: hre.ethers,
        env: { MIN_DELAY: "604800", GOVERNANCE_SAFE_ADDRESS: deployedAddress },
        deployerAddress: deployer,
        provider: hre.ethers.provider,
      });
      expect(config).to.deep.equal({
        isLocal: false,
        minDelay: 604800,
        governanceMultisig: deployedAddress,
      });
    } finally {
      if (originalProfile === undefined) delete process.env.GOVERNANCE_SAFE_PROFILE;
      else process.env.GOVERNANCE_SAFE_PROFILE = originalProfile;
    }
  });
});
