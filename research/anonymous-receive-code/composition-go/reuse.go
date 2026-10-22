package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

func readBinary(file string, value io.ReaderFrom) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	_, err = value.ReadFrom(f)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

type caseManifest struct {
	Cases []struct {
		Name       string `json:"name"`
		InputDir   string `json:"inputDir"`
		Mode       string `json:"mode"`
		ExtrasFile string `json:"extrasFile"`
		Valid      bool   `json:"valid"`
	} `json:"cases"`
}

// runReusableCases never recompiles or sets up a new key. Negative cases are
// rejected by Groth16.Prove's constraint solver with its actual commitment hint;
// generic ccs.IsSolved cannot evaluate the recursive gadget's placeholder hint.
func runReusableCases(setupDir, manifestFile, constantsFile, outDir string) error {
	if outDir == "" {
		outDir = filepath.Join(setupDir, "cases")
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return err
	}
	if err := LoadPoseidonConstants(constantsFile); err != nil {
		return err
	}
	var manifest caseManifest
	if err := readJSON(manifestFile, &manifest); err != nil {
		return err
	}
	var setupSummary map[string]any
	if err := readJSON(filepath.Join(setupDir, "summary.json"), &setupSummary); err != nil {
		return err
	}
	ccs := groth16.NewCS(ecc.BN254)
	pk := groth16.NewProvingKey(ecc.BN254)
	vk := groth16.NewVerifyingKey(ecc.BN254)
	fmt.Println("Loading research circuit and proving key; setup is reused for every case")
	if err := readBinary(filepath.Join(setupDir, "composition.r1cs"), ccs); err != nil {
		return err
	}
	if err := readBinary(filepath.Join(setupDir, "composition.pk"), pk); err != nil {
		return err
	}
	if err := readBinary(filepath.Join(setupDir, "composition.vk"), vk); err != nil {
		return err
	}
	var caseResults []map[string]any
	validCount, invalidCount := 0, 0
	for _, item := range manifest.Cases {
		if item.Name == "" || filepath.Base(item.Name) != item.Name {
			return fmt.Errorf("invalid case output name")
		}
		fmt.Println("Case:", item.Name)
		input, err := loadIssuance(item.InputDir, item.Mode)
		if err != nil {
			return err
		}
		if err := backendbn254.Verify(input.Proof, input.VK, input.Public); err != nil {
			return fmt.Errorf("case %s: invalid native input proof: %w", item.Name, err)
		}
		vkJSON, err := os.ReadFile(filepath.Join(item.InputDir, "research.vkey.json"))
		if err != nil {
			return err
		}
		vkHash := sha256.Sum256(vkJSON)
		if hex.EncodeToString(vkHash[:]) != setupSummary["fixedIssuanceVK_SHA256"] {
			return fmt.Errorf("case %s has a different issuer verifying key", item.Name)
		}
		extras, err := LoadNativeExtras(item.ExtrasFile, input.PublicStrings)
		if err != nil {
			return err
		}
		proofValue, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](input.Proof)
		if err != nil {
			return err
		}
		innerValue := stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], issuancePublicCount)}
		for i := range input.Public {
			innerValue.Public[i] = sw_bn254.NewScalar(input.Public[i])
		}
		assignment := &MainCircuit{Proof: proofValue, InnerWitness: innerValue, Extras: extras}
		witness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
		if err != nil {
			return err
		}
		started := time.Now()
		proof, err := groth16.Prove(ccs, pk, witness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
		elapsed := time.Since(started).Milliseconds()
		if !item.Valid {
			if err == nil {
				return fmt.Errorf("invalid case %s unexpectedly produced a proof", item.Name)
			}
			invalidCount++
			caseResults = append(caseResults, map[string]any{
				"name": item.Name, "passed": true, "expectedValid": false,
				"constraintSolveRejected": true, "millis": elapsed,
				"scope": "constraint rejection by actual prover; no invalid proof was produced",
			})
			continue
		}
		if err != nil {
			return fmt.Errorf("valid case %s: %w", item.Name, err)
		}
		publicWitness, err := witness.Public()
		if err != nil {
			return err
		}
		if err := groth16.Verify(proof, vk, publicWitness, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
			return fmt.Errorf("case %s proof verification: %w", item.Name, err)
		}
		vec := publicWitness.Vector().(fr.Vector)
		proofBN := proof.(*backendbn254.Proof)
		caseDir := filepath.Join(outDir, item.Name)
		if err := os.MkdirAll(caseDir, 0o700); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(caseDir, "public.json"), publicStrings(vec)); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(caseDir, "proof.json"), map[string]any{
			"solidityProof": "0x" + hex.EncodeToString(proofBN.MarshalSolidity()),
			"publicSignals": publicStrings(vec), "commitmentCount": len(proofBN.Commitments),
		}); err != nil {
			return err
		}
		for i := range vec {
			changed := append(fr.Vector(nil), vec...)
			one := fr.One()
			changed[i].Add(&changed[i], &one)
			if backendbn254.Verify(proofBN, vk.(*backendbn254.VerifyingKey), changed, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
				return fmt.Errorf("case %s accepted changed outer public signal %d", item.Name, i)
			}
		}
		validCount++
		caseResults = append(caseResults, map[string]any{
			"name": item.Name, "passed": true, "expectedValid": true,
			"realProofVerified": true, "proveMillis": elapsed,
			"outerPublicTamperRejections": len(vec), "solidityProofBytes": len(proofBN.MarshalSolidity()),
		})
		if err := writeJSON(filepath.Join(outDir, "cases-summary.json"), caseResults); err != nil {
			return err
		}
	}
	return writeJSON(filepath.Join(outDir, "cases-summary.json"), map[string]any{
		"scope":               "one reused research circuit and local setup; not a production ceremony",
		"validProofsVerified": validCount, "invalidWitnessesRejected": invalidCount,
		"cases": caseResults,
	})
}
