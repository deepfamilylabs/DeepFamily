# Browser prover resource experiment

This research compiles the pinned Go 1.26.8 / gnark v0.16.4 prover to WebAssembly
and runs actual Groth16 `Prove` and `Verify` inside a Web Worker. The browser
loads the existing gnark `.r1cs`, `.pk`, `.vk` and a serialized synthetic witness;
it performs no setup. These are not snarkjs `.zkey` files.

This measures the outer prover, not the complete identity/password/issuance UI.
This desktop experiment does not measure physical phone performance;
viewport/UA emulation does not replace physical hardware testing.
See the primary [Go WebAssembly instructions](https://go.dev/wiki/WebAssembly)
and [Playwright emulation documentation](https://playwright.dev/docs/emulation).

## Prepare

From `composition-go/`, build only `browser_wasm.go`, using
`GOTOOLCHAIN=go1.26.8 GOOS=js GOARCH=wasm go build -o /tmp/prover.wasm browser_wasm.go`.
Copy the matching toolchain's `lib/wasm/wasm_exec.js` alongside it.

Use the native CLI flag `--export-browser-witness CASE` with either
`--attachment-manifest FILE` or `--fund-manifest FILE` and a temporary `--out-dir`.
The exporter serializes a full synthetic witness and its expected public vector.
Keep all generated binaries and keys outside the repository.

Prepare `browser-jobs.json` with `wasmPath`, `wasmExecPath`, and `jobs`.
Each job has `name`, `r1cs`, `pk`, `vk`, `witness`, `expectedPublic` and
`solidityVerifier` absolute file paths (except `name`, the short job label).
Use matching files from the exact existing circuit/setup. These trusted local
development keys must never be deployed.

## Run from the repository root

```sh
node research/anonymous-receive-code/browser/run.mjs /tmp/browser-jobs.json /tmp/browser-results
DEEPFAMILY_BROWSER_RESULT=/tmp/browser-results/results.json npx hardhat --config research/anonymous-receive-code/hardhat.config.mjs run --no-compile research/anonymous-receive-code/browser/verify-contract.mjs
```

The runner uses the existing frontend `playwright-core` dependency and installed
desktop Chrome. `DEEPFAMILY_CHROME_PATH` overrides its executable.
`DEEPFAMILY_BROWSER_JOB` selects one job. `DEEPFAMILY_BROWSER_REPEATS=2` measures
a second proof reusing decoded parameters. `DEEPFAMILY_BROWSER_TIMEOUT_MS`
changes the default 15-minute job limit. Each job starts a new browser process.

## Measurement scope

- Download, safe decoding, proving and verification are timed separately.
- The loopback HTTP server uses `no-store`; its download times do not represent
  production CDN or mobile bandwidth. It serves only the named fixture files.
- Go heap allocation, reserved heap, Wasm linear memory and process RSS differ.
  One-second process RSS sums can double-count shared pages and miss brief peaks.
- A sampled RSS sum above 6 GiB or timeout stops a job. These are experiment
  safeguards, not discovered browser or phone limits.
- The same exported Solidity verifier independently checks actual browser proof
  bytes. Parameter download or decoding alone is not successful proving.
- Desktop success does not freeze the production architecture or minimum device
  requirements. Full witnesses and inner issuance proofs were prepared natively.
