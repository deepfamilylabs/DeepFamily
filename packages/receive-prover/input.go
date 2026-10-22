package main

import (
	"encoding/json"
	"fmt"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

type PresentationJSON struct {
	ChainID      string   `json:"chainId"`
	Consumer     string   `json:"consumer"`
	Action       string   `json:"action"`
	MessageID    string   `json:"messageId"`
	CipherLo     string   `json:"cipherLo"`
	CipherHi     string   `json:"cipherHi"`
	CheckpointID string   `json:"checkpointId"`
	StateRoot    string   `json:"stateRoot"`
	AsOf         string   `json:"asOf"`
	ExpiresAt    string   `json:"expiresAt"`
	Binding      string   `json:"binding"`
	Salt         string   `json:"salt"`
	Depth        string   `json:"depth"`
	Siblings     []string `json:"siblings"`
	OldKey       string   `json:"oldKey"`
	OldValue     string   `json:"oldValue"`
	IsOld0       string   `json:"isOld0"`
	Absent       string   `json:"absent"`
}

type AttachmentJSON struct {
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

// This raw input contains no identity preimage, spending key or HPKE secret.
// It is sufficient to construct a fresh full gnark witness inside a Worker.
type ProveRequest struct {
	Kind                    string           `json:"kind"`
	CredentialProof         snarkjsProof     `json:"credentialProof"`
	CredentialPublicSignals []string         `json:"credentialPublicSignals"`
	Presentation            PresentationJSON `json:"presentation"`
	Attachment              *AttachmentJSON  `json:"attachment,omitempty"`
}

func issuerCount(kind string) (int, error) {
	switch kind {
	case "anonymous", "attachment":
		return 11, nil
	case "fund":
		return 12, nil
	}
	return 0, fmt.Errorf("unsupported receipt kind %q", kind)
}

func validDecimals(items ...string) error {
	for i, v := range items {
		if _, err := canonicalDecimal(v, fr.Modulus()); err != nil {
			return fmt.Errorf("input decimal %d: %w", i, err)
		}
	}
	return nil
}

func (v PresentationJSON) assignment() (Presentation, error) {
	if len(v.Siblings) != StateDepth {
		return Presentation{}, fmt.Errorf("state path requires exactly %d padded siblings", StateDepth)
	}
	if err := validDecimals(v.ChainID, v.Consumer, v.Action, v.MessageID, v.CipherLo, v.CipherHi, v.CheckpointID, v.StateRoot, v.AsOf, v.ExpiresAt, v.Binding, v.Salt, v.Depth, v.OldKey, v.OldValue, v.IsOld0, v.Absent); err != nil {
		return Presentation{}, err
	}
	if err := validDecimals(v.Siblings...); err != nil {
		return Presentation{}, err
	}
	u := Presentation{ChainID: v.ChainID, Consumer: v.Consumer, Action: v.Action, MessageID: v.MessageID, CipherLo: v.CipherLo, CipherHi: v.CipherHi, CheckpointID: v.CheckpointID, StateRoot: v.StateRoot, AsOf: v.AsOf, ExpiresAt: v.ExpiresAt, Binding: v.Binding, Salt: v.Salt, Depth: v.Depth, OldKey: v.OldKey, OldValue: v.OldValue, IsOld0: v.IsOld0, Absent: v.Absent}
	for i := range u.Siblings {
		u.Siblings[i] = v.Siblings[i]
	}
	return u, nil
}

func (v AttachmentJSON) assignment() (Attachment, error) {
	if len(v.Siblings) != NoteDepth {
		return Attachment{}, fmt.Errorf("note path requires exactly %d padded siblings", NoteDepth)
	}
	if err := validDecimals(v.BudgetPool, v.BudgetRoot, v.Relation, v.Policy, v.Enrollment, v.Rate, v.Remaining, v.Nonce, v.CiphertextHash, v.Depth, v.Index); err != nil {
		return Attachment{}, err
	}
	if err := validDecimals(v.Siblings...); err != nil {
		return Attachment{}, err
	}
	a := Attachment{BudgetPool: v.BudgetPool, BudgetRoot: v.BudgetRoot, Relation: v.Relation, Policy: v.Policy, Enrollment: v.Enrollment, Rate: v.Rate, Remaining: v.Remaining, Nonce: v.Nonce, CiphertextHash: v.CiphertextHash, Depth: v.Depth, Index: v.Index}
	for i := range a.Siblings {
		a.Siblings[i] = v.Siblings[i]
	}
	return a, nil
}

func buildAssignment(req ProveRequest) (frontend.Circuit, error) {
	count, err := issuerCount(req.Kind)
	if err != nil {
		return nil, err
	}
	if len(req.CredentialPublicSignals) != count {
		return nil, fmt.Errorf("expected exactly %d credential signals", count)
	}
	if err = validDecimals(req.CredentialPublicSignals...); err != nil {
		return nil, err
	}
	p, err := parseProof(req.CredentialProof)
	if err != nil {
		return nil, err
	}
	pv, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](p)
	if err != nil {
		return nil, err
	}
	inner := stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], count)}
	for i, s := range req.CredentialPublicSignals {
		inner.Public[i] = emulated.ValueOf[sw_bn254.ScalarField](s)
	}
	u, err := req.Presentation.assignment()
	if err != nil {
		return nil, err
	}
	c := ReceiptCircuit{Proof: pv, InnerWitness: inner, Kind: req.Kind, Presentation: u}
	if req.Kind != "attachment" {
		if req.Attachment != nil {
			return nil, fmt.Errorf("unexpected attachment witness")
		}
		return &c, nil
	}
	if req.Attachment == nil {
		return nil, fmt.Errorf("missing attachment witness")
	}
	a, err := req.Attachment.assignment()
	if err != nil {
		return nil, err
	}
	return &AttachedCircuit{Receipt: c, Attachment: a}, nil
}

func requestWitness(data []byte, kind string) (witness.Witness, error) {
	var req ProveRequest
	if err := json.Unmarshal(data, &req); err != nil {
		return nil, fmt.Errorf("invalid receipt input JSON")
	}
	if req.Kind != kind {
		return nil, fmt.Errorf("receipt kind differs from loaded fixed circuit")
	}
	a, err := buildAssignment(req)
	if err != nil {
		return nil, err
	}
	return frontend.NewWitness(a, ecc.BN254.ScalarField())
}
