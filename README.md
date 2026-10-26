# DeepFamily - Decentralized Digital Family Tree Protocol

<div align="center">

![DeepFamily Logo](https://img.shields.io/badge/DeepFamily-v1.0.0-blue?style=for-the-badge)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-^0.8.20-red?style=for-the-badge&logo=solidity)](https://soliditylang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react)](https://reactjs.org/)
[![Node](https://img.shields.io/badge/Node.js-22.18+-green?style=for-the-badge&logo=node.js)](https://nodejs.org/)

**A blockchain-based decentralized digital family tree protocol**
_Leveraging zero-knowledge proofs and community governance for collaborative family history_

[🏗 Architecture](#architecture) • [🚀 Quick Start](#quick-start) • [📖 Documentation](#documentation) • [🤝 Contributing](#contributing)

</div>

---

## Vision & Mission

DeepFamily creates the decentralized family tree infrastructure, using zero-knowledge proofs and blockchain immutability to build a collaborative, verifiable, and perpetual family history recording system.

> This is an open-source protocol/tooling suite—feel free to deploy and operate it yourself.

> **Release status:** the on-chain biography v1 implementation is still development-only. Identity
> and file KDF suite 1 await the required device/attacker-cost studies, and production requires a
> fresh reviewed ZK ceremony plus finalized artifact, vector, deployment, and runtime evidence.

### Core Principles

- **Zero-Knowledge Privacy**: Private family tree construction with selective disclosure through NFT minting
- **Globally Accessible**: Borderless family connections accessible from anywhere in the world
- **Immutable Heritage**: Permanent on-chain storage preserves data across generations
- **Contribution Incentives**: Protocol mechanisms encourage complete, connected family data
- **Community Validation**: Endorsement-based governance ensures information quality

## Architecture

### Privacy-Preserving Family Graph

- Build a global family tree graph through parent-child hash connections
- Zero-knowledge proofs bind private identity witnesses to person/parent commitments
- Each version stores an immutable encrypted DFM1 metadata envelope on-chain; person, parent,
  `tag`, and private `biography` plaintext stay off-chain
- Multiple versions per person allow different contributors to record the same individual
- One user-entered passphrase drives domain-separated identity and file KDFs; matching identity
  fields, suite, and passphrase reproduce the same person hash

### Endorsement, Incentives & Public Records

- Community endorsement validates data quality across versions
- Endorsed versions can be minted as permanent public NFT records
- Private encrypted biography and public NFT story data are independent; public story records can be
  permanently sealed
- Personal details remain private until an endorsed contributor mints an NFT

### Family Inheritance

- A public `shield` deposit places the selected ERC-20 or native asset in its canonical pool. `depositBudget` spends the payer's VALUE and creates an encrypted BUDGET contribution. The first deposit creates a code/policy record; later deposits add independent contributions and preserve its original eligibility clock. Both paths check current qualification.
- One `dfreceive` code authorizes letters and ordinary transfers, with optional family capabilities for child budgets. A payer can use the original code and a future public family rule while the recipient stays offline. Ordinary receipt and letters remain available after a family qualification is revoked.
- `claimBudget` proves a current qualification, spends a matured contribution and creates VALUE plus the remaining BUDGET output. The subject/policy/period allowance is shared across codes. Transfers and public `unshield` exits are separate transactions.
- Qualification revocation takes effect immediately. Budget deposits, contributions and claims use three direct role-index lookups, independent of total revocation history. Codes using the same qualification expose the same role indices and can be linked; recipient spending/viewing keys remain independently derived.
- Wallet secrets and qualification/controller openings remain inside the receiving Worker. Authenticated encrypted backups preserve money keys, code indices and openings; each new external code requires an updated backup. A family wallet derives its canonical subject secret from identity inputs inside the Worker. Recovery replays public ledger events and decrypts locally. See [receiving codes and letters](docs/private-letters.md).
- Gas-paying wallets, public deposits, and public exit addresses and amounts remain visible. Privacy depends on avoiding address funding and timing links; the pool does not offer absolute anonymity. Each asset has its own balances, budgets and anonymity set.

## Technology Stack

- **Smart Contracts**: Solidity ^0.8.20, OpenZeppelin v5, Poseidon hashing
- **Zero-Knowledge**: Groth16 proofs, circom circuits, snarkjs integration
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS, D3.js family tree visualization
- **Development**: Hardhat, Ethers v6, comprehensive testing suite
- **Shared protocol**: `packages/protocol-core` provides identity, encryption, archives, proof encoding and receive credentials for the frontend and Node tools

### Contracts Overview

| Contract                          | Purpose                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **DeepFamily.sol**                | Core protocol — ZK proof validation, endorsement governance, NFT minting, and canonical Archive binding. UUPS proxy |
| **DeepFamilyArchive.sol**         | Immutable Metadata + Story archive; atomic 16 KiB segments, paged manifests, owner append/seal                      |
| **DeepFamilyReader.sol**          | Aggregated/paginated read views with immutable proxy/Archive bindings and metadata refs                             |
| **DeepFamilyToken.sol**           | Utility token powering endorsement and incentive mechanics                                                          |
| **GovernanceTimelock.sol**        | Production owner and DEEP protocol treasury; enforces a delay on multisig-approved administration and spending      |
| **PersonCommitmentVerifier.sol**  | ZK verifier for person identity and parent commitment proofs                                                        |
| **DisclosureBindingVerifier.sol** | ZK verifier for NFT mint disclosure-binding proofs                                                                  |
| **DeepFamilyLineageIndex.sol**    | Immutable Poseidon Merkle mirror of endorsements and recommended sources, written by the DeepFamily proxy           |
| **EligibilitySource.sol**         | Authenticated lineage facts, trusted sources and current role revocations                                           |
| **ReceiveRegistry.sol**           | Qualification issuance, generic receiving authorization and family budget capabilities                              |
| **LetterArchive.sol**             | Encrypted letters authorized by the same receiving code                                                             |
| **ShieldedPoolCore.sol**          | Common multi-asset ledger with budget contributions, claims, transfers and exits                                    |
| **ShieldedErc20Pool.sol**         | One immutable ERC-20 pool with exact sender/recipient transfer checks                                               |
| **ShieldedNativePool.sol**        | Direct native-currency pool with exact deposit value and reverting payouts                                          |
| **ShieldedPoolFactory.sol**       | Permissionless canonical pool creation for gas only, with no administrator                                          |

## Quick Start

### Prerequisites

- **Node.js** >= 22.18.0
- **npm** or **yarn**
- **Git**

### One-Command Setup

```bash
git clone https://github.com/deepfamilylabs/DeepFamily.git
cd DeepFamily
npm install    # Install root + frontend dependencies
cp .env.example .env
# Set PRIVATE_KEY and HISTORICAL_DATA_FILES in .env before starting dev:all.
cp frontend/.env.example frontend/.env.local
# Set VITE_ZK_ASSET_BASE_URL in frontend/.env.local to the proving-file host.
npm run check    # Frontend checks + contract lint/build/test
npm run dev:all  # Start local node + deploy + seed data + frontend
```

### Step-by-Step Setup

```bash
npm install           # Install dependencies
cp frontend/.env.example frontend/.env.local  # Then set VITE_ZK_ASSET_BASE_URL
npm run check           # Run frontend + contract verification
npm run dev:node        # Start local Hardhat node
npm run dev:deploy      # Check ZK artifacts and deploy the complete system
npm run dev:fund        # Fund the PRIVATE_KEY wallet with local test ETH
npm run dev:seed        # Seed demo data
npm run frontend:config # Generate frontend config from deployed contracts
npm run frontend:dev    # Start frontend dev server
```

Historical seeding uses the wallet identified by `PRIVATE_KEY` in `.env` for person creation,
endorsement, NFT minting, and story records. Set `HISTORICAL_DATA_FILES` to the source JSON files
in `data/persons/`. `dev:all` funds this wallet before seeding; the step-by-step flow requires
`dev:fund`. Local contract deployment and funding use the Hardhat node's development account.
Rerunning the seed resumes existing data and does not change an existing NFT's owner.

### Access Points

- **Frontend dApp**: http://localhost:5173
- **Local Blockchain RPC**: http://localhost:8545

### Testing

```bash
npm test               # Protocol and contract tests, including real receive/full-depth proofs
npm run frontend:check # Run frontend lint + typecheck + tests
npm run check          # Run circuit constraints, frontend checks and contract lint/build/test
```

The real EVM suite and chain acceptance share `scripts/lib/receiveProtocolAcceptance.mjs`.
It executes Source/Q issuance, native/ERC20 budgets, all three role revocations and same-family
reissuance without reverting chain state. The `receiveProtocol` report binds proofs to actual
transaction calldata, canonical receipts and replayed rejection calls. Claims use the chain's
maturity clock: local tests advance their node, while chain acceptance waits for the timestamp.

Run revocation status and gas regressions with `npm test -- test/receive-revocation-gas.test.mjs`.
The default histories contain 0 and 9 revocations per role. Set
`RECEIVE_REVOCATION_GAS_COUNTS=0,32,64,128,256` to measure larger histories and
`RECEIVE_REVOCATION_GAS_REPORT=tmp/receive-revocation-direct-status-gas.json` to save a report.

The development artifacts have been regenerated and pass `zk:check -- --artifacts-only` for all 13
relations. Real-proof and EVM checks are separate; they require the matching manifest-pinned files
and reject missing or mismatched artifacts. See [ZK
proofs](docs/zk-proofs.md#development-and-release).

### ZK Artifact Workflow

The protocol uses 13 Circom relations: two identity/disclosure, three money boundaries and eight receiving/qualification/budget relations. `dfreceive` is the sole receiving-code format. A payer can use the code for letters, transfers and future budget contributions while the recipient remains offline. See [receiving codes and letters](docs/private-letters.md).

| Command                                       | Purpose                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run zk:fetch`                            | Install the pinned Circom toolchain                                              |
| `npm run zk:build`                            | Compile the 13 canonical relations                                               |
| `npm run zk:assets:fetch`                     | Download and verify manifest-pinned proving files                                |
| `npm run zk:setup`                            | Compile all relations, regenerate 11 key sets and reuse identity/disclosure keys |
| `npm run zk:check -- --artifacts-only`        | Verify all 13 artifact sets without replacing keys                               |
| `npm run zk:check`                            | Rebuild all relations and check pinned artifacts and real proofs                 |
| `npm run test:circuits`                       | Check current circuit constraints without proving keys                           |
| `npm run zk:check -- --circuit protocol`      | Verify eight receiving proofs and public-signal binding                          |
| `npm run acceptance -- --browser`             | Run browser acceptance with three wallets and real qualification/funding proofs  |
| `npm test -- test/protocol-real-evm.test.mjs` | Exercise the real-proof money and eligibility flow                               |

Local development keys are not approved production keys. Public deployment and release remain blocked until all 13 relations have reviewed ceremony evidence. Browser WASM/zkey files are generated/downloaded artifacts; proof keys cannot be selected by a scanned receiving code. The project has one protocol and no compatibility entry points for previous receiving designs.

`zk:setup` is the single key-generation entry point: it compiles all 13 relations, verifies and
reuses existing matching identity/disclosure keys, and generates new keys for the eight receiving
and three boundary relations. It updates their development manifests, vkeys and Solidity verifiers;
redeploy local contracts and run `frontend:config` to synchronize pins and boundary aliases after
rotation. Generation does not approve a production ceremony or promote its artifacts.
`zk:check -- --artifacts-only` checks all 13 sets without regeneration. Use
`npm run zk:setup -- --circuit protocol:code` or `--circuit shielded:unshield4` to rotate a selected
current relation, or `--ptau <path>` to choose the local Phase 1 file; focused runs still require
all 13 artifact sets to pass the final check.

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

Upstream publishes no official macOS arm64 binary for the pinned Circom version, so the Apple
Silicon target is built from the repository-pinned source commit with locked Cargo dependencies.

These are the only supported host/runtime pairs. Linux libc is detected from Node's process report;
musl is rejected explicitly, as are all unsupported platform and architecture combinations. Windows
ARM64 hosts are unsupported even when running x64 Node.js under emulation. CI uses GitHub's
`ubuntu-latest` x64/glibc runner and separately exercises macOS arm64 and Windows x64.

Every selected compiler must report the repository-pinned Circom version and pass its
target-specific binary or source-provenance checks. All circuit compilation uses explicit
`--O2 --sanity_check 2`, pinning both the optimization and sanity-check levels instead of relying
on compiler defaults.
`zk:build` compiles the two identity/disclosure relations into `zk-artifacts/circuits`, the
three asset boundaries into `zk-artifacts/shielded`, and the eight receiving relations into
`zk-artifacts/protocol`. Compilation does not replace proving keys.

The receiving development manifest is `circuits/receive-development-manifest.json`.
`frontend:config` exports its verified browser files and the three boundary artifact sets into
`frontend/public/zk/protocol`, with trusted chain/registry pins in
`frontend/src/proof-artifacts.local.json`. Identity/disclosure files remain under
`frontend/public/zk/`. Remote builds fetch WASM/zkey from the configured
`VITE_ZK_ASSET_BASE_URL` using `<sha256>/<file name>.br`; verification-key JSON stays local.
The browser checks the decoded files against the pinned hashes.

`zk:check` rebuilds all 13 relations and verifies the current artifacts and real receiving proofs;
it never generates replacement keys.

`npm run zk:ptau:fetch` downloads the pinned power-17 Phase 1 file for explicit local development
setup. A reviewed production ceremony for the current 13-relation graph is still required;
`zk:setup` does not approve that ceremony, and `release:preflight` remains closed. Previous
ceremony/runbook procedures do not provide production approval for this graph.

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

RPC endpoints, Safe profiles, native-currency units,
wallet-derivation domains, report contents, locks, and checkpoints remain chain-bound. The guarded
runners share the `EVM_E2E_*` and `EVM_MAINNET_*` setting names because the named npm command
selects the immutable profile; the selected profile still rejects another chain's report, recovery
evidence, or authorization digest. Do not invoke a lower-level script with an arbitrary
`--network` to bypass these locks, and never persist a native-token budget while switching chains.

### Recommended eSpace Mainnet release

Production release is blocked: the current 13-relation graph has no reviewed production ceremony,
and `zk:setup` generates local keys without approving that ceremony. The release flow below remains
gated on reviewed production artifacts, a passing `release:preflight` from their clean commit, and
an exact eSpace Testnet `release-rehearsal` report with `releaseReady=true`. A prior ceremony for a
different circuit graph does not satisfy these requirements. A successful, self-validated rehearsal
automatically publishes the exact schema-v1 evidence to the Git-ignored, eSpace-specific path
`tmp/release-evidence/espace-release-rehearsal.json`. Diagnostic, failed, and recovery runs never
overwrite that file. The eSpace Mainnet release commands read it automatically and reject a missing
file, an older release commit, or mismatched artifact digest, production delay, ZK status,
verification, finality, or terminal state.

For a new production governance wallet, first configure three reviewed EOA/hardware-wallet owner
addresses in their final order, a fixed decimal salt nonce, the approved deployer, the Safe-only
CFX limit, and `GOVERNANCE_SAFE_PROFILE=conflux-safe-1.3.0-2of3`. Safe/status/release use the
built-in 2-confirmation and 3600-second finality policy. `GOVERNANCE_SAFE_ADDRESS` means the
deployed Safe Proxy contract address; keep it empty
while generating its read-only deterministic deployment plan:

```bash
npm run mainnet:safe -- --chain espace --plan
```

The creator is fixed to canonical Safe v1.3.0 with exactly three ordered EOA owners and a `2/3`
threshold. Owner order and `EVM_MAINNET_SAFE_SALT_NONCE` both affect the predicted address.
After an independent review, pass the exact printed digest to the explicit execute command to deploy
or resume. It reads only public owner addresses and never accepts an owner private key:

```bash
npm run mainnet:safe -- --chain espace --execute --digest 0x...
```

Deployment alone does not prove that the real controllers can sign. Two owners must use their
external signing workflow to execute the documented refund-free `0 CFX`, empty-calldata `CALL` to
`EVM_MAINNET_EXPECTED_DEPLOYER`. Set its outer transaction hash in
`EVM_MAINNET_SAFE_ACCEPTANCE_TX`, then require this read-only check to pass:

```bash
npm run mainnet:safe -- --chain espace --status
```

Only then copy the reviewed Safe Proxy address to `GOVERNANCE_SAFE_ADDRESS`. Do not configure
`GOVERNANCE_TIMELOCK_ADDRESS` for a fresh Mainnet release: the release orchestrator deploys and
checkpoints that Timelock itself. The accepted Safe Proxy becomes the sole holder of the Timelock's
proposer, canceller, and executor roles; the Timelock becomes `DeepFamily.owner()`. The acceptance
must remain the Safe's first and only execution (`nonce == 1`) until the protocol release plan and
execution complete.

Next use the resumable protocol orchestrator's explicit read-only plan command:

```bash
npm run mainnet:release -- --chain espace --plan
```

Every release invocation runs the clean build, test and release-evidence checks, then verifies the
complete ZK ceremony once in the final execution process before opening the RPC. The shared build
lock stays held throughout. Review the plan with a second operator. At least two current Safe owners
must sign the complete printed EIP-191
plan-approval message using their external wallet/hardware-wallet workflow. Put the exact printed
digest and signatures in a regular JSON file inside the repository, for example:

```json
{
  "planDigest": "0x...",
  "signatures": ["0xFirstOwnerSignature...", "0xSecondOwnerSignature..."]
}
```

Then execute or resume with that reviewed file:

```bash
npm run mainnet:release -- --chain espace --execute \
  --approval-file tmp/release-evidence/espace-mainnet-release-approval.json
```

The repository recovers the owner addresses and rejects a changed plan, report, Safe or owner set;
it never receives an owner private key.
It checkpoints every phase, verifies every contract, waits for finalized coverage, and validates
the terminal governance state. Repository tests never broadcast eSpace Mainnet transactions. See
the complete Safe bootstrap, acceptance, release, and recovery procedure in the
[eSpace Mainnet release runbook](docs/espace-mainnet-release.md).

### Guarded Ethereum release

Ethereum uses the same reviewed release architecture but a separate Ethereum profile and state.
It also requires the reviewed production ZK setup commit, `release:preflight`, and an exact Sepolia
release-rehearsal report. A successful, self-validated rehearsal publishes that evidence to the
Git-ignored, Ethereum-specific path `tmp/release-evidence/ethereum-release-rehearsal.json`; the
Ethereum Mainnet release commands read it automatically and reject a missing file or evidence from
an older commit. Diagnostic, failed, and recovery runs do not overwrite it. The ZK contributor count
is unrelated to the three-owner, 2/3 production Safe policy.
First run the destructive Sepolia acceptance suite:

```bash
EVM_E2E_MODE=diagnostic \
npm run acceptance -- --chain ethereum
```

A diagnostic run always reports `releaseReady=false`. Before a production release, rerun from the
clean release commit with `EVM_E2E_MODE=release-rehearsal`,
`GOVERNANCE_SAFE_PROFILE=ethereum-safe-1.3.0-2of3`, verification/finality enabled, and
the intended production `MIN_DELAY >= 604800`. Diagnostic mode uses the built-in 30-second delay
for each real governance window; `release-rehearsal` ignores that diagnostic default.

For Mainnet, configure three reviewed public owner addresses and a fixed salt, then create a
read-only Safe plan:

```bash
npm run mainnet:safe -- --chain ethereum --plan
```

After independent review, pass the exact printed digest to the explicit execute command; this
broadcasts the real Safe factory transaction:

```bash
npm run mainnet:safe -- --chain ethereum --execute --digest 0x...
```

Two real owners must then execute the documented zero-ETH smoke transaction externally; this
repository never accepts owner private keys. Record its outer hash and validate it without
broadcasting:

```bash
npm run mainnet:safe -- --chain ethereum --status
```

Finally, generate the read-only protocol plan:

```bash
npm run mainnet:release -- --chain ethereum --plan
```

At least two current Safe owners must sign the complete EIP-191 plan-approval message printed by
plan mode. Store the independently reviewed digest and those external signatures in the same
`planDigest`/`signatures` approval JSON shape shown above, then execute or resume with:

```bash
npm run mainnet:release -- --chain ethereum --execute \
  --approval-file tmp/release-evidence/ethereum-mainnet-release-approval.json
```

This broadcasts real Ethereum Mainnet transactions and spends real ETH. A real
`EXPLORER_API_KEY` is mandatory for Ethereum Mainnet source verification; Sepolia
acceptance uses API-key-free Blockscout. See the complete
environment, owner-smoke, approval, checkpoint, resumption, and recovery procedure in the
[Ethereum Mainnet release runbook](docs/ethereum-mainnet-release.md).

### Manual and other-network deployment

The stepwise commands below remain available for local/testnet work, optional compatibility
networks, and explicitly reviewed forensic recovery. They are not the recommended first-release
path on eSpace Mainnet; do not mix them with an active orchestrated release checkpoint.

```bash
# Stepwise rehearsal on Conflux eSpace Testnet (temporary one-command overrides; see below)
GOVERNANCE_TIMELOCK_ADDRESS=0xTimelock... GOVERNANCE_SAFE_ADDRESS=0xSafeProxy... \
  npm run deploy:net --net=confluxTestnet

# Optional Ethereum compatibility deployment (temporary one-command overrides)
GOVERNANCE_TIMELOCK_ADDRESS=0xTimelock... GOVERNANCE_SAFE_ADDRESS=0xSafeProxy... \
  npm run deploy:net --net=sepolia

# Local development
npm run dev:deploy

# Verify one eSpace deployment (ConfluxScan uses the built-in non-secret "espace" fallback)
npm run verify:net --net=confluxTestnet -- 0xContractAddress

# Sepolia verification uses API-key-free Blockscout
npm run verify:net --net=sepolia -- 0xContractAddress
```

### Upgradeability & Governance

`DeepFamily` is a UUPS proxy. `GOVERNANCE_SAFE_ADDRESS` is the Safe Proxy contract address; on live
networks it must contain contract code, expose `getOwners()`/`getThreshold()` with threshold at
least 2, and be the exclusive holder of the Timelock's proposer, canceller, and executor roles.
`GOVERNANCE_TIMELOCK_ADDRESS` is the already-deployed `GovernanceTimelock` contract address; when a
manual/reuse/upgrade command accepts it, the address must match the current Timelock runtime and
have a non-zero delay. New Mainnet deployments require at least 7 days (`604800` seconds).
`DeepFamily` upgrade authority is handed to the timelock after wiring, never left on the deployer
EOA. Local and simulated networks keep the deployer as `DeepFamily.owner()` for test flows.

`DeepFamilyToken` has a separate one-time lifecycle: the deployer owns it only long enough to call
`initialize(DeepFamily)`. A successful binding verifies both directions and automatically sets the
Token owner to `address(0)`. The Token is never owned by the Safe Proxy or Timelock and has no
mutable owner-only administration after initialization.

The recommended production control chain is
`DeepFamily → GovernanceTimelock ← Safe Proxy`: the Timelock is the protocol owner and DEEP
treasury, while the Safe Proxy is the sole holder of its proposer/canceller/executor roles. The
production checks do not prove that an arbitrary wallet implementation or its bytecode is safe;
the deployer must review the selected wallet, signer policy, modules, and guards independently.

The same `GovernanceTimelock` also acts as the DEEP protocol treasury. `DeepFamily` sends the
protocol share of each paid endorsement to `owner()`, so under the production ownership chain that
share accumulates at the Timelock address. Holding DEEP does not make the Token administratively
owned by the Timelock: `DeepFamilyToken.owner()` remains permanently zero. Treasury spending is a
separate delayed operation approved through the Safe Proxy.

The governance examples below use `confluxTestnet` for a stepwise rehearsal. The address settings
are temporary one-command inputs: `GOVERNANCE_SAFE_ADDRESS` identifies the Safe Proxy that will
hold the Timelock roles, and `GOVERNANCE_TIMELOCK_ADDRESS` identifies the already-deployed Timelock
that will become the protocol owner. For a fresh eSpace Mainnet release, do not set the latter;
start with `npm run mainnet:release -- --chain espace --plan` and let the orchestrator deploy it. Supply a
Timelock address only to a later, explicitly reviewed manual/reuse/upgrade command that needs an
existing deployment.

```bash
MIN_DELAY=604800 GOVERNANCE_SAFE_ADDRESS=0xSafeProxy... \
  npm run deploy:timelock --net=confluxTestnet
GOVERNANCE_TIMELOCK_ADDRESS=0xTimelock... GOVERNANCE_SAFE_ADDRESS=0xSafeProxy... \
  npm run deploy:net --net=confluxTestnet
```

Every non-local Timelock deployment requires `MIN_DELAY` and `GOVERNANCE_SAFE_ADDRESS` explicitly.
On Ethereum Mainnet and Conflux eSpace Mainnet, deployment requires `MIN_DELAY >= 604800` (7 days).
Testnet diagnostic runs may use shorter delays. Use an initialized Safe Proxy whose reported
threshold is at least 2. Only in-process simulated networks and a `localhost` connection to a
non-Mainnet chain use the 120-second/deployer defaults. The wrapper fixes the external admin to
zero and permits role changes only through a scheduled, delayed self-call.
The 7-day minimum is a deployment and release-tooling policy. Governance can later change the delay
through a self-call that first waits the current delay; the contract itself only rejects zero.

Owner-only configuration, such as changing the endorsement fee to 7.5%, uses the general governance
tasks. If the CLI signer is not the role holder, the task prints the destination and calldata to
submit through the configured Safe Proxy:

```bash
npx hardhat --config hardhat.config.mjs governance-schedule --network confluxTestnet \
  --target main --function updateEndorsementFee --args '[750]'
# Submit the printed schedule call through the Safe Proxy, then wait for the Timelock delay.
npx hardhat --config hardhat.config.mjs governance-execute --network confluxTestnet \
  --target main --function updateEndorsementFee --args '[750]'

# The Safe Proxy holding CANCELLER_ROLE can cancel a pending operation by its printed ID.
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
# Submit the printed schedule call through the Safe Proxy and wait for the delay.
npx hardhat --config hardhat.config.mjs treasury-transfer --network confluxTestnet \
  --phase execute --recipient 0xRecipient... --amount 125.5 \
  --contract-name GovernanceTimelock --token-contract-name DeepFamilyToken
```

The transfer task accepts a human-readable DEEP amount, rejects arbitrary token/target addresses,
and requires identical recipient, amount, and optional `--salt` in both phases. Without a local
role-holder signer it prints the `to`, `value`, `data`, and `operation` fields for the governance
Safe Proxy rather than bypassing its approval policy.

Timelock lifecycle changes use explicit `schedule` and `execute` phases. Both invocations must use
the same addresses and optional salt; without a configured role-holder key they print a multisig
Safe transaction:

```bash
# Atomically replace the sole proposer/canceller/executor Safe Proxy.
npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --network confluxTestnet \
  --contract-name GovernanceTimelock --phase schedule \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig...
npx hardhat --config hardhat.config.mjs timelock-migrate-multisig --network confluxTestnet \
  --contract-name GovernanceTimelock --phase execute \
  --old-multisig 0xOldMultisig... --new-multisig 0xNewMultisig...

# Raise the minimum delay to 14 days through a delayed Timelock self-call.
npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
  --contract-name GovernanceTimelock --phase schedule --new-delay 1209600
npx hardhat --config hardhat.config.mjs timelock-update-delay --network confluxTestnet \
  --contract-name GovernanceTimelock --phase execute --new-delay 1209600
```

Replacing the Timelock itself is a separate ownership migration. Deploy and verify the new
Timelock first using the intended new Safe Proxy as a one-command override; do not change
the persistent operator environment yet:

```bash
MIN_DELAY=1209600 GOVERNANCE_SAFE_ADDRESS=0xNewSafeProxy... \
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

Only pass a new `GOVERNANCE_SAFE_ADDRESS` or `GOVERNANCE_TIMELOCK_ADDRESS` to a later operator
command after the corresponding Safe-role or `DeepFamily` owner migration is confirmed on-chain.
Do not keep these migration overrides in the persistent fresh-release environment.

`DeepFamily.renounceOwnership()` remains available as an irreversible final governance-exit
mechanism, but the ordinary governance tasks deliberately reject it. It is not a routine
"decentralize" switch: once a separately constructed and audited Timelock operation executes it,
the proxy can never be upgraded, no new verifier route can be registered, protocol-fee settings
can never be changed, and
ownership can never be migrated. Future protocol fee shares are burned because `owner()` is zero;
already accumulated treasury assets are not automatically moved. Consider it only after a final
protocol audit, treasury disposition, public notice, and explicit Safe-owner approval of the exact
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
- [Receiving Codes and Letters](docs/private-letters.md) - Shared receiving authorization, budget contributions and encrypted wallet recovery
- [Frontend Integration](docs/frontend.md) - React component and UI development guide
- [Frontend Security](docs/frontend-security.md) - Passphrase, Archive unlock, and plaintext cache boundaries

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
