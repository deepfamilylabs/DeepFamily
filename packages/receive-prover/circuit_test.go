package main

import (
	"math/big"
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
)

type poseidonTestCircuit struct {
	Inputs   []frontend.Variable
	Expected frontend.Variable `gnark:",public"`
}

func (c *poseidonTestCircuit) Define(api frontend.API) error {
	api.AssertIsEqual(nativePoseidon(api, c.Inputs...), c.Expected)
	return nil
}

func TestCircomPoseidonConformance(t *testing.T) {
	vectors := map[int]string{
		2: "7853200120776062878684798364095072458815029376092732009249414926327459813530",
		3: "6542985608222806190361240322586112750744169038454362455181422643027100751666",
		5: "6183221330272524995739186171720101788151706631170188140075976616310159254464",
		8: "18604317144381847857886385684060986177838410221561136253933256952257712543953",
	}
	for count, expected := range vectors {
		values := make([]frontend.Variable, count)
		ints := make([]*big.Int, count)
		for i := range values {
			values[i] = i + 1
			ints[i] = big.NewInt(int64(i + 1))
		}
		if referencePoseidon(ints...).String() != expected {
			t.Fatalf("reference Poseidon(%d) differs from poseidon-lite", count)
		}
		ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &poseidonTestCircuit{Inputs: make([]frontend.Variable, count)})
		if err != nil {
			t.Fatal(err)
		}
		w, err := frontend.NewWitness(&poseidonTestCircuit{Inputs: values, Expected: expected}, ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		if err = ccs.IsSolved(w); err != nil {
			t.Fatal(err)
		}
	}
}

type stateTestCircuit struct {
	State          Presentation
	Alias, Counter frontend.Variable
}

func (c *stateTestCircuit) Define(api frontend.API) error {
	constrainCounterLookup(api, &c.State, c.Alias, c.Counter)
	return nil
}

func stateAssignment(alias, counter int64) *stateTestCircuit {
	c := &stateTestCircuit{Alias: alias, Counter: counter, State: Presentation{ChainID: 1, Consumer: 1, Action: 1, MessageID: 1, CipherLo: 0, CipherHi: 0, CheckpointID: 1, AsOf: 1, ExpiresAt: 2, Binding: 1, Salt: 1, Depth: 0, OldKey: alias, OldValue: counter, IsOld0: 0, Absent: 0}}
	for i := range c.State.Siblings {
		c.State.Siblings[i] = 0
	}
	c.State.StateRoot = referencePoseidon(big.NewInt(alias), big.NewInt(counter), big.NewInt(1)).String()
	return c
}

func assertState(t *testing.T, ccs constraint.ConstraintSystem, a *stateTestCircuit, valid bool) {
	t.Helper()
	w, err := frontend.NewWitness(a, ecc.BN254.ScalarField())
	if err != nil {
		t.Fatal(err)
	}
	err = ccs.IsSolved(w)
	if (err == nil) != valid {
		t.Fatalf("state satisfaction=%v, want %v: %v", err == nil, valid, err)
	}
}

func TestCanonicalPrivateCounterQueries(t *testing.T) {
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &stateTestCircuit{})
	if err != nil {
		t.Fatal(err)
	}
	assertState(t, ccs, stateAssignment(17, 3), true)
	wrong := stateAssignment(17, 3)
	wrong.Counter = 4
	assertState(t, ccs, wrong, false)
	wrong = stateAssignment(17, 3)
	wrong.State.OldKey = 18
	assertState(t, ccs, wrong, false)
	empty := stateAssignment(17, 0)
	empty.State.Absent = 1
	empty.State.IsOld0 = 1
	empty.State.OldKey = 0
	empty.State.OldValue = 0
	empty.State.StateRoot = 0
	assertState(t, ccs, empty, true)
	empty.State.OldKey = 1
	assertState(t, ccs, empty, false)
	collision := stateAssignment(17, 0)
	collision.State.Absent = 1
	collision.State.OldKey = 18
	collision.State.OldValue = 2
	collision.State.StateRoot = referencePoseidon(big.NewInt(18), big.NewInt(2), big.NewInt(1)).String()
	assertState(t, ccs, collision, true)
	collision.State.OldKey = 17
	assertState(t, ccs, collision, false)
	// Full supported depth: keys agree at bits 0..62 and branch at bit 63.
	full := stateAssignment(17, 3)
	full.State.Depth = 64
	otherKey := new(big.Int).Xor(big.NewInt(17), new(big.Int).Lsh(big.NewInt(1), 63))
	other := referencePoseidon(otherKey, big.NewInt(5), big.NewInt(1))
	full.State.Siblings[63] = other.String()
	current := referencePoseidon(big.NewInt(17), big.NewInt(3), big.NewInt(1))
	for i := 63; i >= 0; i-- {
		sibling := new(big.Int)
		if i == 63 {
			sibling.Set(other)
		}
		if (17>>i)&1 == 1 {
			current = referencePoseidon(sibling, current)
		} else {
			current = referencePoseidon(current, sibling)
		}
	}
	full.State.StateRoot = current.String()
	assertState(t, ccs, full, true)
	full.State.Depth = 65
	assertState(t, ccs, full, false)
	padding := stateAssignment(17, 3)
	padding.State.Siblings[63] = 1
	assertState(t, ccs, padding, false)
}

// Test the operation relation separately from the expensive recursive issuer
// verifier. A satisfiable witness alone does not detect unused public inputs:
// each public mutation must fail actual Groth16 verification as well.
type presentationTestCircuit struct {
	Statement Presentation
	Signals   [11]frontend.Variable
}

func (c *presentationTestCircuit) Define(api frontend.API) error {
	return constrainPresentation(api, &c.Statement, c.Signals[:], "anonymous")
}

func presentationAssignment() *presentationTestCircuit {
	u := stateAssignment(17, 3).State
	u.Binding = referencePoseidon(
		referencePoseidon(
			referencePoseidon(big.NewInt(202610210102), big.NewInt(17), big.NewInt(23)),
			big.NewInt(0), big.NewInt(29)),
		big.NewInt(31), big.NewInt(1)).String()
	return &presentationTestCircuit{
		Statement: u,
		Signals:   [11]frontend.Variable{17, 3, 2, 23, 29, 31, 0, 1, 1, 1, 2},
	}
}

func TestEveryPresentationPublicInputIsProofBound(t *testing.T) {
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &presentationTestCircuit{})
	if err != nil {
		t.Fatal(err)
	}
	assignment := presentationAssignment()
	w, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		t.Fatal(err)
	}
	pk, vk, err := groth16.Setup(ccs)
	if err != nil {
		t.Fatal(err)
	}
	proof, err := groth16.Prove(ccs, pk, w)
	if err != nil {
		t.Fatal(err)
	}
	public, err := w.Public()
	if err != nil {
		t.Fatal(err)
	}
	if err = groth16.Verify(proof, vk, public); err != nil {
		t.Fatal(err)
	}
	values := public.Vector().(fr.Vector)
	if len(values) != 11 {
		t.Fatalf("unexpected public layout: %d", len(values))
	}
	var one fr.Element
	one.SetOne()
	for index := range values {
		original := values[index]
		values[index].Add(&original, &one)
		if err = groth16.Verify(proof, vk, public); err == nil {
			t.Fatalf("public input %d is not bound to the proof", index)
		}
		values[index] = original
	}
	assignment.Statement.CheckpointID = 0
	invalid, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		t.Fatal(err)
	}
	if err = ccs.IsSolved(invalid); err == nil {
		t.Fatal("zero checkpoint must not satisfy a presentation")
	}
}
