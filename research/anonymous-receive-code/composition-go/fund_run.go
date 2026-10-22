package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

type fundCase struct {
	Name        string `json:"name"`
	InputDir    string `json:"inputDir"`
	Mode        string `json:"mode"`
	WitnessFile string `json:"witnessFile"`
	ExtrasFile  string `json:"extrasFile"`
	Valid       bool   `json:"valid"`
}

type fundManifest struct {
	RelationFile      string     `json:"relationFile"`
	ConstantsFile     string     `json:"constantsFile"`
	PublicSignalNames []string   `json:"publicSignalNames"`
	Cases             []fundCase `json:"cases"`
}

func fileSHA256(file string) (string, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:]), nil
}

func fundAssignment(item fundCase, relation *fundRelation) (*FundCircuit, *IssuanceInput, error) {
	input, err := loadIssuanceCount(item.InputDir, item.Mode, fundIssuancePublicCount)
	if err != nil {
		return nil, nil, err
	}
	if err := backendbn254.Verify(input.Proof, input.VK, input.Public); err != nil {
		return nil, nil, fmt.Errorf("invalid native disclosure issuer proof: %w", err)
	}
	normalized := append([]string(nil), input.PublicStrings[:3]...)
	normalized = append(normalized, input.PublicStrings[4:]...)
	extras, err := LoadNativeExtras(item.ExtrasFile, normalized)
	if err != nil {
		return nil, nil, err
	}
	var wires []string
	if err := readJSON(item.WitnessFile, &wires); err != nil {
		return nil, nil, err
	}
	if len(wires) != relation.NVars {
		return nil, nil, fmt.Errorf("wrong Fund witness wire count")
	}
	wireValues := make([]frontend.Variable, len(wires))
	for i, wire := range wires {
		if _, err := canonicalDecimal(wire, fr.Modulus()); err != nil {
			return nil, nil, fmt.Errorf("Fund wire %d: %w", i, err)
		}
		wireValues[i] = wire
	}
	proofValue, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](input.Proof)
	if err != nil {
		return nil, nil, err
	}
	innerValue := stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], fundIssuancePublicCount)}
	for i := range input.Public {
		innerValue.Public[i] = sw_bn254.NewScalar(input.Public[i])
	}
	return &FundCircuit{Proof: proofValue, InnerWitness: innerValue, Extras: extras, Wires: wireValues,
		FundPublic: append([]frontend.Variable(nil), wireValues[1:relation.NPublic+1]...), Relation: relation}, input, nil
}

// runFundManifest either compiles one immutable circuit and performs a local
// development setup, or loads that exact circuit/key pair. Every manifest case
// uses the same fixed issuer VK and original Fund matrices.
func runFundManifest(manifestFile, reuseDir, outDir string, compileOnly bool) error {
	var manifest fundManifest
	if err := readJSON(manifestFile, &manifest); err != nil {
		return err
	}
	if len(manifest.Cases) == 0 || !manifest.Cases[0].Valid {
		return fmt.Errorf("Fund manifest must start with a valid case")
	}
	relation, err := loadFundRelation(manifest.RelationFile)
	if err != nil {
		return err
	}
	if len(manifest.PublicSignalNames) != 11+relation.NPublic {
		return fmt.Errorf("wrong Fund public signal manifest shape")
	}
	if err := LoadPoseidonConstants(manifest.ConstantsFile); err != nil {
		return err
	}
	if outDir == "" {
		outDir, err = os.MkdirTemp("", "deepfamily-fund-outer-")
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return err
	}
	fmt.Println("RESEARCH ONLY: Fund relation composition; insecure local setup; artifacts:", outDir)
	assignment, input, err := fundAssignment(manifest.Cases[0], relation)
	if err != nil {
		return err
	}
	issuerHash, err := fileSHA256(filepath.Join(manifest.Cases[0].InputDir, "research.vkey.json"))
	if err != nil {
		return err
	}
	relationHash, err := fileSHA256(manifest.RelationFile)
	if err != nil {
		return err
	}
	summary := map[string]any{"scope": "fixed identity-disclosing issuer recursion + full original Fund relation + private counter lookup and authenticated expiry; synthetic fixtures",
		"gnarkVersion": "v0.16.4", "goVersion": runtime.Version(), "productionCeremony": false,
		"fixedIssuanceVK_SHA256": issuerHash, "fixedFundModel_SHA256": relationHash, "sourceFundR1CS_SHA256": relation.SourceR1CSSHA256,
		"originalFundConstraints": relation.NConstraints, "originalFundWires": relation.NVars, "originalFundPublicSignals": relation.NPublic,
		"authenticatedViewingKeyBoundToBudget": relation.ViewFields,
		"publicSignalNames":                    manifest.PublicSignalNames, "innerPublicSignalsRemainPrivate": true}
	if relation.ViewFields {
		summary["scope"] = "fixed identity-disclosing issuer recursion + proposed viewing-key-bound and producer-domain-separated Fund relation + private counter lookup and authenticated expiry; synthetic fixtures"
	}
	for i := range input.Public {
		changed := append(fr.Vector(nil), input.Public...)
		one := fr.One()
		changed[i].Add(&changed[i], &one)
		if backendbn254.Verify(input.Proof, input.VK, changed) == nil {
			return fmt.Errorf("native issuer accepted tamper at %d", i)
		}
	}
	summary["nativeIssuerPublicTamperChecks"] = fundIssuancePublicCount
	ccs := groth16.NewCS(ecc.BN254)
	pk := groth16.NewProvingKey(ecc.BN254)
	vk := groth16.NewVerifyingKey(ecc.BN254)
	if reuseDir != "" {
		var previous map[string]any
		if err := readJSON(filepath.Join(reuseDir, "summary.json"), &previous); err != nil {
			return err
		}
		if previous["fixedIssuanceVK_SHA256"] != issuerHash || previous["fixedFundModel_SHA256"] != relationHash {
			return fmt.Errorf("reused circuit has different fixed issuer or Fund relation")
		}
		if err := readBinary(filepath.Join(reuseDir, "composition.r1cs"), ccs); err != nil {
			return err
		}
		if err := readBinary(filepath.Join(reuseDir, "composition.pk"), pk); err != nil {
			return err
		}
		if err := readBinary(filepath.Join(reuseDir, "composition.vk"), vk); err != nil {
			return err
		}
		summary["reusedSetup"] = reuseDir
	} else {
		fixedVK, err := stdgroth16.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](input.VK)
		if err != nil {
			return err
		}
		circuit := &FundCircuit{VK: fixedVK, Relation: relation, Wires: make([]frontend.Variable, relation.NVars), FundPublic: make([]frontend.Variable, relation.NPublic),
			InnerWitness: stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], fundIssuancePublicCount)}}
		fmt.Println("Compile immutable disclosure issuer + original Fund matrices")
		started := time.Now()
		ccs, err = frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
		if err != nil {
			return err
		}
		summary["compileMillis"] = time.Since(started).Milliseconds()
		summary["constraints"] = ccs.GetNbConstraints()
		summary["publicVariablesIncludingOne"] = ccs.GetNbPublicVariables()
		summary["secretVariables"] = ccs.GetNbSecretVariables()
		if err := writeBinary(filepath.Join(outDir, "composition.r1cs"), ccs); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
			return err
		}
		if compileOnly {
			return nil
		}
		fmt.Println("INSECURE local development setup for Fund circuit")
		started = time.Now()
		pk, vk, err = groth16.Setup(ccs)
		if err != nil {
			return err
		}
		summary["setupMillis"] = time.Since(started).Milliseconds()
		if err := writeBinary(filepath.Join(outDir, "composition.pk"), pk); err != nil {
			return err
		}
		if err := writeBinary(filepath.Join(outDir, "composition.vk"), vk); err != nil {
			return err
		}
	}
	summary["constraints"] = ccs.GetNbConstraints()
	summary["publicVariablesIncludingOne"] = ccs.GetNbPublicVariables()
	summary["secretVariables"] = ccs.GetNbSecretVariables()
	f, err := os.Create(filepath.Join(outDir, "FundCompositionVerifier.sol"))
	if err != nil {
		return err
	}
	if err := vk.ExportSolidity(f); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	// Save setup hashes before the cases, permitting an interrupted run to reuse
	// this exact setup without a repeated ceremony.
	if err := writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
		return err
	}
	var results []map[string]any
	validCount, invalidCount, tamperCount := 0, 0, 0
	for _, item := range manifest.Cases {
		if item.Name == "" || filepath.Base(item.Name) != item.Name {
			return fmt.Errorf("invalid Fund case name")
		}
		fmt.Println("Fund case:", item.Name)
		assignment, input, err = fundAssignment(item, relation)
		if err != nil {
			return fmt.Errorf("%s: %w", item.Name, err)
		}
		caseHash, err := fileSHA256(filepath.Join(item.InputDir, "research.vkey.json"))
		if err != nil {
			return err
		}
		if caseHash != issuerHash {
			return fmt.Errorf("case %s has different fixed issuer", item.Name)
		}
		witness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
		if err != nil {
			return err
		}
		started := time.Now()
		proof, err := groth16.Prove(ccs, pk, witness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
		elapsed := time.Since(started).Milliseconds()
		if !item.Valid {
			if err == nil {
				return fmt.Errorf("invalid Fund case %s generated a proof", item.Name)
			}
			if !strings.Contains(err.Error(), "constraint") {
				return fmt.Errorf("negative Fund case %s failed outside constraints: %w", item.Name, err)
			}
			invalidCount++
			results = append(results, map[string]any{"name": item.Name, "passed": true, "expectedValid": false, "constraintSolveRejected": true, "millis": elapsed})
			if err := writeJSON(filepath.Join(outDir, "cases-summary.json"), results); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return fmt.Errorf("valid Fund case %s: %w", item.Name, err)
		}
		publicWitness, err := witness.Public()
		if err != nil {
			return err
		}
		if err := groth16.Verify(proof, vk, publicWitness, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
			return err
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
		if err := writeJSON(filepath.Join(caseDir, "proof.json"), map[string]any{"solidityProof": "0x" + hex.EncodeToString(proofBN.MarshalSolidity()), "publicSignals": publicStrings(vec), "commitmentCount": len(proofBN.Commitments)}); err != nil {
			return err
		}
		for i := range vec {
			changed := append(fr.Vector(nil), vec...)
			one := fr.One()
			changed[i].Add(&changed[i], &one)
			if backendbn254.Verify(proofBN, vk.(*backendbn254.VerifyingKey), changed, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
				return fmt.Errorf("Fund case %s accepted public tamper %d", item.Name, i)
			}
			tamperCount++
		}
		validCount++
		results = append(results, map[string]any{"name": item.Name, "passed": true, "expectedValid": true, "realProofVerified": true, "proveMillis": elapsed, "outerPublicTamperRejections": len(vec), "solidityProofBytes": len(proofBN.MarshalSolidity())})
		if err := writeJSON(filepath.Join(outDir, "cases-summary.json"), results); err != nil {
			return err
		}
	}
	// Check all twelve private issuer signals using the actual recursive prover,
	// separately from the six valid-issuer cross-protocol mismatch fixtures.
	assignment, input, err = fundAssignment(manifest.Cases[0], relation)
	if err != nil {
		return err
	}
	for i := range input.Public {
		bad := *assignment
		bad.InnerWitness.Public = append([]emulated.Element[sw_bn254.ScalarField](nil), assignment.InnerWitness.Public...)
		changed := input.Public[i]
		one := fr.One()
		changed.Add(&changed, &one)
		bad.InnerWitness.Public[i] = sw_bn254.NewScalar(changed)
		witness, err := frontend.NewWitness(&bad, ecc.BN254.ScalarField())
		if err != nil {
			return err
		}
		if _, err = groth16.Prove(ccs, pk, witness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16)); err == nil || !strings.Contains(err.Error(), "constraint") {
			return fmt.Errorf("private disclosure issuer tamper %d was not rejected by constraints: %v", i, err)
		}
	}
	summary["validProofsVerified"] = validCount
	summary["invalidWitnessesRejected"] = invalidCount
	summary["outerPublicTamperRejections"] = tamperCount
	summary["privateIssuerTamperConstraintRejections"] = fundIssuancePublicCount
	summary["verified"] = true
	summary["solidityProofBytes"] = 384
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	summary["goHeapSysBytes"] = memory.HeapSys
	summary["goTotalAllocBytes"] = memory.TotalAlloc
	if err := writeJSON(filepath.Join(outDir, "cases-summary.json"), map[string]any{"validProofsVerified": validCount, "invalidWitnessesRejected": invalidCount, "cases": results}); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
		return err
	}
	fmt.Printf("SUCCESS Fund: %d constraints, %d public signals; %d valid, %d invalid, %d public tamper checks\n", ccs.GetNbConstraints(), ccs.GetNbPublicVariables()-1, validCount, invalidCount, tamperCount)
	return nil
}
