# DeepFamily - Decentralized Digital Family Tree Protocol

<div align="center">

![DeepFamily Logo](https://img.shields.io/badge/DeepFamily-v1.0.0-blue?style=for-the-badge&logo=ethereum)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-red?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Node](https://img.shields.io/badge/Node.js-18+-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

**A blockchain-based decentralized digital family tree protocol**
*Leveraging zero-knowledge proofs, NFTs, and community governance for collaborative family history*

[🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) • [🎯 Core Features](#-core-features) • [🚀 Deployment](#-deployment) • [🤝 Contributing](#-contributing)

</div>

---

## Vision & Mission

DeepFamily creates the decentralized family tree infrastructure, using zero-knowledge proofs and blockchain immutability to build a collaborative, verifiable, and perpetual family history recording system.

> This is an open-source protocol/tooling suite—feel free to deploy and operate it yourself.

### Core Principles
- **Zero-Knowledge Privacy**: Private family tree construction with selective disclosure through NFT minting
- **Globally Accessible**: Borderless family connections accessible from anywhere in the world
- **Immutable Heritage**: Permanent on-chain storage preserves data across generations
- **Smart Incentives**: DEEP utility point distributions for complete family data contributions
- **Community Validation**: Endorsement-based governance ensures information quality

> Disclaimer: The DEEP token is solely a platform utility point used to access and operate DeepFamily functionality. It carries no investment attributes, makes no promise of profit or returns, and must not be used to initiate fundraising, wealth‑management, investment plans, or speculative trading of any kind.

## Core Features

### Zero-Knowledge Privacy System
- **Private Member Addition**: Uses Groth16 proofs to add family tree members without revealing personal information
- **Salted Passphrase Unlinkability**: Poseidon(fullName, passphrase) prevents identity inference and family tree pollution
- **Dual Family Tree Models**: Public trees (shared passphrase) for collaboration, private trees (unique passphrase) for complete protection
- **Selective Disclosure**: Privacy protection during member addition, **full disclosure when minting NFTs**
- **Multi-Version Support**: Each person can have multiple verified versions with parent relationship tracking

### NFT Value Creation
- **Family Tree NFTs**: Each person version can mint exactly one ERC721 token
- **Public Information**: **NFT minting reveals full name and biographical data to the community**
- **Story Sharding**: Detailed life stories stored in up to 100×1KB on-chain chunks with immutable sealing
- **Endorsement Requirement**: Must endorse a version before minting its NFT

### DEEP Utility Point Mechanics
- **Utility Issuance**: Rewards mint only when parent hash commitments are submitted (encourages structured family data without exposing plaintext)
- **Progressive Halving**: 10 halving cycles with expanding periods (1→10→100→1K→10K→100K→1M→10M→100M→Fixed 100M)
- **100 Billion Cap**: Fixed maximum supply, rewards continue halving asymptotically until cap is reached
- **Complete Family Incentives**: Encourages connected family trees over isolated entries

### Community Governance
- **Endorsement Fees**: Pay current utility issuance level to endorse trusted versions
- **Fee Distribution**: Majority flows to NFT holders or contributors, with a small protocol share (default 5%, max 20%) for sustainability
- **Version Competition**: Multiple versions per person, community selects best through endorsements
- **Quality Signaling**: Endorsement counts indicate version trustworthiness

### Advanced Data Management
- **Multi-Version System**: Each person supports multiple data versions with duplicate prevention
- **Paginated Queries**: Gas-optimized queries with 100-record limits
- **Family Tree Networks**: Complete relationship tracking through personHash/fatherHash/motherHash
- **Story Sealing**: Biographical data can be permanently locked for historical preservation

## Two-Layer Value System

### Layer 1: Private Hash Storage
- Add family tree members with zero-knowledge proofs without revealing personal information
- **Salted Passphrase System**: `Poseidon(fullName, passphrase)` prevents identity inference and pollution attacks
- Only cryptographic commitments stored on-chain (personHash, fatherHash, motherHash)
- **Dual Tree Models**: Public collaborative trees vs. private protected trees with unique passphrases
- Receive DEEP utility point distributions for complete family connections

### Layer 2: Public NFT Assets
- Community-endorsed versions can be minted as NFTs
- **NFT minting reveals full name and biographical information**
- Story sharding enables detailed on-chain biographies
- NFTs represent community-validated family tree data

### Technology Stack
- **Smart Contracts**: Solidity ^0.8.20, OpenZeppelin v5, Poseidon hashing
- **Zero-Knowledge**: Groth16 proofs, circom circuits, snarkjs integration
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, D3.js family tree visualization
- **Development**: Hardhat, Ethers v6, comprehensive testing suite

### Smart Contracts

**DeepFamily.sol** - Main Protocol
- Multi-version person data with ZK proof validation
- Community endorsement with automatic fee distribution
- NFT minting with on-chain biographical storage
- Story sharding system for detailed life narratives
- Mining rewards for complete family data

**DeepFamilyToken.sol** - DEEP Token
- ERC20 with progressive halving utility issuance mechanism
- 100 billion supply cap, 10 halving cycles
- Authorized minting only by DeepFamily contract

**ZK Verifiers** - Privacy Protection
- PersonHashVerifier: Validates family relationships for private submissions
- NamePoseidonVerifier: Proves name ownership for NFT minting


## Quick Start

### Prerequisites
- **Node.js** >= 18.0.0 (required by package.json engines)
- **npm** or **yarn** package manager
- **Git** version control

### Environment Setup
1. Clone the repository
   ```bash
   git clone https://github.com/deepfamilylabs/DeepFamily.git
   cd DeepFamily
   ```
2. Install dependencies
   ```bash
   npm run setup
   # Installs root + frontend dependencies
   ```

3. Configure environment
   ```bash
   cp .env.example .env
   # Required for deployment and verification
   PRIVATE_KEY=0x... # Your deployer wallet private key
   ```

4. Compile smart contracts
   ```bash
   npm run build
   ```

5. Run complete development environment
   ```bash
   npm run dev:all
   # This starts: local node + contract deployment + demo data + frontend
   ```

### Testing
```bash
# Run all contract tests
npm test

# Run with gas reporting
npm run test:gas

# Generate coverage report
npm run test:coverage

# Run specific test suites
npx hardhat test test/contract-person-version.test.js
npx hardhat test test/contract-endorse.test.js
npx hardhat test test/contract-mint-nft.test.js
```

## Usage

### Complete Development Workflow
#### One-Command Full Stack
```bash
# Install all dependencies
npm run setup

# Compile smart contracts
npm run build

# Start complete development environment
npm run dev:all
# This starts: local node + contract deployment + demo data seeding + frontend
```

#### Manual Step-by-Step
```bash
# 1. Install dependencies
npm run setup

# 2. Compile contracts
npm run build

# 3. Start local Hardhat node
npm run dev:node

# 4. Deploy contracts
npm run dev:deploy

# 5. Seed demo data
npm run dev:seed

# 6. Configure frontend environment
npm run frontend:config

# This automatically configures for local development
# For manual configuration: copy frontend/.env.example to frontend/.env and update values

# 7. Start frontend development server
npm run frontend:dev
```


### Access Points
- **Frontend dApp**: http://localhost:5173
- **Local Blockchain RPC**: http://localhost:8545
- **Contract Deployment**: Check terminal output for deployed addresses


## Deployment Guide

### Supported Networks
**Ethereum Family:**
- Mainnet, Sepolia, Holesky 

**Layer 2 Solutions:**
- Polygon: Mainnet, Amoy Testnet
- Arbitrum: Mainnet , Sepolia Testnet
- Optimism: Mainnet, Sepolia Testnet

**Alternative Chains:**
- BSC: Mainnet, Testnet
- Conflux eSpace: Mainnet, Testnet

### Multi-Network Deployment
```bash
# Deploy to specific network
npm run deploy:net --net=holesky
npm run deploy:net --net=polygonAmoy
npm run deploy:net --net=confluxTestnet

# Local development
npm run deploy:local

# Verify deployed contracts
npm run verify:net --net=holesky
```

## Documentation

- [Smart Contracts Reference](docs/contracts.md) - Complete contract API and implementation details
- [Zero-Knowledge Proofs](docs/zk-proofs.md) - ZK proof system and circuit documentation
- [Frontend Integration](docs/frontend.md) - React component and UI development guide

## Contributing

### Bug Reports
1. Search existing Issues
2. Open new issue with reproduction steps & env
3. Include logs & network details

### Code
1. Fork
2. Branch: `git checkout -b feat/your-feature`
3. Commit: `git commit -am 'feat: add X'`
4. Push: `git push origin feat/your-feature`
5. Open PR

### Standards
- Prettier + Solhint + lint-staged pre-commit (husky)
- Conventional Commits
- Tests required for new features
- Update README / docs when changing core behaviors

## Community

Links are placeholders until launch:
- **GitHub**: https://github.com/deepfamilylabs/DeepFamily

## License

MIT License (see [LICENSE](LICENSE) for full text). Excerpt:
```
MIT License

Copyright (c) 2025 DeepFamily
```
---

<div align="center">

**🌳 DeepFamily - Connect the Past, Record the Present, Preserve the Future 🌳**

[![GitHub Stars](https://img.shields.io/github/stars/deepfamilylabs/DeepFamily?style=social)](https://github.com/deepfamilylabs/DeepFamily.git)
[![GitHub Forks](https://img.shields.io/github/forks/deepfamilylabs/DeepFamily?style=social)](https://github.com/deepfamilylabs/DeepFamily.git)

*Building a shared digital family heritage for humanity*

</div>
