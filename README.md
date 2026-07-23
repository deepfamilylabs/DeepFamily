# DeepFamily - Decentralized Digital Family Tree Protocol

<div align="center">

![DeepFamily Logo](https://img.shields.io/badge/DeepFamily-v1.0.0-blue?style=for-the-badge)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-red?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Node](https://img.shields.io/badge/Node.js-22.10+-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

**A blockchain-based decentralized digital family tree protocol**
_Leveraging zero-knowledge proofs and community governance for collaborative family history_

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

### Privacy-Preserving Family Graph

- Build a global family tree graph through parent-child hash connections
- Zero-knowledge proofs protect privacy — no plaintext personal data stored on-chain
- Multiple versions per person allow different contributors to record the same individual
- Supports both collaborative (shared passphrase) and fully private (unique passphrase) modes

### Endorsement, Incentives & Public Records

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

| Contract                          | Purpose                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **DeepFamily.sol**                | Core protocol — ZK proof validation, endorsement governance, NFT minting, story sharding. UUPS-upgradeable behind a proxy |
| **DeepFamilyReader.sol**          | Stateless aggregated/paginated read views over the core protocol                                                          |
| **DeepFamilyToken.sol**           | Utility token powering endorsement and incentive mechanics                                                                |
| **GovernanceTimelock.sol**        | Production owner and DEEP protocol treasury; enforces a delay on multisig-approved administration and spending            |
| **PersonCommitmentVerifier.sol**  | ZK verifier for person identity and parent commitment proofs                                                              |
| **DisclosureBindingVerifier.sol** | ZK verifier for NFT mint disclosure-binding proofs                                                                        |

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

**Primary deployment targets — Conflux eSpace:**

- Mainnet (`conflux`, chain ID 1030)
- Testnet (`confluxTestnet`, chain ID 71)

**Optional EVM-compatible targets — Ethereum:**

- Mainnet (`mainnet`, chain ID 1)
- Sepolia (`sepolia`, chain ID 11155111)

[Conflux eSpace](https://doc.confluxnetwork.org/docs/general/conflux-basics/spaces/) is an
EVM-compatible execution environment within Conflux Network, not an Ethereum L2. The names in
parentheses are the network names used by the project scripts and Hardhat tasks.
Set `CONFLUX_TESTNET_RPC_URL` or `CONFLUX_RPC_URL` to use a managed eSpace RPC; blank values fall
back to the official public testnet or mainnet endpoint.

### Recommended eSpace Mainnet release

For a new production governance wallet, first configure three reviewed EOA/hardware-wallet owner
addresses in their final order, a fixed decimal salt nonce, the approved deployer, and the
Safe-only CFX/finality limits. Keep `GOVERNANCE_MULTISIG`,
`ESPACE_MAINNET_SAFE_CONFIRM`, and `ESPACE_MAINNET_SAFE_PLAN_DIGEST` empty, then generate a
read-only deterministic deployment plan:

```bash
npm run espace:mainnet:safe
```

The creator is fixed to canonical Safe v1.3.0 with exactly three ordered EOA owners and a `2/3`
threshold. Owner order and `ESPACE_MAINNET_SAFE_SALT_NONCE` both affect the predicted address.
After an independent review, set the printed digest and
`ESPACE_MAINNET_SAFE_CONFIRM=conflux-mainnet-safe-chain-1030`, then run the same command to deploy
or resume. It reads only public owner addresses and never accepts an owner private key.

Deployment alone does not prove that the real controllers can sign. Two owners must use their
external signing workflow to execute the documented refund-free `0 CFX`, empty-calldata `CALL` to
`ESPACE_MAINNET_EXPECTED_DEPLOYER`. Set its outer transaction hash in
`ESPACE_MAINNET_SAFE_ACCEPTANCE_TX`, then require this read-only check to pass:

```bash
npm run espace:mainnet:safe:status
```

Only then copy the reviewed Safe address to `GOVERNANCE_MULTISIG`. That acceptance must remain the
Safe's first and only execution (`nonce == 1`) until the protocol release plan and execution
complete.

Next use the resumable protocol orchestrator. With `ESPACE_MAINNET_CONFIRM` and
`ESPACE_MAINNET_PLAN_DIGEST` empty, this command is read-only:

```bash
npm run espace:mainnet:release
```

Every release invocation performs a clean production-profile build. Review the plan with a second
operator, copy the printed digest to `ESPACE_MAINNET_PLAN_DIGEST`, set
`ESPACE_MAINNET_CONFIRM=conflux-mainnet-chain-1030`, and run the same command to execute or resume.
It checkpoints every phase, verifies every contract, waits for finalized coverage, and validates
the terminal governance state. Repository tests never broadcast eSpace Mainnet transactions. See
the complete Safe bootstrap, acceptance, release, and recovery procedure in the
[eSpace Mainnet release runbook](docs/espace-mainnet-release.md).

### Manual and other-network deployment

The stepwise commands below remain available for local/testnet work, optional compatibility
networks, and explicitly reviewed forensic recovery. They are not the recommended first-release
path on eSpace Mainnet; do not mix them with an active orchestrated release checkpoint.

```bash
# Stepwise rehearsal on Conflux eSpace Testnet (both values are required, see below)
GOVERNANCE_OWNER=0xTimelock... GOVERNANCE_MULTISIG=0xMultisig... \
  npm run deploy:net --net=confluxTestnet

# Optional Ethereum compatibility deployment
GOVERNANCE_OWNER=0xTimelock... GOVERNANCE_MULTISIG=0xMultisig... \
  npm run deploy:net --net=sepolia

# Local development
npm run dev:deploy

# Verify one eSpace deployment (ConfluxScan uses the built-in non-secret "espace" fallback)
npm run verify:net --net=confluxTestnet -- 0xContractAddress

# Ethereum verification instead requires a real Etherscan key for that invocation
EXPLORER_API_KEY=... npm run verify:net --net=sepolia -- 0xContractAddress
```

### Upgradeability & Governance

`DeepFamily` is a UUPS proxy. On live networks the deployment requires `GOVERNANCE_OWNER` to match
the current `GovernanceTimelock` runtime bytecode and have a non-zero delay. It also requires
`GOVERNANCE_MULTISIG` to contain contract code, expose `getOwners()`/`getThreshold()` with threshold
at least 2, and be the exclusive holder of the timelock's proposer, canceller, and executor roles.
`DeepFamily` upgrade authority is handed to the timelock after wiring, never left on the deployer
EOA. Local and simulated networks keep the deployer as `DeepFamily.owner()` for test flows.

`DeepFamilyToken` has a separate one-time lifecycle: the deployer owns it only long enough to call
`initialize(DeepFamily)`. A successful binding verifies both directions and automatically sets the
Token owner to `address(0)`. The Token is never owned by the governance multisig or Timelock and has
no mutable owner-only administration after initialization.

The recommended production ownership chain is
`DeepFamily → GovernanceTimelock → governance multisig`: the timelock is the protocol owner, while
one multisig holds its proposer/canceller/executor roles. The production checks do not prove that
an arbitrary multisig implementation or its bytecode is safe; the deployer must review the selected
wallet, signer policy, modules, and guards independently.
Deploy and wire it before the protocol deployment:

The same `GovernanceTimelock` also acts as the DEEP protocol treasury. `DeepFamily` sends the
protocol share of each paid endorsement to `owner()`, so under the production ownership chain that
share accumulates at the Timelock address. Holding DEEP does not make the Token administratively
owned by the Timelock: `DeepFamilyToken.owner()` remains permanently zero. Treasury spending is a
separate delayed operation approved through the governance multisig.

The governance examples below use `confluxTestnet` for a stepwise rehearsal. For the initial eSpace
Mainnet deployment, use `npm run espace:mainnet:release`; direct deployment commands are retained
for advanced recovery and other supported networks.

```bash
MIN_DELAY=172800 GOVERNANCE_MULTISIG=0xMultisig... \
  npm run deploy:timelock --net=confluxTestnet
GOVERNANCE_OWNER=0xTimelock... GOVERNANCE_MULTISIG=0xMultisig... \
  npm run deploy:net --net=confluxTestnet
```

Every non-local timelock deployment requires `MIN_DELAY` and `GOVERNANCE_MULTISIG` explicitly. Use
an initialized multisig whose reported threshold is at least 2. Only in-process simulated networks
and the explicitly named `localhost` network use the 120-second/deployer defaults. The wrapper fixes
the external admin to zero and permits role changes only through a scheduled, delayed self-call.

Owner-only configuration, such as changing the endorsement fee to 7.5%, uses the general governance
tasks. If the CLI signer is not the role holder, the task prints the destination and calldata to
submit through the configured governance multisig:

```bash
npx hardhat --config hardhat.config.mjs governance-schedule --network confluxTestnet \
  --target main --function updateEndorsementFee --args '[750]'
# Submit the printed schedule call through the governance multisig, then wait for the timelock delay.
npx hardhat --config hardhat.config.mjs governance-execute --network confluxTestnet \
  --target main --function updateEndorsementFee --args '[750]'

# The governance multisig holding CANCELLER_ROLE can cancel a pending operation by its printed ID.
npx hardhat --config hardhat.config.mjs governance-cancel --network confluxTestnet \
  --target main --operation-id 0x...
```

Inspect the complete on-chain role/multisig policy, or one operation, at any time:

```bash
npx hardhat --config hardhat.config.mjs timelock-status --network confluxTestnet
npx hardhat --config hardhat.config.mjs timelock-status --network confluxTestnet \
  --contract-name GovernanceTimelock --operation-id 0x...
```

Inspect the DEEP treasury balance and transfer 125.5 DEEP through the same multisig-and-delay path:

```bash
npx hardhat --config hardhat.config.mjs treasury-status --network confluxTestnet \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
  --phase schedule --recipient 0xRecipient... --amount 125.5 \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
# Submit the printed schedule call through the governance multisig and wait for the delay.
npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
  --phase execute --recipient 0xRecipient... --amount 125.5 \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
```

The transfer task accepts a human-readable DEEP amount, rejects arbitrary token/target addresses,
and requires identical recipient, amount, and optional `--salt` in both phases. Without a local
role-holder signer it prints the `to`, `value`, `data`, and `operation` fields for the governance
multisig rather than bypassing its approval policy.

Timelock lifecycle changes use explicit `schedule` and `execute` phases. Both invocations must use
the same addresses and optional salt; without a configured role-holder key they print a multisig
transaction:

```bash
# Atomically replace the sole proposer/canceller/executor governance multisig.
npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --network confluxTestnet \
  --contract-name GovernanceTimelock --phase schedule \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig...
npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --network confluxTestnet \
  --contract-name GovernanceTimelock --phase execute \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig...

# Change the minimum delay through a delayed Timelock self-call.
npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
  --contract-name GovernanceTimelock --phase schedule --new-delay 259200
npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
  --contract-name GovernanceTimelock --phase execute --new-delay 259200
```

Replacing the Timelock itself is a separate ownership migration. Deploy and verify the new
Timelock first using the intended new governance multisig as a one-command override; do not change
the persistent operator environment yet:

```bash
MIN_DELAY=259200 GOVERNANCE_MULTISIG=0xNewMultisig... \
  npm run deploy:timelock --net=confluxTestnet
```

Then schedule and execute one atomic two-call batch from the old Timelock. It first transfers
`DeepFamily` ownership to the new Timelock, then makes the old Timelock self-call
`sweepERC20(DEEP, newTimelock)`. The sweep reads the complete balance at execution time, so it also
includes protocol fees received during the delay; a zero balance is valid. The Token remains
ownerless throughout. The example below is a same-runtime redeployment. For a code-changing
V1-to-V2 migration, replace the two Timelock artifact arguments with the separately retained
versioned artifact names:

```bash
npx hardhat --config hardhat.config.mjs timelock-migrate-owner --network confluxTestnet \
  --phase schedule --old-timelock 0xOldTimelock... --new-timelock 0xNewTimelock... \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig... \
  --old-contract-name GovernanceTimelock --new-contract-name GovernanceTimelock \
  --proxy-contract-name UUPSProxy --deep-family-contract-name DeepFamily \
  --token-contract-name DeepFamilyToken
npx hardhat --config hardhat.config.mjs timelock-migrate-owner --network confluxTestnet \
  --phase execute --old-timelock 0xOldTimelock... --new-timelock 0xNewTimelock... \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig... \
  --old-contract-name GovernanceTimelock --new-contract-name GovernanceTimelock \
  --proxy-contract-name UUPSProxy --deep-family-contract-name DeepFamily \
  --token-contract-name DeepFamilyToken
```

The artifact names are runtime locks, not labels. Keep audited, version-named source/artifacts for
every deployed Timelock version so a later V1-to-V2 migration can use, for example,
`GovernanceTimelockV1` and `GovernanceTimelockV2` to verify each contract against its own bytecode.
The old Timelock artifact must include the self-call-only `sweepERC20(address,address)` function.
The Token artifact remains required so the task can verify its exact runtime,
`owner() == address(0)`, and bidirectional binding. Use identical arguments in both phases; there is
no unsafe bytecode bypass. After execution, confirm `DeepFamily.owner()` is the new Timelock, the old
Timelock's DEEP balance is zero, and the new Timelock received the execution-time balance.

Only update `GOVERNANCE_MULTISIG` / `GOVERNANCE_OWNER` in the operator environment after the
corresponding multisig-role or `DeepFamily` owner migration is confirmed on-chain.

`DeepFamily.renounceOwnership()` remains available as an irreversible final governance-exit
mechanism, but the ordinary governance tasks deliberately reject it. It is not a routine
"decentralize" switch: once a separately constructed and audited Timelock operation executes it,
the proxy can never be upgraded, verifiers and protocol-fee settings can never be changed, and
ownership can never be migrated. Future protocol fee shares are burned because `owner()` is zero;
already accumulated treasury assets are not automatically moved. Consider it only after a final
protocol audit, treasury disposition, public notice, and explicit multisig approval of the exact
raw Timelock operation.

Upgrades intentionally use the separate `upgrade-schedule` / `upgrade-execute` tasks, which require
a candidate artifact and enforce storage-layout and runtime-bytecode checks. If `upgrade-schedule`
deploys the candidate, it prints the exact explorer-verification command and stops before creating
a Timelock operation; verify that address, then rerun with `--implementation`. The general
governance task rejects upgrade and ownership-transfer functions. See
[Smart Contracts Reference](docs/contracts.md#upgradeability--governance-uups).

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

_Building a shared digital family heritage for humanity_

</div>
