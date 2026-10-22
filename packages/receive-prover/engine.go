package main

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
)

type Manifest struct {
	CircuitVersion     string            `json:"circuitVersion"`
	Kind               string            `json:"kind"`
	PublicSignals      int               `json:"publicSignals"`
	IssuerVK_SHA256    string            `json:"issuerVkSha256"`
	ProductionCeremony bool              `json:"productionCeremony"`
	Setup              string            `json:"setup"`
	Constraints        int               `json:"constraints"`
	Artifacts          map[string]string `json:"artifacts"`
}

func (m Manifest) validate() error {
	if m.CircuitVersion != CircuitVersion {
		return fmt.Errorf("unsupported receive circuit version")
	}
	if _, err := issuerCount(m.Kind); err != nil {
		return err
	}
	want := 11
	if m.Kind == "attachment" {
		want = 14
	}
	if m.PublicSignals != want {
		return fmt.Errorf("invalid receive public layout")
	}
	return nil
}

type Engine struct {
	Manifest Manifest
	CCS      constraint.ConstraintSystem
	PK       groth16.ProvingKey
	VK       groth16.VerifyingKey
}

type ProofResult struct {
	SolidityProof string   `json:"solidityProof"`
	PublicSignals []string `json:"publicSignals"`
	// Native encoding allows independent CLI verification; never submit this
	// encoding to Solidity, whose commitment-aware encoding is SolidityProof.
	NativeProof  string `json:"nativeProof"`
	Verified     bool   `json:"verified"`
	ProveMillis  int64  `json:"proveMillis"`
	VerifyMillis int64  `json:"verifyMillis"`
}

func (e *Engine) Prove(rawJSON []byte) (*ProofResult, error) {
	if err := e.Manifest.validate(); err != nil {
		return nil, err
	}
	if e.CCS == nil || e.PK == nil || e.VK == nil {
		return nil, fmt.Errorf("load receipt R1CS, proving key, verifying key and manifest")
	}
	w, err := requestWitness(rawJSON, e.Manifest.Kind)
	if err != nil {
		return nil, err
	}
	pub, err := w.Public()
	if err != nil {
		return nil, err
	}
	values := pub.Vector().(fr.Vector)
	if len(values) != e.Manifest.PublicSignals {
		return nil, fmt.Errorf("receipt witness public layout mismatch")
	}
	started := time.Now()
	proof, err := groth16.Prove(e.CCS, e.PK, w, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
	if err != nil {
		return nil, fmt.Errorf("receipt constraints rejected witness: %w", err)
	}
	proveMillis := time.Since(started).Milliseconds()
	started = time.Now()
	if err = groth16.Verify(proof, e.VK, pub, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
		return nil, fmt.Errorf("generated receipt did not verify: %w", err)
	}
	result := &ProofResult{Verified: true, ProveMillis: proveMillis, VerifyMillis: time.Since(started).Milliseconds(), PublicSignals: make([]string, len(values))}
	for i := range values {
		result.PublicSignals[i] = values[i].String()
	}
	result.SolidityProof = "0x" + hex.EncodeToString(proof.(*backendbn254.Proof).MarshalSolidity())
	var native bytes.Buffer
	if _, err = proof.WriteTo(&native); err != nil {
		return nil, err
	}
	result.NativeProof = hex.EncodeToString(native.Bytes())
	return result, nil
}

type publicAssignment struct {
	Values []frontend.Variable `gnark:",public"`
}

func (*publicAssignment) Define(frontend.API) error { return nil }

func (e *Engine) Verify(result ProofResult) error {
	if err := e.Manifest.validate(); err != nil {
		return err
	}
	if e.VK == nil {
		return fmt.Errorf("receipt verifying key is not loaded")
	}
	if len(result.PublicSignals) != e.Manifest.PublicSignals {
		return fmt.Errorf("invalid public signal count")
	}
	if err := validDecimals(result.PublicSignals...); err != nil {
		return err
	}
	data, err := hex.DecodeString(result.NativeProof)
	if err != nil {
		return err
	}
	proof := groth16.NewProof(ecc.BN254)
	r := bytes.NewReader(data)
	if _, err = proof.ReadFrom(r); err != nil {
		return err
	}
	if r.Len() != 0 {
		return fmt.Errorf("trailing native proof bytes")
	}
	if result.SolidityProof != "0x"+hex.EncodeToString(proof.(*backendbn254.Proof).MarshalSolidity()) {
		return fmt.Errorf("Solidity proof does not match the native proof")
	}
	a := &publicAssignment{Values: make([]frontend.Variable, len(result.PublicSignals))}
	for i := range a.Values {
		a.Values[i] = result.PublicSignals[i]
	}
	w, err := frontend.NewWitness(a, ecc.BN254.ScalarField(), frontend.PublicOnly())
	if err != nil {
		return err
	}
	return groth16.Verify(proof, e.VK, w, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16))
}
