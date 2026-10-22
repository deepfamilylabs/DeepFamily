package main

// RESEARCH ONLY: native business/state constraints attached to the recursively
// verified issuance proof. Depth 8 is a bounded fixture, not production capacity.
import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"

	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
)

type poseidonConstants struct {
	C []string `json:"C"`
	M [][]string `json:"M"`
}

var nativePoseidonConstants map[string]poseidonConstants

func poseidonPartialRounds(inputs int) int {
	values := []int{56, 57, 56, 60, 60, 63, 64, 63, 60, 66, 60, 65, 70, 60, 64, 68}
	if inputs < 1 || inputs > len(values) { panic("unsupported Poseidon arity") }
	return values[inputs-1]
}

func LoadPoseidonConstants(file string) error {
	data, err := os.ReadFile(file)
	if err != nil { return err }
	if err = json.Unmarshal(data, &nativePoseidonConstants); err != nil { return err }
	for _, inputs := range []int{2, 3} {
		p, ok := nativePoseidonConstants[fmt.Sprint(inputs)]
		partial := poseidonPartialRounds(inputs)
		if !ok || len(p.C) != (inputs+1)*(8+partial) || len(p.M) != inputs+1 {
			return fmt.Errorf("invalid research Poseidon constants for arity %d", inputs)
		}
		for _, row := range p.M { if len(row) != inputs+1 { return fmt.Errorf("invalid Poseidon matrix") } }
	}
	return nil
}

func nativePoseidon(api frontend.API, inputs ...frontend.Variable) frontend.Variable {
	p, ok := nativePoseidonConstants[fmt.Sprint(len(inputs))]
	if !ok { panic("Poseidon constants not loaded") }
	t := len(inputs)+1
	partial := poseidonPartialRounds(len(inputs))
	state := make([]frontend.Variable, t)
	state[0] = 0
	copy(state[1:], inputs)
	for round := 0; round < 8+partial; round++ {
		for i := 0; i < t; i++ {
			state[i] = api.Add(state[i], p.C[round*t+i])
			if round < 4 || round >= 4+partial || i == 0 {
				x2 := api.Mul(state[i], state[i])
				x4 := api.Mul(x2, x2)
				state[i] = api.Mul(x4, state[i])
			}
		}
		next := make([]frontend.Variable, t)
		for i := 0; i < t; i++ {
			next[i] = 0
			for j := 0; j < t; j++ { next[i] = api.Add(next[i], api.Mul(p.M[i][j], state[j])) }
		}
		state = next
	}
	return state[0]
}

// Public signals are listed in declaration order. Identity, alias, issuer proof,
// code counter, keys and Merkle path are not public outer-circuit fields.
type NativeExtras struct {
	ChainID frontend.Variable `gnark:",public"`
	Consumer frontend.Variable `gnark:",public"`
	Action frontend.Variable `gnark:",public"`
	MessageID frontend.Variable `gnark:",public"`
	CipherLo frontend.Variable `gnark:",public"`
	CipherHi frontend.Variable `gnark:",public"`
	CheckpointID frontend.Variable `gnark:",public"`
	StateRoot frontend.Variable `gnark:",public"`
	AsOf frontend.Variable `gnark:",public"`
	ExpiresAt frontend.Variable `gnark:",public"`
	Binding frontend.Variable `gnark:",public"`
	Salt frontend.Variable
	Depth frontend.Variable
	Siblings [8]frontend.Variable
	OldKey frontend.Variable
	OldValue frontend.Variable
	IsOld0 frontend.Variable
	Absent frontend.Variable
}

func AttachNative(api frontend.API, u *NativeExtras, inner []emulated.Element[sw_bn254.ScalarField]) error {
	if len(inner) != 11 { return fmt.Errorf("expected the 11-signal anonymous issuance statement") }
	f, err := emulated.NewField[sw_bn254.ScalarField](api)
	if err != nil { return err }
	sig := make([]frontend.Variable, len(inner))
	for i := range inner {
		// Canonical emulated Fr -> the same native Fr, without discarding carries.
		sig[i] = api.FromBinary(f.ToBitsCanonical(&inner[i])...)
	}
	alias, counter := sig[0], sig[1]
	api.AssertIsEqual(u.ExpiresAt, sig[2])
	for _, v := range []frontend.Variable{u.ChainID, u.CheckpointID, u.AsOf, u.ExpiresAt, counter} { api.ToBinary(v, 64) }
	api.ToBinary(u.Consumer, 160)
	api.ToBinary(u.Action, 8)
	api.ToBinary(u.MessageID, 128)
	api.ToBinary(u.CipherLo, 128)
	api.ToBinary(u.CipherHi, 128)
	api.AssertIsDifferent(u.Salt, 0)
	api.AssertIsBoolean(u.Absent)
	api.AssertIsBoolean(u.IsOld0)
	api.AssertIsEqual(api.Mul(u.Absent, counter), 0)
	api.ToBinary(u.Depth, 3)
	keyBits := api.ToBinary(alias, 254) // gnark performs the native modulus check.
	oldBits := api.ToBinary(u.OldKey, 254)
	depthIs := [8]frontend.Variable{}
	sum := frontend.Variable(0)
	for i := range depthIs {
		depthIs[i] = api.IsZero(api.Sub(u.Depth, i))
		sum = api.Add(sum, depthIs[i])
	}
	api.AssertIsEqual(sum, 1)
	nonemptyExclusion := api.Mul(u.Absent, api.Sub(1, u.IsOld0))
	api.AssertIsEqual(api.Mul(nonemptyExclusion, api.IsZero(api.Sub(u.OldKey, alias))), 0)
	api.AssertIsEqual(api.Mul(u.Absent, u.IsOld0, u.OldKey), 0)
	api.AssertIsEqual(api.Mul(u.Absent, u.IsOld0, u.OldValue), 0)
	oldLeaf := nativePoseidon(api, u.OldKey, u.OldValue, 1)
	newLeaf := nativePoseidon(api, alias, counter, 1)
	current := api.Select(u.Absent, api.Select(u.IsOld0, 0, oldLeaf), newLeaf)
	for i := 7; i >= 0; i-- {
		active := frontend.Variable(0)
		for j := i+1; j < 8; j++ { active = api.Add(active, depthIs[j]) }
		api.AssertIsEqual(api.Mul(api.Sub(1, active), u.Siblings[i]), 0)
		// A compressed exclusion leaf must share the query's traversed prefix.
		api.AssertIsEqual(api.Mul(nonemptyExclusion, active, api.Sub(keyBits[i], oldBits[i])), 0)
		left := api.Select(keyBits[i], u.Siblings[i], current)
		right := api.Select(keyBits[i], current, u.Siblings[i])
		parent := nativePoseidon(api, left, right)
		current = api.Select(active, parent, current)
	}
	api.AssertIsEqual(current, u.StateRoot)
	// Bind actual public operation fields to authenticated private recipient keys.
	// The consumer reconstructs chain/address/action and ciphertext hash itself.
	ctx := nativePoseidon(api, 202610210101, u.ChainID, u.Consumer)
	ctx = nativePoseidon(api, ctx, u.Action, u.MessageID)
	ctx = nativePoseidon(api, ctx, u.CipherLo, u.CipherHi)
	ctx = nativePoseidon(api, ctx, u.CheckpointID, u.StateRoot)
	ctx = nativePoseidon(api, ctx, u.AsOf, u.ExpiresAt)
	recipient := nativePoseidon(api, 202610210102, alias, sig[3])
	recipient = nativePoseidon(api, recipient, sig[6], sig[4])
	recipient = nativePoseidon(api, recipient, sig[5], u.Salt)
	api.AssertIsEqual(u.Binding, nativePoseidon(api, recipient, ctx))
	return nil
}

type nativeExtrasJSON struct {
	ChainID string `json:"chainId"`
	Consumer string `json:"consumer"`
	Action string `json:"action"`
	MessageID string `json:"messageId"`
	CipherLo string `json:"cipherLo"`
	CipherHi string `json:"cipherHi"`
	CheckpointID string `json:"checkpointId"`
	StateRoot string `json:"stateRoot"`
	AsOf string `json:"asOf"`
	ExpiresAt string `json:"expiresAt"`
	Binding string `json:"binding"`
	Salt string `json:"salt"`
	Depth string `json:"depth"`
	Siblings []string `json:"siblings"`
	OldKey string `json:"oldKey"`
	OldValue string `json:"oldValue"`
	IsOld0 string `json:"isOld0"`
	Absent string `json:"absent"`
}

func LoadNativeExtras(file string, codePublic []string) (NativeExtras, error) {
	var v nativeExtrasJSON
	data, err := os.ReadFile(file)
	if err != nil { return NativeExtras{}, err }
	if err := json.Unmarshal(data, &v); err != nil { return NativeExtras{}, err }
	if len(v.Siblings) != 8 || len(codePublic) != 11 { return NativeExtras{}, fmt.Errorf("invalid prototype input shape") }
	u := NativeExtras{ChainID:v.ChainID, Consumer:v.Consumer, Action:v.Action, MessageID:v.MessageID,
		CipherLo:v.CipherLo, CipherHi:v.CipherHi, CheckpointID:v.CheckpointID, StateRoot:v.StateRoot,
		AsOf:v.AsOf, ExpiresAt:v.ExpiresAt, Binding:v.Binding, Salt:v.Salt, Depth:v.Depth,
		OldKey:v.OldKey, OldValue:v.OldValue, IsOld0:v.IsOld0, Absent:v.Absent}
	for i := range u.Siblings { u.Siblings[i] = v.Siblings[i] }
	return u, nil
}

// NativePoseidonReference is only an off-circuit diagnostic. JS fixture values
// additionally come from the existing poseidon-lite implementation.
func NativePoseidonReference(inputs ...*big.Int) *big.Int {
	q, _ := new(big.Int).SetString("21888242871839275222246405745257275088548364400416034343698204186575808495617",10)
	p := nativePoseidonConstants[fmt.Sprint(len(inputs))]
	partial := poseidonPartialRounds(len(inputs))
	t := len(inputs)+1
	state := make([]*big.Int,t)
	state[0]=new(big.Int)
	for i,v:=range inputs {state[i+1]=new(big.Int).Set(v)}
	for round:=0;round<8+partial;round++ {
		for i:=range state {
			c,_:=new(big.Int).SetString(p.C[round*t+i],10)
			state[i].Add(state[i],c).Mod(state[i],q)
			if round<4||round>=4+partial||i==0 {state[i].Exp(state[i],big.NewInt(5),q)}
		}
		next:=make([]*big.Int,t)
		for i:=range next {
			next[i]=new(big.Int)
			for j:=range state {
				m,_:=new(big.Int).SetString(p.M[i][j],10)
				next[i].Add(next[i],new(big.Int).Mul(m,state[j]))
			}
			next[i].Mod(next[i],q)
		}
		state=next
	}
	return state[0]
}
