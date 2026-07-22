import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatTypechain from "@nomicfoundation/hardhat-typechain";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import "dotenv/config";

import { resolveConfluxRpcUrls, SOLIDITY_EVM_VERSION } from "./scripts/lib/hardhatConfig.mjs";
import addPersonTask from "./tasks/contract-add-person.mjs";
import endorseTask from "./tasks/contract-endorse.mjs";
import mintNftTask from "./tasks/contract-mint-nft.mjs";
import addPersonZkTask from "./tasks/zk-add-person.mjs";
import generateDisclosureBindingProofTask from "./tasks/zk-generate-disclosure-binding-proof.mjs";
import networksCheckTask from "./tasks/networks-check.mjs";
import networksListTask from "./tasks/networks-list.mjs";
import addStoryChunkTask from "./tasks/story-add-chunk.mjs";
import listStoryChunksTask from "./tasks/story-list-chunks.mjs";
import sealStoryTask from "./tasks/story-seal.mjs";
import governanceScheduleTask from "./tasks/governance-schedule.mjs";
import governanceExecuteTask from "./tasks/governance-execute.mjs";
import governanceCancelTask from "./tasks/governance-cancel.mjs";
import timelockStatusTask from "./tasks/timelock-status.mjs";
import timelockMigrateMultisigTask from "./tasks/timelock-migrate-multisig.mjs";
import timelockUpdateDelayTask from "./tasks/timelock-update-delay.mjs";
import timelockMigrateOwnerTask from "./tasks/timelock-migrate-owner.mjs";
import treasuryStatusTask from "./tasks/treasury-status.mjs";
import treasuryTransferTask from "./tasks/treasury-transfer.mjs";
import upgradeScheduleTask from "./tasks/upgrade-schedule.mjs";
import upgradeExecuteTask from "./tasks/upgrade-execute.mjs";
import {
  explorerApiKeyForNetwork,
  selectedHardhatNetwork,
} from "./tasks/lib/explorerVerification.mjs";

const PRIVATE_KEY =
  process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
// Hardhat 3 accepts one Etherscan-compatible API key per invocation. ConfluxScan only requires a
// non-empty placeholder; Ethereum verification deliberately keeps an absent key empty so the
// operator must explicitly provide a real Etherscan key.
const EXPLORER_API_KEY = explorerApiKeyForNetwork(
  selectedHardhatNetwork(),
  process.env.EXPLORER_API_KEY,
);
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || "";
const CONFLUX_RPC_URLS = resolveConfluxRpcUrls();

const solidityProfile = () => ({
  // Keep deployment and verification compiler inputs identical across Hardhat build profiles.
  isolated: false,
  toolVersionsInBuildInfo: false,
  compilers: [
    {
      version: "0.8.28",
      settings: {
        optimizer: {
          enabled: true,
          runs: 1,
        },
        // viaIR (Yul pipeline) keeps the shared artifact within the conservative 24,576-byte
        // cross-network budget used by this project. Conflux eSpace permits a larger artifact,
        // but keeping one portable build avoids network-specific production bytecode.
        // One deterministic compiler pipeline is used by diagnostics, release rehearsals and
        // production deployments so their bytecode manifests are directly comparable.
        viaIR: true,
        // ReentrancyGuardTransient requires EIP-1153, so this target must not be downgraded.
        evmVersion: SOLIDITY_EVM_VERSION,
        // Emit storage layout so the upgrade-safety checker can diff proxy contracts.
        outputSelection: {
          "*": {
            "*": ["storageLayout"],
          },
        },
      },
    },
  ],
  overrides: {
    "poseidon-solidity/PoseidonT5.sol": {
      version: "0.8.28",
      settings: {
        optimizer: {
          enabled: true,
          runs: 1,
        },
        viaIR: false,
        evmVersion: SOLIDITY_EVM_VERSION,
      },
    },
  },
});

/** @type {import('hardhat/config').HardhatUserConfig} */
export default {
  plugins: [
    hardhatEthers,
    hardhatEthersChaiMatchers,
    hardhatMocha,
    hardhatNetworkHelpers,
    hardhatTypechain,
    hardhatVerify,
  ],
  solidity: {
    npmFilesToBuild: ["poseidon-solidity/PoseidonT5.sol"],
    profiles: {
      default: solidityProfile(),
      production: solidityProfile(),
    },
  },

  networks: {
    // Default in-process simulated network used by Hardhat 3 when no --network is provided
    default: {
      type: "edr-simulated",
      chainId: 31337,
      allowUnlimitedContractSize: (process.env.UNLIMITED_SIZE || "true") === "true",
      gas: "auto",
      gasPrice: "auto",
      blockGasLimit: 30000000,
    },
    // Network used by `hardhat node` in Hardhat 3. Keep this aligned with the
    // local simulated networks so oversized dev contracts deploy on localhost.
    node: {
      type: "edr-simulated",
      chainId: 31337,
      allowUnlimitedContractSize: (process.env.UNLIMITED_SIZE || "true") === "true",
      gas: "auto",
      gasPrice: "auto",
      blockGasLimit: 30000000,
    },
    // Local development network
    localhost: {
      type: "http",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      // Use estimation by default; Hardhat's JSON-RPC may enforce a per-tx gas cap (~16.7M),
      // so forcing 30M here can make even small txs fail with "exceeds transaction gas cap".
      gas: "auto",
      gasPrice: "auto",
      timeout: 1200000,
    },

    // Built-in Hardhat network - allow large contracts
    hardhat: {
      type: "edr-simulated",
      chainId: 31337,
      // Allow unlimited contract size locally; can be controlled via env UNLIMITED_SIZE
      allowUnlimitedContractSize: (process.env.UNLIMITED_SIZE || "true") === "true",
      // Use estimation by default; forcing a high gas limit can exceed Hardhat's per-tx gas cap.
      gas: "auto",
      gasPrice: "auto",
      blockGasLimit: 30000000, // Block gas limit
    },

    // Ethereum test network
    sepolia: {
      type: "http",
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts:
        PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? [PRIVATE_KEY]
          : [],
      chainId: 11155111,
      gasPrice: "auto",
      timeout: 1200000,
    },

    // Ethereum mainnet
    mainnet: {
      type: "http",
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts:
        PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? [PRIVATE_KEY]
          : [],
      chainId: 1,
      gasPrice: "auto",
      timeout: 1200000,
    },

    // Conflux eSpace testnet
    confluxTestnet: {
      type: "http",
      url: CONFLUX_RPC_URLS.confluxTestnet,
      accounts:
        PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? [PRIVATE_KEY]
          : [],
      chainId: 71,
      gasPrice: "auto",
      timeout: 1200000,
    },

    // Conflux eSpace mainnet
    conflux: {
      type: "http",
      url: CONFLUX_RPC_URLS.conflux,
      accounts:
        PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? [PRIVATE_KEY]
          : [],
      chainId: 1030,
      gasPrice: "auto",
      timeout: 1200000,
    },
  },

  // Custom Etherscan-compatible explorers used by Hardhat 3 verification.
  // Ethereum Mainnet and Sepolia are already present in Hardhat's built-in
  // chain descriptors, so only Conflux eSpace needs to be declared here.
  chainDescriptors: {
    71: {
      name: "Conflux eSpace Testnet",
      blockExplorers: {
        etherscan: {
          name: "ConfluxScan",
          url: "https://evmtestnet.confluxscan.org",
          apiUrl: "https://evmapi-testnet.confluxscan.org/api/",
        },
      },
    },
    1030: {
      name: "Conflux eSpace",
      blockExplorers: {
        etherscan: {
          name: "ConfluxScan",
          url: "https://evm.confluxscan.org",
          apiUrl: "https://evmapi.confluxscan.org/api/",
        },
      },
    },
  },
  test: {
    mocha: {
      timeout: 180000,
      require: ["./hardhat-test-setup.mjs"],
      parallel: false,
      reporterOptions: {
        maxDiffSize: 0,
      },
      exit: true,
    },
  },

  tasks: [
    addPersonTask,
    endorseTask,
    mintNftTask,
    addPersonZkTask,
    generateDisclosureBindingProofTask,
    networksCheckTask,
    networksListTask,
    addStoryChunkTask,
    listStoryChunksTask,
    sealStoryTask,
    governanceScheduleTask,
    governanceExecuteTask,
    governanceCancelTask,
    timelockStatusTask,
    timelockMigrateMultisigTask,
    timelockUpdateDelayTask,
    timelockMigrateOwnerTask,
    treasuryStatusTask,
    treasuryTransferTask,
    upgradeScheduleTask,
    upgradeExecuteTask,
  ],

  // Hardhat 3 contract verification configuration
  verify: {
    blockscout: {
      enabled: false,
    },
    etherscan: {
      apiKey: EXPLORER_API_KEY,
    },
    sourcify: {
      enabled: false,
    },
  },

  // Gas reporter configuration
  gasReporter: {
    enabled: false, // Temporarily disabled due to provider issues
    currency: "USD",
    coinmarketcap: COINMARKETCAP_API_KEY,
    gasPrice: 20,
    showTimeSpent: true,
    showMethodSig: true,
    maxMethodDiff: 10,
  },

  // Contract size checker - temporarily disabled due to JSON parsing issue
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: false, // Disabled to avoid JSON parsing errors
    strict: process.env.CONTRACT_SIZER_STRICT === "true",
  },

  // Path configuration
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./deploy",
    deployments: "./deployments",
  },

  // Mocha test configuration
  mocha: {
    timeout: 1200000,
    color: true,
    reporter: "spec",
    parallel: false,
    exit: true,
  },

  // Typechain configuration
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["externalArtifacts/*.json"],
  },
};
