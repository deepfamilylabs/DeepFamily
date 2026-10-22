//go:build !js || !wasm

package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"testing"
)

// TestReceiveProductionBatchSmoke runs the same production-engine relation as
// scripts/receive-proof-smoke.mjs while retaining each large proving key for
// all requests that use it. It is opt-in and writes only temporary evidence.
func TestReceiveProductionBatchSmoke(t *testing.T) {
	fixtureDir := os.Getenv("RECEIVE_SMOKE_FIXTURES")
	artifactDir := os.Getenv("RECEIVE_SMOKE_ARTIFACTS")
	if fixtureDir == "" && artifactDir == "" {
		t.Skip("set RECEIVE_SMOKE_FIXTURES and RECEIVE_SMOKE_ARTIFACTS for real production-engine smoke")
	}
	if fixtureDir == "" || artifactDir == "" {
		t.Fatal("both RECEIVE_SMOKE_FIXTURES and RECEIVE_SMOKE_ARTIFACTS are required")
	}
	previousProcs := runtime.GOMAXPROCS(4)
	defer runtime.GOMAXPROCS(previousProcs)
	previousLimit := debug.SetMemoryLimit(5 << 30)
	defer debug.SetMemoryLimit(previousLimit)
	var fixtures struct {
		KeyMode *int `json:"keyMode"`
		Cases   []struct {
			Name  string `json:"name"`
			Kind  string `json:"kind"`
			Input string `json:"input"`
		} `json:"cases"`
	}
	if err := readJSON(filepath.Join(fixtureDir, "fixtures.json"), &fixtures); err != nil {
		t.Fatal(err)
	}
	expectedCases := map[string]string{"anonymous": "anonymous", "transfer": "anonymous", "fund": "fund", "attachment": "attachment"}
	if len(fixtures.Cases) != len(expectedCases) {
		t.Fatalf("expected exactly four fixture cases; got %d", len(fixtures.Cases))
	}
	seen := make(map[string]bool)
	keyMode := -1
	expectedActions := map[string]string{"anonymous": "1", "transfer": "4", "fund": "3", "attachment": "2"}
	for _, item := range fixtures.Cases {
		kind, ok := expectedCases[item.Name]
		if !ok || kind != item.Kind || seen[item.Name] {
			t.Fatalf("unexpected or duplicated fixture: %+v", item)
		}
		seen[item.Name] = true
		var request ProveRequest
		if err := readJSON(item.Input, &request); err != nil {
			t.Fatal(err)
		}
		if request.Kind != kind || request.Presentation.Action != expectedActions[item.Name] || request.Presentation.Depth != "64" || len(request.Presentation.Siblings) != StateDepth {
			t.Fatalf("%s requires its named operation and full 64-level counter path", item.Name)
		}
		modeIndex := 6
		if kind == "fund" {
			modeIndex = 7
		}
		if len(request.CredentialPublicSignals) <= modeIndex || (request.CredentialPublicSignals[modeIndex] != "0" && request.CredentialPublicSignals[modeIndex] != "1") {
			t.Fatalf("%s has no valid authenticated key mode", item.Name)
		}
		mode := int(request.CredentialPublicSignals[modeIndex][0] - '0')
		if keyMode == -1 {
			keyMode = mode
		}
		if keyMode != mode || (fixtures.KeyMode != nil && *fixtures.KeyMode != mode) {
			t.Fatalf("%s key mode differs from the smoke fixture set", item.Name)
		}
		if kind == "attachment" && (request.Attachment == nil || request.Attachment.Depth != "32" || len(request.Attachment.Siblings) != NoteDepth) {
			t.Fatal("attachment requires a full 32-level Fund note path")
		}
	}
	checks := []string{}
	manifests := make(map[string]string)
	positiveCount, mutationCount, rejectionCount := 0, 0, 0
	for _, kind := range []string{"anonymous", "fund", "attachment"} {
		passed := t.Run(kind, func(t *testing.T) {
			artifacts := filepath.Join(artifactDir, kind)
			digest, err := hashFile(filepath.Join(artifacts, "manifest.json"))
			if err != nil {
				t.Fatal(err)
			}
			manifests[kind] = digest
			t.Logf("loading production engine once: %s", kind)
			e, err := loadEngine(artifacts, false)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { e = nil }()
			for _, item := range fixtures.Cases {
				if item.Kind != kind {
					continue
				}
				t.Logf("proving fresh raw-input fixture: %s", item.Name)
				raw, err := os.ReadFile(item.Input)
				if err != nil {
					t.Fatal(err)
				}
				proof, err := e.Prove(raw)
				if err != nil {
					t.Fatalf("%s valid production proof failed: %v", item.Name, err)
				}
				if !proof.Verified {
					t.Fatalf("%s production proof is not marked verified", item.Name)
				}
				wantSignals := 11
				if kind == "attachment" {
					wantSignals = 14
				}
				if len(proof.PublicSignals) != wantSignals {
					t.Fatalf("%s public signal count: got %d; want %d", item.Name, len(proof.PublicSignals), wantSignals)
				}
				if err := e.Verify(*proof); err != nil {
					t.Fatalf("%s independent production verification failed: %v", item.Name, err)
				}
				if err := writeJSON(filepath.Join(fixtureDir, "batch-"+item.Name+".proof.json"), proof); err != nil {
					t.Fatal(err)
				}
				positiveCount++
				pathLabel := ""
				if kind == "attachment" {
					pathLabel = " and 32-level Fund path"
				}
				checks = append(checks, fmt.Sprintf("%s: fresh raw-input proof verifies with full 64-level state path%s", item.Name, pathLabel))
				for index, value := range proof.PublicSignals {
					tampered := *proof
					tampered.PublicSignals = append([]string(nil), proof.PublicSignals...)
					n, ok := new(big.Int).SetString(value, 10)
					if !ok {
						t.Fatal("production proof has non-decimal public signal")
					}
					tampered.PublicSignals[index] = n.Add(n, big.NewInt(1)).String()
					if err := e.Verify(tampered); err == nil {
						t.Fatalf("%s public field mutation at index %d accepted", item.Name, index)
					}
					mutationCount++
				}
				checks = append(checks, item.Name+": every public field mutation rejected by real verifier")
				type mutation struct {
					name   string
					change func(*ProveRequest)
				}
				changes := []mutation{
					{"authenticated recipient", func(r *ProveRequest) {
						index := 3
						if kind == "fund" {
							index = 4
						}
						r.CredentialPublicSignals[index] = "123"
					}},
					{"authenticated alias", func(r *ProveRequest) { r.CredentialPublicSignals[0] = "124" }},
					{"counter state path", func(r *ProveRequest) { r.Presentation.Siblings[63] = "1" }},
					{"expiry from issuer proof", func(r *ProveRequest) { r.Presentation.ExpiresAt = "1900000001" }},
					{"recipient binding", func(r *ProveRequest) { r.Presentation.Binding = "125" }},
					{"operation kind", func(r *ProveRequest) { r.Presentation.Action = "0" }},
					{"zero checkpoint ID", func(r *ProveRequest) { r.Presentation.CheckpointID = "0" }},
				}
				if kind == "attachment" {
					changes = append(changes,
						mutation{"Fund budget owner relation", func(r *ProveRequest) { r.Attachment.Nonce = "99" }},
						mutation{"Fund note membership", func(r *ProveRequest) { r.Attachment.Siblings[31] = "1" }},
						mutation{"Fund attachment relation", func(r *ProveRequest) { r.Attachment.Relation = "126" }},
					)
				}
				for _, change := range changes {
					var request ProveRequest
					if err := json.Unmarshal(raw, &request); err != nil {
						t.Fatal(err)
					}
					change.change(&request)
					altered, err := json.Marshal(request)
					if err != nil {
						t.Fatal(err)
					}
					_, err = e.Prove(altered)
					if err == nil {
						t.Fatalf("%s invalid %s accepted by production prover", item.Name, change.name)
					}
					if !strings.Contains(err.Error(), "receipt constraints rejected witness:") {
						t.Fatalf("%s invalid %s failed outside production constraints: %v", item.Name, change.name, err)
					}
					rejectionCount++
					checks = append(checks, fmt.Sprintf("%s: prover constraints reject %s", item.Name, change.name))
					t.Logf("rejected %s: %s", item.Name, change.name)
				}
			}
		})
		if !passed {
			t.FailNow()
		}
		// Retain only the current kind's large proving key; the anonymous engine
		// above is shared by both anonymous and transfer fixtures.
		debug.FreeOSMemory()
	}
	if positiveCount != 4 || mutationCount != 47 || rejectionCount != 31 || len(checks) != 39 {
		t.Fatalf("incomplete smoke: positive=%d, public mutations=%d, private rejections=%d, checks=%d", positiveCount, mutationCount, rejectionCount, len(checks))
	}
	evidence := struct {
		DevelopmentOnly   bool              `json:"developmentOnly"`
		ProductionReady   bool              `json:"productionReady"`
		CircuitVersion    string            `json:"circuitVersion"`
		KeyMode           int               `json:"keyMode"`
		ArtifactManifests map[string]string `json:"artifactManifests"`
		PositiveProofs    int               `json:"positiveProofs"`
		PublicMutations   int               `json:"publicMutationsRejected"`
		PrivateMutations  int               `json:"privateMutationsRejected"`
		CheckCount        int               `json:"checkCount"`
		Checks            []string          `json:"checks"`
	}{true, false, CircuitVersion, keyMode, manifests, positiveCount, mutationCount, rejectionCount, len(checks), checks}
	if err := writeJSON(filepath.Join(fixtureDir, "batch-smoke-results.json"), evidence); err != nil {
		t.Fatal(err)
	}
	t.Logf("Receive production-engine smoke: %d checks, %d real proofs, %d public mutations, %d private rejections passed", len(checks), positiveCount, mutationCount, rejectionCount)
}
