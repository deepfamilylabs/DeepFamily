# DeepFamily Production ZK Setup

This runbook describes how to replace the checked-in development Groth16 keys with production
artifacts. The normal DeepFamily path is intentionally a single command for the current
single-developer project:

```bash
npm run zk:production:setup
```

That command creates production artifacts for both circuits, writes an auditable transcript and
manifest, and verifies the complete result before returning. It does **not** commit files, deploy a
contract, submit a transaction, or authorize a Mainnet release.

## Trust model

Groth16 needs a circuit-specific Phase 2 setup. Anyone who retains all Phase 2 secrets could forge
proofs accepted by the matching verifier. DeepFamily therefore records the production trust model
explicitly:

```text
trustModel = single-operator
minimumContributors = 1
contributorCount = 1
```

For this model, production security trusts the operator who runs the setup command to use a
controlled machine and destroy both circuit-specific Phase 2 secrets after the command exits. This
is a deliberate and visible trust assumption, not a claim that the proving keys are trustless.

One contribution is sufficient for Groth16. Three contributors are **not** a cryptographic
requirement. A multi-party ceremony remains a useful optional enhancement when independent
contributors become available: its benefit is that the final parameters remain safe if at least one
participant destroys their secret.

ZK contributors and governance signers are separate concepts:

- the ZK setup creates proving and verification material;
- the production Safe uses three owners with a 2/3 threshold to govern contracts;
- a ZK contributor does not become a Safe owner;
- the Safe 2/3 policy does not require three ZK contributors.

## Fixed Powers of Tau

Both DeepFamily circuits reuse the same published BN254 Phase 1 file:

```text
File:
powersOfTau28_hez_final_13.ptau

Source:
https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_13.ptau

Capacity:
2^13 constraints

Bytes:
9,520,280

SHA-256:
95751b5207f20aa822f01109902315c01c15250303feacea2b8aa7dc9fdfeefd

BLAKE2b-512:
58efc8bf2834d04768a3d7ffcd8e1e23d461561729beaac4e3e7a47829a1c9066d5320241e124a1a8e8aa6c75be0ba66f65bc8239a0542ed38e11276f6fdb4d9
```

The setup command downloads this file only when the verified cache is absent. It stores the file at:

```text
tmp/zk-production/powersOfTau28_hez_final_13.ptau
```

The downloader rejects redirects, symbolic links, an unexpected byte length, or either hash
mismatch. An existing cache is rehashed before use. A suspicious existing file is not silently
replaced.

To populate or validate the cache without generating keys:

```bash
npm run zk:ptau:fetch
```

`ZK_PTAU_PATH` is optional for later verification and release commands. When it is empty,
`zk:ceremony:verify` and `release:preflight` use the pinned cache above. An explicit override must
still be an ordinary file whose byte length, SHA-256, and BLAKE2b-512 all match the production
manifest:

```bash
ZK_PTAU_PATH=/absolute/path/to/the-same-reviewed-file \
npm run release:preflight
```

Development and production intentionally reuse this exact fixed-digest public Phase 1 file. The
development refresh obtains or validates the same cache, so the repository no longer needs a
separate locally generated development pTau.

This shared Phase 1 does **not** make development zkeys production-safe. `npm run zk:dev:refresh`
uses a single-operator Phase 2 flow with hard-coded public entropy and records a `development`
manifest. That supplies no independent secret contribution, and the operator may retain the
circuit-specific toxic waste. `npm run zk:production:setup` instead creates fresh OS-CSPRNG Phase 2
inputs and records the explicit production trust model described above.

## Circom host and release compiler

`npm run zk:fetch` installs two separate copies of the same repository-pinned Circom version:

- a reusable native compiler at `bin/circom` (`bin/circom.exe` on Windows) for development and
  diagnostic builds;
- the canonical official Linux amd64 compiler at
  `bin/circom-release-linux-amd64` as the fixed-digest audit reference.

The compiler support matrix is:

| Host/runtime         | Installation strategy          | Prerequisites                               | May run release gates |
| -------------------- | ------------------------------ | ------------------------------------------- | --------------------- |
| Linux x64 with glibc | Pinned official release asset  | None                                        | Yes                   |
| macOS arm64          | Build the pinned source commit | `git`, Rust/Cargo, Xcode Command Line Tools | Yes                   |
| Windows x64          | Pinned official release asset  | Visual C++ 2015–2022 Redistributable        | Yes                   |

Official assets must match their fixed SHA-256. Source builds must come from the pinned commit and
report the exact pinned compiler version. Every circuit compilation passes `--O2` explicitly, and
the artifact gate compares rebuilt R1CS and WASM output hashes with the reviewed manifest and
published files. A native compiler is therefore suitable for development only until its output has
passed those comparisons; matching the version string alone is not release evidence.

Both `zk:production:setup` and `release:preflight` support the three release-gate runtimes above.
Linux libc is detected from Node's process report: Linux x64 with glibc uses the pinned official
asset, while musl is rejected explicitly. Windows ARM64 hosts remain unsupported even with x64 Node
emulation. The macOS arm64 release gates never execute the reusable
source-built compiler from `bin/`: they perform a fresh locked build of the pinned commit in the
current user's protected build directory and bind its binary hash, source commit, Cargo, and Rust
versions into the evidence. The source builder rejects external ancestor Cargo configuration,
removes inherited Git, Cargo, Rust, Node, dynamic-loader, npm, compiler, linker, and
package-discovery overrides. It resolves Git/Cargo/Rustc to protected absolute executables and uses
a controlled PATH, private home/Cargo/XDG/temporary directories, empty Git system/global
configuration files, and an empty hooks directory. The resulting compiler is copied into the
private release stage. Before any Groth16 Setup or Phase 2 contribution, production setup compiles both
circuits and verifies every staged R1CS/WASM hash against the reviewed manifest. The canonical
Linux amd64 glibc binary remains a fixed-digest reference; other runtimes hash it but never execute
it. The schema-v3 ceremony transcript records which native compiler and Linux libc evidence
actually produced the staged circuits.

Production setup reads the contribution helper and its local dependency from the exact
release-commit Git blobs. It verifies their Git object IDs while staging and their SHA-256 digests
both before creating Phase 2 entropy and immediately before passing that entropy to the helper
process.

Every release-only temporary root is hardened before use. On POSIX it must be a real directory
owned by the current user with mode `0700`. On Windows the command disables ACL inheritance,
removes existing access rules, sets the current user SID as owner and sole full-control principal,
then re-reads and validates that ACL. Failure removes the temporary root and aborts the operation.

On Windows x64, invoke these entry points through `npm run` so child npm commands use the real npm
JavaScript CLI. The complete preflight test suite must run in an environment permitted to create
symbolic links (for example, Windows Developer Mode). CI uses GitHub's `ubuntu-latest` x64/glibc
runner and also exercises macOS arm64 and Windows x64. Repository
`.gitattributes` keeps hashed circuit and source text on canonical LF line endings across operating
systems. The strict manifest/transcript reader also accepts an older checkout containing uniform
CRLF and normalizes it to LF before calculating evidence hashes; mixed line endings remain invalid.

The current artifact manifest is schema v3 and includes the reviewed snarkjs runtime-graph digest.
Schema-v2 manifests are accepted only by legacy compatibility inspection and ceremony verification;
they cannot start `zk:production:setup` or pass `release:preflight`.

## Before running the command

Run the setup only after the circuit source, public signals, packing rules, dependencies, and
verifier interface have been frozen for a release candidate. Any later circuit change requires new
production keys. The controlled checkout may use any host listed in the support matrix.

Use a clean, controlled checkout:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run zk:fetch
git status --short
git rev-parse HEAD
```

`git status --short` must have no output. The setup command refuses:

- a dirty working tree;
- CI execution;
- a symbolic-link repository or artifact path;
- a missing or unexpected pinned toolchain;
- concurrent pTau download or setup execution;
- overwriting an existing production manifest.

The operator should use a machine they control, stop unrelated backup/snapshot tools during the
run, and avoid terminal recording. No Safe owner private key, funded wallet, CFX, or ETH is needed.

## Run the production setup

The default command creates an audit ID automatically:

```bash
npm run zk:production:setup
```

An optional stable audit ID may be supplied:

```bash
npm run zk:production:setup -- \
  --ceremony-id deepfamily-production-2026-001
```

Internally the command:

1. validates the clean release commit and development manifest;
2. downloads or reuses the pinned public power-13 pTau and checks both pinned digests;
3. validates and snapshots an official compiler, or fresh-builds a source target, then copies the
   pTau into the current user's private OS temporary directory and compiles both circuits there
   with explicit `--O2`;
4. verifies all staged R1CS/WASM hashes against the reviewed manifest, then—and only then—creates
   either initial Groth16 zkey; each circuit and the pTau are checked again immediately before its
   setup;
5. hashes the logical installed snarkjs production dependency graph—each package's content,
   identity, version, and logical dependency path—and compares it with the schema-v3 manifest; it
   copies only that verified runtime into private staging, makes package files read-only on POSIX,
   and executes snarkjs from the snapshot;
6. before reading either secret, re-hashes that private runtime snapshot, strips inherited release
   injection variables from the helper environment, and supplies a separate 64-byte OS CSPRNG input
   for each circuit through a private stdin pipe, never through command arguments, environment
   variables, or files;
7. embeds one `deepfamily-single-operator` contribution in each zkey;
8. only after both contributions, generates a separate 32-byte local CSPRNG finalization value and
   applies it to both zkeys;
9. exports both verification keys and Solidity verifiers and stages the browser WASM/zkey assets;
10. reads the real contribution metadata embedded in both final zkeys;
11. creates `circuits/zk-ceremony-transcript.json` and updates
    `circuits/zk-artifacts-manifest.json`;
12. rechecks the reviewed R1CS/WASM and pTau bytes, then validates the staged schema, pTau
    mathematics, zkey mathematics, contribution order, finalization metadata, and real proofs
    before any release file is replaced;
13. installs every non-manifest artifact, reruns real proofs and the production contract build, and
    only then installs the manifest as the atomic release commit marker;
14. rechecks installed artifact hashes and zkey-derived outputs, restoring the previous artifact
    set if final validation fails.

The local finalization value is accurately recorded as:

```text
node:crypto.randomBytes(32), generated after both Phase 2 contributions
```

It closes and identifies the final transcript. It is **not** described as an independent public
randomness event and does not remove the single-operator trust assumption.

The secret Phase 2 inputs are not placed in shell history, process arguments, environment
variables, the transcript, or normal command output. The operator must still protect the machine
during execution and destroy VM snapshots, swap copies, backups, or other recoverable state that
could contain those secrets.

## Generated evidence

The production manifest records:

- `status: production`;
- `trustModel: single-operator`;
- the explicit single-operator warning;
- the fixed pTau source, byte length, SHA-256, BLAKE2b-512, and verification status;
- schema v3, the canonical Circom reference, the exact snarkjs CLI hash, and the deterministic
  logical dependency-graph hash of the installed snarkjs production runtime;
- the source, R1CS, WASM, zkey, vkey, and Solidity verifier hashes for both circuits;
- the transcript and local finalization hashes.

The schema-v3 transcript records:

- the release ceremony ID;
- the same `single-operator` trust model;
- the actual native compiler version, target, platform, architecture, strategy, binary hash, and
  Linux libc detection evidence (or `null` on macOS/Windows);
- for source targets, the pinned repository/commit and the Cargo/Rust versions from the fresh
  private build;
- both source and R1CS hashes;
- the one operator contribution name;
- the two embedded BLAKE2b-512 contribution hashes;
- the finalization value, exponent, source, and embedded finalization contribution hashes.

`platform` and `architecture` describe the Node/compiler execution runtime, not a hardware
attestation.

The single-operator transcript intentionally has no generated EVM identity signature. An ephemeral
self-generated wallet signature would not prove independent participation or improve the trust
model.

## Review and commit

Success leaves the generated release files uncommitted so that they can be reviewed. Do not run
`release:preflight` yet: it requires a clean commit.

First inspect the result:

```bash
git status --short
git diff --stat
git diff -- \
  circuits/zk-artifacts-manifest.json \
  circuits/zk-ceremony-transcript.json \
  contracts/PersonCommitmentVerifier.sol \
  contracts/DisclosureBindingVerifier.sol

npm run zk:ceremony:verify
npm run zk:artifacts:check
npm run zk:check
```

Review the large binary assets by comparing their hashes with the manifest rather than attempting
to render their bytes. Commit the manifest, transcript, verifiers, and frontend proving artifacts
together:

```bash
git add \
  circuits/zk-artifacts-manifest.json \
  circuits/zk-ceremony-transcript.json \
  contracts/PersonCommitmentVerifier.sol \
  contracts/DisclosureBindingVerifier.sol \
  frontend/public/zk

git commit -m "chore: install production zk artifacts"
```

The ignored `zk-artifacts/circuits/` build outputs and pinned pTau cache must also be copied into
the controlled release archive. A clean Git status alone does not archive ignored files.

From a clean checkout of the new commit, restore the exact dependencies and pTau cache, rebuild, and
run the complete gate:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run zk:fetch
npm run zk:ptau:fetch
npm run release:preflight
```

`release:preflight` runs on every release-gate runtime in the support matrix and requires a
schema-v3 manifest. It validates the official native compiler identity or performs a fresh,
environment-isolated private build for a source target, validates the canonical reference digest,
checks the clean commit before and after the build, verifies that the explicit-`--O2` R1CS and WASM
output hashes match the reviewed artifacts, runs the ceremony's snarkjs verification from a private
runtime snapshot, verifies both real proofs and all published hashes, validates the single-operator
transcript against the real zkey metadata, and runs the complete contract, frontend, localization,
XSS, storage, and dependency checks.

## Testnet and Mainnet sequence

Only after `release:preflight` passes:

1. run the target testnet acceptance command in `release-rehearsal` mode with the real production
   Timelock delay;
2. accept only a report with `status=passed`, `releaseReady=true`,
   `zkArtifactTrust.productionReady=true`, and `zkCeremonyVerification.status=passed`;
3. archive that exact report with the release commit and ZK evidence;
4. prepare and validate the production governance Safe;
5. generate the read-only Mainnet release plan;
6. obtain the required Safe-owner approvals over the exact plan;
7. execute only the unchanged reviewed plan.

The Safe remains a separate 2/3 governance control. The testnet/Mainnet release tools validate the
recorded ZK trust model but do not reinterpret one ZK contributor as one governance signer.

## Optional multi-party enhancement

When independent contributors are available, DeepFamily may perform a traditional sequential
multi-party Phase 2 ceremony instead of the default command:

```text
initial zkeys
  -> participant A contributes independently to both circuits
  -> participant B contributes independently to both circuits
  -> optional further participants
  -> pre-announced public finalization beacon
  -> final production zkeys
```

Each participant should verify the incoming R1CS, pTau, zkeys, and transcript; use separate fresh
entropy for the two circuits; return both outputs together; sign the exact public contribution
record; and destroy their secret environment. The existing signed multi-party transcript format
remains supported.

This is an optional strengthening, not a current release prerequisite and not tied to the Safe
owner count. If a multi-party setup is selected, use a separately reviewed coordinator procedure
and do not claim completion merely by generating several keys on one operator's machine.

## Restart conditions

Generate a new production setup before release when:

- either circuit source or R1CS changes;
- public-signal or packing semantics change;
- the selected pTau or its hash is uncertain;
- the operator believes Phase 2 secrets may have been retained or exposed;
- a zkey, transcript, verifier, or artifact hash cannot be reproduced;
- any pTau, zkey, proof, or artifact verification fails.

Never repair a transcript by manually changing hashes or contribution order. Fix the cause and
regenerate the complete artifact set.
