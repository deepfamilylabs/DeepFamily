//go:build !js || !wasm

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

func writeJSON(file string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, append(b, '\n'), 0600)
}
func writeBinary(file string, v io.WriterTo) error {
	f, err := os.OpenFile(file, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = v.WriteTo(f)
	cerr := f.Close()
	if err != nil {
		return err
	}
	return cerr
}
func readBinary(file string, v io.ReaderFrom) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = v.ReadFrom(f)
	if err != nil {
		return err
	}
	var b [1]byte
	n, _ := f.Read(b[:])
	if n != 0 {
		return fmt.Errorf("trailing artifact bytes")
	}
	return nil
}
func hashFile(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func compileReceipt(kind string, vkBytes []byte) (frontend.Circuit, error) {
	count, err := issuerCount(kind)
	if err != nil {
		return nil, err
	}
	vk, err := parseIssuerVK(vkBytes, count)
	if err != nil {
		return nil, err
	}
	fixed, err := stdgroth16.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	if err != nil {
		return nil, err
	}
	c := ReceiptCircuit{Kind: kind, IssuerVK: fixed, InnerWitness: stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], count)}}
	if kind == "attachment" {
		return &AttachedCircuit{Receipt: c}, nil
	}
	return &c, nil
}

func setup(kind, issuerFile, out string, compileOnly bool) error {
	if out == "" || issuerFile == "" {
		return fmt.Errorf("setup requires --kind, --issuer-vk and --out-dir")
	}
	vkBytes, err := os.ReadFile(issuerFile)
	if err != nil {
		return err
	}
	circuit, err := compileReceipt(kind, vkBytes)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(out, 0700); err != nil {
		return err
	}
	fmt.Println("Compiling fixed-issuer receive presentation", kind)
	started := time.Now()
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
	if err != nil {
		return err
	}
	fmt.Printf("Compiled %d constraints in %s\n", ccs.GetNbConstraints(), time.Since(started))
	if err = writeBinary(filepath.Join(out, "receipt.r1cs"), ccs); err != nil {
		return err
	}
	sum := sha256.Sum256(vkBytes)
	count := 11
	if kind == "attachment" {
		count = 14
	}
	m := Manifest{CircuitVersion: CircuitVersion, Kind: kind, PublicSignals: count, IssuerVK_SHA256: hex.EncodeToString(sum[:]), ProductionCeremony: false, Setup: "insecure-local-development", Constraints: ccs.GetNbConstraints(), Artifacts: map[string]string{}}
	if !compileOnly {
		fmt.Println("INSECURE LOCAL DEVELOPMENT SETUP: these keys are not production ceremony artifacts")
		pk, vk, err := groth16.Setup(ccs)
		if err != nil {
			return err
		}
		if err = writeBinary(filepath.Join(out, "receipt.pk"), pk); err != nil {
			return err
		}
		if err = writeBinary(filepath.Join(out, "receipt.vk"), vk); err != nil {
			return err
		}
		var source strings.Builder
		if err = vk.ExportSolidity(&source); err != nil {
			return err
		}
		name := map[string]string{"anonymous": "AnonymousReceivePresentationVerifier", "fund": "FundReceivePresentationVerifier", "attachment": "AttachedReceivePresentationVerifier"}[kind]
		if err = os.WriteFile(filepath.Join(out, "ReceiptVerifier.sol"), []byte(strings.Replace(source.String(), "contract Verifier ", "contract "+name+" ", 1)), 0600); err != nil {
			return err
		}
	}
	for _, name := range []string{"receipt.r1cs", "receipt.pk", "receipt.vk", "ReceiptVerifier.sol"} {
		if compileOnly && name != "receipt.r1cs" {
			continue
		}
		h, err := hashFile(filepath.Join(out, name))
		if err != nil {
			return err
		}
		m.Artifacts[name] = h
	}
	return writeJSON(filepath.Join(out, "manifest.json"), m)
}

func loadEngine(dir string, verifyOnly bool) (*Engine, error) {
	e := new(Engine)
	if err := readJSON(filepath.Join(dir, "manifest.json"), &e.Manifest); err != nil {
		return nil, err
	}
	if err := e.Manifest.validate(); err != nil {
		return nil, err
	}
	for _, name := range []string{"receipt.r1cs", "receipt.pk", "receipt.vk"} {
		if verifyOnly && name != "receipt.vk" {
			continue
		}
		expected, ok := e.Manifest.Artifacts[name]
		if !ok {
			return nil, fmt.Errorf("missing artifact digest %s", name)
		}
		got, err := hashFile(filepath.Join(dir, name))
		if err != nil {
			return nil, err
		}
		if got != expected {
			return nil, fmt.Errorf("artifact digest mismatch: %s", name)
		}
	}
	e.VK = groth16.NewVerifyingKey(ecc.BN254)
	if err := readBinary(filepath.Join(dir, "receipt.vk"), e.VK); err != nil {
		return nil, err
	}
	if verifyOnly {
		return e, nil
	}
	e.CCS = groth16.NewCS(ecc.BN254)
	e.PK = groth16.NewProvingKey(ecc.BN254)
	if err := readBinary(filepath.Join(dir, "receipt.r1cs"), e.CCS); err != nil {
		return nil, err
	}
	if err := readBinary(filepath.Join(dir, "receipt.pk"), e.PK); err != nil {
		return nil, err
	}
	return e, nil
}

func run() error {
	if len(os.Args) < 2 {
		return fmt.Errorf("usage: receive-prover setup|prove|verify [flags]")
	}
	fs := flag.NewFlagSet(os.Args[1], flag.ContinueOnError)
	kind := fs.String("kind", "anonymous", "anonymous, fund or attachment")
	issuer := fs.String("issuer-vk", "", "fixed Circom issuer verifying key JSON")
	out := fs.String("out-dir", "", "artifact output directory")
	artifacts := fs.String("artifacts", "", "receipt artifact directory")
	input := fs.String("input", "", "raw request JSON (prove) or proof result JSON (verify)")
	output := fs.String("output", "", "proof result JSON path")
	compileOnly := fs.Bool("compile-only", false, "compile fixed circuit without development setup")
	if err := fs.Parse(os.Args[2:]); err != nil {
		return err
	}
	switch os.Args[1] {
	case "setup":
		return setup(*kind, *issuer, *out, *compileOnly)
	case "prove":
		if *input == "" || *output == "" {
			return fmt.Errorf("prove requires --artifacts, --input and --output")
		}
		e, err := loadEngine(*artifacts, false)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(*input)
		if err != nil {
			return err
		}
		result, err := e.Prove(data)
		if err != nil {
			return err
		}
		return writeJSON(*output, result)
	case "verify":
		e, err := loadEngine(*artifacts, true)
		if err != nil {
			return err
		}
		var result ProofResult
		if err = readJSON(*input, &result); err != nil {
			return err
		}
		if err = e.Verify(result); err != nil {
			return err
		}
		fmt.Println("Receipt proof verified")
		return nil
	}
	return fmt.Errorf("unknown command %q", os.Args[1])
}

func main() {
	runtime.GOMAXPROCS(4)
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "receive-prover:", err)
		os.Exit(1)
	}
}
