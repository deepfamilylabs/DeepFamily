package main

import (
	"encoding/hex"
	"fmt"
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
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type transferAuth struct {
	InputDir   string `json:"inputDir"`
	Mode       string `json:"mode"`
	ExtrasFile string `json:"extrasFile"`
}
type transferCase struct {
	Name        string         `json:"name"`
	Valid       bool           `json:"valid"`
	Shape       string         `json:"shape"`
	Slot        string         `json:"slot"`
	WitnessFile string         `json:"witnessFile"`
	Auth        []transferAuth `json:"auth"`
}
type transferManifest struct {
	Shape         string         `json:"shape"`
	RelationFile  string         `json:"relationFile"`
	ConstantsFile string         `json:"constantsFile"`
	Cases         []transferCase `json:"cases"`
}

func transferCount(shape string) (int, int, error) {
	switch shape {
	case "self":
		return 0, 30, nil
	case "single":
		return 1, 42, nil
	case "dual":
		return 2, 52, nil
	}
	return 0, 0, fmt.Errorf("unknown Transfer shape")
}
func transferAssignment(item transferCase, r *transferRelation) (frontend.Circuit, string, error) {
	var strings []string
	if err := readJSON(item.WitnessFile, &strings); err != nil {
		return nil, "", err
	}
	if len(strings) != r.NVars {
		return nil, "", fmt.Errorf("Transfer wire count mismatch")
	}
	t := transferStatement{Relation: r, Public: make([]frontend.Variable, 30), Wires: make([]frontend.Variable, r.NVars)}
	for i, s := range strings {
		n, err := canonicalDecimal(s, fr.Modulus())
		if err != nil {
			return nil, "", err
		}
		t.Wires[i] = n
	}
	for i := range t.Public {
		t.Public[i] = t.Wires[i+1]
	}
	count, _, err := transferCount(item.Shape)
	if err != nil {
		return nil, "", err
	}
	if len(item.Auth) != count {
		return nil, "", fmt.Errorf("Transfer auth count mismatch")
	}
	if count == 0 {
		return &SelfTransferCircuit{Transfer: t}, "", nil
	}
	var proofs [2]stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	var inners [2]stdgroth16.Witness[sw_bn254.ScalarField]
	var extras [2]NativeExtras
	var vk stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl]
	fixedHash := ""
	for i, a := range item.Auth {
		input, err := loadIssuance(a.InputDir, a.Mode)
		if err != nil {
			return nil, "", err
		}
		hash, err := attachmentFileHash(filepath.Join(a.InputDir, "research.vkey.json"))
		if err != nil {
			return nil, "", err
		}
		if i > 0 && hash != fixedHash {
			return nil, "", fmt.Errorf("different Transfer issuer VK")
		}
		fixedHash = hash
		if err = backendbn254.Verify(input.Proof, input.VK, input.Public); err != nil {
			return nil, "", fmt.Errorf("native issuer proof invalid: %w", err)
		}
		vk, err = stdgroth16.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](input.VK)
		if err != nil {
			return nil, "", err
		}
		proofs[i], err = stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](input.Proof)
		if err != nil {
			return nil, "", err
		}
		inners[i].Public = make([]emulated.Element[sw_bn254.ScalarField], issuancePublicCount)
		for j := range input.Public {
			inners[i].Public[j] = sw_bn254.NewScalar(input.Public[j])
		}
		extras[i], err = LoadNativeExtras(a.ExtrasFile, input.PublicStrings)
		if err != nil {
			return nil, "", err
		}
	}
	if count == 1 {
		return &SingleTransferCircuit{Transfer: t, Slot: item.Slot, Extras: extras[0], Proof: proofs[0], Inner: inners[0], VK: vk}, fixedHash, nil
	}
	return &DualTransferCircuit{Transfer: t, Extras: extras, Proofs: proofs, Inner: inners, VK: vk}, fixedHash, nil
}
func runTransferManifest(manifestFile, reuseDir, outDir string, compileOnly bool) error {
	var m transferManifest
	if err := readJSON(manifestFile, &m); err != nil {
		return err
	}
	count, publicCount, err := transferCount(m.Shape)
	if err != nil {
		return err
	}
	if len(m.Cases) == 0 {
		return fmt.Errorf("Transfer manifest has no cases")
	}
	if err = LoadPoseidonConstants(m.ConstantsFile); err != nil {
		return err
	}
	var r transferRelation
	if err = readJSON(m.RelationFile, &r); err != nil {
		return err
	}
	if r.Schema != "fixed-transfer-r1cs-v1" || r.Prime != fr.Modulus().String() || r.NPublic != 30 || r.NConstraints != len(r.Constraints) || r.NVars < 31 {
		return fmt.Errorf("invalid fixed Transfer relation")
	}
	for _, key := range []string{"inputOwnerSecret", "outputOwner0", "outputOwner1"} {
		i := r.WireMap[key]
		if i <= 0 || i >= r.NVars {
			return fmt.Errorf("invalid Transfer wire map")
		}
	}
	for _, row := range r.Constraints {
		for _, lc := range row {
			for _, term := range lc {
				if term.I < 0 || term.I >= r.NVars {
					return fmt.Errorf("Transfer matrix index out of range")
				}
				if _, err = canonicalDecimal(term.C, fr.Modulus()); err != nil {
					return err
				}
			}
		}
	}
	assignment, fixedHash, err := transferAssignment(m.Cases[0], &r)
	if err != nil {
		return err
	}
	if outDir == "" {
		outDir, err = os.MkdirTemp("", "deepfamily-transfer-outer-")
		if err != nil {
			return err
		}
	}
	if err = os.MkdirAll(outDir, 0700); err != nil {
		return err
	}
	relationHash, err := attachmentFileHash(m.RelationFile)
	if err != nil {
		return err
	}
	constantsHash, err := attachmentFileHash(m.ConstantsFile)
	if err != nil {
		return err
	}
	summary := map[string]any{"scope": "research-only full PrivateTransfer relation plus per-external-output anonymous authorization; public compile-time shape leaks external-recipient count", "shape": m.Shape, "recursiveIssuanceVerifiers": count, "publicSignals": publicCount, "fixedIssuanceVK_SHA256": fixedHash, "relationSHA256": relationHash, "poseidonConstants_SHA256": constantsHash, "goVersion": runtime.Version(), "gnarkVersion": "v0.16.4", "productionCeremony": false}
	ccs := groth16.NewCS(ecc.BN254)
	pk := groth16.NewProvingKey(ecc.BN254)
	vk := groth16.NewVerifyingKey(ecc.BN254)
	if reuseDir != "" {
		var old map[string]any
		if err = readJSON(filepath.Join(reuseDir, "summary.json"), &old); err != nil {
			return err
		}
		for _, key := range []string{"shape", "fixedIssuanceVK_SHA256", "relationSHA256", "poseidonConstants_SHA256"} {
			if old[key] != summary[key] {
				return fmt.Errorf("Transfer reused setup mismatch %s", key)
			}
		}
		if err = readBinary(filepath.Join(reuseDir, "transfer.r1cs"), ccs); err != nil {
			return err
		}
		if err = readBinary(filepath.Join(reuseDir, "transfer.pk"), pk); err != nil {
			return err
		}
		if err = readBinary(filepath.Join(reuseDir, "transfer.vk"), vk); err != nil {
			return err
		}
		summary["reusedSetup"] = reuseDir
	} else {
		start := time.Now()
		ccs, err = frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, assignment)
		if err != nil {
			return err
		}
		summary["compileMillis"] = time.Since(start).Milliseconds()
		summary["constraints"] = ccs.GetNbConstraints()
		summary["secretVariables"] = ccs.GetNbSecretVariables()
		if err = writeBinary(filepath.Join(outDir, "transfer.r1cs"), ccs); err != nil {
			return err
		}
		if err = writeJSON(filepath.Join(outDir, "summary.json"), summary); err != nil {
			return err
		}
		if compileOnly {
			return nil
		}
		fmt.Println("RESEARCH ONLY insecure Transfer setup", m.Shape, ccs.GetNbConstraints())
		start = time.Now()
		pk, vk, err = groth16.Setup(ccs)
		if err != nil {
			return err
		}
		summary["setupMillis"] = time.Since(start).Milliseconds()
		if err = writeBinary(filepath.Join(outDir, "transfer.pk"), pk); err != nil {
			return err
		}
		if err = writeBinary(filepath.Join(outDir, "transfer.vk"), vk); err != nil {
			return err
		}
	}
	if ccs.GetNbPublicVariables() != publicCount+1 {
		return fmt.Errorf("Transfer public count mismatch: %d", ccs.GetNbPublicVariables())
	}
	name := map[string]string{"self": "SelfTransferVerifier.sol", "single": "SingleTransferVerifier.sol", "dual": "DualTransferVerifier.sol"}[m.Shape]
	sol, err := os.Create(filepath.Join(outDir, name))
	if err != nil {
		return err
	}
	if err = vk.ExportSolidity(sol); err != nil {
		sol.Close()
		return err
	}
	if err = sol.Close(); err != nil {
		return err
	}
	summary["constraints"] = ccs.GetNbConstraints()
	summary["secretVariables"] = ccs.GetNbSecretVariables()
	var results []map[string]any
	valid, invalid, tampers := 0, 0, 0
	for _, item := range m.Cases {
		if item.Shape != m.Shape || item.Name == "" || filepath.Base(item.Name) != item.Name {
			return fmt.Errorf("Transfer case mismatch")
		}
		assignment, hash, err := transferAssignment(item, &r)
		if err != nil {
			return err
		}
		if hash != fixedHash {
			return fmt.Errorf("Transfer case changed issuer VK")
		}
		witness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
		if err != nil {
			return err
		}
		start := time.Now()
		proof, err := groth16.Prove(ccs, pk, witness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
		millis := time.Since(start).Milliseconds()
		if !item.Valid {
			if err == nil {
				return fmt.Errorf("invalid Transfer case %s produced a proof", item.Name)
			}
			if !strings.Contains(err.Error(), "constraint") {
				return fmt.Errorf("negative Transfer case %s failed outside constraints: %w", item.Name, err)
			}
			errorSummary := err.Error()
			if len(errorSummary) > 700 {
				errorSummary = errorSummary[:700]
			}
			invalid++
			results = append(results, map[string]any{"name": item.Name, "expectedValid": false, "passed": true, "constraintSolveRejected": true, "errorSummary": errorSummary, "millis": millis})
		} else {
			if err != nil {
				return fmt.Errorf("Transfer case %s: %w", item.Name, err)
			}
			public, err := witness.Public()
			if err != nil {
				return err
			}
			if err = groth16.Verify(proof, vk, public, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)); err != nil {
				return err
			}
			vec := public.Vector().(fr.Vector)
			if len(vec) != publicCount {
				return fmt.Errorf("Transfer proof public length mismatch")
			}
			p := proof.(*backendbn254.Proof)
			dir := filepath.Join(outDir, item.Name)
			if err = os.MkdirAll(dir, 0700); err != nil {
				return err
			}
			if err = writeJSON(filepath.Join(dir, "proof.json"), map[string]any{"solidityProof": "0x" + hex.EncodeToString(p.MarshalSolidity()), "publicSignals": publicStrings(vec), "commitmentCount": len(p.Commitments)}); err != nil {
				return err
			}
			if err = writeJSON(filepath.Join(dir, "public.json"), publicStrings(vec)); err != nil {
				return err
			}
			for i := range vec {
				changed := append(fr.Vector(nil), vec...)
				one := fr.One()
				changed[i].Add(&changed[i], &one)
				if backendbn254.Verify(p, vk.(*backendbn254.VerifyingKey), changed, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
					return fmt.Errorf("Transfer public tamper accepted")
				}
			}
			valid++
			tampers += len(vec)
			results = append(results, map[string]any{"name": item.Name, "expectedValid": true, "passed": true, "proveMillis": millis, "realProofVerified": true, "solidityProofBytes": len(p.MarshalSolidity()), "outerPublicTamperRejections": len(vec)})
		}
		if err = writeJSON(filepath.Join(outDir, "cases-summary.json"), map[string]any{"validProofsVerified": valid, "invalidWitnessesRejected": invalid, "outerPublicTamperRejections": tampers, "cases": results}); err != nil {
			return err
		}
	}
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	summary["goHeapSysBytes"] = mem.HeapSys
	summary["goTotalAllocBytes"] = mem.TotalAlloc
	summary["validProofsVerified"] = valid
	summary["invalidWitnessesRejected"] = invalid
	summary["outerPublicTamperRejections"] = tampers
	summary["verified"] = true
	return writeJSON(filepath.Join(outDir, "summary.json"), summary)
}
