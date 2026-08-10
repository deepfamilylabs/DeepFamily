# Ethereum Mainnet Safe bootstrap and release

The guarded Ethereum production path is fixed to Ethereum Mainnet (`mainnet`, chain ID `1`) and
uses five explicit commands:

- `npm run ethereum:mainnet:safe:plan` predicts a canonical governance Safe without broadcasting;
- `npm run ethereum:mainnet:safe:execute -- --digest 0x...` deploys or resumes that Safe only from
  its independently reviewed plan digest;
- `npm run ethereum:mainnet:safe:status` performs read-only validation of the Safe deployment and
  the real-owner acceptance transaction;
- `npm run ethereum:mainnet:release:plan` creates a read-only protocol release plan;
- `npm run ethereum:mainnet:release:execute -- --approval-file <path>` broadcasts or resumes only
  from a separate operation-specific approval JSON file.

Use these npm commands directly. Do not invoke the lower-level `.mjs` files, add a different
`--network`, or reuse an eSpace digest, approval file, or recovery value. The public entries select an
immutable Ethereum profile in code: Mainnet chain ID `1`, canonical Safe v1.3.0 **L1** singleton,
three ordered EOA owners, threshold `2`, Etherscan verification, ETH budgets, Ethereum receipt gas
accounting, and `deployments/mainnet/` checkpoints. Environment variables supply stable approved
addresses, limits, and evidence; explicit commands and one-operation files supply authorization and
recovery without persisting those transient values in `.env`.

The eSpace and Ethereum production commands share the public `EVM_MAINNET_*` setting names. The
named command fixes their chain, plan-digest domain, native unit, and evidence requirements. Review
and replace the persistent public identities and testnet report when switching command families;
never reuse a digest, approval file, or recovery file across chains.

These commands have not, merely by existing or by passing repository tests, deployed anything on
Ethereum Mainnet. Plan mode makes RPC reads and writes local plan files but does not broadcast.
Execute mode sends real Ethereum transactions and spends real ETH.

A fresh protocol release deploys the Timelock and initial implementation only. It deploys no Mock,
performs no upgrade, schedules no Timelock operation, and therefore waits for no Timelock delay.
The configured delay applies to governance after release.

## Security and responsibility boundary

`PRIVATE_KEY` is the key of the dedicated production deployer/relayer. It pays for the Safe factory
call and the protocol deployment. It must not be a Safe-owner key.

The repository accepts only the three owners' public addresses through
`EVM_MAINNET_SAFE_OWNERS`. It never accepts, derives, imports, stores, or signs with a
production owner's private key, seed phrase, keystore, hardware-wallet secret, or Safe signature.
The three controllers must use an independently approved external Safe signing workflow.

The Safe deployment proves that the reviewed proxy and configuration exist. It does not prove that
the intended controllers possess usable keys. Before protocol release, two real owners must sign
and execute one refund-free Safe smoke transaction whose inner fields are exactly:

| Safe field                         | Required value                  |
| ---------------------------------- | ------------------------------- |
| `to`                               | `EVM_MAINNET_EXPECTED_DEPLOYER` |
| `value`                            | `0` ETH                         |
| `data`                             | `0x`                            |
| `operation`                        | `CALL` (`0`)                    |
| `safeTxGas`, `baseGas`, `gasPrice` | all `0`                         |
| `gasToken`, `refundReceiver`       | zero address                    |

The outer transaction must also carry zero ETH, succeed, emit exactly one `ExecutionSuccess`, emit
no `ExecutionFailure`, and reach the configured finality requirement. Record the **outer**
transaction hash in `EVM_MAINNET_SAFE_ACCEPTANCE_TX`.

This smoke transaction must be the new Safe's first and only execution. The release planner
requires Safe nonce `1`; after smoke acceptance, do not submit any other Safe transaction or change
owners, threshold, modules, guard, or fallback handler until release planning and execution are
complete.

The deployer EOA and its nonce must also be reserved exclusively for the active operation. Local
locks prevent competing commands in one checkout, but they cannot coordinate another machine,
wallet, CI job, or replacement-transaction tool. Maintain an external production change lock.

## Prerequisites

1. From a clean frozen circuit commit, run `npm run zk:production:setup` as described in
   [zk-ceremony.md](./zk-ceremony.md). Review and commit the generated manifest, transcript,
   verifiers, and frontend proving artifacts together, then run `npm run release:preflight` from
   that clean commit. The default path records one Phase 2 contributor under the explicit
   `single-operator` trust model. A multi-party ZK ceremony is an optional enhancement, not a
   prerequisite and not related to the Safe's three-owner, 2/3 policy.
2. Run `npm run ethereum:acceptance` from the intended release commit on Sepolia in
   `release-rehearsal` mode with `MIN_DELAY >= 86400`, and archive its successful schema-v4 report.
   This mode rehearses a fresh release with zero Timelock waits. A diagnostic run instead uses
   `EVM_E2E_MIN_DELAY=30` for each of four real governance windows and always has
   `releaseReady=false`. Require
   `zkArtifactTrust.productionReady=true` and `zkCeremonyVerification.status=passed` in the accepted
   report.
3. Use a clean, isolated checkout of the reviewed commit with exact dependencies and complete the
   contract, frontend, ZK artifact, and storage-layout checks.
4. Obtain the final public addresses of three independent EOA/hardware-wallet controllers in their
   reviewed order. Confirm that the external signing workflow is configured for chain ID `1`.
5. Choose one decimal Safe salt nonce and never change the salt or owner order after plan approval.
6. Reserve a dedicated deployer EOA, fund it only to the independently approved ceilings, and use a
   reliable `ETHEREUM_MAINNET_RPC_URL` or reviewed Infura endpoint.
7. Configure a real Etherscan key in `EXPLORER_API_KEY`. Ethereum release execution requires source
   verification and does not accept the non-secret ConfluxScan `espace` placeholder.
8. Arrange immutable off-machine storage for the complete ignored `deployments/mainnet/`
   directory, release logs, review record, and explorer evidence.

## Environment configuration

Copy `.env.example` to the ignored `.env` and protect it. Never commit `.env`.

```dotenv
# Dedicated deployer/relayer only; never a production Safe owner.
PRIVATE_KEY=0x...
ETHEREUM_MAINNET_RPC_URL=https://your-reviewed-ethereum-mainnet-rpc
EXPLORER_API_KEY=your-real-etherscan-api-key
# Optional: blank uses tmp/zk-production/powersOfTau28_hez_final_13.ptau.
ZK_PTAU_PATH=

# Production policy.
GOVERNANCE_MULTISIG_PROFILE=ethereum-safe-1.3.0-2of3
MIN_DELAY=172800
EVM_MAINNET_CONFIRMATIONS=2
EVM_MAINNET_FINALITY_TIMEOUT=3600
# Keep blank for a fresh orchestrated release.
GOVERNANCE_OWNER=
# Keep blank until Safe deployment and owner smoke validation have passed.
GOVERNANCE_MULTISIG=

# Public deployer and owner identities.
EVM_MAINNET_EXPECTED_DEPLOYER=0x...
EVM_MAINNET_SAFE_OWNERS=0xOwner1,0xOwner2,0xOwner3

# Safe factory phase.
EVM_MAINNET_SAFE_SALT_NONCE=2026072401
# Set explicitly for this operation; ethereum:mainnet:safe interprets the value as ETH.
EVM_MAINNET_SAFE_MAX_NATIVE=0.1
EVM_MAINNET_SAFE_ACCEPTANCE_TX=

# Protocol release phase.
# Set explicitly for this operation; ethereum:mainnet:release interprets the value as ETH.
EVM_MAINNET_MAX_NATIVE=1
# Exact reviewed Sepolia report copied to a regular path inside this checkout.
EVM_MAINNET_TESTNET_RELEASE_REPORT=tmp/release-evidence/ethereum-release-rehearsal.json
```

The protocol release command requires a schema-v4 fresh-release report with release-ready status,
`evidenceType=initial-mainnet-release`, `governanceLifecycleIncluded=false`, the same clean commit,
artifact-input digest and deployed `MIN_DELAY`, production ZK evidence, source verification,
finality, initial governance state and refund evidence. It rejects a report containing Mock,
upgrade, migration, or Timelock-wait evidence, as well as diagnostic or another commit's evidence,
before any Mainnet transaction.

The acceptance runner's original ignored report path is run-specific; the example path is not
created automatically. Copy the exact reviewed JSON into an ordinary, non-symlink file inside the
release checkout, compare its SHA-256 against the immutable off-machine archive, and point
`EVM_MAINNET_TESTNET_RELEASE_REPORT` at that in-checkout file. External paths and symlinks are
rejected so the reviewed report bytes are included in the plan and Safe-owner signatures.

Choose the two ETH ceilings from reviewed estimates plus a documented margin; they are hard
authorization ceilings, not spending targets. `EVM_MAINNET_SAFE_MAX_NATIVE` covers only the Safe
factory transaction. `EVM_MAINNET_MAX_NATIVE` separately covers the protocol release. The Ethereum
commands interpret both as ETH; set them explicitly for each operation and never carry populated
values across chains. The runner requires the deployer to cover the applicable ceiling and rechecks
funds before broadcasts.
Ethereum charged gas is accounted from the receipt as
`gasUsed × effectiveGasPrice`; the Conflux three-quarter gas-limit rule is not used.

The Safe and release plan digests are deliberately independent. Plan and execute are separate npm
commands: Safe execution receives its reviewed digest through `--digest`, while protocol release
execution receives its digest and reviewed Safe-owner signatures from an operation-specific approval
JSON file. Neither authorization belongs in persistent `.env` configuration.

## Phase A: create and accept the governance Safe

### A1. Generate a read-only Safe plan

Keep `GOVERNANCE_MULTISIG` blank while planning a fresh Safe:

```dotenv
GOVERNANCE_MULTISIG=
```

Run:

```bash
npm run ethereum:mainnet:safe:plan
```

The command is hard-locked to network `mainnet` and raw RPC chain ID `1`. It checks the canonical
Safe v1.3.0 L1 singleton, proxy factory and fallback handler runtime, the exact three ordered
codeless owner addresses, threshold `2`, explicit salt, unused predicted address, factory calldata,
deployer identity and budget. It writes:

```text
deployments/mainnet/mainnet-safe-plan.json
```

No Safe transaction is broadcast in plan mode. Independently review the release commit and tool
input digest, deployer and reserved nonce, owner order, salt, predicted address, canonical
components and code hashes, target/value/calldata hash, budget, confirmation/finality settings, and
printed plan digest.

### A2. Execute or resume the reviewed factory call

After independent approval, keep `PRIVATE_KEY` set only to the approved deployer key and pass the
exact printed digest to the explicit execute command:

```bash
npm run ethereum:mainnet:safe:execute -- --digest 0x...
```

This is a real Mainnet transaction. The tool recomputes the complete plan, rejects drift, records a
checkpoint before broadcast, waits for confirmations/finality, and validates the resulting Safe's
singleton, owners, threshold, nonce `0`, empty module set, zero guard, and canonical fallback
handler. Rerunning the same execute command with the same reviewed digest resumes or revalidates; it
does not intentionally deploy a second Safe.

### A3. Prove real 2-of-3 owner control

Two of the three production controllers must inspect and sign the exact smoke transaction from the
security table using the approved external Safe workflow. The repository does not collect their
signatures. A non-owner relayer may submit an already authorized Safe transaction.

After it is finalized, record its outer transaction hash:

```dotenv
EVM_MAINNET_SAFE_ACCEPTANCE_TX=0x...
```

Run:

```bash
npm run ethereum:mainnet:safe:status
```

Status is read-only. It revalidates the factory deployment, canonical profile, smoke transaction,
`ExecutionSuccess`, finality, and current Safe state without an owner key. Proceed only when it
reports governance ready and Safe nonce `1`. Then set:

```dotenv
GOVERNANCE_MULTISIG=0xReviewedSafeAddress
```

Keep the Safe frozen at nonce `1` until the protocol release completes.

## Phase B: plan and execute the protocol release

### B1. Generate a read-only release plan

Run:

```bash
npm run ethereum:mainnet:release:plan
```

The wrapper obtains per-chain and shared production-build locks, runs the complete
`npm run release:preflight` gate, and invokes the Mainnet engine with compilation disabled without
releasing the shared build lock.
Plan mode performs chain reads, does not broadcast, and writes this local plan file:

```text
deployments/mainnet/mainnet-release-plan.json
```

It does not broadcast. Review the chain and raw chain ID, commit/build inputs, deployer, accepted
Safe and owner order, Safe nonce `1`, Timelock delay, ETH ceiling, expected contracts, mandatory
Etherscan/finality policy, checkpoint directory, all ordered transaction intents, testnet evidence,
and digest. The command also prints one exact UTF-8 EIP-191 approval message.

### B2. Execute or resume the reviewed release

At least two current production Safe owners must independently review the exact plan and selected
Sepolia report, then sign the complete printed EIP-191 message with their external
hardware-wallet/wallet workflow. The repository accepts only the resulting signatures and never
their private keys. Do not sign only the digest or retype the message.

After collecting the signatures, create an operation-specific JSON file inside this repository. It
must be a regular, non-symlink file containing exactly `planDigest` and `signatures`, for example
the Git-ignored `tmp/release-evidence/ethereum-mainnet-release-approval.json`:

```json
{
  "planDigest": "0x...",
  "signatures": ["0xFirstOwnerSignature...", "0xSecondOwnerSignature..."]
}
```

Keep this reviewed file unchanged for execution and any resume, then run:

```bash
npm run ethereum:mainnet:release:execute -- --approval-file tmp/release-evidence/ethereum-mainnet-release-approval.json
```

This execute phase first recomputes the plan and requires distinct valid signatures from at least
the on-chain Safe threshold of configured owners. A changed plan digest, Safe address, or owner set
invalidates the signatures before any broadcast. It then broadcasts real Ethereum Mainnet
transactions and spends ETH. The release deploys and validates `GovernanceTimelock`, deploys and
wires the protocol system, hands `DeepFamily` ownership to the Timelock, verifies every contract on
Etherscan, waits for finality, re-reads receipts and block hashes, checks proxy/verifier/Token/
Reader/Timelock/treasury invariants, and writes its terminal report. It does not create person,
endorsement, NFT, or story business data on Mainnet. It also deploys no Mock, performs no upgrade,
and waits for no Timelock operation. `MIN_DELAY=172800` is the on-chain 48-hour policy for future
governance, not a sleep in the fresh-release command.

`GOVERNANCE_OWNER` remains blank for a fresh run because the orchestrator creates and checkpoints
the Timelock itself. Do not manually deploy pieces or mix `deploy:net`/`deploy:timelock` with an
active orchestrated checkpoint.

## Checkpoints, resumption, and recovery

Safe files are:

- `deployments/mainnet/mainnet-safe-plan.json`;
- `deployments/mainnet/mainnet-safe-state.json`;
- `deployments/mainnet/mainnet-safe-report.json`;
- locks under `deployments/mainnet/` while a Safe command is active.

Release files are:

- `deployments/mainnet/mainnet-release-plan.json`;
- `deployments/mainnet/mainnet-release-state.json`;
- `deployments/mainnet/mainnet-release-report.json`;
- locks under `deployments/mainnet/` while a release command is active.

The shared `deployments/mainnet/.mainnet-command.lock` prevents Safe creation and protocol release
from racing in this checkout. A repository-wide production-build lock also prevents eSpace and
Ethereum release wrappers from cleaning/replacing the same Hardhat artifacts concurrently. These
locks do not replace the team's external release coordination.

After an ordinary RPC interruption, rerun the same Safe execute command with its unchanged digest,
or the same release execute command with its unchanged approval file. The checkpoint validates
completed phases and resumes at the first safe incomplete phase. Never edit or delete a checkpoint
to force progress.

If the Safe factory transaction was accepted by the RPC but its hash was not persisted, first
recover and independently validate the exact chain, sender, nonce, target, value, calldata, receipt,
and proxy result. Keep the original Safe digest and supply the recovered hash only for that resume:

```bash
npm run ethereum:mainnet:safe:execute -- --digest 0xApprovedPlanDigest --recovery-tx 0xTransactionHash
```

The recovery hash can only adopt a transaction matching the checkpointed intent; it does not
authorize a new broadcast. Once adopted, later revalidation does not need `--recovery-tx`.

For a hashless planned protocol phase, create a regular, non-symlink recovery JSON file inside this
repository using the exact label printed by the runner, for example
the Git-ignored `tmp/release-evidence/ethereum-mainnet-release-recovery.json`:

```json
{
  "exact-runner-label": "0xTransactionHash"
}
```

Keep the original approval file and run:

```bash
npm run ethereum:mainnet:release:execute -- --approval-file tmp/release-evidence/ethereum-mainnet-release-approval.json --recovery-file tmp/release-evidence/ethereum-mainnet-release-recovery.json
```

Unknown labels, extra hashes, failed/replaced transactions, or sender/nonce/input/address/code/state
mismatches stop recovery. Once the checkpoint adopts the evidence, later resumes can omit
`--recovery-file` while continuing to use the unchanged approval file.

Preserve stale lock files and checkpoints after abnormal termination until operators have proved no
related process or transaction remains active. Do not remove a lock simply to silence an error.

## Completion and handoff

Archive the complete `deployments/mainnet/` directory, release commit and build information,
factory and release receipts, Etherscan links, Safe owner/salt approval, owner smoke evidence,
digests, logs, and external approval record. A successful completion report must show verification,
finality, canonical receipts/block hashes, and all terminal governance invariants—not merely mined
transactions.

Subsequent fee changes, verifier replacement, treasury transfers, upgrades, Safe migration, delay
changes, or Timelock migration are governance operations. The tooling generates the
`to/value/data/operation`; the external Safe workflow collects owner signatures, and the Timelock
enforces the configured delay. See
[Smart Contracts Reference](contracts.md#upgradeability--governance-uups).

For Conflux eSpace, use the separate
[eSpace Mainnet release runbook](espace-mainnet-release.md). Although both environments are EVM,
their chain profiles, Safe singleton type, gas charging, RPC, explorer, currency, authorization,
and checkpoint directories are intentionally not interchangeable.
