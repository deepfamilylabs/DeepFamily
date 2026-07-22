import "../hardhat-test-setup.mjs";
import { expect } from "chai";
import hre from "hardhat";
import {
  parseGovernanceMultisig,
  parsePositiveSafeInteger,
  resolveTimelockDeploymentConfig,
} from "../scripts/lib/timelockDeployment.mjs";
import { CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE } from "../scripts/lib/governanceSafety.mjs";

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
      /requires explicit MIN_DELAY, GOVERNANCE_MULTISIG/i,
    );
  });

  it("requires every live-network setting explicitly", async () => {
    await expect(resolve()).to.be.rejectedWith(/requires explicit MIN_DELAY, GOVERNANCE_MULTISIG/i);
    await expect(
      resolve({ env: { MIN_DELAY: "172800", GOVERNANCE_MULTISIG: " " } }),
    ).to.be.rejectedWith(/requires explicit GOVERNANCE_MULTISIG/i);
  });

  it("accepts only positive safe integer delays", function () {
    expect(parsePositiveSafeInteger("172800", "MIN_DELAY")).to.equal(172800);

    for (const invalid of ["", "0", "-1", "1.5", "seconds", "9007199254740992"]) {
      expect(() => parsePositiveSafeInteger(invalid, "MIN_DELAY")).to.throw(
        /positive safe integer/i,
      );
    }
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
    const env = { MIN_DELAY: "172800", GOVERNANCE_MULTISIG: multisig };
    await expect(resolve({ env })).to.be.rejectedWith(
      new RegExp(`${multisig}.*no contract code`, "i"),
    );

    const deployed = provider({ code: { [multisig.toLowerCase()]: "0x60006000" } });
    const config = await resolve({ env, provider: deployed });

    expect(config).to.deep.equal({
      isLocal: false,
      minDelay: 172800,
      governanceMultisig: multisig,
    });
  });

  it("propagates multisig policy inspection failures", async () => {
    const env = { MIN_DELAY: "172800", GOVERNANCE_MULTISIG: multisig };
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
    const originalProfile = process.env.GOVERNANCE_MULTISIG_PROFILE;
    process.env.GOVERNANCE_MULTISIG_PROFILE = CONFLUX_SAFE_1_3_0_2_OF_3_PROFILE;

    try {
      const config = await resolveTimelockDeploymentConfig({
        connection: { networkConfig: { type: "http" } },
        ethers: hre.ethers,
        env: { MIN_DELAY: "172800", GOVERNANCE_MULTISIG: deployedAddress },
        deployerAddress: deployer,
        provider: hre.ethers.provider,
      });
      expect(config).to.deep.equal({
        isLocal: false,
        minDelay: 172800,
        governanceMultisig: deployedAddress,
      });
    } finally {
      if (originalProfile === undefined) delete process.env.GOVERNANCE_MULTISIG_PROFILE;
      else process.env.GOVERNANCE_MULTISIG_PROFILE = originalProfile;
    }
  });
});
