# Contract security checks

The existing `npm run zk:check` validates the shielded business public-signal schema before
checking circuit artifacts and proofs. Its shielded selections run the same schema check;
identity-only selections retain their existing scope. No additional npm command is required.

`packages/protocol-core/shielded-signal-layout.js` defines ordered field segments, their applicable
actions, widths and eight business circuit variants. Protocol-core derives each action's fields
from these segments. The internal
`scripts/generate-shielded-signal-layout.mjs` generator produces the marked Solidity regions
in `ProofConstants` and `ShieldedPoolCore`. The pool builds shared segments once and appends
action-specific segments conditionally. The generator's `--check` mode rejects stale generated code
and disagreements with the Circom declarations and fixed verifier ABI. Public-input membership
comes from `main { public [...] }`; signal order is checked against the template's input declarations.
After changing the schema, regenerate those regions with the script, then use the existing ZK checks
and real-proof tests. This generation does not replace circuit compilation or trusted-setup artifact
verification.

## Asset-pool operation sequences

`npm test` includes `test/contract-shielded-stateful.test.mjs`. The Solidity security workflow
also runs this file independently, without downloading proving artifacts.

Each sequence exercises all five pool actions, followed by pseudorandom actions against
native and ERC-20 pools. An independent note ledger and Merkle-tree reconstruction check
asset conservation, liabilities, recipient payments, roots, commitments, nullifiers and
events. Invalid proofs, repeated spends, duplicate nullifiers, unknown roots, rejected native
payments and fee-taking token transfers must leave the touched state unchanged.

These are contract-boundary tests using the existing exact-public-input mock verifier.
The model constructs conserving transitions, but the mock does not authenticate private
ownership, note openings or circuit constraints. Existing circuit and real-proof integration
tests continue to cover those properties.

The default seeds are `0x5eed1234` and `0xc0ffee`, with 32 random steps per seed and asset,
in addition to the initial five-action sequence. Failures identify their seed and step.
`SHIELDED_STATEFUL_SEEDS` accepts 1–8 distinct nonzero uint32 seeds, separated by commas;
`SHIELDED_STATEFUL_STEPS` accepts 16–256 steps. The existing Hardhat test command can select
this file when reproducing a failure.

## Solidity static analysis

`.github/workflows/solidity-security.yml` installs the pinned analyzer environment from
`security/slither-requirements.txt`, forces a production Solidity build and runs the internal
`scripts/check-solidity-security.mjs` script. Its Python driver explicitly loads the Hardhat
compilation, including the project's `.mjs` configuration. It analyzes current inputs selected
by the production artifacts, rather than every historical build-info file. Missing artifacts,
stale source contents, zero analysis, incomplete production-source coverage and analyzer
failures reject the check.

The driver fixes the Python hash seed and sorts Slither's cached Solidity-call query by source
position before detection. This preserves every queried operation and all detector rules while
making the selected `incorrect-return` path reproducible. The report records this policy, and
the gate rejects reports from a different analysis configuration.

For a local run, install the requirements in a Python 3.14.4 environment, run the existing
`npm run build -- --force`, then invoke the script with that environment's Python executable
in `SOLIDITY_SECURITY_PYTHON` (the default is `python3`).

The full report is written to `artifacts/security/slither.json`. Dependency and test-contract
findings are filtered from the report; production contracts retain all detector categories.
Unreviewed High and Medium findings fail the check. Lower-severity findings remain visible
in the report. Any reviewed High/Medium exception must identify one exact finding and explain
its code-specific rationale in `security/slither-baseline.json`. Reviews are bound to SHA-256
snapshots of their related source files; changed sources and obsolete exceptions fail the check.

The initial reviewed baseline contains 76 High/Medium findings:

| Detector | Count | Review basis |
| --- | ---: | --- |
| `incorrect-return` | 47 | Generated verifiers intentionally return ABI `false`; public Poseidon library returns exit their own call frame. |
| `arbitrary-send-eth` | 1 | Withdrawals prove the recipient and amount, consume state before payment and use the shared reentrancy guard. |
| `uninitialized-local` | 18 | Default-zero values are intentional, or arrays/locals are assigned before use. |
| `divide-before-multiply` | 4 | Calendar conversion requires integer quotients and remainder subtraction. |
| `incorrect-equality` | 2 | Dictionary absence and unchanged-root rejection require exact equality. |
| `unused-return` | 3 | Calls intentionally check existence or perform storage side effects; the reader's tuple results are assigned. |
| `write-after-write` | 1 | Calendar conversion deliberately reuses a local intermediate after deriving the day. |

Each exception remains attached to its exact finding and related sources in the baseline;
these explanations do not suppress a detector for future code.
