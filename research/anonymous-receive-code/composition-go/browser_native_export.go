//go:build !js || !wasm

package main

// Export only existing synthetic research fixtures. No setup, compilation or
// proof generation is performed here; the browser receives serialized witness
// values so its measured work is actual Groth16 proving and verification.

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

func exportBrowserWitness(fundManifestFile, attachmentManifestFile, caseName, outDir string) error {
	if (fundManifestFile == "") == (attachmentManifestFile == "") || caseName == "" {
		return fmt.Errorf("choose exactly one Fund or attachment manifest and a synthetic fixture case")
	}
	if outDir == "" {
		var err error
		outDir, err = os.MkdirTemp("", "deepfamily-browser-witness-")
		if err != nil {
			return err
		}
	}
	if err := os.MkdirAll(outDir, 0o700); err != nil {
		return err
	}
	var assignment frontend.Circuit
	kind := "attachment"
	if fundManifestFile != "" {
		kind = "fund"
		var m fundManifest
		if err := readJSON(fundManifestFile, &m); err != nil {
			return err
		}
		relation, err := loadFundRelation(m.RelationFile)
		if err != nil {
			return err
		}
		for _, item := range m.Cases {
			if item.Name == caseName && item.Valid {
				a, _, err := fundAssignment(item, relation)
				if err != nil {
					return err
				}
				assignment = a
				break
			}
		}
	} else {
		var m attachmentManifest
		if err := readJSON(attachmentManifestFile, &m); err != nil {
			return err
		}
		for _, item := range m.Cases {
			if item.Name != caseName || !item.Valid {
				continue
			}
			input, err := loadIssuance(item.InputDir, item.Mode)
			if err != nil {
				return err
			}
			if err := backendbn254.Verify(input.Proof, input.VK, input.Public); err != nil {
				return err
			}
			extras, err := LoadNativeExtras(item.ExtrasFile, input.PublicStrings)
			if err != nil {
				return err
			}
			attached, err := LoadAttachmentExtras(item.AttachmentFile)
			if err != nil {
				return err
			}
			proof, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](input.Proof)
			if err != nil {
				return err
			}
			inner := stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], issuancePublicCount)}
			for i := range input.Public {
				inner.Public[i] = sw_bn254.NewScalar(input.Public[i])
			}
			assignment = &AttachmentCircuit{Proof: proof, InnerWitness: inner, Extras: extras, Attachment: attached}
			break
		}
	}
	if assignment == nil {
		return fmt.Errorf("valid synthetic %s case %q not found", kind, caseName)
	}
	w, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return err
	}
	if err := writeBinary(filepath.Join(outDir, "witness.bin"), w); err != nil {
		return err
	}
	public, err := w.Public()
	if err != nil {
		return err
	}
	if err := writeBinary(filepath.Join(outDir, "public-witness.bin"), public); err != nil {
		return err
	}
	vec := public.Vector().(fr.Vector)
	if err := writeJSON(filepath.Join(outDir, "public.json"), publicStrings(vec)); err != nil {
		return err
	}
	stat, err := os.Stat(filepath.Join(outDir, "witness.bin"))
	if err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(outDir, "browser-input.json"), map[string]any{
		"scope": "synthetic research witness export only; browser must actually Prove and Verify",
		"kind":  kind, "case": caseName, "witnessBytes": stat.Size(), "publicSignals": len(vec), "productionSecrets": false,
	}); err != nil {
		return err
	}
	fmt.Println("Exported synthetic browser witness:", outDir)
	return nil
}
