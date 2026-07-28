# Conflux eSpace Mainnet Safe bootstrap and release

The production path for Conflux eSpace Mainnet (`conflux`, chain ID `1030`) has three deliberately
separate commands:

- `npm run espace:mainnet:safe` predicts and, after explicit approval, deploys one canonical
  governance Safe through its pinned factory call;
- `npm run espace:mainnet:safe:status` performs read-only validation of the deployment and the
  real-owner smoke transaction;
- `npm run espace:mainnet:release` plans and, after a separate approval, deploys the Timelock and
  protocol, verifies sources, waits for finality, checks terminal governance, and records a
  resumable checkpoint.

Use only these npm commands. Do not invoke either lower-level `.mjs` entry with `hardhat run`. The
release wrapper holds the shared production-build lock, performs the complete
`npm run release:preflight` gate, then invokes the reviewed orchestrator with compilation disabled
without releasing the lock. The Safe creator does not need a protocol compilation; it hashes and
binds its own pinned deployment inputs instead.

The eSpace and Ethereum commands share reviewed orchestration internals, but the public entry fixes
an immutable chain profile. This runbook is only for eSpace Mainnet: Safe v1.3.0 L2 singleton,
CFX budgets, Conflux gas charging, Conflux RPC/ConfluxScan, eSpace confirmation strings, and
`deployments/conflux/` state. Do not append an arbitrary `--network` or substitute Ethereum
environment variables. For Ethereum's Safe v1.3.0 L1 profile and independent state, use the
[Ethereum Mainnet release runbook](ethereum-mainnet-release.md).

These are production tools, not a mainnet copy of the testnet acceptance suite. The Safe creator
does not operate the owners' wallets, and the release runner does not create or migrate governance,
perform an upgrade, or submit person, endorsement, NFT, or story transactions.

## Security model

The Safe creator and release runner support exactly the pinned
`conflux-safe-1.3.0-2of3` profile: canonical Safe v1.3.0, exactly three distinct ordered EOA owners,
and threshold `2`. Contract owners and a different owner count or threshold are deliberately
unsupported. The configured owner order is part of setup calldata, deterministic address
prediction, and the plan digest. `ESPACE_MAINNET_SAFE_SALT_NONCE` is an explicit decimal
`uint256`; choose it once and never change either the salt or owner order during planning,
deployment, recovery, and status validation.

The Safe creator accepts only the owners' public addresses. `PRIVATE_KEY` belongs to the approved
deployer/relayer EOA, must not be one of the owners, and is used only when the repository must
broadcast a factory or release transaction. The repository never accepts, derives, reads, signs
with, or stores an owner private key, seed phrase, keystore, or Safe signature.

Deploying the proxy proves only that the reviewed bytecode and setup are on chain. It does not prove
that the three named people or devices control their keys. Before release, two real owners must use
an external signing workflow to execute one refund-free Safe transaction whose inner call is:

| Safe field                         | Required value                     |
| ---------------------------------- | ---------------------------------- |
| `to`                               | `ESPACE_MAINNET_EXPECTED_DEPLOYER` |
| `value`                            | `0` CFX                            |
| `data`                             | `0x`                               |
| `operation`                        | `CALL` (`0`)                       |
| `safeTxGas`, `baseGas`, `gasPrice` | all `0`                            |
| `gasToken`, `refundReceiver`       | zero address                       |

The outer transaction must also carry zero CFX, succeed, emit exactly one `ExecutionSuccess`, emit
no `ExecutionFailure`, and become finalized. Record its outer transaction hash in
`ESPACE_MAINNET_SAFE_ACCEPTANCE_TX`; `npm run espace:mainnet:safe:status` replays and validates that
public evidence without any owner key.

The release runner requires that acceptance to be the Safe's first and only execution, so the Safe
nonce must be exactly `1` at release-plan time. Do not submit another Safe transaction or change
owners, threshold, modules, guard, or fallback handler after acceptance and before release planning
and execution complete. A later status check can prove the recorded acceptance transaction but
cannot make an advanced nonce eligible for first release.

The deployer key and nonce must likewise be exclusive to the active Safe deployment or protocol
release from plan approval through completion. Do not use that EOA from another checkout, host,
container, wallet, automation job, or replacement-transaction tool. The shared local
`.mainnet-command.lock` prevents the Safe creator and release runner in this checkout from racing
each other; repository locks cannot coordinate another machine, so production operations also need
the team's external release lock/change record.

The runner also enforces all of the following for execution:

- Hardhat network `conflux` and raw RPC chain ID `1030`;
- a clean, unchanged release checkout and the production compiler profile;
- `MIN_DELAY >= 86400` seconds;
- the approved deployer, accepted Safe address, exact ordered three-owner set, and Safe nonce `1`;
- a required CFX budget ceiling;
- contract source verification, finalized-block coverage, and terminal on-chain checks, with no
  environment switch that can disable them.

The pinned Safe contracts are checked directly through RPC by address, runtime code hash, singleton,
factory, fallback handler, owners, threshold, nonce, modules, and guard. That does not guarantee
that Safe Wallet's hosted UI or transaction service supports Conflux eSpace. The owner team chooses
and validates its external signing interface or SDK; never solve UI compatibility by copying owner
keys into this repository.

## Prerequisites

1. Complete the production multi-party ZK ceremony in
   [zk-ceremony.md](./zk-ceremony.md), replace the development proving keys, and run
   `npm run release:preflight` with the reviewed `ZK_PTAU_PATH`.
2. Complete `npm run espace:acceptance` from the same audited release commit on eSpace Testnet in
   `release-rehearsal` mode with the exact production `MIN_DELAY`. Archive only a report whose
   `status` is `passed`, `releaseReady` is `true`,
   `zkArtifactTrust.productionReady` is `true`, and `zkCeremonyVerification.status` is `passed`; a
   30-second diagnostic report is not release evidence.
3. Use a clean, isolated checkout of that commit and the reviewed Node/npm versions. Install exact
   dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, then complete the repository's
   build, test, frontend, ZK artifact, and storage-layout checks. Do not reuse an untrusted global
   compiler or a mutable development `node_modules` directory.
4. Have three independent production controllers supply only their final public EOA/hardware-wallet
   addresses in the reviewed order. Confirm that each controller can use the chosen external
   Conflux eSpace signing workflow; do not give any owner key to the deployer or repository.
5. Choose and record one explicit Safe salt nonce. Fund only the approved deployer EOA with enough
   mainnet CFX for the independently reviewed Safe and release ceilings. The Safe itself needs no
   CFX for this bootstrap or protocol deployment.
6. Use a reliable `CONFLUX_RPC_URL`. A public fallback exists, but a monitored provider is strongly
   preferred for deployment, verification, receipt recovery, and finality checks.
7. Ensure the release checkout can write `deployments/conflux/`, and arrange an independent archive
   for that ignored local directory immediately after completion.

## Configuration

Copy `.env.example` to the ignored `.env` file and fill the production values. Do not commit
`.env`, a private key, a signature, or an owner keystore.

```dotenv
# Approved factory/release deployer only; never a Safe owner key.
PRIVATE_KEY=0x...
CONFLUX_RPC_URL=https://your-reviewed-espace-mainnet-rpc
ZK_PTAU_PATH=/absolute/path/to/reviewed-production.ptau

# Keep blank until the Safe deployment and real-owner acceptance are independently validated.
GOVERNANCE_MULTISIG=
GOVERNANCE_MULTISIG_PROFILE=conflux-safe-1.3.0-2of3
MIN_DELAY=172800
# Must remain empty for a fresh orchestrated protocol release.
GOVERNANCE_OWNER=

# Public identities shared by Safe creation and protocol release.
ESPACE_MAINNET_EXPECTED_DEPLOYER=0x...
ESPACE_MAINNET_SAFE_OWNERS=0xOwner1,0xOwner2,0xOwner3

# Safe creation: owner order and this explicit decimal uint256 determine the address.
ESPACE_MAINNET_SAFE_SALT_NONCE=2026072301
ESPACE_MAINNET_SAFE_MAX_CFX=0.2
ESPACE_MAINNET_SAFE_CONFIRMATIONS=2
ESPACE_MAINNET_SAFE_FINALITY_TIMEOUT=3600
ESPACE_MAINNET_SAFE_CONFIRM=
ESPACE_MAINNET_SAFE_PLAN_DIGEST=
ESPACE_MAINNET_SAFE_RECOVERY_TX=
# Fill only after two real owners complete the documented external smoke transaction.
ESPACE_MAINNET_SAFE_ACCEPTANCE_TX=

# Protocol release: separate budget, finality policy, authorization, and recovery evidence.
ESPACE_MAINNET_MAX_CFX=5
ESPACE_MAINNET_CONFIRMATIONS=2
ESPACE_MAINNET_FINALITY_TIMEOUT=3600
# Exact reviewed release-rehearsal report copied to a regular path inside this checkout.
ESPACE_MAINNET_TESTNET_RELEASE_REPORT=tmp/release-evidence/espace-release-rehearsal.json
ESPACE_MAINNET_CONFIRM=
ESPACE_MAINNET_PLAN_DIGEST=
ESPACE_MAINNET_PLAN_APPROVAL_SIGNATURES=
ESPACE_MAINNET_RECOVERY_TXS=
```

For a fresh release, leave `GOVERNANCE_OWNER` empty: the orchestrator deploys
`GovernanceTimelock`, validates it, and uses that exact address for the integrated protocol
deployment. Keep `GOVERNANCE_MULTISIG` empty while creating and accepting a new Safe. Setting or
changing `.env` later never changes chain state.

The protocol release command validates the selected testnet report rather than trusting its file
name. It requires schema v3, `releaseReady=true`, the current clean commit and artifact-input digest,
the same `MIN_DELAY`, production ZK evidence, finalized critical transactions, complete source
verification, terminal governance checks, and refund evidence. A report from another commit,
diagnostic mode, or the earlier 30-second run is rejected before any Mainnet transaction.

The acceptance runner writes its report beneath its ignored run directory; the example path above
is not created automatically. Copy the exact reviewed JSON into an ordinary, non-symlink file
inside the release checkout, record and independently compare its SHA-256 with the immutable
off-machine archive, then set `ESPACE_MAINNET_TESTNET_RELEASE_REPORT` to that relative or absolute
in-checkout path. Repository-external paths and symbolic links are rejected so that plan bytes and
owner signatures bind one stable local report.

`EXPLORER_API_KEY` may remain empty for ConfluxScan; the Hardhat configuration supplies its
non-secret `espace` placeholder. It is not a wallet credential or an authorization key. Do not use
that placeholder for an Ethereum verification invocation.

`ESPACE_MAINNET_SAFE_MAX_CFX` covers only the one Safe factory call.
`ESPACE_MAINNET_MAX_CFX` separately covers the protocol release. Neither is a target to spend.
Choose each from a reviewed gas estimate plus a documented margin; do not set either to the
deployer's whole balance. The deployer must hold at least the applicable full ceiling before
execution or resumption. Before every individual broadcast, the runner also requires enough
current balance for that transaction's checkpointed worst case.
Final receipts record both `gasUsed` and Conflux `gasCharged`; actual cost uses
`max(gasUsed, ceil(3 × gasLimit / 4)) × effectiveGasPrice`, rather than the Ethereum-only
`gasUsed × effectiveGasPrice` assumption.

The Safe-specific `*_CONFIRMATIONS`, `*_FINALITY_TIMEOUT`, budget, confirmation/digest pair, and
single recovery hash are independent from the release variables with similar names. Never copy a
Safe plan digest into the release digest or use one operation's budget/recovery evidence for the
other.

## Create and validate the production Safe

### 1. Generate a read-only Safe plan

Confirm that these three values are empty:

```dotenv
GOVERNANCE_MULTISIG=
ESPACE_MAINNET_SAFE_CONFIRM=
ESPACE_MAINNET_SAFE_PLAN_DIGEST=
```

`PRIVATE_KEY` is not needed for this read-only phase. Run:

```bash
npm run espace:mainnet:safe
```

The command is restricted to chain `1030`. It verifies the raw RPC chain ID, clean Git state,
canonical singleton/factory/fallback-handler runtime hashes, factory-derived proxy runtime,
deployer and owners as codeless EOAs, unused predicted address, and exact factory-call simulation.
It then writes `deployments/conflux/mainnet-safe-plan.json` without broadcasting a transaction.

Independently review at least:

- release commit and Safe-tool input digest;
- approved deployer and its reserved pending nonce;
- all three public owner addresses in the exact displayed order and threshold `2`;
- explicit salt nonce and predicted Safe address;
- canonical v1.3.0 singleton, proxy factory, fallback handler, and runtime code hashes;
- exact factory target, zero value, calldata hash, budget, confirmation count, finality timeout, and
  printed Safe plan digest.

Owner order is not cosmetic. Reordering the same three addresses changes initializer calldata,
CREATE2 prediction, and digest. Changing the salt has the same effect. Any change requires a new
plan and a fresh independent review.

### 2. Deploy or resume the reviewed Safe

After approval, copy the exact printed digest and exact confirmation string:

```dotenv
ESPACE_MAINNET_SAFE_PLAN_DIGEST=0x...
ESPACE_MAINNET_SAFE_CONFIRM=conflux-mainnet-safe-chain-1030
```

Set `PRIVATE_KEY` only to the approved `ESPACE_MAINNET_EXPECTED_DEPLOYER` key and run the same
command:

```bash
npm run espace:mainnet:safe
```

The command recomputes the complete plan before any broadcast, requires enough deployer balance for
the full Safe ceiling, checkpoints the planned factory intent before sending, verifies the emitted
proxy address and exact factory calldata, waits for the configured receipts and finalized head, and
revalidates the final Safe version, singleton, owners, threshold, nonce `0`, modules, guard, and
fallback handler. A completed rerun is a read-only revalidation; it does not create a second Safe.

The deployment report can say `deployed: true` while `governanceReady: false`. This is expected:
factory deployment cannot prove that real owners possess and can use their keys.

### 3. Prove real 2-of-3 owner control

In the owner team's external multisig workflow, construct the exact refund-free transaction from
the Security model table above. Two of the three real owners must inspect and sign it. The
repository does not choose or operate the signing UI, collect signatures, or relay with an owner
key. A non-owner relayer may submit the already authorized `execTransaction`, but its outer value
must also be zero.

Safe Wallet's hosted web application and transaction service are not assumed to support Conflux
eSpace. A compatible externally reviewed SDK/interface may be used, but each owner must verify chain
ID `1030`, the Safe address, inner target/value/data/operation, all refund fields, and the final
encoded transaction independently. Never export an owner key into `.env`, a repository script, or
the deployer's machine merely to automate this step.

After the transaction succeeds and is available through the reviewed RPC, record its **outer**
transaction hash:

```dotenv
ESPACE_MAINNET_SAFE_ACCEPTANCE_TX=0x...
```

Then run the read-only validator:

```bash
npm run espace:mainnet:safe:status
```

Status revalidates the original finalized factory deployment, current canonical Safe profile, and
the exact acceptance transaction and `ExecutionSuccess`, then waits for finalized coverage. It
prints `governance ready: yes` only when that evidence passes. It needs no owner private key and
never sends a transaction. Its report keeps the approved deployment commit/input digest separate
from the current status-validator commit/input digest and says whether they match. A later or dirty
validator checkout is therefore visible rather than being mislabeled as the original audited
deployment version; review that provenance before relying on the result.

The protocol release independently requires the current Safe nonce to be exactly `1`. Therefore:

1. make this acceptance the newly deployed Safe's first execution;
2. after it succeeds, send no owner change, module/guard transaction, transfer, or governance call;
3. run status and archive the report;
4. only then set `GOVERNANCE_MULTISIG` to the reviewed predicted/deployed Safe address;
5. keep the Safe frozen at nonce `1` until protocol release planning and execution finish.

If the nonce advances beyond `1`, do not try to edit a report or checkpoint. The first-release gate
will reject that Safe state; stop and obtain a new reviewed operational decision.

## Plan, approve, and execute the protocol release

First run the command with `ESPACE_MAINNET_CONFIRM` and `ESPACE_MAINNET_PLAN_DIGEST` empty:

```bash
npm run espace:mainnet:release
```

This is the default read-only plan. It must not broadcast a transaction. The command still performs
the same clean production build used by execution. Review the printed chain,
release commit and build inputs, deployer, Safe address and ordered owners, threshold, validated
acceptance transaction, current Safe nonce `1`, delay, budget, expected contracts,
verification/finality policy, checkpoint location, and plan digest. A second operator should also
compare the 14 ordered transaction intent hashes with the approved release record and the chain
independently. Do not send another Safe transaction after this review.

The plan also prints one exact UTF-8 EIP-191 approval message. At least two of the three current
production Safe owners must independently compare the plan and archived testnet report, then sign
that complete message using their normal external hardware-wallet/wallet signing workflow. Do not
sign only the digest, retype the message, or give an owner key to this repository. Collect the two
signatures as a one-line JSON array.

Only after that review and owner approval, copy the exact printed digest, signatures and chain
confirmation into `.env`:

```dotenv
ESPACE_MAINNET_PLAN_DIGEST=0x...
ESPACE_MAINNET_PLAN_APPROVAL_SIGNATURES=["0xFirstOwnerSignature...","0xSecondOwnerSignature..."]
ESPACE_MAINNET_CONFIRM=conflux-mainnet-chain-1030
```

Then run the exact same command (do not replace it with a direct Hardhat/script invocation):

```bash
npm run espace:mainnet:release
```

Execution recomputes the plan and recovers each signer from the exact EIP-191 message. It requires
at least the on-chain Safe threshold of distinct signatures from the configured current owner set.
Any source, artifact, testnet-report byte, configuration, deployer, Safe state, or chain change
invalidates the digest or signatures and stops before a new transaction. Never bypass this by
copying a new digest without repeating the review and owner signatures.

The normal release sequence is:

1. re-run all preflight gates and lock this network's release state;
2. deploy and validate `GovernanceTimelock` with the production Safe as its sole
   proposer/canceller/executor and itself as its sole administrator;
3. verify the Timelock source on ConfluxScan;
4. deploy and wire the Token, libraries, ZK verifiers, adapter, DeepFamily implementation, UUPS
   proxy, and reader while recording every receipt;
5. transfer `DeepFamily.owner()` to the Timelock and confirm that the deployer has no governance
   role or protocol ownership;
6. verify every release contract with the exact constructor arguments and linked libraries;
7. wait until the finalized head covers every recorded release transaction, then re-read every
   receipt and canonical block hash;
8. validate proxy, verifier, Token binding/ownerless state, Reader, Timelock roles/delay, protocol
   owner, and treasury relationships; write the final report.

No mainnet business-data smoke transaction is part of this sequence. Person, proof, endorsement,
NFT, and story behavior is exercised by the testnet release rehearsal; any mainnet data write must
be separately approved as real production activity.

## Safe and release checkpoints

Neither tool stores secret material. Safe creation uses:

- `deployments/conflux/mainnet-safe-plan.json` — latest read-only prediction, decoded setup, policy,
  and Safe plan digest;
- `deployments/conflux/mainnet-safe-state.json` — atomic factory-transaction checkpoint and
  immutable Safe input fingerprint, created for execution;
- `deployments/conflux/mainnet-safe-report.json` — deployment/finality/profile evidence and the
  latest owner-operational-acceptance result, including separate approved-plan and
  current-validator provenance;
- `deployments/conflux/.mainnet-safe.lock` — factory execution/resumption lock;
- `deployments/conflux/.mainnet-safe-command.lock` — complete Safe command wrapper lock;
- `deployments/conflux/.mainnet-command.lock` — shared wrapper lock that prevents a Safe command
  and protocol release command in this checkout from consuming the same deployer nonce
  concurrently.

Of those three Safe-flow lock files, `.mainnet-safe.lock` and `.mainnet-safe-command.lock` are
specific to Safe creation; `.mainnet-command.lock` is shared with release. All three are
local-checkout guards only.

Protocol release uses:

- `deployments/conflux/mainnet-release-plan.json` — the latest read-only plan and digest; it is
  separate from, and can never overwrite, the final execution report;
- `deployments/conflux/mainnet-release-state.json` — atomic checkpoint and immutable release input
  fingerprint;
- `deployments/conflux/mainnet-release-report.json` — final addresses, transactions, verification,
  finality, and terminal-state evidence;
- `deployments/conflux/.mainnet-release.lock` — local-checkout concurrent-run guard, present only
  while a process owns the release operation;
- `deployments/conflux/.mainnet-release-command.lock` — local-checkout guard wrapping the clean
  build and complete plan/execute process, so another invocation in this checkout cannot delete or
  replace artifacts while a release is running.

`deployments/` is Git-ignored. Back up the complete `deployments/conflux/` directory, logs, source
commit, build information, ConfluxScan links, and external approval record to controlled immutable
storage. Do not rely on the deployment machine as the sole copy.

If either command exits, loses RPC connectivity, or is restarted, rerun that same npm command with
the same reviewed inputs and authorization. It validates its checkpoint and on-chain state, skips
only completed phases that still match, and resumes at the first safe incomplete phase. A completed
Safe or release rerun is read-only revalidation only while its pinned initial terminal state still
matches. It does not deploy another copy or rewrite/downgrade an archived successful checkpoint.
After normal governance advances the Safe nonce or changes another intentionally governed state,
the initial-release runner is expected to reject current-state revalidation; use the immutable
archived completion report as historical release evidence and the governance status tasks for the
new state.

For Safe creation, an incomplete execution checkpoint must be resumed with its original reviewed
digest and confirmation. Clearing those two fields does not turn an interrupted execution back into
a fresh plan: blank-authorization mode stops and points to the existing checkpoint, so it can never
claim “no transaction was broadcast” after a planned, submitted, or confirmed factory step exists.
The protocol release applies the same rule to an incomplete 14-step checkpoint. For an already
completed checkpoint, blank-authorization mode performs read-only revalidation while the pinned
initial state remains unchanged; it does not emit a new “no broadcast” plan.

Never delete or edit the checkpoint to make a rerun proceed. Never use `deploy:timelock` or
`deploy:net` after a timeout merely because the terminal did not print an address.

## Broadcast-before-checkpoint recovery

A process can fail after an RPC accepted a transaction but before its hash reached the local
checkpoint. Both tools deliberately refuse to guess, replace, or automatically rebroadcast that
phase. First recover the transaction hash using the approved deployer address and reserved nonce
from the RPC and ConfluxScan, and verify its chain, sender, nonce, destination or creation input,
value, calldata, receipt, and resulting contract address.

For the Safe creator's single factory call, set only the independently verified hash:

```dotenv
ESPACE_MAINNET_SAFE_RECOVERY_TX=0xTransactionHash
```

Keep the same reviewed `ESPACE_MAINNET_SAFE_PLAN_DIGEST`, exact Safe confirmation string, owner
order, salt, deployer, and all other Safe inputs, then rerun:

```bash
npm run espace:mainnet:safe
```

This recovery variable is accepted only in execute mode and only when the checkpoint contains a
hashless planned `createGovernanceSafe` entry. The tool verifies the original sender, nonce,
factory target, calldata, proxy address, receipt, runtime, and profile before adopting it. If the
predicted address has code but there is no matching checkpoint and independently verified factory
hash, the creator refuses to adopt that unmanaged deployment. Clear the recovery variable after
the checkpoint records it.

For protocol release, supply independently verified missing hashes as a one-line JSON object whose
keys are the exact transaction labels printed in the failure message:

```dotenv
ESPACE_MAINNET_RECOVERY_TXS={"exact-runner-label":"0xTransactionHash"}
```

Run the same command again. Recovery input does not authorize a new transaction: it only lets the
runner match an already-mined transaction to the expected phase and persist evidence after all
sender, nonce, input, receipt, address, code, and state checks pass. Unknown labels, extra hashes,
failed/replaced transactions, or any mismatch stop the release. Remove the recovery variable after
the checkpoint has adopted the evidence.

If any integrated deployment transaction is known to have succeeded but the expected full
deployment metadata cannot be reconstructed and validated, the runner stops in a manual-recovery
state instead of deploying a second copy. Preserve every artifact and receipt, investigate from a
clean environment, and obtain a new explicit release decision. An orphaned contract is not a
reason to silently mix addresses from different attempts.

If any Safe, release, command-wrapper, or shared lock remains after an abnormal process exit, first
prove that no Safe factory, build, plan, or release process is still running. Preserve the lock and
checkpoint as evidence; do not remove a lock merely to silence a concurrent-run error. Resolve the
recorded phase and transaction state before resuming.

## Completion and handoff

A successful exit is not based only on mined receipts. The final report must show every source
verification passed, every critical transaction covered by the finalized head, every receipt and
block hash still canonical, and every terminal on-chain invariant matched. Archive that report and
independently compare all addresses with ConfluxScan and the governance record. Also archive the
Safe plan/state/report, factory and owner-acceptance receipts, ordered-owner/salt approval, and the
external controllers' acceptance record.

Repository automated tests and this documentation change never execute or broadcast a transaction
on eSpace Mainnet. Transactional test coverage runs only on an in-process local Hardhat chain; pure
safety/recovery tests use fixtures. A chain-1030 Safe factory or release broadcast is possible only
when an operator explicitly runs the corresponding production npm command with that tool's
reviewed digest and exact confirmation value configured.

Apart from read-only validation of the recorded acceptance transaction, repository production
commands do not sign for or operate the Safe. Subsequent configuration, treasury spending, verifier
replacement, upgrades, Safe migration, delay changes, or Timelock migration use the governance
tasks to produce `to/value/data/operation`. Submit those calls using the approved external multisig
workflow, collect the required owner signatures there, wait the Timelock delay, and execute in a
separate reviewed operation. See
[Smart Contracts Reference](contracts.md#upgradeability--governance-uups) for the available tasks
and governance invariants.

## Manual commands

`deploy:timelock`, `deploy:net`, and one-contract `verify:net` remain useful for local/testnet work,
forensic reconstruction, and an explicitly reviewed recovery plan. They are not the recommended
first-release path on eSpace Mainnet because they do not provide the orchestrator's single
checkpoint, digest approval, phase resumption, complete verification, finality coverage, and final
terminal-state report. Do not mix manual and orchestrated deployment in one release state.

Ethereum Mainnet has a separate guarded entry, authorization domain, Etherscan requirement, ETH gas
accounting, and `deployments/mainnet/` checkpoint tree. Neither EVM compatibility nor identical
Solidity artifacts makes an eSpace digest, Safe singleton, confirmation string, report, or recovery
hash valid for Ethereum.
