package main

// RESEARCH ONLY. Complete unchanged PrivateTransfer R1CS plus receive-code
// authorization. Compile-time shapes expose the number of external recipients;
// they measure resource costs and are not a finalized production privacy format.
import (
	"fmt"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

type transferRelation struct {
	Schema           string          `json:"schema"`
	Prime            string          `json:"prime"`
	NVars            int             `json:"nVars"`
	NPublic          int             `json:"nPublic"`
	NConstraints     int             `json:"nConstraints"`
	SourceR1CSSHA256 string          `json:"sourceR1csSHA256"`
	PublicNames      []string        `json:"publicNames"`
	WireMap          map[string]int  `json:"wireMap"`
	Constraints      [][3][]fundTerm `json:"constraints"`
}
type transferStatement struct {
	Public   []frontend.Variable `gnark:",public"`
	Wires    []frontend.Variable
	Relation *transferRelation `gnark:"-"`
}

func (t *transferStatement) define(api frontend.API) (frontend.Variable, [2]frontend.Variable, error) {
	var owners [2]frontend.Variable
	if t.Relation == nil || len(t.Public) != 30 || len(t.Wires) != t.Relation.NVars {
		return nil, owners, fmt.Errorf("invalid fixed Transfer shape")
	}
	api.AssertIsEqual(t.Wires[0], 1)
	for i, v := range t.Public {
		api.AssertIsEqual(v, t.Wires[i+1])
	}
	lc := func(terms []fundTerm) frontend.Variable {
		var sum frontend.Variable = 0
		for _, term := range terms {
			sum = api.Add(sum, api.Mul(term.C, t.Wires[term.I]))
		}
		return sum
	}
	for _, row := range t.Relation.Constraints {
		api.AssertIsEqual(api.Mul(lc(row[0]), lc(row[1])), lc(row[2]))
	}
	owners[0] = t.Wires[t.Relation.WireMap["outputOwner0"]]
	owners[1] = t.Wires[t.Relation.WireMap["outputOwner1"]]
	sender := nativePoseidon(api, 1013, t.Wires[t.Relation.WireMap["inputOwnerSecret"]])
	return sender, owners, nil
}
func transferUsage(api frontend.API, u *NativeExtras, t *transferStatement) {
	api.AssertIsEqual(u.ChainID, t.Public[0])
	api.AssertIsEqual(u.Consumer, t.Public[1])
	api.AssertIsEqual(u.Action, 3)
}
func transferIssuer(api frontend.API, proof stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine], inner stdgroth16.Witness[sw_bn254.ScalarField], vk stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl], u *NativeExtras) (frontend.Variable, error) {
	verifier, err := stdgroth16.NewVerifier[sw_bn254.ScalarField, sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](api)
	if err != nil {
		return nil, err
	}
	if err = verifier.AssertProof(vk, proof, inner, stdgroth16.WithSubgroupCheck()); err != nil {
		return nil, err
	}
	if err = AttachNative(api, u, inner.Public); err != nil {
		return nil, err
	}
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil {
		return nil, err
	}
	return api.FromBinary(f.ToBitsCanonical(&inner.Public[3])...), nil
}

type SelfTransferCircuit struct{ Transfer transferStatement }

func (c *SelfTransferCircuit) Define(api frontend.API) error {
	sender, owners, err := c.Transfer.define(api)
	if err != nil {
		return err
	}
	for _, owner := range owners {
		api.AssertIsEqual(owner, sender)
	}
	return nil
}

type SingleTransferCircuit struct {
	Extras   NativeExtras
	Transfer transferStatement
	Slot     frontend.Variable `gnark:",public"`
	Proof    stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	Inner    stdgroth16.Witness[sw_bn254.ScalarField]
	VK       stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
}

func (c *SingleTransferCircuit) Define(api frontend.API) error {
	sender, owners, err := c.Transfer.define(api)
	if err != nil {
		return err
	}
	api.AssertIsBoolean(c.Slot)
	codeOwner, err := transferIssuer(api, c.Proof, c.Inner, c.VK, &c.Extras)
	if err != nil {
		return err
	}
	transferUsage(api, &c.Extras, &c.Transfer)
	recipient := api.Select(c.Slot, owners[1], owners[0])
	change := api.Select(c.Slot, owners[0], owners[1])
	api.AssertIsEqual(recipient, codeOwner)
	api.AssertIsDifferent(recipient, sender)
	api.AssertIsEqual(change, sender)
	return nil
}

type DualTransferCircuit struct {
	Extras   [2]NativeExtras
	Transfer transferStatement
	Proofs   [2]stdgroth16.Proof[sw_bn254.G1Affine, sw_bn254.G2Affine]
	Inner    [2]stdgroth16.Witness[sw_bn254.ScalarField]
	VK       stdgroth16.VerifyingKey[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl] `gnark:"-"`
}

func (c *DualTransferCircuit) Define(api frontend.API) error {
	sender, owners, err := c.Transfer.define(api)
	if err != nil {
		return err
	}
	for i := 0; i < 2; i++ {
		codeOwner, err := transferIssuer(api, c.Proofs[i], c.Inner[i], c.VK, &c.Extras[i])
		if err != nil {
			return err
		}
		transferUsage(api, &c.Extras[i], &c.Transfer)
		api.AssertIsEqual(owners[i], codeOwner)
		api.AssertIsDifferent(owners[i], sender)
	}
	a, b := c.Extras[0], c.Extras[1]
	for _, pair := range [][2]frontend.Variable{{a.ChainID, b.ChainID}, {a.Consumer, b.Consumer}, {a.Action, b.Action}, {a.MessageID, b.MessageID}, {a.CipherLo, b.CipherLo}, {a.CipherHi, b.CipherHi}, {a.CheckpointID, b.CheckpointID}, {a.StateRoot, b.StateRoot}, {a.AsOf, b.AsOf}} {
		api.AssertIsEqual(pair[0], pair[1])
	}
	return nil
}
