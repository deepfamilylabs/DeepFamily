package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	backendbn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	"github.com/consensys/gnark/std/math/emulated"
	stdgroth16 "github.com/consensys/gnark/std/recursion/groth16"
)

func fail(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "ERROR:", err)
		os.Exit(1)
	}
}

func writeJSON(file string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(file, append(data, '\n'), 0o600)
}

func writeBinary(file string, value io.WriterTo) error {
	f, err := os.Create(file)
	if err != nil {
		return err
	}
	_, err = value.WriteTo(f)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func publicStrings(vec fr.Vector) []string {
	values := make([]string, len(vec))
	for i := range vec {
		values[i] = vec[i].String()
	}
	return values
}

func main() {
	inputDir := flag.String("input-dir", "", "temporary issuance proof directory")
	mode := flag.String("mode", "0", "issuance key mode: 0 or 1")
	outDir := flag.String("out-dir", "", "artifact directory; default is a new OS temporary directory")
	extrasFile := flag.String("extras-json", "", "native application/checkpoint witness JSON")
	constantsFile := flag.String("poseidon-constants", "", "native Poseidon constants JSON")
	nativeOnly := flag.Bool("native-only", false, "only parse and verify snarkjs input with gnark native verifier")
	parseOnly := flag.Bool("parse-only", false, "alias of --native-only")
	compileOnly := flag.Bool("compile-only", false, "compile the full circuit without setup or proving")
	checkInnerTamper := flag.Bool("check-inner-tamper", false, "solve negative circuits for each of the 11 private issuer signals")
	reuseSetup := flag.String("reuse-setup", "", "reuse a temporary composition.r1cs/pk/vk directory for --cases-json")
	casesFile := flag.String("cases-json", "", "fixture manifest for valid and invalid cases using a reused setup")
	fundManifest := flag.String("fund-manifest", "", "full Fund relation and issuer fixture manifest")
	attachmentManifest := flag.String("attachment-manifest", "", "anonymous attached-letter research fixture manifest")
	transferManifest := flag.String("transfer-manifest", "", "private-transfer receive authorization research fixture manifest")
	exportBrowserCase := flag.String("export-browser-witness", "", "export a synthetic fixture witness for browser proving")
	flag.Parse()
	if *transferManifest != "" {
		fail(runTransferManifest(*transferManifest, *reuseSetup, *outDir, *compileOnly))
		return
	}
	if *exportBrowserCase != "" {
		fail(exportBrowserWitness(*fundManifest, *attachmentManifest, *exportBrowserCase, *outDir))
		return
	}
	if *attachmentManifest != "" {
		fail(runAttachmentManifest(*attachmentManifest, *reuseSetup, *outDir, *compileOnly))
		return
	}
	if *fundManifest != "" {
		fail(runFundManifest(*fundManifest, *reuseSetup, *outDir, *compileOnly))
		return
	}
	if *reuseSetup != "" {
		if *casesFile == "" || *constantsFile == "" {
			fail(fmt.Errorf("--reuse-setup requires --cases-json and --poseidon-constants"))
		}
		fail(runReusableCases(*reuseSetup, *casesFile, *constantsFile, *outDir))
		return
	}
	if *inputDir == "" || (*mode != "0" && *mode != "1") {
		fail(fmt.Errorf("--input-dir and --mode 0|1 are required"))
	}
	if *outDir == "" {
		var err error
		*outDir, err = os.MkdirTemp("", "deepfamily-private-composition-")
		fail(err)
	}
	fail(os.MkdirAll(*outDir, 0o700))
	fmt.Println("RESEARCH ONLY: insecure local setup; no production ceremony or deployment")
	fmt.Println("Artifacts:", *outDir)
	summary := map[string]any{
		"scope":     "research-only private BN254 Groth16-in-Groth16 issuance authentication with native application constraints",
		"goVersion": runtime.Version(), "gnarkVersion": "v0.16.4", "mode": *mode,
		"gomaxprocs": runtime.GOMAXPROCS(0), "productionCeremony": false,
	}
	start := time.Now()
	input, err := loadIssuance(*inputDir, *mode)
	fail(err)
	fail(backendbn254.Verify(input.Proof, input.VK, input.Public))
	nativeTamperChecks := 0
	for i := range input.Public {
		changed := append(fr.Vector(nil), input.Public...)
		one := fr.One()
		changed[i].Add(&changed[i], &one)
		if backendbn254.Verify(input.Proof, input.VK, changed) == nil {
			fail(fmt.Errorf("native issuer verifier accepted changed public signal %d", i))
		}
		nativeTamperChecks++
	}
	summary["nativeInputVerifyMillis"] = time.Since(start).Milliseconds()
	summary["nativeInputPublicTamperChecks"] = nativeTamperChecks
	summary["snarkjsG2Order"] = "JSON [A0,A1] -> gnark [A0,A1], no Solidity-style reversal"
	vkData, err := os.ReadFile(filepath.Join(*inputDir, "research.vkey.json"))
	fail(err)
	vkHash := sha256.Sum256(vkData)
	summary["fixedIssuanceVK_SHA256"] = hex.EncodeToString(vkHash[:])
	fmt.Println("Native snarkjs input conversion verified; eleven changed issuer signals rejected")
	if *nativeOnly || *parseOnly {
		fail(writeJSON(filepath.Join(*outDir, "summary.json"), summary))
		return
	}
	if *extrasFile == "" || *constantsFile == "" {
		fail(fmt.Errorf("full circuit requires --extras-json and --poseidon-constants"))
	}
	fail(LoadPoseidonConstants(*constantsFile))
	extras, err := LoadNativeExtras(*extrasFile, input.PublicStrings)
	fail(err)
	fixedVK, err := stdgroth16.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](input.VK)
	fail(err)
	circuit := &MainCircuit{
		VK: fixedVK,
		InnerWitness: stdgroth16.Witness[sw_bn254.ScalarField]{
			Public: make([]emulated.Element[sw_bn254.ScalarField], issuancePublicCount),
		},
	}
	proofValue, err := stdgroth16.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](input.Proof)
	fail(err)
	innerValue := stdgroth16.Witness[sw_bn254.ScalarField]{Public: make([]emulated.Element[sw_bn254.ScalarField], issuancePublicCount)}
	for i := range input.Public {
		innerValue.Public[i] = sw_bn254.NewScalar(input.Public[i])
	}
	assignment := &MainCircuit{VK: fixedVK, Proof: proofValue, InnerWitness: innerValue, Extras: extras}
	fmt.Println("Compiling private issuance recursion plus native application circuit")
	start = time.Now()
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, circuit)
	fail(err)
	summary["compileMillis"] = time.Since(start).Milliseconds()
	summary["constraints"] = ccs.GetNbConstraints()
	summary["publicVariablesIncludingOne"] = ccs.GetNbPublicVariables()
	summary["secretVariables"] = ccs.GetNbSecretVariables()
	fail(writeBinary(filepath.Join(*outDir, "composition.r1cs"), ccs))
	fail(writeJSON(filepath.Join(*outDir, "summary.json"), summary))
	if *compileOnly {
		return
	}
	fullWitness, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	fail(err)
	publicWitness, err := fullWitness.Public()
	fail(err)
	outerPublic, ok := publicWitness.Vector().(fr.Vector)
	if !ok {
		fail(fmt.Errorf("unexpected public vector type"))
	}
	fail(writeJSON(filepath.Join(*outDir, "public.json"), publicStrings(outerPublic)))
	fmt.Println("Running INSECURE local development Groth16 setup")
	start = time.Now()
	pk, vk, err := groth16.Setup(ccs)
	fail(err)
	summary["setupMillis"] = time.Since(start).Milliseconds()
	fail(writeBinary(filepath.Join(*outDir, "composition.pk"), pk))
	fail(writeBinary(filepath.Join(*outDir, "composition.vk"), vk))
	solFile, err := os.Create(filepath.Join(*outDir, "CompositionVerifier.sol"))
	fail(err)
	fail(vk.ExportSolidity(solFile))
	fail(solFile.Close())
	fmt.Println("Proving private issuance verification and native application constraints")
	start = time.Now()
	outerProof, err := groth16.Prove(ccs, pk, fullWitness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16))
	fail(err)
	summary["proveMillis"] = time.Since(start).Milliseconds()
	start = time.Now()
	fail(groth16.Verify(outerProof, vk, publicWitness, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)))
	summary["verifyMillis"] = time.Since(start).Milliseconds()
	fail(writeBinary(filepath.Join(*outDir, "proof.bin"), outerProof))
	proofBN := outerProof.(*backendbn254.Proof)
	fail(writeJSON(filepath.Join(*outDir, "proof.json"), map[string]any{
		"solidityProof":   "0x" + hex.EncodeToString(proofBN.MarshalSolidity()),
		"publicSignals":   publicStrings(outerPublic),
		"commitmentCount": len(proofBN.Commitments),
	}))
	outerChecks := 0
	for i := range outerPublic {
		changed := append(fr.Vector(nil), outerPublic...)
		one := fr.One()
		changed[i].Add(&changed[i], &one)
		if backendbn254.Verify(proofBN, vk.(*backendbn254.VerifyingKey), changed, solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)) == nil {
			fail(fmt.Errorf("outer verifier accepted changed public signal %d", i))
		}
		outerChecks++
	}
	summary["outerPublicTamperChecks"] = outerChecks
	summary["outerProofCommitments"] = len(proofBN.Commitments)
	summary["solidityProofBytes"] = len(proofBN.MarshalSolidity())
	summary["verified"] = true
	var memory runtime.MemStats
	runtime.ReadMemStats(&memory)
	summary["goHeapSysBytes"] = memory.HeapSys
	summary["goTotalAllocBytes"] = memory.TotalAlloc
	summary["outerPublicSignalValues"] = publicStrings(outerPublic)
	summary["innerPublicSignalsRemainPrivate"] = true
	if *checkInnerTamper {
		fmt.Println("Checking eleven changed private issuance statements using the reused proving key")
		for i := range input.Public {
			changedAssignment := *assignment
			changedAssignment.InnerWitness.Public = append([]emulated.Element[sw_bn254.ScalarField](nil), assignment.InnerWitness.Public...)
			changed := input.Public[i]
			one := fr.One()
			changed.Add(&changed, &one)
			changedAssignment.InnerWitness.Public[i] = sw_bn254.NewScalar(changed)
			badWitness, err := frontend.NewWitness(&changedAssignment, ecc.BN254.ScalarField())
			fail(err)
			if _, err := groth16.Prove(ccs, pk, badWitness, solidity.WithProverTargetSolidityVerifier(backend.GROTH16)); err == nil {
				fail(fmt.Errorf("recursive circuit accepted changed private issuer signal %d", i))
			}
		}
		summary["recursivePrivateInputConstraintRejections"] = issuancePublicCount
		summary["negativeCheckScope"] = "prover constraint-solving rejection; no proof was produced for invalid witnesses"
	}
	fail(writeJSON(filepath.Join(*outDir, "summary.json"), summary))
	fmt.Printf("SUCCESS: %d constraints, %d public signals, %d outer tamper rejections\n", ccs.GetNbConstraints(), len(outerPublic), outerChecks)
}
