package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"

	"github.com/consensys/gnark-crypto/ecc/bn254"
	"github.com/consensys/gnark-crypto/ecc/bn254/fp"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
)

const issuancePublicCount = 11

type snarkjsProof struct {
	A        []string   `json:"pi_a"`
	B        [][]string `json:"pi_b"`
	C        []string   `json:"pi_c"`
	Protocol string     `json:"protocol"`
	Curve    string     `json:"curve"`
}

type snarkjsVK struct {
	Alpha    []string   `json:"vk_alpha_1"`
	Beta     [][]string `json:"vk_beta_2"`
	Gamma    [][]string `json:"vk_gamma_2"`
	Delta    [][]string `json:"vk_delta_2"`
	IC       [][]string `json:"IC"`
	NPublic  int        `json:"nPublic"`
	Protocol string     `json:"protocol"`
	Curve    string     `json:"curve"`
}

type IssuanceInput struct {
	Proof         *backendbn254.Proof
	VK            *backendbn254.VerifyingKey
	Public        fr.Vector
	PublicStrings []string
}

func readJSON(file string, value any) error {
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, value); err != nil {
		return fmt.Errorf("decode %s: %w", file, err)
	}
	return nil
}

func canonicalDecimal(s string, modulus *big.Int) (*big.Int, error) {
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.Sign() < 0 || n.Cmp(modulus) >= 0 || n.String() != s {
		return nil, fmt.Errorf("noncanonical field decimal")
	}
	return n, nil
}

func g1FromJSON(in []string) (bn254.G1Affine, error) {
	var point bn254.G1Affine
	if len(in) != 3 || in[2] != "1" {
		return point, fmt.Errorf("expected affine snarkjs G1 [x,y,1]")
	}
	x, err := canonicalDecimal(in[0], fp.Modulus())
	if err != nil {
		return point, err
	}
	y, err := canonicalDecimal(in[1], fp.Modulus())
	if err != nil {
		return point, err
	}
	point.X.SetBigInt(x)
	point.Y.SetBigInt(y)
	if !point.IsOnCurve() || !point.IsInSubGroup() || point.IsInfinity() {
		return point, fmt.Errorf("invalid/non-subgroup/infinite G1")
	}
	return point, nil
}

func g2FromJSON(in [][]string) (bn254.G2Affine, error) {
	var point bn254.G2Affine
	if len(in) != 3 || len(in[0]) != 2 || len(in[1]) != 2 || len(in[2]) != 2 || in[2][0] != "1" || in[2][1] != "0" {
		return point, fmt.Errorf("expected affine snarkjs G2 [[x0,x1],[y0,y1],[1,0]]")
	}
	var coords [4]*big.Int
	for i, s := range []string{in[0][0], in[0][1], in[1][0], in[1][1]} {
		var err error
		coords[i], err = canonicalDecimal(s, fp.Modulus())
		if err != nil {
			return point, err
		}
	}
	// snarkjs JSON and gnark-crypto use [A0,A1] here. Solidity calldata
	// convention reverses these pairs; this parser intentionally does not.
	point.X.A0.SetBigInt(coords[0])
	point.X.A1.SetBigInt(coords[1])
	point.Y.A0.SetBigInt(coords[2])
	point.Y.A1.SetBigInt(coords[3])
	if !point.IsOnCurve() || !point.IsInSubGroup() || point.IsInfinity() {
		return point, fmt.Errorf("invalid/non-subgroup/infinite G2")
	}
	return point, nil
}

func parseProof(in snarkjsProof) (*backendbn254.Proof, error) {
	if in.Protocol != "groth16" || (in.Curve != "bn128" && in.Curve != "bn254") {
		return nil, fmt.Errorf("expected BN254 Groth16 credential proof")
	}
	p := new(backendbn254.Proof)
	var err error
	if p.Ar, err = g1FromJSON(in.A); err != nil {
		return nil, fmt.Errorf("credential A: %w", err)
	}
	if p.Bs, err = g2FromJSON(in.B); err != nil {
		return nil, fmt.Errorf("credential B: %w", err)
	}
	if p.Krs, err = g1FromJSON(in.C); err != nil {
		return nil, fmt.Errorf("credential C: %w", err)
	}
	return p, nil
}

func parseIssuerVK(data []byte, count int) (*backendbn254.VerifyingKey, error) {
	var in snarkjsVK
	if err := json.Unmarshal(data, &in); err != nil {
		return nil, err
	}
	if in.Protocol != "groth16" || (in.Curve != "bn128" && in.Curve != "bn254") || in.NPublic != count || len(in.IC) != count+1 {
		return nil, fmt.Errorf("expected fixed BN254 Groth16 issuer with %d public signals", count)
	}
	v := new(backendbn254.VerifyingKey)
	var err error
	if v.G1.Alpha, err = g1FromJSON(in.Alpha); err != nil {
		return nil, err
	}
	if v.G2.Beta, err = g2FromJSON(in.Beta); err != nil {
		return nil, err
	}
	if v.G2.Gamma, err = g2FromJSON(in.Gamma); err != nil {
		return nil, err
	}
	if v.G2.Delta, err = g2FromJSON(in.Delta); err != nil {
		return nil, err
	}
	v.G1.K = make([]bn254.G1Affine, len(in.IC))
	for i := range in.IC {
		if v.G1.K[i], err = g1FromJSON(in.IC[i]); err != nil {
			return nil, err
		}
	}
	if err = v.Precompute(); err != nil {
		return nil, err
	}
	return v, nil
}
