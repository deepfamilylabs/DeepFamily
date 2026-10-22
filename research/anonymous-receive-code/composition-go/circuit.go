package main

import (
	"fmt"

	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

// MainCircuit privately authenticates the complete eleven-signal receive-code
// issuance statement, then joins the native application constraints. VK is a
// compile-time constant; it MUST NOT become a prover-selected witness.
// This is an isolated research circuit, not a production protocol artifact.
type MainCircuit struct {
	Proof        stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	InnerWitness stdgroth16.Witness[sw_bn254.ScalarField]
	VK           stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
	Extras       NativeExtras
}

func (c *MainCircuit) Define(api frontend.API) error {
	verifier, err := stdgroth16.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return fmt.Errorf("create private issuance verifier: %w", err)
	}
	if err := verifier.AssertProof(c.VK, c.Proof, c.InnerWitness, stdgroth16.WithSubgroupCheck()); err != nil {
		return fmt.Errorf("verify private issuance: %w", err)
	}
	return AttachNative(api, &c.Extras, c.InnerWitness.Public)
}
