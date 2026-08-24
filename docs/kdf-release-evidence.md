# KDF release evidence

Production release requires two independently reviewed, canonical JSON evidence files. The
repository does not contain completed device measurements yet, and the development protocol
manifest deliberately keeps this gate closed.

## Generate incomplete templates

These commands only print deterministic `status: incomplete` skeletons to stdout. They never run a
benchmark, choose a production candidate, write a repository file, or claim that a device passed.

```bash
mkdir -p release-evidence
npm run --silent release:kdf:device-matrix:template \
  > release-evidence/kdf-device-matrix.incomplete.json
npm run --silent release:kdf:attacker-study:template \
  > release-evidence/kdf-attacker-study.incomplete.json
```

Do not turn a template into evidence by changing its status. Every non-null measurement must come
from the named physical device, browser/runtime, worker mode, benchmark revision and measured run.

## Device-matrix schema v2

Before measuring, review and freeze the latency budgets in `protocol-release-manifest.json`. The
same values must appear byte-for-byte in the report. The three required environment kinds are
`minimum-mobile`, `desktop-browser`, and `worker`; every candidate must use the exact same stable
environment ID set.

The candidate ladder must contain the 64 MiB, Argon2id t=3, p=1 baseline and at least one heavier
candidate. A passing environment result records all of the following:

- identity and file single-derivation p50/p95 measurements;
- a complete AddVersion measurement that executes 4 identity KDF and 2 file KDF operations, proof
  generation, gzip compression and decompression, two AES-GCM encryptions, two AES-GCM decryptions,
  and the production decode round trip using fresh inputs;
- a strictly serial, multi-version unlock measurement with one identity and one file KDF per
  version;
- a continuous stress run of at least 1800 seconds, the iteration count, peak memory, and explicit
  OOM, worker-crash, and process-crash counts.

KDF outputs, KEKs, DEKs, proofs, compressed bytes, ciphertext, or other intermediate values must not
be reused between benchmark samples. A candidate is reliable only when every required environment
meets the frozen latency budgets and completes the stress requirement without OOM or crash. Among
reliable candidates, select the greatest `memoryKiB` first and then the greatest `iterations`.
Identity suite 1 and file-KDF suite 1 must both be frozen to that exact selected candidate.

## Attacker-cost study schema v2

The attacker study binds the device matrix's selected candidate and separately covers the identity
and file suites. Each implementation entry records:

- tool name, exact version, and source revision;
- explicit confirmation that the implementation is independent from the product KDF path and
  optimized for attacker throughput;
- hardware description, processor, installed memory, and accelerator;
- measurement duration of at least 60 seconds, attempt count, optimization mode, measured
  throughput, memory per attempt, and the measured memory-time product;
- explicit assumptions and the observed memory-time tradeoff.

Keep legitimate-user latency and attacker throughput separate. Browser latency must not be turned
into security bits or password-cracking years, and the production validator rejects such derived
claims.

## Freeze measured evidence

1. Fill the templates only from captured runs on every declared environment. Preserve raw logs
   outside the canonical summary for independent review.
2. Confirm every AddVersion sample used fresh inputs and performed the complete operation counts;
   confirm serial unlock was not parallelized or memoized.
3. Confirm the selected candidate is the highest-memory, then highest-time reliable candidate that
   passes every frozen budget on every environment.
4. Have a second reviewer compare the canonical summaries with raw device and attacker-tool output.
5. Rename the reviewed summaries to their final tracked paths, retain two-space JSON with exactly one
   trailing newline, and calculate each file's SHA-256.
6. Update the manifest bindings with schema version 2, evidence type, selected candidate, budgets,
   stress requirements, tracked path, SHA-256, and `status: passed`. Freeze both suite definitions to
   the same selected KDF parameters.
7. Run the production manifest/release preflight. It will still reject release until all unrelated
   production evidence (including trusted setup and deployment evidence) is also complete.

The checked-in development manifest intentionally has null latency budgets, no selected candidate,
no evidence paths or hashes, and `status: missing`; therefore it remains production-ineligible.
