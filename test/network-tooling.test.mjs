import { expect } from "chai";
import hre from "hardhat";
import {
  DEFAULT_CONFLUX_RPC_URLS,
  resolveConfluxRpcUrls,
  SOLIDITY_EVM_VERSION,
} from "../scripts/lib/hardhatConfig.mjs";
import { nativeCurrencySymbol, runNetworkCheck } from "../tasks/networks-check.mjs";
import { listSupportedNetworks, runNetworksList } from "../tasks/networks-list.mjs";

describe("Network tooling", function () {
  it("uses defaults for blank Conflux RPC overrides", function () {
    expect(resolveConfluxRpcUrls({})).to.deep.equal(DEFAULT_CONFLUX_RPC_URLS);
    expect(
      resolveConfluxRpcUrls({
        CONFLUX_RPC_URL: "  ",
        CONFLUX_TESTNET_RPC_URL: "",
      }),
    ).to.deep.equal(DEFAULT_CONFLUX_RPC_URLS);
  });

  it("trims and applies non-blank Conflux RPC overrides", function () {
    expect(
      resolveConfluxRpcUrls({
        CONFLUX_RPC_URL: "  https://mainnet-rpc.example  ",
        CONFLUX_TESTNET_RPC_URL: "https://testnet-rpc.example ",
      }),
    ).to.deep.equal({
      conflux: "https://mainnet-rpc.example",
      confluxTestnet: "https://testnet-rpc.example",
    });
  });

  it("resolves public-network RPCs and fixes every compiler profile to Cancun", async function () {
    expect(hre.config.networks).to.have.property("mainnet");
    expect(hre.config.networks).to.have.property("sepolia");
    expect(hre.config.networks).to.have.property("conflux");
    expect(hre.config.networks).to.have.property("confluxTestnet");
    expect(hre.config.networks).not.to.have.property("holesky");

    const expectedRpcUrls = resolveConfluxRpcUrls(process.env);
    expect(await hre.config.networks.conflux.url.get()).to.equal(expectedRpcUrls.conflux);
    expect(await hre.config.networks.confluxTestnet.url.get()).to.equal(
      expectedRpcUrls.confluxTestnet,
    );

    expect(SOLIDITY_EVM_VERSION).to.equal("cancun");
    expect(hre.config.solidity.profiles.production).to.deep.equal(
      hre.config.solidity.profiles.default,
    );
    expect(hre.config.solidity.profiles.default.isolated).to.equal(false);
    for (const profile of Object.values(hre.config.solidity.profiles)) {
      for (const compiler of profile.compilers) {
        expect(compiler.settings.evmVersion).to.equal(SOLIDITY_EVM_VERSION);
      }
      for (const compiler of Object.values(profile.overrides)) {
        expect(compiler.settings.evmVersion).to.equal(SOLIDITY_EVM_VERSION);
      }
    }

    const conflux = hre.config.chainDescriptors.get(1030n);
    const confluxTestnet = hre.config.chainDescriptors.get(71n);
    expect(conflux.blockExplorers.etherscan.url).to.equal("https://evm.confluxscan.org");
    expect(conflux.blockExplorers.etherscan.apiUrl).to.equal("https://evmapi.confluxscan.org/api/");
    expect(confluxTestnet.blockExplorers.etherscan.url).to.equal(
      "https://evmtestnet.confluxscan.org",
    );
    expect(confluxTestnet.blockExplorers.etherscan.apiUrl).to.equal(
      "https://evmapi-testnet.confluxscan.org/api/",
    );
    expect(hre.config.verify.etherscan.apiKey).to.respondTo("get");
  });

  it("lists deployable networks and prints real npm script commands", async function () {
    const networks = {
      default: { type: "edr-simulated", chainId: 31337 },
      node: { type: "edr-simulated", chainId: 31337 },
      hardhat: { type: "edr-simulated", chainId: 31337 },
      localhost: { type: "http", chainId: 31337 },
      sepolia: { type: "http", chainId: 11155111 },
      mainnet: { type: "http", chainId: 1 },
      confluxTestnet: { type: "http", chainId: 71 },
      conflux: { type: "http", chainId: 1030 },
    };
    const lines = [];

    expect(listSupportedNetworks(networks).map(({ name }) => name)).to.deep.equal([
      "conflux",
      "confluxTestnet",
      "mainnet",
      "sepolia",
      "localhost",
    ]);

    const result = await runNetworksList(
      {},
      { config: { networks } },
      { log: (line) => lines.push(line) },
    );

    expect(result).to.have.lengthOf(5);
    expect(lines).to.include("npm run deploy:net --net=conflux");
    expect(lines).to.include("npm run deploy:net --net=localhost");
    expect(lines).to.include("npm run verify:net --net=confluxTestnet");
    expect(lines.some((line) => line.includes("deploy:conflux"))).to.equal(false);
    expect(lines.some((line) => line.includes("verify:localhost"))).to.equal(false);
  });

  it("checks a Hardhat 3 connection and labels Conflux balances as CFX", async function () {
    const originalPrivateKey = process.env.PRIVATE_KEY;
    process.env.PRIVATE_KEY = `0x${"11".repeat(32)}`;

    let resolvedUrl = false;
    let connectedNetwork;
    let connectionClosed = false;
    const lines = [];
    const fakeProvider = {
      getNetwork: async () => ({ chainId: 71n }),
      getBlockNumber: async () => 12345,
      getBalance: async () => 10n ** 18n,
    };
    class FakeWallet {
      constructor() {
        this.address = "0x1111111111111111111111111111111111111111";
      }
    }
    const fakeHre = {
      config: {
        networks: {
          default: { type: "edr-simulated", chainId: 31337 },
          confluxTestnet: {
            type: "http",
            chainId: 71,
            url: {
              get: async () => {
                resolvedUrl = true;
                return "https://evmtestnet.confluxrpc.com";
              },
            },
          },
        },
      },
      network: {
        create: async (name) => {
          connectedNetwork = name;
          return {
            ethers: {
              provider: fakeProvider,
              Wallet: FakeWallet,
              formatEther: () => "1.0",
            },
            close: async () => {
              connectionClosed = true;
            },
          };
        },
      },
    };

    try {
      const summary = await runNetworkCheck(
        {
          delay: "0",
          only: "",
          exclude: "",
          includeMissing: false,
        },
        fakeHre,
        { log: (line) => lines.push(line), wait: async () => {} },
      );

      expect(summary).to.deep.equal({
        totalChecked: 1,
        success: 1,
        failed: 0,
        results: { confluxTestnet: true },
      });
      expect(resolvedUrl).to.equal(true);
      expect(connectedNetwork).to.equal("confluxTestnet");
      expect(connectionClosed).to.equal(true);
      expect(lines).to.include("  - Balance: 1.0 CFX");
      expect(nativeCurrencySymbol(1n)).to.equal("ETH");
    } finally {
      if (originalPrivateKey === undefined) {
        delete process.env.PRIVATE_KEY;
      } else {
        process.env.PRIVATE_KEY = originalPrivateKey;
      }
    }
  });
});
