package main

// RESEARCH ONLY. The original Circom Fund relation is embedded as constant
// BN254 scalar-field R1CS matrices. A prover supplies its wires, never matrices
// or verifying keys. This avoids adding a second recursive pairing verifier.

import (
	"fmt"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

const fundIssuancePublicCount = 12

type fundTerm struct {
	I int    `json:"i"`
	C string `json:"c"`
}

type fundRelation struct {
	Schema           string          `json:"schema"`
	Prime            string          `json:"prime"`
	NVars            int             `json:"nVars"`
	NPublic          int             `json:"nPublic"`
	NConstraints     int             `json:"nConstraints"`
	SourceR1CSSHA256 string          `json:"sourceR1csSHA256"`
	PublicNames      []string        `json:"publicNames"`
	WireMap          map[string]int  `json:"wireMap"`
	ViewFields       bool            `json:"viewFields"`
	Constraints      [][3][]fundTerm `json:"constraints"`
}

func loadFundRelation(file string) (*fundRelation, error) {
	var r fundRelation
	if err := readJSON(file, &r); err != nil {
		return nil, err
	}
	if r.Schema != "fixed-circom-r1cs-v1" || r.Prime != fr.Modulus().String() ||
		r.NVars <= r.NPublic+1 || r.NPublic < 1 || r.NConstraints != len(r.Constraints) ||
		len(r.PublicNames) != r.NPublic || len(r.SourceR1CSSHA256) != 64 {
		return nil, fmt.Errorf("invalid fixed Fund relation metadata")
	}
	for _, name := range []string{"chainId", "pool", "fundMode", "budgetKind", "heirIdentityCommitment", "heirOwnerCommitment", "keyMode"} {
		i, ok := r.WireMap[name]
		if !ok || i <= 0 || i >= r.NVars {
			return nil, fmt.Errorf("invalid Fund wire index for %s", name)
		}
	}
	lo, hasLo := r.WireMap["heirViewKeyLo"]
	hi, hasHi := r.WireMap["heirViewKeyHi"]
	if hasLo != hasHi || r.ViewFields != (hasLo && hasHi) {
		return nil, fmt.Errorf("Fund viewing-key fields must both exist and agree with viewFields metadata")
	}
	if r.ViewFields && (lo <= 0 || hi <= 0 || lo >= r.NVars || hi >= r.NVars || lo == hi) {
		return nil, fmt.Errorf("invalid Fund viewing-key wire indices")
	}
	for _, row := range r.Constraints {
		for _, lc := range row {
			for _, term := range lc {
				if term.I < 0 || term.I >= r.NVars {
					return nil, fmt.Errorf("Fund matrix wire out of range")
				}
				if _, err := canonicalDecimal(term.C, fr.Modulus()); err != nil {
					return nil, fmt.Errorf("Fund matrix coefficient: %w", err)
				}
			}
		}
	}
	return &r, nil
}

// Public order: the eleven NativeExtras fields, then the original Fund public
// wires in Circom order. The authenticated identity, R, recipient keys, code
// counter, issuer proof and every original private Fund wire remain private.
type FundCircuit struct {
	Proof        stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	InnerWitness stdgroth16.Witness[sw_bn254.ScalarField]
	VK           stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
	Extras       NativeExtras
	FundPublic   []frontend.Variable `gnark:",public"`
	Wires        []frontend.Variable
	Relation     *fundRelation `gnark:"-"`
}

func (c *FundCircuit) Define(api frontend.API) error {
	if c.Relation == nil || len(c.Wires) != c.Relation.NVars || len(c.FundPublic) != c.Relation.NPublic || len(c.InnerWitness.Public) != fundIssuancePublicCount {
		return fmt.Errorf("invalid fixed Fund circuit shape")
	}
	verifier, err := stdgroth16.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return err
	}
	if err := verifier.AssertProof(c.VK, c.Proof, c.InnerWitness, stdgroth16.WithSubgroupCheck()); err != nil {
		return err
	}
	// Normalize [R,counter,T,I,owner,lo,hi,mode,suites...] to the anonymous
	// eleven-signal layout solely for the shared native state/expiry constraints.
	issue := c.InnerWitness.Public
	normalized := make([]emulated.Element[sw_bn254.ScalarField], 0, issuancePublicCount)
	normalized = append(normalized, issue[:3]...)
	normalized = append(normalized, issue[4:]...)
	if err := AttachNative(api, &c.Extras, normalized); err != nil {
		return err
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return err
	}
	toNative := func(i int) frontend.Variable { return api.FromBinary(f.ToBitsCanonical(&issue[i])...) }
	api.AssertIsEqual(c.Wires[0], 1)
	for i, value := range c.FundPublic {
		api.AssertIsEqual(value, c.Wires[i+1])
	}
	wire := func(name string) frontend.Variable { return c.Wires[c.Relation.WireMap[name]] }
	api.AssertIsEqual(wire("chainId"), c.Extras.ChainID)
	api.AssertIsEqual(wire("pool"), c.Extras.Consumer)
	api.AssertIsEqual(wire("budgetKind"), 0)
	api.AssertIsEqual(wire("heirIdentityCommitment"), toNative(3))
	api.AssertIsEqual(wire("heirOwnerCommitment"), toNative(4))
	api.AssertIsEqual(wire("keyMode"), toNative(7))
	if c.Relation.ViewFields {
		api.AssertIsEqual(wire("heirViewKeyLo"), toNative(5))
		api.AssertIsEqual(wire("heirViewKeyHi"), toNative(6))
	}
	// Each native wire is already a BN254 scalar-field element. Input parsing
	// rejects noncanonical decimal encodings instead of silently reducing them.
	lc := func(terms []fundTerm) frontend.Variable {
		value := frontend.Variable(0)
		for _, term := range terms {
			value = api.Add(value, api.Mul(term.C, c.Wires[term.I]))
		}
		return value
	}
	for _, row := range c.Relation.Constraints {
		api.AssertIsEqual(api.Mul(lc(row[0]), lc(row[1])), lc(row[2]))
	}
	return nil
}
