//go:build js && wasm

package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"runtime"
	"runtime/debug"
	"syscall/js"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/logger"
)

var wasmEngine Engine
var wasmBusy bool
var wasmCallbacks []js.Func

func jsJSON(value any) js.Value {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return js.Global().Get("JSON").Call("parse", string(data))
}

func rejectJS(message string) js.Value {
	return js.Global().Get("Promise").Call("reject", js.Global().Get("Error").New(message))
}

func wasmTask(fn func() (any, error)) js.Value {
	if wasmBusy {
		return rejectJS("one receive prover operation at a time")
	}
	wasmBusy = true
	executor := js.FuncOf(func(_ js.Value, args []js.Value) any {
		resolve, reject := args[0], args[1]
		go func() {
			defer func() {
				wasmBusy = false
				if err := recover(); err != nil {
					reject.Invoke(js.Global().Get("Error").New("Receive proof operation failed"))
				}
			}()
			value, err := fn()
			if err != nil {
				reject.Invoke(js.Global().Get("Error").New("Receive proof operation failed"))
				return
			}
			resolve.Invoke(jsJSON(value))
		}()
		return nil
	})
	promise := js.Global().Get("Promise").New(executor)
	executor.Release()
	return promise
}

func wasmConfigure(_ js.Value, args []js.Value) any {
	if len(args) != 1 || args[0].Type() != js.TypeString {
		return rejectJS("configure requires manifest JSON")
	}
	data := args[0].String()
	return wasmTask(func() (any, error) {
		var manifest Manifest
		if err := json.Unmarshal([]byte(data), &manifest); err != nil {
			return nil, fmt.Errorf("invalid receive manifest")
		}
		if err := manifest.validate(); err != nil {
			return nil, err
		}
		wasmEngine = Engine{Manifest: manifest}
		return map[string]any{"kind": manifest.Kind, "publicSignals": manifest.PublicSignals}, nil
	})
}

// Decode without retaining a second complete Go copy of a ~330 MiB proving key.
type jsArrayReader struct {
	data          js.Value
	offset, total int
}

func (r *jsArrayReader) Read(dst []byte) (int, error) {
	if r.offset == r.total {
		return 0, io.EOF
	}
	n := len(dst)
	if n > r.total-r.offset {
		n = r.total - r.offset
	}
	n = js.CopyBytesToGo(dst[:n], r.data.Call("subarray", r.offset, r.offset+n))
	r.offset += n
	return n, nil
}

func wasmLoad(_ js.Value, args []js.Value) any {
	if len(args) != 2 || args[0].Type() != js.TypeString || !args[1].InstanceOf(js.Global().Get("Uint8Array")) {
		return rejectJS("load requires kind and Uint8Array")
	}
	kind, data := args[0].String(), args[1]
	return wasmTask(func() (any, error) {
		if err := wasmEngine.Manifest.validate(); err != nil {
			return nil, err
		}
		file := "receipt." + kind
		expected, ok := wasmEngine.Manifest.Artifacts[file]
		if !ok || len(expected) != 64 {
			return nil, fmt.Errorf("missing artifact digest: %s", file)
		}
		var target io.ReaderFrom
		switch kind {
		case "r1cs":
			target = groth16.NewCS(ecc.BN254)
		case "pk":
			target = groth16.NewProvingKey(ecc.BN254)
		case "vk":
			target = groth16.NewVerifyingKey(ecc.BN254)
		default:
			return nil, fmt.Errorf("only r1cs, pk and vk artifacts are accepted; witnesses must be constructed from raw input")
		}
		h := sha256.New()
		source := &jsArrayReader{data: data, total: data.Get("byteLength").Int()}
		r := bufio.NewReaderSize(io.TeeReader(source, h), 1<<20)
		if _, err := target.ReadFrom(r); err != nil {
			return nil, fmt.Errorf("decode %s: %w", file, err)
		}
		if _, err := r.ReadByte(); err != io.EOF {
			return nil, fmt.Errorf("trailing artifact bytes: %s", file)
		}
		if hex.EncodeToString(h.Sum(nil)) != expected {
			return nil, fmt.Errorf("artifact digest mismatch: %s", file)
		}
		switch kind {
		case "r1cs":
			ccs := target.(interface {
				GetNbConstraints() int
				GetNbPublicVariables() int
			})
			if ccs.GetNbConstraints() != wasmEngine.Manifest.Constraints || ccs.GetNbPublicVariables() != wasmEngine.Manifest.PublicSignals+1 {
				return nil, fmt.Errorf("R1CS does not match receive manifest")
			}
			wasmEngine.CCS = target.(constraint.ConstraintSystem)
		case "pk":
			wasmEngine.PK = target.(groth16.ProvingKey)
		case "vk":
			wasmEngine.VK = target.(groth16.VerifyingKey)
		}
		return map[string]any{"kind": kind, "bytes": source.total}, nil
	})
}

func wasmProve(_ js.Value, args []js.Value) any {
	if len(args) != 1 || args[0].Type() != js.TypeString {
		return rejectJS("prove requires a raw receive request JSON string")
	}
	data := []byte(args[0].String())
	return wasmTask(func() (any, error) { return wasmEngine.Prove(data) })
}

func main() {
	// Constraint diagnostics can contain private witness values. Never send
	// gnark logs or raw solver errors to a product browser console.
	logger.Disable()
	runtime.GOMAXPROCS(1)
	debug.SetMemoryLimit(3 << 30)
	api := js.Global().Get("Object").New()
	for name, fn := range map[string]func(js.Value, []js.Value) any{"configure": wasmConfigure, "load": wasmLoad, "prove": wasmProve} {
		callback := js.FuncOf(fn)
		wasmCallbacks = append(wasmCallbacks, callback)
		api.Set(name, callback)
	}
	js.Global().Set("deepFamilyReceiveProver", api)
	select {}
}
