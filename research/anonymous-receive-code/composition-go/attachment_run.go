package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
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

type attachmentManifest struct {
	ConstantsFile string `json:"constantsFile"`
	Cases         []struct {
		Name           string `json:"name"`
		Valid          bool   `json:"valid"`
		InputDir       string `json:"inputDir"`
		Mode           string `json:"mode"`
		ExtrasFile     string `json:"extrasFile"`
		AttachmentFile string `json:"attachmentFile"`
	} `json:"cases"`
}

func attachmentFileHash(file string) (string, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// runAttachmentManifest compiles one fixed-key circuit and produces real proofs
// for all valid fixtures. Invalid fixtures must fail the actual Groth16 prover
// constraint solver, not merely a JavaScript predicate. The setup is local and
// deliberately insecure; binaries remain in the selected temporary directory.
func runAttachmentManifest(manifestFile, reuseDir, outDir string, compileOnly bool) error {
	var manifest attachmentManifest
	if err := readJSON(manifestFile, &manifest); err != nil {
		return err
	}
	if len(manifest.Cases) == 0 || manifest.ConstantsFile == "" {
		return fmt.Errorf("attachment manifest requires constantsFile and cases")
	}
	if outDir == "" {
		var err error
		outDir, err = os.MkdirTemp("", "deepfamily-attachment-p0-")
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return err
	}
	if err := LoadPoseidonConstants(manifest.ConstantsFile); err != nil {
		return err
	}
	// LoadPoseidonConstants validates the shared arities; this circuit also
	// requires the exact arity-five and arity-eight parameter sets.
	for _, inputs := range []int{5, 8} {
		p, ok := nativePoseidonConstants[fmt.Sprint(inputs)]
		if !ok || len(p.C) != (inputs+1)*(8+poseidonPartialRounds(inputs)) || len(p.M) != inputs+1 {
			return fmt.Errorf("invalid attachment Poseidon constants arity %d", inputs)
		}
		for _, row := range p.M {
			if len(row) != inputs+1 {
				return fmt.Errorf("invalid attachment Poseidon matrix arity %d", inputs)
			}
		}
	}
	constantsHash, err := attachmentFileHash(manifest.ConstantsFile)
	if err != nil {
		return err
	}
	first := manifest.Cases[0]
	input, err := loadIssuance(first.InputDir, first.Mode)
	if err != nil {
		return err
	}
	fixedVKHash, err := attachmentFileHash(filepath.Join(first.InputDir, "research.vkey.json"))
	if err != nil {
		return err
	}
	fixedVK, err := stdgroth16.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](input.VK)
	if err != nil {
		return err
	}

	summary := map[string]any{
		"scope":          "research anonymous-code authentication, private counter state and Fund-specific budget attachment with bounded fixture paths; HPKE correctness not proved by circuit",
		"circuitVersion": attachmentCircuitVersion, "productionCeremony": false,
		"goVersion": runtime.Version(), "gnarkVersion": "v0.16.4", "gomaxprocs": runtime.GOMAXPROCS(0),
		"fixedIssuanceVK_SHA256": fixedVKHash, "poseidonConstants_SHA256": constantsHash,
		"publicSignals": attachmentPublicCount, "budgetIdentityEqualityRequired": false,
		"publicSignalNames": []string{"chainId", "consumer", "action", "messageId", "cipherLo", "cipherHi", "checkpointId", "stateRoot", "asOf", "expiresAt", "binding", "budgetPool", "budgetRoot", "relation"},
	}
	ccs := groth16.NewCS(ecc.BN254)
	pk := groth16.NewProvingKey(ecc.BN254)
	vk := groth16.NewVerifyingKey(ecc.BN254)
	if reuseDir != "" {
		var setupSummary map[string]any
		if err := readJSON(filepath.Join(reuseDir, "summary.json"), &setupSummary); err != nil {
			return err
		}
		for _, key := range []string{"circuitVersion", "fixedIssuanceVK_SHA256", "poseidonConstants_SHA256"} {
			if setupSummary[key] != summary[key] {
				return fmt.Errorf("attachment reused setup mismatch: %s", key)
			}
		}
		fmt.Println("Loading research attachment circuit and reusing its insecure local setup")
		if err := readBinary(filepath.Join(reuseDir, "attachment.r1cs"), ccs); err != nil {
			return err
		}
		if err := readBinary(filepath.Join(reuseDir, "attachment.pk"), pk); err != nil {
			return err
		}
		if err := readBinary(filepath.Join(reuseDir, "attachment.vk"), vk); err != nil {
			return err
		}
		summary["reusedSetup"] = reuseDir
	} else {
		circuit := &AttachmentCircuit{VK: fixedVK,
			InnerWitness: stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], issuancePublicCount)}}
		fmt.Println("Compiling private issuer, counter lookup and Fund-specific attachment circuit")
		started := time.Now()
		ccs, err = frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
		if err != nil {
			return err
		}
		summary["compileMillis"] = time.Since(started).Milliseconds()
		if err := writeBinary(filepath.Join(outDir, "attachment.r1cs"), ccs); err != nil {
			return err
		}
		summary["constraints"] = ccs.GetNbConstraints()
		summary["publicVariablesIncludingOne"] = ccs.GetNbPublicVariables()
		summary["secretVariables"] = ccs.GetNbSecretVariables()
		if err := writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
			return err
		}
		if compileOnly {
			return nil
		}
		fmt.Println("Running INSECURE local development attachment Groth16 setup")
		started = time.Now()
		pk, vk, err = groth16.Setup(ccs)
		if err != nil {
			return err
		}
		summary["setupMillis"] = time.Since(started).Milliseconds()
		if err := writeBinary(filepath.Join(outDir, "attachment.pk"), pk); err != nil {
			return err
		}
		if err := writeBinary(filepath.Join(outDir, "attachment.vk"), vk); err != nil {
			return err
		}
	}
	if ccs.GetNbPublicVariables() != attachmentPublicCount+1 {
		return fmt.Errorf("attachment public-variable count: got %d, want %d", ccs.GetNbPublicVariables(), attachmentPublicCount+1)
	}
	solFile, err := os.Create(filepath.Join(outDir, "AttachmentVerifier.sol"))
	if err != nil {
		return err
	}
	if err := vk.ExportSolidity(solFile); err != nil {
		solFile.Close()
		return err
	}
	if err := solFile.Close(); err != nil {
		return err
	}
	summary["constraints"] = ccs.GetNbConstraints()
	summary["publicVariablesIncludingOne"] = ccs.GetNbPublicVariables()
	summary["secretVariables"] = ccs.GetNbSecretVariables()
	if err := writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
		return err
	}
	var caseResults []map[string]any
	validCount, invalidCount, tamperCount := 0, 0, 0
	for _, item := range manifest.Cases {
		if item.Name == "" || filepath.Base(item.Name) != item.Name || item.Name == "." || item.Name == ".." {
			return fmt.Errorf("invalid attachment case name")
		}
		fmt.Println("Attachment case:", item.Name)
		input, err := loadIssuance(item.InputDir, item.Mode)
		if err != nil {
			return err
		}
		inputVKHash, err := attachmentFileHash(filepath.Join(item.InputDir, "research.vkey.json"))
		if err != nil {
			return err
		}
		if inputVKHash != fixedVKHash {
			return fmt.Errorf("attachment case %s has different fixed issuer VK", item.Name)
		}
		if err := backendbn254.Verify(input.Proof, input.VK, input.Public); err != nil {
			return fmt.Errorf("attachment case %s input issuer proof invalid: %w", item.Name, err)
		}
		extras, err := LoadNativeExtras(item.ExtrasFile, input.PublicStrings)
		if err != nil {
			return err
		}
		attachment, err := LoadAttachmentExtras(item.AttachmentFile)
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
		assignment := &AttachmentCircuit{VK: fixedVK, Proof: proofValue, InnerWitness: innerValue, Extras: extras, Attachment: attachment}
		witness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
		if err != nil {
			return fmt.Errorf("attachment case %s witness: %w", item.Name, err)
		}
		started := time.Now()
		proof, err := groth16.Prove(ccs, pk, witness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
		elapsed := time.Since(started).Milliseconds()
		if !item.Valid {
			if err == nil {
				return fmt.Errorf("invalid attachment case %s unexpectedly produced a proof", item.Name)
			}
			invalidCount++
			caseResults = append(caseResults, map[string]any{"name": item.Name, "expectedValid": false,
				"passed": true, "constraintSolveRejected": true, "millis": elapsed,
				"scope": "actual prover constraint rejection; no invalid proof produced"})
		} else {
			if err != nil {
				return fmt.Errorf("valid attachment case %s: %w", item.Name, err)
			}
			publicWitness, err := witness.Public()
			if err != nil {
				return err
			}
			if err := groth16.Verify(proof, vk, publicWitness, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
				return fmt.Errorf("attachment case %s real proof verification: %w", item.Name, err)
			}
			vec := publicWitness.Vector().(fr.Vector)
			if len(vec) != attachmentPublicCount {
				return fmt.Errorf("attachment public signal count mismatch")
			}
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
					return fmt.Errorf("attachment case %s accepted changed public signal %d", item.Name, i)
				}
			}
			tamperCount += len(vec)
			validCount++
			caseResults = append(caseResults, map[string]any{"name": item.Name, "expectedValid": true,
				"passed": true, "realProofVerified": true, "proveMillis": elapsed,
				"outerPublicTamperRejections": len(vec), "solidityProofBytes": len(proofBN.MarshalSolidity())})
		}
		if err := writeJSON(filepath.Join(outDir, "cases-summary.json"), map[string]any{
			"validProofsVerified": validCount, "invalidWitnessesRejected": invalidCount,
			"outerPublicTamperRejections": tamperCount, "cases": caseResults,
		}); err != nil {
			return err
		}
	}
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	summary["goHeapSysBytes"] = memory.HeapSys
	summary["goTotalAllocBytes"] = memory.TotalAlloc
	summary["validProofsVerified"] = validCount
	summary["invalidWitnessesRejected"] = invalidCount
	summary["outerPublicTamperRejections"] = tamperCount
	summary["verified"] = true
	return writeJSON(filepath.Join(outDir, "summary.json"), summary)
}
