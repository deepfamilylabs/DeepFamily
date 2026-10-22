package main

import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

const CircuitVersion = "receive-presentation-v1-64-32-checkpoint-bound"
const StateDepth = 64
const NoteDepth = 32

type Presentation struct {
	ChainID      frontend.Variable `gnark:",public"`
	Consumer     frontend.Variable `gnark:",public"`
	Action       frontend.Variable `gnark:",public"`
	MessageID    frontend.Variable `gnark:",public"`
	CipherLo     frontend.Variable `gnark:",public"`
	CipherHi     frontend.Variable `gnark:",public"`
	CheckpointID frontend.Variable `gnark:",public"`
	StateRoot    frontend.Variable `gnark:",public"`
	AsOf         frontend.Variable `gnark:",public"`
	ExpiresAt    frontend.Variable `gnark:",public"`
	Binding      frontend.Variable `gnark:",public"`
	Salt         frontend.Variable
	Depth        frontend.Variable
	Siblings     [StateDepth]frontend.Variable
	OldKey       frontend.Variable
	OldValue     frontend.Variable
	IsOld0       frontend.Variable
	Absent       frontend.Variable
}

type ReceiptCircuit struct {
	Proof        stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	InnerWitness stdgroth16.Witness[sw_bn254.ScalarField]
	// No caller/prover can replace this key: it is compiled into the R1CS.
	IssuerVK     stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
	Kind         string                                                                       `gnark:"-"`
	Presentation Presentation
}

func (c *ReceiptCircuit) Define(api frontend.API) error {
	sig, err := authenticate(api, c.IssuerVK, c.Proof, c.InnerWitness)
	if err != nil {
		return err
	}
	return constrainPresentation(api, &c.Presentation, sig, c.Kind)
}

func authenticate(api frontend.API, vk stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl], proof stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine], w stdgroth16.Witness[sw_bn254.ScalarField]) ([]frontend.Variable, error) {
	v, err := stdgroth16.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return nil, err
	}
	if err = v.AssertProof(vk, proof, w, stdgroth16.WithSubgroupCheck()); err != nil {
		return nil, fmt.Errorf("private credential verification: %w", err)
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return nil, err
	}
	sig := make([]frontend.Variable, len(w.Public))
	for i := range sig {
		sig[i] = api.FromBinary(f.ToBitsCanonical(&w.Public[i])...)
	}
	return sig, nil
}

func constrainPresentation(api frontend.API, u *Presentation, sig []frontend.Variable, kind string) error {
	offset := 0
	if kind == "fund" {
		offset = 1
	}
	if len(sig) != 11+offset {
		return fmt.Errorf("incorrect fixed issuer layout")
	}
	alias, counter, expiry := sig[0], sig[1], sig[2]
	owner, viewLo, viewHi, mode := sig[3+offset], sig[4+offset], sig[5+offset], sig[6+offset]
	api.AssertIsEqual(u.ExpiresAt, expiry)
	for _, v := range []frontend.Variable{u.ChainID, u.AsOf, u.ExpiresAt, counter, u.OldValue} {
		api.ToBinary(v, 64)
	}
	api.AssertIsLessOrEqual(api.Add(u.AsOf, 1), u.ExpiresAt)
	api.ToBinary(u.Consumer, 160)
	api.ToBinary(u.MessageID, 128)
	api.ToBinary(u.CipherLo, 128)
	api.ToBinary(u.CipherHi, 128)
	// CheckpointID is part of the authenticated operation even though the state
	// lookup itself only needs its root. Without a constraint its verification-key
	// coefficient is zero, allowing a proof's public checkpoint ID to be changed.
	for _, v := range []frontend.Variable{u.ChainID, u.Consumer, u.CheckpointID, u.Salt, u.Binding, alias, owner, expiry} {
		api.AssertIsDifferent(v, 0)
	}
	switch kind {
	case "anonymous":
		api.AssertIsEqual(api.Mul(api.Sub(u.Action, 1), api.Sub(u.Action, 4)), 0)
		// Money proofs identify the actual receive output slot.
		api.AssertIsEqual(api.Mul(api.Sub(u.Action, 1), u.MessageID, api.Sub(u.MessageID, 1)), 0)
	case "fund":
		api.AssertIsEqual(u.Action, 3)
		api.AssertIsBoolean(u.MessageID)
	case "attachment":
		api.AssertIsEqual(u.Action, 2)
	default:
		return fmt.Errorf("unsupported receipt kind %q", kind)
	}
	constrainCounterLookup(api, u, alias, counter)
	// This commitment also appears in the original money circuit. Public chain,
	// consumer, action, slot and digest are already bound by the outer proof.
	b := nativePoseidon(api, 202610210102, alias, owner)
	b = nativePoseidon(api, b, mode, viewLo)
	b = nativePoseidon(api, b, viewHi, u.Salt)
	if kind == "fund" {
		b = nativePoseidon(api, 202610220102, b, sig[3])
	}
	api.AssertIsEqual(u.Binding, b)
	return nil
}

func constrainCounterLookup(api frontend.API, u *Presentation, alias, counter frontend.Variable) {
	api.AssertIsBoolean(u.Absent)
	api.AssertIsBoolean(u.IsOld0)
	api.AssertIsEqual(u.Absent, api.IsZero(counter))
	present := api.Sub(1, u.Absent)
	api.AssertIsEqual(api.Mul(present, u.IsOld0), 0)
	api.AssertIsEqual(api.Mul(present, api.Sub(u.OldKey, alias)), 0)
	api.AssertIsEqual(api.Mul(present, api.Sub(u.OldValue, counter)), 0)
	empty := api.Mul(u.Absent, u.IsOld0)
	api.AssertIsEqual(api.Mul(empty, u.OldKey), 0)
	api.AssertIsEqual(api.Mul(empty, u.OldValue), 0)
	collision := api.Mul(u.Absent, api.Sub(1, u.IsOld0))
	api.AssertIsEqual(api.Mul(collision, api.IsZero(api.Sub(u.OldKey, alias))), 0)
	api.AssertIsEqual(api.Mul(collision, api.IsZero(u.OldKey)), 0)
	api.AssertIsEqual(api.Mul(collision, api.IsZero(u.OldValue)), 0)
	keyBits := api.ToBinary(alias, 254)
	oldBits := api.ToBinary(u.OldKey, 254)
	api.ToBinary(u.Depth, 7)
	depthIs := make([]frontend.Variable, StateDepth+1)
	sum := frontend.Variable(0)
	for i := range depthIs {
		depthIs[i] = api.IsZero(api.Sub(u.Depth, i))
		sum = api.Add(sum, depthIs[i])
	}
	api.AssertIsEqual(sum, 1)
	oldLeaf := nativePoseidon(api, u.OldKey, u.OldValue, 1)
	newLeaf := nativePoseidon(api, alias, counter, 1)
	current := api.Select(u.Absent, api.Select(u.IsOld0, 0, oldLeaf), newLeaf)
	for i := StateDepth - 1; i >= 0; i-- {
		active := frontend.Variable(0)
		for j := i + 1; j <= StateDepth; j++ {
			active = api.Add(active, depthIs[j])
		}
		api.AssertIsEqual(api.Mul(api.Sub(1, active), u.Siblings[i]), 0)
		// A compressed non-membership leaf must share every traversed key bit.
		api.AssertIsEqual(api.Mul(collision, active, api.Sub(keyBits[i], oldBits[i])), 0)
		// A canonical compressed dictionary stops at its deepest nonzero
		// sibling; redundant unary suffixes cannot become another witness.
		api.AssertIsEqual(api.Mul(depthIs[i+1], api.IsZero(u.Siblings[i])), 0)
		left := api.Select(keyBits[i], u.Siblings[i], current)
		right := api.Select(keyBits[i], current, u.Siblings[i])
		current = api.Select(active, nativePoseidon(api, left, right), current)
	}
	api.AssertIsEqual(current, u.StateRoot)
}

type Attachment struct {
	BudgetPool     frontend.Variable `gnark:",public"`
	BudgetRoot     frontend.Variable `gnark:",public"`
	Relation       frontend.Variable `gnark:",public"`
	Policy         frontend.Variable
	Enrollment     frontend.Variable
	Rate           frontend.Variable
	Remaining      frontend.Variable
	Nonce          frontend.Variable
	CiphertextHash frontend.Variable
	Depth          frontend.Variable
	Index          frontend.Variable
	Siblings       [NoteDepth]frontend.Variable
}

type AttachedCircuit struct {
	Receipt    ReceiptCircuit
	Attachment Attachment
}

func (c *AttachedCircuit) Define(api frontend.API) error {
	sig, err := authenticate(api, c.Receipt.IssuerVK, c.Receipt.Proof, c.Receipt.InnerWitness)
	if err != nil {
		return err
	}
	if err = constrainPresentation(api, &c.Receipt.Presentation, sig, "attachment"); err != nil {
		return err
	}
	constrainBudget(api, &c.Attachment, &c.Receipt.Presentation, sig)
	return nil
}

func constrainBudget(api frontend.API, a *Attachment, u *Presentation, sig []frontend.Variable) {
	api.ToBinary(a.BudgetPool, 160)
	for _, v := range []frontend.Variable{a.BudgetPool, a.BudgetRoot, a.Relation, a.Policy, a.Enrollment, a.Rate, a.Nonce} {
		api.AssertIsDifferent(v, 0)
	}
	api.ToBinary(a.Rate, 128)
	api.ToBinary(a.Remaining, 128)
	scope := nativePoseidon(api, 1031, u.ChainID, a.BudgetPool)
	authTag := nativePoseidon(api, 1032, scope, 1033)
	auth := nativePoseidon(api, authTag, sig[3], sig[6], sig[4], sig[5])
	fundTag := nativePoseidon(api, 1032, scope, 202610210301)
	leaf := nativePoseidon(api, fundTag, a.Policy, a.Enrollment, auth, a.Rate, a.Remaining, a.Nonce, a.CiphertextHash)
	api.AssertIsDifferent(leaf, 0)
	// Same 32-level compact binary note path as ShieldedMerkleRoot(32).
	api.ToBinary(a.Depth, 6)
	bits := api.ToBinary(a.Index, NoteDepth)
	depthIs := make([]frontend.Variable, NoteDepth+1)
	sum := frontend.Variable(0)
	for i := range depthIs {
		depthIs[i] = api.IsZero(api.Sub(a.Depth, i))
		sum = api.Add(sum, depthIs[i])
	}
	api.AssertIsEqual(sum, 1)
	current := leaf
	for i := 0; i < NoteDepth; i++ {
		active := frontend.Variable(0)
		for j := i + 1; j <= NoteDepth; j++ {
			active = api.Add(active, depthIs[j])
		}
		inactive := api.Sub(1, active)
		api.AssertIsEqual(api.Mul(inactive, a.Siblings[i]), 0)
		api.AssertIsEqual(api.Mul(inactive, bits[i]), 0)
		left := api.Select(bits[i], a.Siblings[i], current)
		right := api.Select(bits[i], current, a.Siblings[i])
		current = api.Select(active, nativePoseidon(api, left, right), current)
	}
	api.AssertIsEqual(current, a.BudgetRoot)
	ref := nativePoseidon(api, 202610210401, a.BudgetPool, leaf)
	api.AssertIsEqual(a.Relation, nativePoseidon(api, ref, u.Binding, u.Salt))
}
