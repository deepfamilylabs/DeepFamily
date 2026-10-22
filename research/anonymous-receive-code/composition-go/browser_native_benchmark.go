//go:build ignore

package main

// Explicit-file benchmark, excluded from the ordinary research CLI:
// go build -o /tmp/deepfamily-browser-native browser_native_benchmark.go
// Uses the same safe decoders, hints, Prove/Verify options and exported witness
// as browser_wasm.go. No circuit compilation or setup is performed.

import (
	"bufio"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/backend/witness"
	_ "github.com/consensys/gnark/std/recursion/groth16"
)

type benchmarkJob struct {
	Name           string `json:"name"`
	R1CS           string `json:"r1cs"`
	PK             string `json:"pk"`
	VK             string `json:"vk"`
	Witness        string `json:"witness"`
	ExpectedPublic string `json:"expectedPublic"`
}

func benchmarkMemory() map[string]any {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return map[string]any{"goHeapAllocBytes": m.HeapAlloc, "goHeapSysBytes": m.HeapSys, "goSysBytes": m.Sys, "goTotalAllocBytes": m.TotalAlloc, "goNumGC": m.NumGC}
}

func benchmarkWrite(file string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, append(data, '\n'), 0o600)
}

func benchmarkRead(file string, target io.ReaderFrom) (map[string]any, error) {
	stat, err := os.Stat(file)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	start := time.Now()
	read, err := target.ReadFrom(bufio.NewReaderSize(f, 1<<20))
	if err != nil {
		return nil, err
	}
	return map[string]any{"bytes": stat.Size(), "decoderReadBytes": read, "millis": time.Since(start).Milliseconds(), "memory": benchmarkMemory()}, nil
}

func benchmarkRun(jobsFile, jobName, outDir string) error {
	data, err := os.ReadFile(jobsFile)
	if err != nil {
		return err
	}
	var list struct {
		Jobs []benchmarkJob `json:"jobs"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		return err
	}
	var job benchmarkJob
	for _, j := range list.Jobs {
		if j.Name == jobName {
			job = j
			break
		}
	}
	if job.Name == "" {
		return fmt.Errorf("unknown job %q", jobName)
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return err
	}
	runtime.GOMAXPROCS(1)
	debug.SetMemoryLimit(3 << 30)
	start := time.Now()
	report := map[string]any{"scope": "native one-CPU read + actual Prove + Verify baseline, same existing setup and synthetic witness as browser",
		"name": job.Name, "goVersion": runtime.Version(), "gnarkVersion": "v0.16.4", "goOS": runtime.GOOS, "goArch": runtime.GOARCH, "goMaxProcs": runtime.GOMAXPROCS(0), "goMemoryLimitBytes": 3 << 30, "setupPerformed": false}
	ccs := groth16.NewCS(ecc.BN254)
	pk := groth16.NewProvingKey(ecc.BN254)
	vk := groth16.NewVerifyingKey(ecc.BN254)
	w, err := witness.New(ecc.BN254.ScalarField())
	if err != nil {
		return err
	}
	loads := map[string]any{}
	for _, item := range []struct {
		name, file string
		target     io.ReaderFrom
	}{{"r1cs", job.R1CS, ccs}, {"pk", job.PK, pk}, {"vk", job.VK, vk}, {"witness", job.Witness, w}} {
		fmt.Println("Native baseline decode:", item.name)
		part, err := benchmarkRead(item.file, item.target)
		if err != nil {
			return fmt.Errorf("%s: %w", item.name, err)
		}
		loads[item.name] = part
	}
	report["loads"] = loads
	report["constraints"] = ccs.GetNbConstraints()
	report["loadTotalMillis"] = time.Since(start).Milliseconds()
	public, err := w.Public()
	if err != nil {
		return err
	}
	vec := public.Vector().(fr.Vector)
	values := make([]string, len(vec))
	for i := range vec {
		values[i] = vec[i].String()
	}
	expectedData, err := os.ReadFile(job.ExpectedPublic)
	if err != nil {
		return err
	}
	var expected []string
	if err := json.Unmarshal(expectedData, &expected); err != nil {
		return err
	}
	if !reflect.DeepEqual(values, expected) {
		return fmt.Errorf("public witness differs from exported fixture")
	}
	fmt.Println("Native baseline actual Prove")
	t := time.Now()
	proof, err := groth16.Prove(ccs, pk, w, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
	if err != nil {
		return err
	}
	report["proveMillis"] = time.Since(t).Milliseconds()
	fmt.Println("Native baseline actual Verify")
	t = time.Now()
	if err := groth16.Verify(proof, vk, public, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
		return err
	}
	report["verifyMillis"] = time.Since(t).Milliseconds()
	changed := append(fr.Vector(nil), vec...)
	one := fr.One()
	changed[0].Add(&changed[0], &one)
	proofBN := proof.(*backendbn254.Proof)
	if backendbn254.Verify(proofBN, vk.(*backendbn254.VerifyingKey), changed, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
		return fmt.Errorf("changed public input accepted")
	}
	report["verified"] = true
	report["publicTamperRejected"] = true
	report["publicSignals"] = values
	report["solidityProof"] = "0x" + hex.EncodeToString(proofBN.MarshalSolidity())
	report["proofBytes"] = len(proofBN.MarshalSolidity())
	report["memory"] = benchmarkMemory()
	report["totalMillis"] = time.Since(start).Milliseconds()
	if err := benchmarkWrite(filepath.Join(outDir, "summary.json"), report); err != nil {
		return err
	}
	fmt.Println("SUCCESS native baseline:", job.Name)
	return nil
}

func main() {
	jobs := flag.String("jobs", "", "browser-jobs.json with absolute artifact paths")
	job := flag.String("job", "", "attachment or fund")
	out := flag.String("out-dir", "", "temporary result directory")
	flag.Parse()
	if *jobs == "" || *job == "" || *out == "" {
		fmt.Fprintln(os.Stderr, "--jobs --job and --out-dir are required")
		os.Exit(1)
	}
	if err := benchmarkRun(*jobs, *job, *out); err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}
