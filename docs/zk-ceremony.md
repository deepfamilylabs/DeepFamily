# ZK artifacts and production setup

The current protocol has 14 Circom relations. Its keys are development-only, and no reviewed
production ceremony is available for this complete graph. `npm run zk:setup`, ceremony
verification and protocol release preflight currently fail closed. Local development generation
does not approve keys for a public deployment.

## Current relation graph

| Group | Count | Relations |
| --- | ---: | --- |
| Identity and disclosure | 2 | PersonRelation, DisclosureBinding |
| Asset boundaries | 3 | Shield, Unshield, four-input Unshield |
| Eligibility and receiving | 9 | SourceFact, SourceTrust, RevocationScan, Issue, Code, Capability, Deposit, Claim, Transfer |

The data-only [circuit catalogue](../scripts/lib/protocolCircuitCatalog.mjs) and
[canonical selection](../scripts/lib/zkCircuitSelection.mjs) define the graph consumed by builds,
deployment, asset export and release gates. The reviewed production ceremony must cover all
14 relations together, including `eligibility_revocation_scan` and its nine public signals.
See [proof relations and public signals](zk-proofs.md#receiving-and-budget-circuits).

## Local development workflow

```sh
npm run zk:fetch
npm run zk:ptau:fetch
npm run zk:build
npm run zk:dev:check
npm run test:circuits
npm run test:proof
npm run test:evm
```

`zk:build` compiles the current relations without replacing keys. `zk:dev:check` authenticates
source and artifact pins for the complete bundle. Missing or mismatched proving files can be
restored with `zk:assets:fetch` after the exact pinned files have been published.

Explicit `npm run zk:dev` compiles all 14 relations, verifies and reuses the existing matching
identity/disclosure keys, and regenerates the nine receiving plus three boundary development key
sets. It updates their development manifests, vkeys and generated Solidity verifiers. A focused
command such as `npm run zk:dev -- --circuit protocol:revocationScan` regenerates only that
selected development set; its final check still requires the complete bundle. `--ptau <path>`
selects an explicit local Phase 1 file for development generation.

After key rotation, redeploy local contracts and synchronize trusted frontend pins for that
registry with `npm run zk:frontend -- <chainId> <registry>`. The export includes the three boundary
aliases under `/zk/protocol/`. The development export accepts only local chain IDs. Codes cannot
select their own verifier, key or artifact host.

## Artifact records

| Record | Purpose |
| --- | --- |
| `circuits/zk-artifacts-manifest.json` | Identity/disclosure source and artifact pins |
| `circuits/shielded-development-manifest.json` | Three development boundary key sets |
| `circuits/receive-development-manifest.json` | Nine development receiving/eligibility key sets |
| `protocol-release-manifest.json` | Protocol interfaces, pending deployment bindings and release evidence |
| `frontend/src/proof-artifacts.local.json` | Exported, trusted chain/registry-bound frontend pins |

R1CS and witness WASM are compiled with the pinned Circom toolchain and explicit
`--O2 --sanity_check 2` flags. Generated verifier contracts, vkeys, WASM and zkeys must belong to
the same manifest-pinned set. Browser vkey JSON remains local; remote WASM/zkey delivery uses
content-hash paths and validates decoded bytes. See [development and release](zk-proofs.md#development-and-release).

## Fixed Powers of Tau

The repository pins this BN254 Phase 1 input:

```text
Path: circuits/ptau/ppot_0080_17.ptau
Power: 17
Bytes: 151,088,274
SHA-256: f807e065fde53f72f4bf4d57140fab85b26daa6cc95bdfec7cce93622b3a367c
BLAKE2b-512: 3010cec42bdd1583bb4477dfa1b11853a67e8611feaa39cd7b3311a353b3e1d8b3f318509d75208078dc6887500b61f3f46bc72c61abbb624bec3bad5ef16012
```

The pinned values and provenance are defined in
[`productionPtau.mjs`](../scripts/lib/productionPtau.mjs). A matching Phase 1 file does not supply
reviewed circuit-specific Phase 2 keys or complete production approval.

## Production status

[`protocolProductionArtifacts.mjs`](../scripts/lib/protocolProductionArtifacts.mjs) explicitly
rejects production setup and release for the current graph. `zk:setup -- --help` explains that
status; the command does not currently generate production transcripts or final keys. Editing a
development manifest's status cannot satisfy this gate.

Production work must provide a reviewed ceremony and verifier/evidence workflow for the same
14 relations, then satisfy the existing clean-build, proof, deployment, capacity and release
evidence checks. Its trust model and contributor evidence must be explicit. Governance Safe
owners and ZK ceremony contributors perform separate roles; the Safe threshold does not supply
trusted-setup evidence.

The two Mainnet runbooks describe later deployment prerequisites, not permission to bypass this
blocked ceremony: [Conflux eSpace](espace-mainnet-release.md#prerequisites) and
[Ethereum](ethereum-mainnet-release.md#prerequisites).

## Historical material

Earlier revisions described issuer/presentation linking and a different ceremony graph. Those
instructions do not apply to the current protocol. For historical analysis, read the earlier
revision explicitly, for example `git show 69dc2571:docs/zk-ceremony.md`. Current operational
commands and requirements are the ones above.
