# DeepFamily Production ZK Ceremony

This runbook is the required process for replacing the development Groth16 proving keys with
production artifacts. It is intentionally separate from the development setup commands.

The repository currently marks its proving keys as `development`. Neither an eSpace/Ethereum
`release-rehearsal` nor a Mainnet release plan is allowed while that marker remains.

## Security objective

Groth16 requires circuit-specific Phase 2 setup material. A malicious party that retains all setup
secrets can forge proofs accepted by the verifier. The ceremony is safe if at least one independent
participant:

1. generates fresh entropy on a trusted machine;
2. contributes separately to both DeepFamily circuits;
3. does not reveal or reuse that entropy; and
4. securely destroys the entropy and temporary machine state.

The final public beacon makes the end of the transcript deterministic and difficult to bias, but it
does not replace an honest contributor.

DeepFamily requires at least three independent contributors. Five are recommended, including at
least one participant outside the core development team.

## Roles

Use different people or control domains for these roles:

- **Coordinator** — freezes the release commit, prepares the initial files, verifies each handoff,
  and publishes the transcript. The coordinator must not know contributor entropy.
- **Contributors** — each runs `snarkjs zkey contribute` on an independently controlled machine.
- **Independent verifiers** — at least two people reproduce the final checks from a clean checkout.
- **Release approvers** — compare the published evidence with the Git release commit and approve
  the testnet rehearsal. They should not rely only on the coordinator's machine.

Do not use the production Safe owners' signing devices as ceremony machines.

## Files covered by the ceremony

Both circuits must always move through the same ceremony round:

| Circuit            | Frozen R1CS               | Final proving key               |
| ------------------ | ------------------------- | ------------------------------- |
| Person commitment  | `person_commitment.r1cs`  | `person_commitment_final.zkey`  |
| Disclosure binding | `disclosure_binding.r1cs` | `disclosure_binding_final.zkey` |

The production release also binds:

- circuit source and R1CS SHA-256;
- browser WASM;
- final zkey;
- exported verification key;
- generated Solidity verifier;
- the Powers of Tau source and SHA-256;
- ordered participant IDs and each round's two output zkey hashes;
- final beacon and transcript SHA-256;
- exact Circom and snarkjs versions.

## 1. Freeze the ceremony commit

Start from a clean, isolated checkout. Do not run a ceremony from a working directory containing
uncommitted circuit, dependency, or script changes.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run zk:fetch
npm run zk:build
git status --short
git rev-parse HEAD
sha256sum package-lock.json bin/circom
sha256sum \
  zk-artifacts/circuits/person_commitment.r1cs \
  zk-artifacts/circuits/disclosure_binding.r1cs
```

The R1CS hashes must match `circuits/zk-artifacts-manifest.json`. Record the commit and every printed
hash in the ceremony record. If either circuit changes afterwards, abort the ceremony and restart
from round zero.

## 2. Select and verify Phase 1

Use a reviewed, publicly archived BN254 Powers of Tau transcript with capacity of at least power 13.
Record its permanent source URL, byte size and SHA-256. Do not silently replace a missing download
with another file carrying the same name.

Use task-specific variables:

```bash
DF_CEREMONY_DIR=/absolute/path/to/deepfamily-ceremony
DF_PTAU=/absolute/path/to/reviewed-powers-of-tau.ptau
export ZK_PTAU_PATH="$DF_PTAU"

sha256sum "$DF_PTAU"
node_modules/.bin/snarkjs powersoftau verify "$DF_PTAU"
```

Two independent verifiers must confirm `Powers Of Tau file OK` and the expected SHA-256. Copy the
verified file into the immutable ceremony archive or archive a durable URL plus its exact digest.

## 3. Create the initial Phase 2 keys

Only the coordinator performs round zero:

```bash
mkdir -p "$DF_CEREMONY_DIR/round-0000"

node_modules/.bin/snarkjs groth16 setup \
  zk-artifacts/circuits/person_commitment.r1cs \
  "$DF_PTAU" \
  "$DF_CEREMONY_DIR/round-0000/person_commitment_0000.zkey"

node_modules/.bin/snarkjs groth16 setup \
  zk-artifacts/circuits/disclosure_binding.r1cs \
  "$DF_PTAU" \
  "$DF_CEREMONY_DIR/round-0000/disclosure_binding_0000.zkey"
```

Immediately verify both initial keys and record their hashes:

```bash
node_modules/.bin/snarkjs zkey verify \
  zk-artifacts/circuits/person_commitment.r1cs \
  "$DF_PTAU" \
  "$DF_CEREMONY_DIR/round-0000/person_commitment_0000.zkey"

node_modules/.bin/snarkjs zkey verify \
  zk-artifacts/circuits/disclosure_binding.r1cs \
  "$DF_PTAU" \
  "$DF_CEREMONY_DIR/round-0000/disclosure_binding_0000.zkey"

sha256sum "$DF_CEREMONY_DIR/round-0000/"*.zkey
```

## 4. Run each independent contribution

For round `N`, the participant receives:

- the frozen commit ID and R1CS hashes;
- the reviewed Powers of Tau file or its durable source and hash;
- both zkeys from round `N-1`;
- the complete signed/hash-chained transcript through round `N-1`.

Before contributing, the participant independently verifies every input hash and both input zkeys.
The participant then runs the following on an isolated machine:

```bash
node_modules/.bin/snarkjs zkey contribute \
  person_commitment_previous.zkey \
  person_commitment_next.zkey \
  --name="public-participant-id" \
  -v

node_modules/.bin/snarkjs zkey contribute \
  disclosure_binding_previous.zkey \
  disclosure_binding_next.zkey \
  --name="public-participant-id" \
  -v
```

Important contributor rules:

- Enter entropy interactively. Never pass it using `-e`, an environment variable, a shell history,
  a CI secret, a chat message, or the transcript.
- Use different fresh entropy for the two circuits.
- Do not reuse an OS image snapshot or entropy from another participant.
- Save the public snarkjs contribution hashes and output-file SHA-256 values.
- Sign the exact EIP-191 approval message described in step 7 with the contributor's previously
  agreed checksummed EVM address. Each contributor must use a distinct address. The private signing
  key never enters this repository or the coordinator's machine.
- Destroy entropy, swap, shell history containing sensitive input, and the temporary ceremony
  environment before publishing the output.

The coordinator verifies both returned zkeys before accepting the round:

```bash
node_modules/.bin/snarkjs zkey verify \
  zk-artifacts/circuits/person_commitment.r1cs \
  "$DF_PTAU" \
  person_commitment_next.zkey

node_modules/.bin/snarkjs zkey verify \
  zk-artifacts/circuits/disclosure_binding.r1cs \
  "$DF_PTAU" \
  disclosure_binding_next.zkey

sha256sum person_commitment_next.zkey disclosure_binding_next.zkey
```

Never accept only one circuit from a participant. Never renumber, replace, or edit an accepted
round. If a participant fails, retain the previous valid round and give that exact round to a new
participant.

## 5. Apply the final public beacon

Before contributions start, publish how the future beacon value will be selected. It must come from
a public event that is unknown until after the last contribution. Record the source and extraction
rule in advance.

After the minimum contributor count is met, derive a 64-hex-character beacon and run:

```bash
node_modules/.bin/snarkjs zkey beacon \
  person_commitment_last.zkey \
  person_commitment_final.zkey \
  0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  10 \
  --name="deepfamily-public-beacon"

node_modules/.bin/snarkjs zkey beacon \
  disclosure_binding_last.zkey \
  disclosure_binding_final.zkey \
  0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  10 \
  --name="deepfamily-public-beacon"
```

The displayed value is only a format example; never use it for a real ceremony. Replace it with the
value derived from the pre-announced public event. The value `10` is `numIterationsExp`, meaning
`2^10` beacon iterations; it is not a plain iteration count. DeepFamily accepts an exponent from
10 through 63, and the chosen value becomes immutable release evidence.

Verify both final zkeys again and record their hashes.

## 6. Export release artifacts

Copy the final zkeys to the explicit build paths, export verification keys and Solidity verifiers,
and sync only the known artifact paths:

```bash
cp person_commitment_final.zkey \
  zk-artifacts/circuits/person_commitment_final.zkey
cp disclosure_binding_final.zkey \
  zk-artifacts/circuits/disclosure_binding_final.zkey

node_modules/.bin/snarkjs zkey export verificationkey \
  zk-artifacts/circuits/person_commitment_final.zkey \
  zk-artifacts/circuits/person_commitment.vkey.json
node_modules/.bin/snarkjs zkey export verificationkey \
  zk-artifacts/circuits/disclosure_binding_final.zkey \
  zk-artifacts/circuits/disclosure_binding.vkey.json

npm run zk:verifier
npm run zk:sync
```

The sync command uses explicit source paths and no longer accepts the first recursively discovered
file with a matching name.

## 7. Publish the production manifest

Update `circuits/zk-artifacts-manifest.json` only after all prior checks pass:

- set `trustedSetup.status` to `production`;
- assign a unique `ceremonyId`;
- record the reviewed Phase 1 source, SHA-256 and `verified: true`;
- create `circuits/zk-ceremony-transcript.json` with at least three distinct participant IDs and
  distinct signer addresses in exact contribution order;
- record each participant's two embedded snarkjs BLAKE2b-512 contribution hashes and two output
  zkey SHA-256 values, then obtain that participant's EIP-191 signature;
- record the final beacon source, value, iteration exponent and both embedded beacon contribution
  hashes;
- publish the canonical transcript, then record its path and SHA-256 in the manifest;
- replace every circuit artifact hash with the final release hash.

The production `trustedSetup` shape in `circuits/zk-artifacts-manifest.json` is:

```json
{
  "trustedSetup": {
    "status": "production",
    "ceremonyId": "deepfamily-production-2026-001",
    "minimumContributors": 3,
    "contributorCount": 3,
    "phase1": {
      "source": "https://permanent.example/reviewed.ptau",
      "sha256": "64-lowercase-hex-characters",
      "verified": true
    },
    "transcript": {
      "path": "circuits/zk-ceremony-transcript.json",
      "sha256": "64-lowercase-hex-characters"
    },
    "beacon": {
      "applied": true,
      "name": "deepfamily-public-beacon",
      "hash": "64-lowercase-hex-characters",
      "numIterationsExp": 10,
      "source": "pre-announced public randomness event",
      "personCommitmentContributionHash": "128-lowercase-hex-characters",
      "disclosureBindingContributionHash": "128-lowercase-hex-characters"
    }
  }
}
```

The canonical two-space JSON transcript, with exactly one trailing newline, has this shape:

```json
{
  "schemaVersion": 1,
  "ceremonyId": "deepfamily-production-2026-001",
  "phase1Sha256": "64-lowercase-hex-characters",
  "circuits": {
    "person_commitment": {
      "sourceSha256": "64-lowercase-hex-characters",
      "r1csSha256": "64-lowercase-hex-characters"
    },
    "disclosure_binding": {
      "sourceSha256": "64-lowercase-hex-characters",
      "r1csSha256": "64-lowercase-hex-characters"
    }
  },
  "contributions": [
    {
      "sequence": 1,
      "participantId": "participant-001",
      "signerAddress": "0xChecksummedContributorAddress",
      "personCommitmentContributionHash": "128-lowercase-hex-characters",
      "disclosureBindingContributionHash": "128-lowercase-hex-characters",
      "personCommitmentZkeySha256": "64-lowercase-hex-characters",
      "disclosureBindingZkeySha256": "64-lowercase-hex-characters",
      "signature": "0xEip191Signature"
    }
  ],
  "beacon": {
    "name": "deepfamily-public-beacon",
    "hash": "64-lowercase-hex-characters",
    "numIterationsExp": 10,
    "source": "pre-announced public randomness event",
    "personCommitmentContributionHash": "128-lowercase-hex-characters",
    "disclosureBindingContributionHash": "128-lowercase-hex-characters"
  }
}
```

For each contribution, the signed UTF-8 message is the literal prefix
`deepfamily:zk-ceremony-contribution:v1:` followed immediately by canonical minified JSON with
sorted object keys containing `schemaVersion`, `ceremonyId`, `phase1Sha256`, the complete
`circuits` object and that contribution object without `signature`. The release checker reconstructs
this message, recovers the EIP-191 signer and requires it to equal `signerAddress`; a copied,
reordered or edited record is rejected. Contributors should compare the complete message on an
independent display before signing it with their normal wallet/hardware-wallet workflow.

The examples abbreviate the full manifest and contribution list. Do not delete the manifest's
schema, toolchain, tool-version or circuit hash fields. Both JSON files must be ordinary files
inside the checkout, not symlinks.

## 8. Run the cryptographic verification gate

From the exact release checkout:

```bash
npm run zk:ceremony:verify -- --ptau "$DF_PTAU"
npm run zk:artifacts:check
npm run zk:check
```

The ceremony command fails unless:

- the checked-in manifest is marked production;
- at least three unique participant IDs and EIP-191 signer addresses are recorded;
- every signed transcript record is valid and the transcript hash matches the manifest;
- every committed source/WASM/zkey/vkey/verifier hash matches;
- the pinned Circom and snarkjs executable hashes match;
- the supplied Powers of Tau hash matches;
- `snarkjs powersoftau verify` succeeds;
- both `snarkjs zkey verify` commands bind the final keys to the frozen R1CS and Powers of Tau;
- each final zkey's embedded Phase 2 metadata contains the exact ordered participant names and
  contribution hashes, followed by exactly one matching named beacon.

`zk:check` also generates a proof for each circuit and independently verifies it against the
committed verification key.

## 9. Independent reproduction and release commit

Two independent verifiers must repeat step 8 from clean checkouts and compare:

- Git commit;
- package lock and tool versions;
- ceremony manifest and transcript hashes;
- all R1CS/WASM/zkey/vkey/verifier hashes;
- embedded contribution chain reported by snarkjs;
- final proof verification results.

Commit the final manifest, frontend proving artifacts and generated Solidity verifiers together.
Tag that commit as the release candidate. Any later change to a covered file invalidates the
ceremony release candidate.

Then run:

```bash
ZK_PTAU_PATH="$DF_PTAU" npm run release:preflight
```

The preflight requires a clean production ceremony manifest and executes the complete contract,
frontend, localization, ZK, XSS-sink and dependency checks.

## 10. Testnet and Mainnet sequence

Only after `release:preflight` passes:

1. run eSpace Testnet in `release-rehearsal` mode with the real production `MIN_DELAY`;
2. run Sepolia in `release-rehearsal` mode as well when Ethereum is a release target;
3. accept only the network-specific report with `status=passed`, `releaseReady=true`,
   `zkArtifactTrust.productionReady=true`, and `zkCeremonyVerification.status=passed`;
4. copy the exact reviewed report into a regular, non-symlink path inside the release checkout and
   record its SHA-256 in the external release archive;
5. prepare and prove control of the production Safe;
6. generate the Mainnet release plan;
7. have at least two current Safe owners sign the exact printed EIP-191 plan-approval message;
8. execute only with the unchanged plan digest, signatures and chain confirmation.

Both the testnet release-rehearsal and Mainnet release tooling reject development-only ZK artifacts.

## Abort and restart conditions

Abort the ceremony and restart from round zero when:

- circuit source or R1CS changes;
- the Phase 1 file or its hash is uncertain;
- a zkey/hash handoff cannot be reproduced;
- a contributor used shared, logged or recoverable entropy;
- a contribution order is ambiguous;
- fewer than three independent contributors remain valid;
- the beacon source differs from the pre-announced rule;
- `powersoftau verify`, `zkey verify`, proof verification, or artifact comparison fails;
- the final release manifest cannot be reproduced by independent verifiers.

Never “repair” the transcript by editing hashes or contribution order.
