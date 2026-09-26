# DeepFamily Production ZK Setup

This runbook describes how to replace the checked-in development Groth16 keys with production
artifacts. The production Phase 1 file is committed, so the normal single-developer setup runs
with one command:

```bash
npm run zk:production:setup
```

That command creates production artifacts for all three circuits, writes an auditable transcript and
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
controlled machine and destroy every circuit-specific Phase 2 secret after the command exits. This
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

All three DeepFamily circuits reuse the same published BN254 Phase 1 file:

```text
File:
ppot_0080_16.ptau

Published provenance recorded in the manifest:
https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_16.ptau

Capacity:
2^16 constraints

Bytes:
75,590,802

SHA-256:
ed3622a7c79b0b49aadd134ebbc5b77df8c8c59bccebdfd0d9bf2c1a51561cf9

BLAKE2b-512:
9532c6c04a21335577713724b6d46c266a93aa621b78882b8b64b26f3080a8f0d974aded00c4d781adbdf493a45c51db455108f7aeedb49971569d57a56971c3
```

The 64-level family inheritance claim circuit has 34,247 constraints, so the previous power-15
file (32,768 constraints) is too small.

The exact file is committed at:

```text
circuits/ptau/ppot_0080_16.ptau
```

The [PSE Perpetual Powers of Tau repository](https://github.com/privacy-ethereum/perpetualpowersoftau)
links the published object above. The retrieval location needs no trust; the pinned digests decide
whether the bytes are accepted.

The setup and verification commands never download or replace the file. They reject symbolic
links, an unexpected byte length, or either hash mismatch; the file is rehashed before use. The
published URL above identifies the reviewed source bytes in ceremony evidence and is not accessed
by these commands.

`ZK_PTAU_PATH` selects a different copy, for example one obtained independently, for setup,
verification, and release commands. When it is empty, they use the committed file above. An
override must still be an ordinary file whose byte length, SHA-256, and BLAKE2b-512 match the
production manifest:

```bash
ZK_PTAU_PATH=/absolute/path/to/an-independent-copy \
npm run release:preflight
```

`npm run zk:development:setup` uses the same committed Phase 1 file. Its Phase 2 contribution
passes a fixed label as entropy, and snarkjs mixes 64 bytes of system randomness into it, so the
secret is still random. The flow nevertheless runs on arbitrary machines, pins no toolchain, and
records no ceremony evidence, so it does not establish a production trust model. The resulting
manifest records `development` status. `npm run zk:production:setup` instead runs once from a
clean commit with a pinned toolchain and records the transcript described above.

## Circom host and release compiler

`npm run zk:fetch` installs two separate copies of repository-pinned Circom 2.2.3:

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

Circom 2.2.3 does not publish an official macOS arm64 binary, so the Apple Silicon target is built
from the repository-pinned source commit with locked Cargo dependencies.

Official assets must match their fixed SHA-256. Source builds must come from the pinned commit and
report exactly Circom 2.2.3. Every circuit compilation passes `--O2 --sanity_check 2` explicitly,
pinning both the optimization and sanity-check levels. The artifact gate compares rebuilt R1CS and
WASM output hashes with the reviewed manifest and published files. A native compiler is therefore
suitable for development only until its output has passed those comparisons; matching the version
string alone is not release evidence.

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
private release stage. Before any Groth16 Setup or Phase 2 contribution, production setup compiles every
circuit and verifies every staged R1CS/WASM hash against the reviewed manifest. The canonical
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
- concurrent production pTau verification or setup execution;
- overwriting an existing production manifest unless the explicit, hash-bound rotation mode below
  is used.

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

### Rotate after a reviewed snarkjs runtime change

Do not delete or downgrade a valid production manifest just because the committed dependency graph
changed. First review and commit the dependency change, install exactly that clean commit, and
record both inputs printed by these read-only commands:

```bash
node --input-type=module -e "import { readCanonicalJsonFile, sha256Text } from './scripts/lib/zkArtifactTrust.mjs'; const { raw } = readCanonicalJsonFile('circuits/zk-artifacts-manifest.json'); console.log(sha256Text(raw));"
node --input-type=module -e "import { inspectSnarkjsRuntime } from './scripts/lib/snarkjsToolchain.mjs'; console.log(inspectSnarkjsRuntime().sha256);"
```

After independently reviewing those exact digests, rotate with a new ceremony ID:

```bash
npm run zk:production:setup -- \
  --rotate \
  --expected-current-manifest-sha256 <current-production-manifest-sha256> \
  --expected-snarkjs-runtime-sha256 <reviewed-new-runtime-sha256> \
  --ceremony-id <new-stable-audit-id>
```

The two expected digests are mandatory with `--rotate` and are rejected without it. Rotation only
accepts an existing schema-v3 `production` manifest using the one-contributor `single-operator`
trust model. It rejects a development or multi-party baseline, a reused ceremony ID, and a runtime
digest equal to the current manifest. Before generating entropy it verifies the old canonical
manifest digest, transcript, source, WASM, zkeys, verification keys, Solidity verifiers, compiler,
snarkjs version/CLI, and pinned pTau identity. It then recompiles every circuit and requires the
source/R1CS/WASM hashes to remain unchanged, snapshots the explicitly reviewed new runtime, and
runs every Phase 2 setup, contribution, and finalization from scratch. The staged and rollback
rules are identical to the initial setup.

Fresh Phase 2 randomness changes every zkey, verification key, and generated verifier contract.
Treat the result as a new cryptographic release: review and commit the complete bundle together,
then redeploy the verifiers and update any governed references through the normal release process.
The circuit WASM and R1CS are expected to stay unchanged for this runtime-only rotation.

Internally the command:

1. validates the clean release commit and development manifest, or the explicitly hash-bound
   production baseline in rotation mode;
2. reads the pinned public power-16 pTau and checks both pinned digests;
3. validates and snapshots an official compiler, or fresh-builds a source target, then copies the
   pTau into the current user's private OS temporary directory and compiles every circuit there
   with explicit `--O2 --sanity_check 2`;
4. verifies all staged R1CS/WASM hashes against the reviewed manifest, then—and only then—creates
   any initial Groth16 zkey; each circuit and the pTau are checked again immediately before its
   setup;
5. hashes the logical installed snarkjs production dependency graph—each package's content,
   identity, version, and logical dependency path—and compares it with the schema-v3 manifest or
   the explicit reviewed rotation digest; it copies only that verified runtime into private
   staging, makes package files read-only on POSIX, and executes snarkjs from the snapshot;
6. before reading any secret, re-hashes that private runtime snapshot, strips inherited release
   injection variables from the helper environment, and supplies a separate 64-byte OS CSPRNG input
   for each circuit through a private stdin pipe, never through command arguments, environment
   variables, or files;
7. embeds one `deepfamily-single-operator` contribution in each zkey;
8. only after every contribution, generates a separate 32-byte local CSPRNG finalization value and
   applies it to every zkey;
9. exports every verification key and Solidity verifier and stages the browser WASM/zkey assets;
10. reads the real contribution metadata embedded in every final zkey;
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
node:crypto.randomBytes(32), generated after every Phase 2 contribution
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
- the source, R1CS, WASM, zkey, vkey, and Solidity verifier hashes for every circuit;
- the transcript and local finalization hashes.

The schema-v3 transcript records:

- the release ceremony ID;
- the same `single-operator` trust model;
- the actual native compiler version, target, platform, architecture, strategy, binary hash, and
  Linux libc detection evidence (or `null` on macOS/Windows);
- for source targets, the pinned repository/commit and the Cargo/Rust versions from the fresh
  private build;
- every source and R1CS hash;
- the one operator contribution name;
- one embedded BLAKE2b-512 contribution hash per circuit;
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
  contracts/DisclosureBindingVerifier.sol \
  contracts/FamilyInheritanceClaimVerifier.sol

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
  contracts/FamilyInheritanceClaimVerifier.sol \
  frontend/public/zk

git commit -m "chore: install production zk artifacts"
```

The ignored `zk-artifacts/circuits/` build outputs must also be copied into the controlled release
archive. A clean Git status alone does not archive ignored files.

From a clean checkout of the new commit, restore the exact dependencies, then rebuild and run the
complete gate:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run zk:fetch
npm run release:preflight
```

`release:preflight` runs on every release-gate runtime in the support matrix and requires a
schema-v3 manifest. It validates the official native compiler identity or performs a fresh,
environment-isolated private build for a source target, validates the canonical reference digest,
checks the clean commit before and after the build, verifies that the R1CS and WASM produced with
explicit `--O2 --sanity_check 2` match the reviewed artifact hashes, runs the ceremony's snarkjs
verification from a private runtime snapshot, verifies every real proof and all published hashes,
validates the single-operator transcript against the real zkey metadata, and runs the complete
contract, frontend, localization, XSS, storage, and dependency checks.

## Testnet and Mainnet sequence

After the ZK artifacts are frozen, follow the target-chain runbook in this order:

1. bootstrap and validate the production governance Safe, then reserve the deployer EOA;
2. query its exact next pending protocol-release nonce and use the chain-specific
   `*:mainnet:release:projection` command to freeze the resulting deployments object into the
   production protocol manifest;
3. commit that chain-specific state and run `release:preflight` from the clean final commit;
4. run the target testnet acceptance command in `release-rehearsal` mode with
   `MIN_DELAY >= 86400` from that same commit;
5. accept only a schema-v5 fresh-release report with `status=passed`, `releaseReady=true`,
   `evidenceType=initial-mainnet-release`, `governanceLifecycleIncluded=false`,
   `zkArtifactTrust.productionReady=true`, and `zkCeremonyVerification.status=passed`;
6. archive that exact report with the release commit and ZK evidence;
7. generate the read-only Mainnet release plan, whose derived same-chain deployment projection must
   exactly equal the manifest;
8. obtain the required Safe-owner approvals over the exact plan;
9. execute only the unchanged reviewed plan.

If the deployer nonce or any tracked release input changes, regenerate and recommit the projection,
then repeat preflight and the rehearsal. Testnet addresses/runtime hashes are verified against the
testnet deployment itself; they are not compared to the final Mainnet addresses/runtime hashes.

The release rehearsal deploys that Timelock delay but schedules no Timelock operation, so it has
zero Timelock waits. Diagnostic mode uses the built-in 30-second delay for each of four governance
windows; diagnostic output is never release evidence. A fresh Mainnet release also has zero
Timelock waits. Its configured 48-hour delay governs later changes.

The Safe remains a separate 2/3 governance control. The testnet/Mainnet release tools validate the
recorded ZK trust model but do not reinterpret one ZK contributor as one governance signer.

## Optional multi-party enhancement

When independent contributors are available, DeepFamily may perform a traditional sequential
multi-party Phase 2 ceremony instead of the default command:

```text
initial zkeys
  -> participant A contributes independently to every circuit
  -> participant B contributes independently to every circuit
  -> optional further participants
  -> pre-announced public finalization beacon
  -> final production zkeys
```

Each participant should verify the incoming R1CS, pTau, zkeys, and transcript; use separate fresh
entropy for each circuit; return all outputs together; sign the exact public contribution
record; and destroy their secret environment. The existing signed multi-party transcript format
remains supported.

This is an optional strengthening, not a current release prerequisite and not tied to the Safe
owner count. If a multi-party setup is selected, use a separately reviewed coordinator procedure
and do not claim completion merely by generating several keys on one operator's machine.

## Restart conditions

Generate a new production setup before release when:

- any circuit source or R1CS changes;
- public-signal or packing semantics change;
- the selected pTau or its hash is uncertain;
- the operator believes Phase 2 secrets may have been retained or exposed;
- a zkey, transcript, verifier, or artifact hash cannot be reproduced;
- any pTau, zkey, proof, or artifact verification fails.

Never repair a transcript by manually changing hashes or contribution order. Fix the cause and
regenerate the complete artifact set.
