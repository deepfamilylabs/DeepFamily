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

### ZK Artifact Workflow

The supported ZK command surface is intentionally limited to these eight entries:

| Command                       | Purpose                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `npm run zk:fetch`            | Install host-native and canonical audit-reference Circom compilers |
| `npm run zk:ptau:fetch`       | Download or verify the pinned public Phase 1 pTau cache            |
| `npm run zk:build`            | Compile both circuits                                              |
| `npm run zk:dev:refresh`      | Rebuild every development artifact from a self-contained workflow  |
| `npm run zk:production:setup` | Generate and verify the production Phase 2 artifacts               |
| `npm run zk:check`            | Generate and verify real proofs for both circuits                  |
| `npm run zk:artifacts:check`  | Rebuild and validate the complete artifact set                     |
| `npm run zk:ceremony:verify`  | Verify the production pTau, zkeys, transcript, and trust metadata  |

`zk:fetch` installs two distinct compiler roles. The native compiler is written to `bin/circom`
(`bin/circom.exe` on Windows) and is used by local and diagnostic builds. Release gates snapshot it
when it is a fixed-hash official asset; the macOS arm64 source target is rebuilt privately from the
pinned commit. The separately stored official Linux amd64 binary at
`bin/circom-release-linux-amd64` is the canonical audit reference; native builds never replace or
execute it as a foreign-platform binary.

| Host/runtime         | Compiler installed by `zk:fetch`    | Additional requirement                      |
| -------------------- | ----------------------------------- | ------------------------------------------- |
| Linux x64 with glibc | Pinned official release asset       | None                                        |
| macOS arm64          | Build from the pinned source commit | `git`, Rust/Cargo, Xcode Command Line Tools |
| Windows x64          | Pinned official release asset       | Visual C++ 2015–2022 Redistributable        |

These are the only supported host/runtime pairs. Linux libc is detected from Node's process report;
musl is rejected explicitly, as are all unsupported platform and architecture combinations. Windows
ARM64 hosts are unsupported even when running x64 Node.js under emulation. CI uses GitHub's
`ubuntu-latest` x64/glibc runner and separately exercises macOS arm64 and Windows x64.

Every selected compiler must report the repository-pinned Circom version and pass its target-specific
binary or source-provenance checks. All circuit compilation uses explicit `--O2`.
For official targets, `zk:production:setup` snapshots the hash-verified compiler. For the macOS
arm64 source target it ignores the reusable development compiler and performs a fresh locked build
of the pinned source commit under the user's protected build directory. The source builder rejects
external ancestor Cargo configuration, discards inherited Git, Cargo, Rust, Node, dynamic-loader,
npm, and native-build overrides, resolves Git/Cargo/Rustc to protected absolute executables, and
uses a controlled PATH plus private home, Cargo, XDG, and temporary directories. It also disables
ambient Git system/global configuration and hooks. Production setup copies the compiler and pTau
into its private OS temporary stage, compiles both circuits, and validates both staged R1CS/WASM pairs
against the reviewed canonical hashes before starting either Groth16 Setup or Phase 2
contribution. It repeats those integrity checks immediately before each setup and before
installation. `release:preflight` performs the same fresh source-build isolation and artifact
comparisons. Both commands therefore run on Linux x64 with glibc, macOS arm64, and Windows x64 while
failing closed on any cross-platform output difference.

Release-only staging is permission-checked: POSIX roots must be owned by the current user with mode
`0700`; Windows roots have inheritance and existing access rules removed, are owned by the current
user SID, and are re-read to verify that only that SID has full control. Production setup hashes the
logical snarkjs production dependency graph—package content, identity, version, and logical
dependency path, independent of checkout location or hoisting—rather than only the CLI file. It
then copies the verified runtime into private staging, makes package files read-only on POSIX, and
executes snarkjs from that snapshot. The contribution helper and its local dependency are copied
from the exact release-commit Git blobs, then re-hashed both before Phase 2 entropy is generated and
again immediately before the child process receives it.

The current ZK artifact manifest is schema v3 and commits that snarkjs runtime-graph digest.
Schema-v2 manifests remain readable only for legacy compatibility inspection and verification;
`zk:production:setup` and `release:preflight` both require schema v3.

Development and production reuse the same fixed-digest public Phase 1 pTau at
`tmp/zk-production/powersOfTau28_hez_final_13.ptau`. This removes the old locally generated
development pTau, but it does **not** make development keys safe for production:
`zk:dev:refresh` deliberately uses a single-operator Phase 2 flow with hard-coded public entropy
and records a `development` manifest. It downloads or validates the shared pTau when needed,
compiles both circuits, generates both development zkeys and verification keys, exports the
Solidity verifiers, copies the required frontend assets, and updates the development manifest.

Artifact copying is strict: the refresh workflow fails if a required generated WASM, zkey, or
verification key is missing. It never silently generates a missing artifact during the copy step.
See [ZK proofs](docs/zk-proofs.md) and the
[production ZK setup runbook](docs/zk-ceremony.md) for the development and release procedures.

## Deployment Guide

### Supported Networks

**Primary deployment targets — Conflux eSpace:**

- Mainnet (`conflux`, chain ID 1030)
- Testnet (`confluxTestnet`, chain ID 71)

**Guarded Ethereum targets:**

- Mainnet (`mainnet`, chain ID 1)
- Sepolia (`sepolia`, chain ID 11155111)

[Conflux eSpace](https://doc.confluxnetwork.org/docs/general/conflux-basics/spaces/) is an
EVM-compatible execution environment within Conflux Network, not an Ethereum L2. The names in
parentheses are the network names used by the project scripts and Hardhat tasks.
Set `CONFLUX_TESTNET_RPC_URL` or `CONFLUX_RPC_URL` to use a managed eSpace RPC; blank values fall
back to the official public testnet or mainnet endpoint.

The guarded release commands use explicit, immutable chain profiles rather than treating every EVM
network as interchangeable:

| Command family | Test / production chain      | Safe singleton           | Currency / gas evidence              | Explorer               |
| -------------- | ---------------------------- | ------------------------ | ------------------------------------ | ---------------------- |
| `espace:*`     | eSpace 71 / 1030             | canonical Safe v1.3.0 L2 | CFX / Conflux three-quarter gas rule | ConfluxScan            |
| `ethereum:*`   | Sepolia 11155111 / Mainnet 1 | canonical Safe v1.3.0 L1 | ETH / receipt `gasUsed`              | Blockscout / Etherscan |

RPC variables, confirmation strings, Safe profile names, budgets, wallet-derivation domains,
reports, locks, and checkpoints are also separated. Use the named npm entry for the intended chain;
do not invoke a lower-level script with an arbitrary `--network` to bypass these locks.

### Recommended eSpace Mainnet release

Production release is blocked until the development Groth16 keys have been replaced with
`npm run zk:production:setup`, the generated artifacts have been reviewed and committed together,
`npm run release:preflight` passes from that clean commit, and the exact release commit produces an
eSpace Testnet `release-rehearsal` report with `releaseReady=true`. The default setup reuses the
pinned public power-13 pTau and records one local Phase 2 contributor under the explicit
`single-operator` trust model; an independent multi-party ceremony is an optional enhancement, not
a three-person requirement. See the [production ZK setup runbook](docs/zk-ceremony.md).
Set `ESPACE_MAINNET_TESTNET_RELEASE_REPORT` to that archived report; the Mainnet plan validates its
commit, artifact digest, production delay, ZK status, verification, finality and terminal state.

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

Every release invocation performs the complete clean `release:preflight` gate. Review the plan with
a second operator. At least two current Safe owners must sign the complete printed EIP-191
plan-approval message using their external wallet/hardware-wallet workflow. Copy the printed digest to
`ESPACE_MAINNET_PLAN_DIGEST`, put the signatures in
`ESPACE_MAINNET_PLAN_APPROVAL_SIGNATURES`, set
`ESPACE_MAINNET_CONFIRM=conflux-mainnet-chain-1030`, and run the same command to execute or resume.
The repository recovers the owner addresses and rejects a changed plan, report, Safe or owner set;
it never receives an owner private key.
It checkpoints every phase, verifies every contract, waits for finalized coverage, and validates
the terminal governance state. Repository tests never broadcast eSpace Mainnet transactions. See
the complete Safe bootstrap, acceptance, release, and recovery procedure in the
[eSpace Mainnet release runbook](docs/espace-mainnet-release.md).

### Guarded Ethereum release

Ethereum uses the same reviewed release architecture but a separate Ethereum profile and state.
It also requires the reviewed production ZK setup commit, `release:preflight`, and an exact Sepolia
release-rehearsal report selected through `ETHEREUM_MAINNET_TESTNET_RELEASE_REPORT`. The ZK
contributor count is unrelated to the three-owner, 2/3 production Safe policy.
First run the destructive Sepolia acceptance suite:

```bash
ETHEREUM_E2E_CONFIRM=ethereum-sepolia-chain-11155111 \
ETHEREUM_E2E_MODE=diagnostic \
npm run ethereum:acceptance
```

A diagnostic run always reports `releaseReady=false`. Before a production release, rerun from the
clean release commit with `ETHEREUM_E2E_MODE=release-rehearsal`,
`GOVERNANCE_MULTISIG_PROFILE=ethereum-safe-1.3.0-2of3`, verification/finality enabled, and
`MIN_DELAY` exactly equal to `ETHEREUM_E2E_MIN_DELAY`.

For Mainnet, configure three reviewed public owner addresses and a fixed salt, then leave the Safe
confirmation/digest pair blank to create a read-only plan:

```bash
npm run ethereum:mainnet:safe
```

After independent review, setting
`ETHEREUM_MAINNET_SAFE_CONFIRM=ethereum-mainnet-safe-chain-1` plus the exact printed digest and
rerunning broadcasts the real Safe factory transaction. Two real owners must then execute the
documented zero-ETH smoke transaction externally; this repository never accepts owner private
keys. Record its outer hash and validate it without broadcasting:

```bash
npm run ethereum:mainnet:safe:status
```

Finally, leave the release confirmation/digest blank for a read-only protocol plan:

```bash
npm run ethereum:mainnet:release
```

At least two current Safe owners must sign the complete EIP-191 plan-approval message printed by
plan mode. Setting `ETHEREUM_MAINNET_CONFIRM=ethereum-mainnet-chain-1`, the independently reviewed
digest, and `ETHEREUM_MAINNET_PLAN_APPROVAL_SIGNATURES` to those external signatures before
rerunning enters execute/resume mode, broadcasts real Ethereum Mainnet transactions, and spends
real ETH. A real `EXPLORER_API_KEY` is mandatory for Ethereum Mainnet source verification; Sepolia
acceptance uses API-key-free Blockscout. See the complete
environment, owner-smoke, approval, checkpoint, resumption, and recovery procedure in the
[Ethereum Mainnet release runbook](docs/ethereum-mainnet-release.md). The local Sepolia setup and
rerun procedure is in `docs/ethereum-sepolia-acceptance.local.md`.

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

# Sepolia verification uses API-key-free Blockscout
npm run verify:net --net=sepolia -- 0xContractAddress
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
- [Conflux eSpace Mainnet release](docs/espace-mainnet-release.md) - Guarded Safe and release runbook
- [Ethereum Mainnet release](docs/ethereum-mainnet-release.md) - Guarded Safe and release runbook
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
