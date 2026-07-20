# DeepFamily - Decentralized Digital Family Tree Protocol

<div align="center">

![DeepFamily Logo](https://img.shields.io/badge/DeepFamily-v1.0.0-blue?style=for-the-badge&logo=ethereum)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-red?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Node](https://img.shields.io/badge/Node.js-22.10+-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

**A blockchain-based decentralized digital family tree protocol**
*Leveraging zero-knowledge proofs and community governance for collaborative family history*

[🏗 Architecture](#-architecture) • [🚀 Quick Start](#-quick-start) • [📖 Documentation](#-documentation) • [🤝 Contributing](#-contributing)

</div>

---

## Vision & Mission

DeepFamily creates the decentralized family tree infrastructure, using zero-knowledge proofs and blockchain immutability to build a collaborative, verifiable, and perpetual family history recording system.

> This is an open-source protocol/tooling suite—feel free to deploy and operate it yourself.

### Core Principles
- **Zero-Knowledge Privacy**: Private family tree construction with selective disclosure through NFT minting
- **Globally Accessible**: Borderless family connections accessible from anywhere in the world
- **Immutable Heritage**: Permanent on-chain storage preserves data across generations
- **Contribution Incentives**: Protocol mechanisms encourage complete, connected family data
- **Community Validation**: Endorsement-based governance ensures information quality

## Architecture

### Layer 1: Family Relationship Network
- Build a global family tree graph through parent-child hash connections
- Zero-knowledge proofs protect privacy — no plaintext personal data stored on-chain
- Multiple versions per person allow different contributors to record the same individual
- Supports both collaborative (shared passphrase) and fully private (unique passphrase) modes

### Layer 2: Value & Public Records
- Community endorsement validates data quality across versions
- Endorsed versions can be minted as permanent on-chain NFT records with biographical data
- On-chain biographical storage with permanent sealing
- Personal details remain private until an endorsed contributor mints an NFT

## Technology Stack

- **Smart Contracts**: Solidity ^0.8.20, OpenZeppelin v5, Poseidon hashing
- **Zero-Knowledge**: Groth16 proofs, circom circuits, snarkjs integration
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, D3.js family tree visualization
- **Development**: Hardhat, Ethers v6, comprehensive testing suite

### Contracts Overview

| Contract | Purpose |
|----------|---------|
| **DeepFamily.sol** | Core protocol — ZK proof validation, endorsement governance, NFT minting, story sharding. UUPS-upgradeable behind a proxy |
| **DeepFamilyReader.sol** | Stateless aggregated/paginated read views over the core protocol |
| **DeepFamilyToken.sol** | Utility token powering endorsement and incentive mechanics |
| **PersonCommitmentVerifier.sol** | ZK verifier for person identity and parent commitment proofs |
| **DisclosureBindingVerifier.sol** | ZK verifier for NFT mint disclosure-binding proofs |


## Quick Start

### Prerequisites
- **Node.js** >= 22.10.0
- **npm** or **yarn**
- **Git**

### One-Command Setup
```bash
git clone https://github.com/deepfamilylabs/DeepFamily.git
cd DeepFamily
npm run setup    # Install root + frontend dependencies
cp .env.example .env
npm run check    # Frontend checks + contract lint/build/test
npm run build    # Compile smart contracts
npm run dev:all  # Start local node + deploy + seed data + frontend
```

### Step-by-Step Setup
```bash
npm run setup           # Install dependencies
npm run check           # Run frontend + contract verification
npm run build           # Compile contracts
npm run dev:node        # Start local Hardhat node
npm run dev:deploy      # Deploy contracts
npm run dev:seed        # Seed demo data
npm run frontend:config # Generate frontend config from deployed contracts
npm run frontend:dev    # Start frontend dev server
```

### Access Points
- **Frontend dApp**: http://localhost:5173
- **Local Blockchain RPC**: http://localhost:8545

### Testing
```bash
npm test              # Run all contract tests
npm run frontend:check # Run frontend lint + typecheck + tests
npm run check         # Run frontend checks + contract lint/build/test
```


## Deployment Guide

### Supported Networks
**Ethereum:**
- Mainnet, Sepolia, Holesky

**Conflux eSpace:**
- Mainnet, Testnet

### Multi-Network Deployment
```bash
# Deploy to specific network (live networks require GOVERNANCE_OWNER, see below)
GOVERNANCE_OWNER=0xTimelock... npm run deploy:net --net=sepolia
npm run deploy:net --net=holesky
npm run deploy:net --net=confluxTestnet

# Local development
npm run dev:deploy

# Verify deployed contracts
npm run verify:net --net=sepolia
```

### Upgradeability & Governance

`DeepFamily` is a UUPS proxy. On live networks the deployment
requires `GOVERNANCE_OWNER` (a `TimelockController`-like address with a non-zero delay) and hands
upgrade authority to it after wiring — it refuses to leave upgrade rights on the deployer EOA. Local
and simulated networks keep the deployer as owner for test flows. Upgrades are staged/executed via
the `upgrade-schedule` / `upgrade-execute` Hardhat tasks, gated by `npm run storage:check`
(append-only storage-layout safety). See [Smart Contracts Reference](docs/contracts.md#upgradeability--governance-uups).

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
- Prefer `npm run check` before opening a PR
- Update README / docs when changing core behaviors

## License

MIT License (see [LICENSE](LICENSE) for full text). Excerpt:
```
MIT License

Copyright (c) 2025 DeepFamily
```

> **Disclaimer**: The DEEP token is solely a platform utility point used to access and operate DeepFamily functionality. It carries no investment attributes, makes no promise of profit or returns, and must not be used to initiate fundraising, wealth‑management, investment plans, or speculative trading of any kind.

---

<div align="center">

**🌳 DeepFamily - Connect the Past, Record the Present, Preserve the Future 🌳**

[![GitHub Stars](https://img.shields.io/github/stars/deepfamilylabs/DeepFamily?style=social)](https://github.com/deepfamilylabs/DeepFamily.git)
[![GitHub Forks](https://img.shields.io/github/forks/deepfamilylabs/DeepFamily?style=social)](https://github.com/deepfamilylabs/DeepFamily.git)

*Building a shared digital family heritage for humanity*

</div>
