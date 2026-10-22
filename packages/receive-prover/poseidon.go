package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/consensys/gnark/frontend"
)

// These fixed BN254 Poseidon parameters are the circomlib-compatible
// poseidon-lite 0.3.0 parameters. They are part of the circuit, never witness.
//
//go:embed poseidon-constants.json
var poseidonJSON []byte

type poseidonConstants struct {
	C []string   `json:"C"`
	M [][]string `json:"M"`
}

var nativePoseidonConstants map[string]poseidonConstants

func init() {
	if err := json.Unmarshal(poseidonJSON, &nativePoseidonConstants); err != nil {
		panic(err)
	}
}

func poseidonPartialRounds(inputs int) int {
	return []int{56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68}[inputs-1]
}

func nativePoseidon(api frontend.API, inputs ...frontend.Variable) frontend.Variable {
	p, ok := nativePoseidonConstants[fmt.Sprint(len(inputs))]
	if !ok {
		panic("unsupported Poseidon arity")
	}
	t, partial := len(inputs)+1, poseidonPartialRounds(len(inputs))
	state := make([]frontend.Variable, t)
	state[0] = 0
	copy(state[1:], inputs)
	for round := 0; round < 8+partial; round++ {
		for i := range state {
			state[i] = api.Add(state[i], p.C[round*t+i])
			if round < 4 || round >= 4+partial || i == 0 {
				x2 := api.Mul(state[i], state[i])
				x4 := api.Mul(x2, x2)
				state[i] = api.Mul(x4, state[i])
			}
		}
		next := make([]frontend.Variable, t)
		for i := range next {
			next[i] = 0
			for j := range state {
				next[i] = api.Add(next[i], api.Mul(p.M[i][j], state[j]))
			}
		}
		state = next
	}
	return state[0]
}

// Reference evaluation is used by conformance tests, never for authentication.
func referencePoseidon(inputs ...*big.Int) *big.Int {
	q, _ := new(big.Int).SetString("21888242871839275222246405745257275088548364400416034343698204186575808495617", 10)
	p := nativePoseidonConstants[fmt.Sprint(len(inputs))]
	t, partial := len(inputs)+1, poseidonPartialRounds(len(inputs))
	state := make([]*big.Int, t)
	state[0] = new(big.Int)
	for i, v := range inputs {
		state[i+1] = new(big.Int).Set(v)
	}
	for round := 0; round < 8+partial; round++ {
		for i := range state {
			c, _ := new(big.Int).SetString(p.C[round*t+i], 10)
			state[i].Add(state[i], c).Mod(state[i], q)
			if round < 4 || round >= 4+partial || i == 0 {
				state[i].Exp(state[i], big.NewInt(5), q)
			}
		}
		next := make([]*big.Int, t)
		for i := range next {
			next[i] = new(big.Int)
			for j := range state {
				m, _ := new(big.Int).SetString(p.M[i][j], 10)
				next[i].Add(next[i], new(big.Int).Mul(m, state[j]))
			}
			next[i].Mod(next[i], q)
		}
		state = next
	}
	return state[0]
}
