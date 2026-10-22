//go:build js && wasm

package main

// Compile this file explicitly, not the complete CLI package:
// GOOS=js GOARCH=wasm go build -o /tmp/prover.wasm browser_wasm.go
// RESEARCH ONLY. Trusted local circuit/setup artifacts and synthetic witnesses.

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"runtime"
	"runtime/debug"
	"syscall/js"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/constraint"
	// Register the same emulated-arithmetic and recursion solver hints as the
	// native application. Loading only generic Groth16 omits these hint inits.
	_ "github.com/consensys/gnark/std/recursion/groth16"
)

var browserState struct {
	busy bool
	ccs  constraint.ConstraintSystem
	pk   groth16.ProvingKey
	vk   groth16.VerifyingKey
	w    witness.Witness
}

var retainedJS []js.Func

func jsObject(value any) js.Value {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return js.Global().Get("JSON").Call("parse", string(data))
}

func memoryMetrics() map[string]any {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return map[string]any{"goHeapAllocBytes": m.HeapAlloc, "goHeapSysBytes": m.HeapSys, "goSysBytes": m.Sys, "goTotalAllocBytes": m.TotalAlloc,
		"goNumGC": m.NumGC, "goNumGoroutine": runtime.NumGoroutine(), "goMaxProcs": runtime.GOMAXPROCS(0), "goVersion": runtime.Version()}
}

func progress(phase string, detail map[string]any) {
	if detail == nil {
		detail = map[string]any{}
	}
	detail["phase"] = phase
	detail["memory"] = memoryMetrics()
	callback := js.Global().Get("deepFamilyResearchOnProgress")
	if callback.Type() == js.TypeFunction {
		callback.Invoke(jsObject(detail))
	}
}

// arrayReader retains a JS Uint8Array while decoding, copying only the current
// chunk into Go memory. A 1MiB bufio.Reader prevents a cross-JS call per point.
type arrayReader struct {
	data                      js.Value
	offset, total, lastReport int
	kind                      string
}

func (r *arrayReader) Read(dst []byte) (int, error) {
	if r.offset == r.total {
		return 0, io.EOF
	}
	n := len(dst)
	if n > r.total-r.offset {
		n = r.total - r.offset
	}
	copied := js.CopyBytesToGo(dst[:n], r.data.Call("subarray", r.offset, r.offset+n))
	r.offset += copied
	if r.offset-r.lastReport >= 16<<20 || r.offset == r.total {
		r.lastReport = r.offset
		progress("decode-bytes", map[string]any{"kind": r.kind, "readBytes": r.offset, "totalBytes": r.total})
	}
	return copied, nil
}

func promiseTask(fn func() (any, error)) js.Value {
	executor := js.FuncOf(func(this js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			defer func() {
				if r := recover(); r != nil {
					browserState.busy = false
					progress("panic", map[string]any{"error": fmt.Sprint(r)})
					reject.Invoke(js.Global().Get("Error").New(fmt.Sprint(r)))
				}
			}()
			result, err := fn()
			browserState.busy = false
			if err != nil {
				progress("error", map[string]any{"error": err.Error()})
				reject.Invoke(js.Global().Get("Error").New(err.Error()))
				return
			}
			resolve.Invoke(jsObject(result))
		}()
		return nil
	})
	result := js.Global().Get("Promise").New(executor)
	executor.Release()
	return result
}

func loadArtifact(this js.Value, args []js.Value) any {
	if len(args) != 2 || args[0].Type() != js.TypeString {
		return js.Global().Get("Promise").Call("reject", js.Global().Get("Error").New("load(kind, Uint8Array) requires two arguments"))
	}
	if browserState.busy {
		return js.Global().Get("Promise").Call("reject", js.Global().Get("Error").New("one research operation at a time"))
	}
	kind, data := args[0].String(), args[1]
	if !data.InstanceOf(js.Global().Get("Uint8Array")) {
		return js.Global().Get("Promise").Call("reject", js.Global().Get("Error").New("artifact must be Uint8Array"))
	}
	browserState.busy = true
	return promiseTask(func() (any, error) {
		started := time.Now()
		r := &arrayReader{data: data, total: data.Get("byteLength").Int(), kind: kind}
		progress("decode-start", map[string]any{"kind": kind, "totalBytes": r.total})
		var target io.ReaderFrom
		switch kind {
		case "r1cs":
			browserState.ccs = groth16.NewCS(ecc.BN254)
			target = browserState.ccs
		case "pk":
			browserState.pk = groth16.NewProvingKey(ecc.BN254)
			target = browserState.pk
		case "vk":
			browserState.vk = groth16.NewVerifyingKey(ecc.BN254)
			target = browserState.vk
		case "witness":
			var err error
			browserState.w, err = witness.New(ecc.BN254.ScalarField())
			if err != nil {
				return nil, err
			}
			target = browserState.w
		default:
			return nil, fmt.Errorf("unknown research artifact %q", kind)
		}
		_, err := target.ReadFrom(bufio.NewReaderSize(r, 1<<20))
		if err != nil {
			return nil, fmt.Errorf("decode %s: %w", kind, err)
		}
		if r.offset != r.total {
			return nil, fmt.Errorf("decode %s did not consume the entire artifact", kind)
		}
		result := map[string]any{"kind": kind, "bytes": r.total, "decodeMillis": time.Since(started).Milliseconds(), "memory": memoryMetrics()}
		if kind == "r1cs" {
			result["constraints"] = browserState.ccs.GetNbConstraints()
			result["publicVariablesIncludingOne"] = browserState.ccs.GetNbPublicVariables()
		}
		// Drop the Go-held reference to this JS ArrayBuffer after decoding.
		r.data = js.Undefined()
		progress("decode-done", result)
		return result, nil
	})
}

func prove(this js.Value, args []js.Value) any {
	if browserState.busy {
		return js.Global().Get("Promise").Call("reject", js.Global().Get("Error").New("one research operation at a time"))
	}
	browserState.busy = true
	return promiseTask(func() (any, error) {
		if browserState.ccs == nil || browserState.pk == nil || browserState.vk == nil || browserState.w == nil {
			return nil, fmt.Errorf("load r1cs, pk, vk and witness before proving")
		}
		public, err := browserState.w.Public()
		if err != nil {
			return nil, err
		}
		progress("prove-start", map[string]any{"constraints": browserState.ccs.GetNbConstraints()})
		started := time.Now()
		proof, err := groth16.Prove(browserState.ccs, browserState.pk, browserState.w, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
		if err != nil {
			return nil, err
		}
		proveMillis := time.Since(started).Milliseconds()
		progress("prove-done", map[string]any{"proveMillis": proveMillis})
		progress("verify-start", nil)
		started = time.Now()
		if err := groth16.Verify(proof, browserState.vk, public, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
			return nil, err
		}
		verifyMillis := time.Since(started).Milliseconds()
		vec := public.Vector().(fr.Vector)
		values := make([]string, len(vec))
		for i := range vec {
			values[i] = vec[i].String()
		}
		// One real negative verification confirms the browser result is tied to
		// its public statement; loading/parsing alone cannot satisfy this check.
		changed := append(fr.Vector(nil), vec...)
		one := fr.One()
		changed[0].Add(&changed[0], &one)
		proofBN := proof.(*backendbn254.Proof)
		if backendbn254.Verify(proofBN, browserState.vk.(*backendbn254.VerifyingKey), changed, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
			return nil, fmt.Errorf("browser verifier accepted a changed public signal")
		}
		encoded := proofBN.MarshalSolidity()
		result := map[string]any{"verified": true, "publicTamperRejected": true, "proveMillis": proveMillis, "verifyMillis": verifyMillis,
			"proofBytes": len(encoded), "publicSignals": values, "solidityProof": "0x" + hex.EncodeToString(encoded), "memory": memoryMetrics(), "setupPerformed": false}
		progress("verify-done", result)
		return result, nil
	})
}

func main() {
	runtime.GOMAXPROCS(2)
	debug.SetMemoryLimit(3 << 30)
	loadFn, proveFn := js.FuncOf(loadArtifact), js.FuncOf(prove)
	metricsFn := js.FuncOf(func(this js.Value, args []js.Value) any { return jsObject(memoryMetrics()) })
	retainedJS = []js.Func{loadFn, proveFn, metricsFn}
	api := js.Global().Get("Object").New()
	api.Set("load", loadFn)
	api.Set("prove", proveFn)
	api.Set("metrics", metricsFn)
	js.Global().Set("deepFamilyResearchProver", api)
	progress("ready", map[string]any{"scope": "research-only actual Go/WASM Groth16 Prove+Verify; synthetic witnesses", "memoryLimitBytes": 3 << 30, "setupPerformed": false})
	select {}
}
