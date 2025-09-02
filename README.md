# DeepFamily - Decentralized Global On-Chain Family Tree Protocol

<div align="center">

![DeepFamily Logo](https://img.shields.io/badge/DeepFamily-v1.0.0-blue?style=for-the-badge&logo=ethereum)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-red?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)

**A decentralized global family history infrastructure for all humanity**

[🚀 Quick Start](#-quick-start) • [📖 Docs](#-core-docs) • [🎯 Features](#-core-features) • [🔧 Deployment](#-deployment-guide) • [🤝 Contributing](#-contributing)

</div>

---

## 🌟 Vision

DeepFamily aims to build a universally shared decentralized genealogical infrastructure. Using blockchain we achieve permanence, privacy protection and community governance so every family story becomes part of humanity’s digital heritage.

### 🎯 Core Mission
- 🔒 **Privacy First**: Zero-knowledge proofs protect sensitive info *(current on-chain contract exposes an interface placeholder; full verifier integration WIP)*
- 🌍 **Global Sharing**: Remove geographic barriers and connect families worldwide
- 💎 **Permanent Storage**: Blockchain guarantees data immutability
- 💰 **Economic Incentives**: DEEP token rewards for quality data contribution

## 🎯 Core Features

### 🔐 Privacy-Preserving Genealogy
- **ZK Proofs (Planned)**: `IPersonHashVerifier` interface integrated; production verifier & circuits under development
- **Hash Storage**: Only hashes on-chain; raw data stays private off-chain
- **Layered Permissions**: Planned progressive disclosure patterns

### 🎨 Person NFTs
- **Single Mint**: Each version can mint exactly one NFT (scarcity)
- **On-Chain Core Data**: Name, birth/death years & limited biography metadata
- **Story Shards**: Up to 100 × 1KB chunks (contract enforced: `MAX_STORY_CHUNKS=100`, `MAX_CHUNK_CONTENT_LENGTH=1000`)
- **Value Accrual**: More endorsements → higher perceived value / fee flow

### 💰 DEEP Token Mining
- **Conditional Rewards**: Only when both parents exist at addition
- **Progressive Halving**: Custom variable-length cycles (1,10,100,1k,10k,100k,1M,10M,100M then fixed 100M) with binary halving per cycle
- **Initial Reward**: 113,777 DEEP (constant `INITIAL_REWARD`)
- **Minimum Reward Cutoff**: Stops when halved reward < 0.1 DEEP (`MIN_REWARD`)
- **Target Supply**: Capped at 100B (`MAX_SUPPLY`)

### 🤝 Staked Endorsement System
- **Stake to Endorse**: Pay current mining reward (`recentReward`) to endorse a version
- **Dual Distribution**: 50/50 split between version author & NFT holder if distinct; else 100% to author
- **Reputation Signal**: Endorse count surfaces socially trusted version

### 🗳️ Multi-Version Governance (Planned)
- **Version Coexistence**: Already supported on-chain
- **Social Selection**: Market-like endorsement dynamics

### 📊 High-Performance Visualization (Frontend WIP)
- Planned: Tree / force-directed / table views (D3)

## 🏗️ Architecture

### 📱 Stack Overview
- **Contracts**: Solidity 0.8.20 (Hardhat + hardhat-deploy)
- **Token**: ERC20 `DeepFamilyToken` (symbol `DEEP`)
- **NFT**: ERC721Enumerable (symbol `Family`)
- **Frontend**: React 18 + TypeScript + Vite + Tailwind + Ethers v6
- **Indexing**: The Graph Subgraph (schema & mappings stub)

### ⛓️ Contracts
```
DeepFamily Contract System
├── 📄 DeepFamily.sol          # Core genealogy + endorsements + NFT mint gate + sharded stories
├── 🪙 DeepFamilyToken.sol     # DEEP ERC20 mining reward token
└── 🔐 IPersonHashVerifier     # ZK verifier interface (implementation pending)
```

### 🏢 Repository Structure
```
DeepFamily/
├── contracts/        # Smart contracts
├── frontend/         # React dApp
├── subgraph/         # The Graph subgraph (WIP)
├── test/             # Hardhat tests
├── tasks/            # Custom Hardhat tasks
├── deploy/           # Deployment scripts
├── scripts/          # Utility scripts (e.g. seeding)
├── docs/             # Additional documentation
└── hardhat.config.js # Hardhat config
```

## 🚀 Quick Start

### 📋 Prerequisites
- **Node.js** >= 18 (aligns with `package.json engines`)
- **npm** (or yarn/pnpm)
- **Git**

### 🔧 Environment
Provide a `.env` (root) with (example):
```
ALCHEMY_API_KEY=...
ETHERSCAN_API_KEY=...
# Optional network deployer keys
PRIVATE_KEY=0xabc...
```
If missing, create manually (no `.env.example` yet).

### ⚡ Install & Run
```bash
# Clone
git clone https://github.com/deepfamilylibs/DeepFamily.git
cd DeepFamily

# Install backend deps
npm install

# Compile contracts
npm run build

# Start local dev full stack (node + deploy + seed + frontend)
npm run dev:all
# (Or run steps manually below)

# Manual: local node only (no auto deploy)
npm run dev:node
# In another terminal deploy + seed
npm run dev:deploy
npm run dev:seed

# Frontend (alternative manual launch)
npm run frontend:dev
```

### 🌐 Access
- **Frontend**: http://localhost:5173
- **Local RPC**: http://localhost:8545
- **Hardhat Console**: `npx hardhat console --network localhost`

## 🧪 Testing

### 🔬 Run Tests
```bash
npm test              # All tests
npm run test:coverage # Solidity coverage (output: coverage/)
npm run test:gas      # Gas reporter (stdout)
```

### 🎭 Demo Data
```bash
npx hardhat run scripts/seed-demo.js --network localhost
```
Creates sample persons, versions & endorsements (see script for specifics).

### ⚙️ Key Tasks (Parameters)
```bash
# Add person version (pre-hashed values expected by task script)
npx hardhat add-person \
  --fullname "Alice Smith" \
  --birthyear 1990 \
  --network localhost

# Endorse (requires DEEP allowance & recentReward payment)
npx hardhat endorse --person 0xPERSONHASH --vindex 1 --network localhost

# Mint NFT (must have endorsed the same version)
npx hardhat mint-nft --person 0xPERSONHASH --vindex 1 --network localhost

# Story shard operations
npx hardhat add-story-chunk --token 1 --index 0 --content "First 1KB" --network localhost
npx hardhat seal-story --token 1 --network localhost

# Listing / diagnostics
npx hardhat networks-list
```
Refer to `tasks/*.js` for full argument definitions & validations.

## 🔧 Deployment Guide

### 🏠 Local
```bash
npx hardhat node
npm run deploy:local
```

### 🌐 Testnet / Mainnet
```bash
# Deploy (select net via npm_config_net)
npm run deploy:net --net=sepolia

# Verify (example: DeepFamily contract)
# Requires ETHERSCAN_API_KEY in .env (or explorer equivalent for chain)
npm run verify:net --net=sepolia -- <CONTRACT_ADDRESS>
```

### 🌍 Mainnet
```bash
npm run deploy:net --net=mainnet
npm run verify:net --net=mainnet -- <CONTRACT_ADDRESS>
```

### 🔗 Supported / Target Networks
- **Ethereum**: Mainnet, Sepolia, Holesky
- **Polygon**: Mainnet, Amoy
- **Arbitrum**: Mainnet, Sepolia
- **Optimism**: Mainnet, Sepolia
- **BSC**: Mainnet, Testnet
- **Conflux**: eSpace, eSpace Testnet

## 🛡️ Security

### 🔒 Contract Safety
- OpenZeppelin audited primitives (ERC20, ERC721Enumerable, Ownable, ReentrancyGuard)
- Custom errors for explicit revert reasons
- Read/write separation to minimize accidental state change
- Reentrancy guard on mutative external entry points involving transfers
- Rejection of direct ETH transfers (receive/fallback reverts)

### 🔐 Privacy
- Person identity hashed (keccak256 over normalized structured input)
- ZK interface integrated (circuits & verifier deployment pending)
- Off-chain storage of raw PII recommended (IPFS / encrypted backend)

### 💰 Economic Safety
- Reward only when both parent hashes already exist
- Endorsement fee equals current mining reward (prevents spam & aligns incentives)
- Dual payout model incentivizes NFT minting & accurate submissions

## 📚 Core Docs
See detailed documents under `docs/`:
- [Architecture](docs/architecture.md)
- [Contracts Reference](docs/contracts.md)
- [Data Model](docs/data-model.md)
- [API & Tasks](docs/api.md)
- [Tokenomics](docs/tokenomics.md)
- [ZK Roadmap](docs/zk-roadmap.md)
- [Frontend Integration](docs/frontend.md)
- [Subgraph Guide](docs/subgraph.md)

## 📊 Subgraph
Current status: scaffold (schema + mapping stub). TODO:
1. Implement handlers for `PersonVersionAdded`, `PersonVersionEndorsed`, `PersonNFTMinted`, story events.
2. Configure deployment: `yarn graph codegen && yarn graph build` (script to be added).
3. Provide hosted service / decentralised index endpoints.

## 🧪 Story Sharding Constraints
- Max chunks per NFT: 100
- Max bytes per chunk: 1000
- Sealed stories immutable (contract enforced)

## 📘 Glossary
| Term | Meaning |
|------|---------|
| Person Hash | keccak256 of structured basic info (name + birth data + gender) |
| Version | A submitted record referencing optional parent version indices |
| Endorsement | Staked trust action paying current reward to version author / NFT holder |
| NFT | On-chain minted representation of a specific person version |
| Story Chunk | Sharded biography text segment (hashed & aggregated) |
| Full Story Hash | keccak256 of concatenated chunk hashes in order |
| Mining Reward | DEEP tokens minted when adding qualifying person version |

## 🤝 Contributing

### 🐛 Bug Reports
1. Search existing Issues
2. Open new issue with reproduction steps & env
3. Include logs & network details

### 💻 Code
1. Fork
2. Branch: `git checkout -b feat/your-feature`
3. Commit: `git commit -am 'feat: add X'`
4. Push: `git push origin feat/your-feature`
5. Open PR

### 📋 Standards
- Prettier + Solhint + lint-staged pre-commit (husky)
- Conventional Commits
- Tests required for new features
- Update README / docs when changing core behaviors

## 🌍 Community

Links are placeholders until launch:
- **GitHub**: https://github.com/deepfamilylibs/DeepFamily
- **Discord**: (TBD)
- **Twitter/X**: (TBD)
- **Telegram**: (TBD)

## 📄 License

MIT License (see [LICENSE](LICENSE) for full text). Excerpt:
```
MIT License

Copyright (c) 2024-2025 DeepFamily
```

Full disclaimer ("AS IS" etc.) intentionally omitted here to reduce duplication—refer to the LICENSE file.

---

<div align="center">

**🌳 DeepFamily - Connect the Past, Record the Present, Preserve the Future 🌳**

[![GitHub Stars](https://img.shields.io/github/stars/deepfamilylibs/DeepFamily?style=social)](https://github.com/deepfamilylibs/DeepFamily)
[![GitHub Forks](https://img.shields.io/github/forks/deepfamilylibs/DeepFamily?style=social)](https://github.com/deepfamilylibs/DeepFamily)

*Building a shared digital family heritage for humanity*

</div>
