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
import generateNamePoseidonProofTask from './tasks/zk-generate-name-poseidon-proof.mjs'
import networksCheckTask from './tasks/networks-check.mjs'
import networksListTask from './tasks/networks-list.mjs'
import addStoryChunkTask from './tasks/story-add-chunk.mjs'
import listStoryChunksTask from './tasks/story-list-chunks.mjs'
import sealStoryTask from './tasks/story-seal.mjs'

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
    version: "0.8.20",
    npmFilesToBuild: ["poseidon-solidity/PoseidonT4.sol"],
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: (process.env.VIA_IR || "false") === "true",
      // Allow overriding EVM version via environment variable (default istanbul)
      evmVersion: process.env.EVM_VERSION || "istanbul",
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
    
    // Polygon Amoy testnet (replacement for Mumbai)
    polygonAmoy: {
      type: "http",
      url: `https://polygon-amoy.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 80002,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Polygon mainnet
    polygon: {
      type: "http",
      url: `https://polygon-mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 137,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // BSC testnet
    bscTestnet: {
      type: "http",
      url: "https://data-seed-prebsc-1-s1.binance.org:8545/",
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 97,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // BSC mainnet
    bsc: {
      type: "http",
      url: "https://bsc-dataseed1.binance.org",
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 56,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Arbitrum testnet
    arbitrumSepolia: {
      type: "http",
      url: `https://arbitrum-sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 421614,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Arbitrum mainnet
    arbitrum: {
      type: "http",
      url: `https://arbitrum-mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 42161,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Optimism testnet
    optimismSepolia: {
      type: "http",
      url: `https://optimism-sepolia.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 11155420,
      gasPrice: "auto",
      timeout: 1200000,
    },
    
    // Optimism mainnet
    optimism: {
      type: "http",
      url: `https://optimism-mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: PRIVATE_KEY !== "0x0000000000000000000000000000000000000000000000000000000000000000" ? [PRIVATE_KEY] : [],
      chainId: 10,
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
    },
  },

  tasks: [
    addPersonTask,
    endorseTask,
    mintNftTask,
    addPersonZkTask,
    generateNamePoseidonProofTask,
    networksCheckTask,
    networksListTask,
    addStoryChunkTask,
    listStoryChunksTask,
    sealStoryTask,
  ],
  
  // Contract verification configuration
  etherscan: {
    apiKey: {
      // Ethereum networks
      mainnet: ETHERSCAN_API_KEY,
      sepolia: ETHERSCAN_API_KEY,
      holesky: ETHERSCAN_API_KEY,
      
      // Polygon networks
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      
      // BSC networks
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      
      // Arbitrum networks
      arbitrum: process.env.ARBISCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
      
      // Optimism networks
      optimism: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
      optimismSepolia: process.env.OPTIMISTIC_ETHERSCAN_API_KEY || "",
      
      // Conflux networks
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
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io"
        }
      },
      {
        network: "optimismSepolia",
        chainId: 11155420,
        urls: {
          apiURL: "https://api-sepolia-optimistic.etherscan.io/api",
          browserURL: "https://sepolia-optimism.etherscan.io"
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
