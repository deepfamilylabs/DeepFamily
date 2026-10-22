# Go/WASM browser prover adapter

This adapter uses the same Go 1.26.8, gnark v0.16.4 and serialized BN254
Groth16 artifacts as the native research CLI. It performs actual `Prove` and
`Verify` in a WebWorker. It never compiles circuits or performs a setup in the
browser. All supplied witnesses are synthetic research fixtures.

Build only the browser entry file, leaving the native CLI entry unchanged:

```sh
GOTOOLCHAIN=go1.26.8 GOOS=js GOARCH=wasm GOMAXPROCS=2 GOMEMLIMIT=3GiB \
  go build -o /tmp/deepfamily-browser-prover-p0/prover.wasm browser_wasm.go
```

Use `lib/wasm/wasm_exec.js` from the matching Go toolchain. The initial build
passed without dependency changes. That establishes compilation compatibility;
browser proving and resource results must be recorded separately by the harness.

Export an existing native fixture witness without setup or proof generation:

```sh
GOTOOLCHAIN=go1.26.8 GOMAXPROCS=2 GOMEMLIMIT=3GiB go run . \
  --attachment-manifest /tmp/deepfamily-attachment-p0/attachment-manifest.json \
  --export-browser-witness attach-first-mode-0 \
  --out-dir /tmp/deepfamily-browser-prover-p0/attachment
```

For Fund, use `--fund-manifest` and `--export-browser-witness first-mode-0`.
The exporter writes `witness.bin`, `public-witness.bin`, `public.json` and a
small `browser-input.json`. It verifies the fixture's existing issuance proof
before serializing the typed assignment. This does not measure browser-side
business witness generation, receive-code issuance or frontend recovery.

After the matching Go runtime starts the WASM instance, the worker can call:

```js
globalThis.deepFamilyResearchOnProgress = event => postMessage({type: "progress", event});
// Wait until deepFamilyResearchProver exists, then load sequentially.
await deepFamilyResearchProver.load("r1cs", r1csBytes);
await deepFamilyResearchProver.load("pk", pkBytes);
await deepFamilyResearchProver.load("vk", vkBytes);
await deepFamilyResearchProver.load("witness", witnessBytes);
const result = await deepFamilyResearchProver.prove();
```

Each byte input is a `Uint8Array`, which can wrap a fetched `ArrayBuffer`.
Release that JS reference after its load promise resolves. The Go reader retains
it only during decoding and copies through a 1 MiB buffer; it does not copy the
whole serialized artifact into another Go byte slice. Normal safe `ReadFrom`
decoders remain enabled. The same decoded circuit and key may be reused for a
second measured proof.

The progress callback receives `ready`, `decode-start`, `decode-bytes`,
`decode-done`, `prove-start`, `prove-done`, `verify-start`, `verify-done`, and
error/panic events. Decode progress reports every 16 MiB and at completion.
`deepFamilyResearchProver.metrics()` returns Go memory counters. `HeapSys`,
`Sys` and cumulative allocation counters are not peak browser process RSS.
The adapter requests `GOMAXPROCS=2` and a 3 GiB Go memory limit; observed values
are included in progress metrics. The outer harness must monitor total browser
memory and keep the UI heartbeat on the main page.

`prove()` returns the real Solidity-compatible proof bytes, public signal
strings, proving and verifying times, and `verified: true` only after native
Groth16 verification succeeds. It also checks rejection of one changed public
signal. The harness should independently verify the returned proof with the
exported Solidity verifier and compare the public signals with `public.json`.

Circuit and setup files are trusted local research artifacts, not an interface
for arbitrary uploaded proving keys. This adapter does not establish mobile
compatibility, production memory limits, or full browser UX feasibility.

The native resource baseline uses a separate explicit-file program, excluded
from the normal CLI with `//go:build ignore`:

```sh
GOTOOLCHAIN=go1.26.8 go build -o /tmp/deepfamily-browser-native-baseline \
  browser_native_benchmark.go
/usr/bin/time -l /tmp/deepfamily-browser-native-baseline \
  --jobs /tmp/deepfamily-browser-prover-p0/browser-jobs.json \
  --job attachment --out-dir /tmp/deepfamily-browser-native-baseline-p0/attachment
```

It requests one Go CPU and a 3 GiB memory limit, and uses the same 1 MiB buffered
safe `ReadFrom`, hint registration, exported witness and proof options as WASM.
Repeat with `--job fund`. On macOS `/usr/bin/time -l` maximum resident set size
and peak memory footprint are byte counts. Those OS measurements are distinct
from Go heap counters. Circuit/setup generation is excluded from the timed run.

The observed safe baseline decoded the compressed attachment proving key in
85.325 seconds and proved in 23.250 seconds; Fund took 92.271 and 24.850 seconds.
Each proof passed real verification and rejection of a changed public signal.
Maximum resident set sizes were 2,927,067,136 and 2,685,943,808 bytes respectively.
These native ARM64 results do not establish browser or phone performance.

An independent read-only OS sample during early safe PK decoding showed
`fp.ExpBySqrtPp1o4` and field multiplication as hot functions. The library first
reads compressed point coordinates, then reconstructs Y and checks groups in a
compute loop. That loop can pause byte-reader progress despite doing real work.
`UnsafeReadFrom` only disables group checks and still reconstructs compressed
Y coordinates. No unsafe decoding, raw-coordinate alternative or dependency
change is included in the baseline or browser adapter.
