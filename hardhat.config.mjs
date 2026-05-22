import hardhatEthers from '@nomicfoundation/hardhat-ethers'
import hardhatEthersChaiMatchers from '@nomicfoundation/hardhat-ethers-chai-matchers'
import hardhatMocha from '@nomicfoundation/hardhat-mocha'
import hardhatNetworkHelpers from '@nomicfoundation/hardhat-network-helpers'
import hardhatTypechain from '@nomicfoundation/hardhat-typechain'
import hardhatVerify from '@nomicfoundation/hardhat-verify'
import 'dotenv/config'

import addPersonTask from './tasks/contract-add-person.mjs'
import endorseTask from './tasks/contract-endorse.mjs'
import mintNftTask from './tasks/contract-mint-nft.mjs'
import addPersonZkTask from './tasks/zk-add-person.mjs'
import generateDisclosureBindingProofTask from './tasks/zk-generate-disclosure-binding-proof.mjs'
import networksCheckTask from './tasks/networks-check.mjs'
import networksListTask from './tasks/networks-list.mjs'
import addStoryChunkTask from './tasks/story-add-chunk.mjs'
import listStoryChunksTask from './tasks/story-list-chunks.mjs'
import sealStoryTask from './tasks/story-seal.mjs'
import attestationVerifyTask from './tasks/attestation-verify.mjs'

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000";
const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const COINMARKETCAP_API_KEY = process.env.COINMARKETCAP_API_KEY || "";

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
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: (process.env.VIA_IR || "false") === "true",
          // Allow overriding EVM version via environment variable (default istanbul)
          evmVersion: process.env.EVM_VERSION || "istanbul",
        },
      },
    ],
    overrides: {
      "poseidon-solidity/PoseidonT5.sol": {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: false,
          evmVersion: process.env.EVM_VERSION || "istanbul",
        },
      },
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
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 11155111,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Holesky testnet (latest Ethereum testnet)
    holesky: {
      type: "http",
      url: `https://holesky.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 17000,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Ethereum mainnet
    mainnet: {
      type: "http",
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 1,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Conflux eSpace testnet
    confluxTestnet: {
      type: "http",
      url: "https://evmtestnet.confluxrpc.com",
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 71,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Conflux eSpace mainnet
    conflux: {
      type: "http",
      url: "https://evm.confluxrpc.com",
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 1030,
      gasPrice: "auto",
      timeout: 1200000,
    },
  },
  test: {
    mocha: {
      timeout: 180000,
      require: ['./hardhat-test-setup.mjs'],
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
    attestationVerifyTask,
  ],
  
  // Contract verification configuration
  etherscan: {
    apiKey: {
      // Ethereum networks
      mainnet: ETHERSCAN_API_KEY,
      sepolia: ETHERSCAN_API_KEY,
      holesky: ETHERSCAN_API_KEY,

      // Conflux eSpace networks
      conflux: process.env.CONFLUXSCAN_API_KEY || "",
      confluxTestnet: process.env.CONFLUXSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "holesky",
        chainId: 17000,
        urls: {
          apiURL: "https://api-holesky.etherscan.io/api",
          browserURL: "https://holesky.etherscan.io"
        }
      },
      {
        network: "confluxTestnet",
        chainId: 71,
        urls: {
          apiURL: "https://evmapi-testnet.confluxscan.net/api",
          browserURL: "https://evmtestnet.confluxscan.net"
        }
      },
      {
        network: "conflux",
        chainId: 1030,
        urls: {
          apiURL: "https://evmapi.confluxscan.net/api",
          browserURL: "https://evm.confluxscan.net"
        }
      }
    ]
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

  // hardhat-deploy configuration
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
}
