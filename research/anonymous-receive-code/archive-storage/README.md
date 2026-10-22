# Archive storage primitive experiment

This local EDR experiment inherits the existing `DeepFamilyArchive` and calls
its unchanged internal `_storeBlob`. `ArchiveData` stores each immutable segment
as contract runtime code beginning with STOP. The existing protocol-core
`readArchiveBlob` reads that code and validates the existing DFBP manifest,
segment lengths and complete payload hash.

The harness deliberately exposes an unprotected `store` method. It is only a
storage and gas test. A production letter entry point must verify the formal
letter proof and operation context before storing a ciphertext. Existing public
Archive metadata and Story APIs bind personHash or NFT ownership; this experiment
does not call them or create Story records. It adds no production API or service.

Run from the repository root:

```sh
DEEPFAMILY_ARCHIVE_STORAGE_OUT=/tmp/deepfamily-letter-archive-p0 \
npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs \
  run --no-compile research/anonymous-receive-code/archive-storage/run.mjs
```

The script generates an actual 512-byte HPKE ciphertext and synthetic payloads
at the segment boundary. It compiles with the cached Solidity
0.8.28 executable, overridable with `DEEPFAMILY_RESEARCH_SOLC`; it does not load
`.env`, connect to live networks, or modify production artifacts.

The observed run passed 17 checks:

| Stored bytes | Content | Segments | Manifest pages | Transaction gas |
| --- | --- | --- | --- | --- |
| 512 | Actual HPKE ciphertext | 1 | 0 | 170,759 |
| 16,384 | Synthetic boundary bytes | 1 | 0 | 3,629,597 |
| 16,385 | Synthetic boundary bytes | 2 | 1 | 3,724,295 |

Every sample was restored byte for byte through actual `eth_getCode`. The
two-segment case also independently parsed the existing manifest and stripped
each segment's STOP prefix. Its manifest runtime was 126 bytes and segment
runtimes were 16,385 and 2 bytes. Restored ciphertext hashes and lengths matched
the emitted reference; forged hashes and lengths were rejected. The restored
512-byte ciphertext also decrypted through the actual production HPKE helper.

Gas covers the harness call, calldata, data-contract creation and its event. It
excludes letter proof verification and production record writes. Randomized
ciphertext can slightly change calldata gas. These are gas measurements, not
currency prices or full letter transaction estimates.

This does not exercise more than one manifest page, a finalized long-letter
encryption format, production deployment authorization, Archive discovery,
event fetching, or full wallet recovery on another device. Results are written
to the chosen temporary output directory as `results.json`.
