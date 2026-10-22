package main

// ISOLATED RESEARCH. A Fund-specific budget commitment in a canonical note
// tree supplies provenance; no per-budget registration or additional tree is
// introduced. The caller contract must authenticate BudgetPool and BudgetRoot.
import (
	"fmt"

	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

const attachmentPublicCount = 14
const attachmentCircuitVersion = "attachment-v2-fund-tag-202610210301"

type AttachmentExtras struct {
	BudgetPool frontend.Variable `gnark:",public"`
	BudgetRoot frontend.Variable `gnark:",public"`
	Relation   frontend.Variable `gnark:",public"`

	Policy         frontend.Variable
	Enrollment     frontend.Variable
	Rate           frontend.Variable
	Remaining      frontend.Variable
	Nonce          frontend.Variable
	CiphertextHash frontend.Variable
	Depth          frontend.Variable
	Index          frontend.Variable
	Siblings       [8]frontend.Variable
}

type AttachmentCircuit struct {
	Proof        stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	InnerWitness stdgroth16.Witness[sw_bn254.ScalarField]
	VK           stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
	Extras       NativeExtras
	Attachment   AttachmentExtras
}

func (c *AttachmentCircuit) Define(api frontend.API) error {
	verifier, err := stdgroth16.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return fmt.Errorf("create attachment issuer verifier: %w", err)
	}
	if err := verifier.AssertProof(c.VK, c.Proof, c.InnerWitness, stdgroth16.WithSubgroupCheck()); err != nil {
		return fmt.Errorf("verify private attachment issuance: %w", err)
	}
	if err := AttachNative(api, &c.Extras, c.InnerWitness.Public); err != nil {
		return err
	}
	return AttachBudget(api, &c.Attachment, &c.Extras, c.InnerWitness.Public)
}

func AttachBudget(api frontend.API, a *AttachmentExtras, u *NativeExtras, inner []emulated.Element[sw_bn254.ScalarField]) error {
	if len(inner) != issuancePublicCount {
		return fmt.Errorf("attachment requires the fixed anonymous eleven-signal issuer")
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return err
	}
	sig := make([]frontend.Variable, len(inner))
	for i := range inner {
		sig[i] = api.FromBinary(f.ToBitsCanonical(&inner[i])...)
	}
	api.ToBinary(a.BudgetPool, 160)
	api.AssertIsDifferent(a.BudgetPool, 0)
	api.AssertIsDifferent(a.BudgetRoot, 0)
	api.AssertIsDifferent(a.Policy, 0)
	api.AssertIsDifferent(a.Enrollment, 0)
	api.ToBinary(a.Rate, 128)
	api.AssertIsDifferent(a.Rate, 0)
	api.ToBinary(a.Remaining, 128)
	api.AssertIsDifferent(a.Nonce, 0)

	scope := nativePoseidon(api, 1031, u.ChainID, a.BudgetPool)
	authTag := nativePoseidon(api, 1032, scope, 1033)
	// Owner/mode/view all come from the same recursively verified credential.
	// No budget heir identity or alias equality is imposed.
	authorization := nativePoseidon(api, authTag, sig[3], sig[6], sig[4], sig[5])
	fundTag := nativePoseidon(api, 1032, scope, 202610210301)
	leaf := nativePoseidon(api, fundTag, a.Policy, a.Enrollment, authorization,
		a.Rate, a.Remaining, a.Nonce, a.CiphertextHash)
	api.AssertIsDifferent(leaf, 0)

	// Compact LeanIMT path, bottom-up. Canonical pool roots follow complete
	// two-output actions, so fixtures require at least one sibling. Eight is
	// an explicit research bound, not the production tree capacity.
	api.ToBinary(a.Depth, 4)
	indexBits := api.ToBinary(a.Index, 8)
	depthIs := [8]frontend.Variable{}
	sum := frontend.Variable(0)
	for i := range depthIs {
		depthIs[i] = api.IsZero(api.Sub(a.Depth, i+1))
		sum = api.Add(sum, depthIs[i])
	}
	api.AssertIsEqual(sum, 1)
	current := leaf
	for i := 0; i < len(a.Siblings); i++ {
		active := frontend.Variable(0)
		for j := i; j < len(depthIs); j++ {
			active = api.Add(active, depthIs[j])
		}
		inactive := api.Sub(1, active)
		api.AssertIsEqual(api.Mul(inactive, a.Siblings[i]), 0)
		api.AssertIsEqual(api.Mul(inactive, indexBits[i]), 0)
		left := api.Select(indexBits[i], a.Siblings[i], current)
		right := api.Select(indexBits[i], current, a.Siblings[i])
		parent := nativePoseidon(api, left, right)
		current = api.Select(active, parent, current)
	}
	api.AssertIsEqual(current, a.BudgetRoot)
	reference := nativePoseidon(api, 202610210401, a.BudgetPool, leaf)
	api.AssertIsEqual(a.Relation, nativePoseidon(api, reference, u.Binding, u.Salt))
	return nil
}

type attachmentExtrasJSON struct {
	BudgetPool     string   `json:"budgetPool"`
	BudgetRoot     string   `json:"budgetRoot"`
	Relation       string   `json:"relation"`
	Policy         string   `json:"policy"`
	Enrollment     string   `json:"enrollment"`
	Rate           string   `json:"rate"`
	Remaining      string   `json:"remaining"`
	Nonce          string   `json:"nonce"`
	CiphertextHash string   `json:"ciphertextHash"`
	Depth          string   `json:"depth"`
	Index          string   `json:"index"`
	Siblings       []string `json:"siblings"`
}

func LoadAttachmentExtras(file string) (AttachmentExtras, error) {
	var v attachmentExtrasJSON
	if err := readJSON(file, &v); err != nil {
		return AttachmentExtras{}, err
	}
	if len(v.Siblings) != 8 {
		return AttachmentExtras{}, fmt.Errorf("attachment path must have exactly eight padded siblings")
	}
	// Validate canonical Fr encodings without moving any authentication out of
	// the circuit. Invalid depths/indices remain actual constraint negatives.
	for _, item := range []string{v.BudgetPool, v.BudgetRoot, v.Relation, v.Policy,
		v.Enrollment, v.Rate, v.Remaining, v.Nonce, v.CiphertextHash, v.Depth, v.Index} {
		if _, err := canonicalDecimal(item, sw_bn254.ScalarField{}.Modulus()); err != nil {
			return AttachmentExtras{}, fmt.Errorf("attachment decimal: %w", err)
		}
	}
	a := AttachmentExtras{BudgetPool: v.BudgetPool, BudgetRoot: v.BudgetRoot, Relation: v.Relation,
		Policy: v.Policy, Enrollment: v.Enrollment, Rate: v.Rate, Remaining: v.Remaining,
		Nonce: v.Nonce, CiphertextHash: v.CiphertextHash, Depth: v.Depth, Index: v.Index}
	for i, sibling := range v.Siblings {
		if _, err := canonicalDecimal(sibling, sw_bn254.ScalarField{}.Modulus()); err != nil {
			return AttachmentExtras{}, fmt.Errorf("attachment sibling %d: %w", i, err)
		}
		a.Siblings[i] = sibling
	}
	return a, nil
}
