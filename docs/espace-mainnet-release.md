# Conflux eSpace Mainnet release

`npm run espace:mainnet:release` is the recommended entry point for a first production deployment
to Conflux eSpace Mainnet (`conflux`, chain ID `1030`). It plans, deploys, verifies, waits for
finality, validates the terminal governance state, and records a resumable checkpoint. The same
command is used for the initial plan, execution, and safe resumption. Every invocation first removes
the old Hardhat build output and performs a fresh production-profile compilation, then runs the
orchestrator with compilation disabled so the reviewed evidence comes from that exact build.

Always use the npm command above. Do not invoke `scripts/espace-mainnet-release.mjs` directly with
`hardhat run`: the lower-level entry bypasses the command's mandatory clean production build and is
not an approved production release path.

This is a production release tool, not a mainnet copy of the testnet acceptance suite. It does not
create a multisig, derive or read Safe owner keys, replace governance, perform an upgrade, or submit
person, endorsement, NFT, or story transactions.

## Security model

Before running the tool, deploy and independently approve one canonical Safe v1.3.0 with exactly
three distinct owners and a `2/3` threshold on eSpace Mainnet. The runner requires the pinned
`conflux-safe-1.3.0-2of3` profile and verifies the Safe's chain, runtime, singleton, owners,
threshold, modules, guard, and fallback handler before any release transaction.

The Safe owners remain outside this process. `PRIVATE_KEY` belongs only to the approved release
deployer EOA and pays deployment gas. The runner never accepts, derives, reads, or stores a Safe
owner private key or Safe signature. After release, every administrative action must be proposed
and signed using the external governance multisig, then pass through `GovernanceTimelock` and its
delay.

The reviewed Safe nonce is part of the immutable release plan. Do not submit any Safe transaction
or change its owners, threshold, modules, guard, or fallback handler between planning and release
completion; the runner rechecks that exact state before deployment phases and at handoff.

The release deployer key and nonce must likewise be exclusive to this one release process from
plan approval through completion. Do not use that EOA from another checkout, host, container,
wallet, automation job, or replacement-transaction tool. Repository lock files protect only this
local checkout and cannot coordinate another machine; production operations should also hold the
team's external release lock/change record.

The runner also enforces all of the following for execution:

- Hardhat network `conflux` and raw RPC chain ID `1030`;
- a clean, unchanged release checkout and the production compiler profile;
- `MIN_DELAY >= 86400` seconds;
- the approved deployer, Safe address, and exact three-owner set;
- a required CFX budget ceiling;
- contract source verification, finalized-block coverage, and terminal on-chain checks, with no
  environment switch that can disable them.

## Prerequisites

1. Complete `npm run espace:acceptance` from the same audited release commit on eSpace Testnet and
   archive its successful report.
2. Use a clean, isolated checkout of that commit and the reviewed Node/npm versions. Install exact
   dependencies with `npm ci --ignore-scripts --no-audit --no-fund`, then complete the repository's
   build, test, frontend, ZK artifact, and storage-layout checks. Do not reuse an untrusted global
   compiler or a mutable development `node_modules` directory.
3. Deploy the production Safe on chain `1030`; have the three controllers independently verify its
   address, owners, `2/3` threshold, version, singleton, modules, guard, and fallback handler.
4. Fund only the approved deployer EOA with enough mainnet CFX for the reviewed budget. Do not fund
   the Safe merely to deploy this protocol.
5. Use a reliable `CONFLUX_RPC_URL`. A public fallback exists, but a monitored provider is strongly
   preferred for deployment, verification, receipt recovery, and finality checks.
6. Ensure the release checkout can write `deployments/conflux/`, and arrange an independent archive
   for that ignored local directory immediately after completion.

## Configuration

Copy `.env.example` to the ignored `.env` file and fill the production values. Do not commit
`.env`, a private key, a signature, or an owner keystore.

```dotenv
# Release deployer only; never a Safe owner key supplied for automated signing.
PRIVATE_KEY=0x...
CONFLUX_RPC_URL=https://your-reviewed-espace-mainnet-rpc

GOVERNANCE_MULTISIG=0x...
GOVERNANCE_MULTISIG_PROFILE=conflux-safe-1.3.0-2of3
MIN_DELAY=172800
# Must remain empty for a fresh orchestrated release.
GOVERNANCE_OWNER=

# Independent operator-approved expectations.
ESPACE_MAINNET_EXPECTED_DEPLOYER=0x...
ESPACE_MAINNET_SAFE_OWNERS=0xOwner1,0xOwner2,0xOwner3
ESPACE_MAINNET_MAX_CFX=5
ESPACE_MAINNET_CONFIRMATIONS=2
ESPACE_MAINNET_FINALITY_TIMEOUT=3600

# Leave both empty for the first, read-only plan.
ESPACE_MAINNET_CONFIRM=
ESPACE_MAINNET_PLAN_DIGEST=
```

For a fresh release, leave `GOVERNANCE_OWNER` empty: the orchestrator deploys
`GovernanceTimelock`, validates it, and uses that exact address for the integrated protocol
deployment. Setting or changing `.env` later never changes chain state.

`EXPLORER_API_KEY` may remain empty for ConfluxScan; the Hardhat configuration supplies its
non-secret `espace` placeholder. It is not a wallet credential or an authorization key. Do not use
that placeholder for an Ethereum verification invocation.

`ESPACE_MAINNET_MAX_CFX` is a release ceiling, not a target to spend. Choose it from a reviewed gas
estimate plus a documented margin; do not set it to the deployer's whole balance. The deployer must
hold at least that full ceiling before execution or resumption. Before every individual broadcast,
the runner also requires enough current balance for that transaction's checkpointed worst case.
Final receipts record both `gasUsed` and Conflux `gasCharged`; actual cost uses
`max(gasUsed, ceil(3 × gasLimit / 4)) × effectiveGasPrice`, rather than the Ethereum-only
`gasUsed × effectiveGasPrice` assumption.

## Plan, approve, and execute

First run the command with `ESPACE_MAINNET_CONFIRM` and `ESPACE_MAINNET_PLAN_DIGEST` empty:

```bash
npm run espace:mainnet:release
```

This is the default read-only plan. It must not broadcast a transaction. The command still performs
the same clean production build used by execution. Review the printed chain,
release commit and build inputs, deployer, Safe address and owners, threshold, delay, budget,
expected contracts, verification/finality policy, checkpoint location, and plan digest. A second
operator should also compare the 14 ordered transaction intent hashes with the approved release
record and the chain independently.

Only after that review, copy the exact printed digest into `.env` and set the exact chain
confirmation:

```dotenv
ESPACE_MAINNET_PLAN_DIGEST=0x...
ESPACE_MAINNET_CONFIRM=conflux-mainnet-chain-1030
```

Then run the exact same command (do not replace it with a direct Hardhat/script invocation):

```bash
npm run espace:mainnet:release
```

Execution recomputes the plan. Any source, artifact, configuration, deployer, Safe state, or chain
change that affects the plan invalidates the copied digest and stops before a new
transaction. Never bypass this by copying a new digest without repeating the review.

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

## Checkpoints and reruns

The runner stores no secret material. Its local release state is:

- `deployments/conflux/mainnet-release-plan.json` — the latest read-only plan and digest; it is
  separate from, and can never overwrite, the final execution report;
- `deployments/conflux/mainnet-release-state.json` — atomic checkpoint and immutable release input
  fingerprint;
- `deployments/conflux/mainnet-release-report.json` — final addresses, transactions, verification,
  finality, and terminal-state evidence;
- `deployments/conflux/.mainnet-release.lock` — local-checkout concurrent-run guard, present only
  while a process owns the release operation.
- `deployments/conflux/.mainnet-release-command.lock` — local-checkout guard wrapping the clean
  build and complete plan/execute process, so another invocation in this checkout cannot delete or
  replace artifacts while a release is running.

`deployments/` is Git-ignored. Back up the complete `deployments/conflux/` directory, logs, source
commit, build information, ConfluxScan links, and external approval record to controlled immutable
storage. Do not rely on the deployment machine as the sole copy.

If the command exits, loses RPC connectivity, or is restarted, run the same command again with the
same reviewed release inputs. It validates the checkpoint and on-chain state, skips only completed
phases that still match, and resumes at the first safe incomplete phase. A completed release rerun
is a read-only revalidation; it does not deploy another system or rewrite/downgrade the archived
successful checkpoint and report if a later revalidation fails.

Never delete or edit the checkpoint to make a rerun proceed. Never use `deploy:timelock` or
`deploy:net` after a timeout merely because the terminal did not print an address.

## Broadcast-before-checkpoint recovery

A process can fail after an RPC accepted a transaction but before its hash reached the local
checkpoint. The runner deliberately refuses to guess, replace, or automatically rebroadcast that
phase. First recover the transaction hash using the approved deployer address and nonce from the
RPC and ConfluxScan, and verify its chain, sender, nonce, destination or creation input, value,
calldata, receipt, and resulting contract address.

Supply only independently verified missing hashes as a one-line JSON object whose keys are the
exact transaction labels printed in the failure message:

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

If either lock file remains after an abnormal process exit, first prove that no build, plan, or
release process is still running. Preserve the lock and checkpoint as evidence; do not remove a
lock merely to silence a concurrent-run error. Resolve the recorded phase and transaction state
before resuming.

## Completion and handoff

A successful exit is not based only on mined receipts. The final report must show every source
verification passed, every critical transaction covered by the finalized head, every receipt and
block hash still canonical, and every terminal on-chain invariant matched. Archive that report and
independently compare all addresses with ConfluxScan and the governance record.

Repository automated tests never execute or broadcast a transaction on eSpace Mainnet. Their
transactional coverage runs only on an in-process local Hardhat chain; pure safety/recovery tests
use fixtures. A chain-1030 broadcast is possible only when an operator runs the production npm
command with both the reviewed plan digest and the exact confirmation value configured.

The release command does not operate the Safe after deployment. Subsequent configuration, treasury
spending, verifier replacement, upgrades, Safe migration, delay changes, or Timelock migration use
the governance tasks to produce `to/value/data/operation`. Submit those calls using the approved
external multisig workflow, collect the required owner signatures there, wait the Timelock delay,
and execute in a separate reviewed operation. See
[Smart Contracts Reference](contracts.md#upgradeability--governance-uups) for the available tasks
and governance invariants.

## Manual commands

`deploy:timelock`, `deploy:net`, and one-contract `verify:net` remain useful for local/testnet work,
forensic reconstruction, and an explicitly reviewed recovery plan. They are not the recommended
first-release path on eSpace Mainnet because they do not provide the orchestrator's single
checkpoint, digest approval, phase resumption, complete verification, finality coverage, and final
terminal-state report. Do not mix manual and orchestrated deployment in one release state.
