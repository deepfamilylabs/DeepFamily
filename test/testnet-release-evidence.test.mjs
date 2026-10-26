import { keccak256, toBeHex, Interface } from "ethers";
import { createHash } from "node:crypto";
import { computeRoleStatusIndex } from "@deepfamily/protocol-core";
import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "chai";

import {
  TESTNET_RELEASE_EVIDENCE_TYPE,
  TESTNET_RELEASE_REPORT_SCHEMA_VERSION,
  TESTNET_RELEASE_READINESS_GATES,
  TESTNET_RELEASE_REQUIRED_STEPS,
  validateTestnetReleaseEvidence,
} from "../scripts/lib/testnetReleaseEvidence.mjs";
import { publishTestnetReleaseEvidence } from "../scripts/lib/releaseEvidencePublisher.mjs";
import {
  GROTH16_ADAPTER_IMMUTABLE_FIELDS,
  groth16VerifierAdapterBindingsFromAddresses,
  protocolDeploymentEvidenceFromAcceptanceReport,
  protocolDeploymentEvidenceSha256,
} from "../scripts/lib/protocolReleaseManifest.mjs";
import {
  shieldedDeploymentBindings,
  shieldedDeploymentEvidence,
} from "../scripts/lib/shieldedDeploymentEvidence.mjs";
import { RECEIVE_POOL_INTERFACE, RECEIVE_PROTOCOL_CHECKS } from "../scripts/lib/receiveProtocolEvidence.mjs";
import {
  INTEGRATED_DEPLOYMENT_RECORDS,
  SHIELDED_DEPLOYMENT_CIRCUITS,
  PROTOCOL_DEPLOYMENT_CIRCUITS,
  RECEIVE_DEPLOYMENT_CONTRACTS,
} from "../scripts/lib/zkDeploymentCatalog.mjs";
import { SHIELDED_CIRCUITS } from "../scripts/lib/zkCircuitSelection.mjs";
import {
  MINIMUM_MULTI_PARTY_CONTRIBUTORS,
  MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
  ZK_PRODUCTION_PHASE1,
  ZK_RELEASE_ARTIFACTS,
  ZK_TRUST_MODEL_MULTI_PARTY,
  ZK_TRUST_MODEL_SINGLE_OPERATOR,
} from "../scripts/lib/zkArtifactTrust.mjs";
import { createCanonicalTemporaryDirectory } from "./helpers/temporaryDirectory.mjs";

const ACCEPTANCE_CIRCUITS = {
  ...SHIELDED_DEPLOYMENT_CIRCUITS,
  ...Object.fromEntries(
    Object.entries(PROTOCOL_DEPLOYMENT_CIRCUITS).map(([action, spec]) => [
      action,
      { ...spec, verifierLabel: spec.adapterLabel },
    ]),
  ),
};
const ACCEPTANCE_SOURCES = Object.fromEntries(
  Object.entries(ACCEPTANCE_CIRCUITS).map(([action, spec]) => [action, spec.source]),
);
const COMMIT = "12".repeat(20);
const INPUT_DIGEST = `0x${"34".repeat(32)}`;
const FINALIZED_BLOCK_HASH = `0x${"56".repeat(32)}`;
const FINALIZED_TRANSACTION_HASH = `0x${"78".repeat(32)}`;
const REFUND_TRANSACTION_HASH = `0x${"9a".repeat(32)}`;
const MIN_DELAY = 604800;
const CHAIN_ID = 71;
const DESTINATION_RELATIVE_PATH = "tmp/release-evidence/espace-release-rehearsal.json";
const PROTOCOL = "deepfamily/onchain-biography-unified-passphrase-v1";
const PROTOCOL_GENERATION = "df-onchain-biography-v1";
const PROTOCOL_MANIFEST_SHA256 = "cd".repeat(32);
const GOLDEN_VECTOR_SHA256 = "ef".repeat(32);
const address = (suffix) => `0x${String(suffix).padStart(40, "0")}`;
const GOVERNANCE_SAFE = address(1);
const TIMELOCK = address(3);
const DEEP_FAMILY = address(5);
const DEEP_FAMILY_IMPLEMENTATION = address(6);
const TOKEN = address(7);
const VERIFIER_ADAPTER = address(9);
const READER = address(10);
const SAFE_OWNERS = [address(11), address(12), address(13)];
const PERSON_VERIFIER = address(14);
const DISCLOSURE_BINDING_VERIFIER = address(15);
const ARCHIVE = address(16);
const ADAPTER_ARTIFACT_SHA256 = "31".repeat(32);
const ADAPTER_RUNTIME_SHA256 = "32".repeat(32);
const ARCHIVE_ARTIFACT_SHA256 = "33".repeat(32);
const ARCHIVE_RUNTIME_SHA256 = "34".repeat(32);
const READER_ARTIFACT_SHA256 = "35".repeat(32);
const READER_RUNTIME_SHA256 = "36".repeat(32);
const COMPONENT_HASH = `0x${"ab".repeat(32)}`;
const ROLE_HASH = `0x${"bc".repeat(32)}`;
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const ZERO_HASH = `0x${"00".repeat(32)}`;
const SHIELDED_MANIFEST_SHA256 = "41".repeat(32);
const SHIELDED_ARTIFACT_SHA256 = "42".repeat(32);
const SHIELDED_RUNTIME_SHA256 = "43".repeat(32);
const SHIELDED_SOURCE_SHA256 = "44".repeat(32);
const SHIELDED_WASM_SHA256 = "45".repeat(32);
const SHIELDED_ZKEY_SHA256 = "46".repeat(32);
const SHIELDED_VERIFICATION_KEY_SHA256 = "47".repeat(32);
const SHIELDED_PROOF_SHA256 = createHash("sha256").update(Buffer.from("1234", "hex")).digest("hex");
const RECEIVE_TRANSACTION_SPECS = [
  ["receive-source-fact", "sourceFact"],
  ["receive-source-trust", "sourceTrust"],
  ["receive-issue", "issue"],
  ["receive-native-shield", "shield", "native"],
  ["receive-native-fund", "fund", "native"],
  ["receive-native-append", "append", "native"],
  ["receive-native-fund-second", "fund", "native"],
  ["receive-native-append-second", "append", "native"],
  ["receive-erc20-shield", "shield", "erc20"],
  ["receive-erc20-fund", "fund", "erc20"],
  ["receive-erc20-append", "append", "erc20"],
  ["receive-erc20-claim", "claim", "erc20"],
  ...[0,1,2].flatMap((role) => [
    [`receive-revoke-${role}`, "revokeRole"],
    [`receive-native-other-append-${role}`, "append", "native"],
    [`receive-reissue-fact-${role}`, "sourceFact"],
    [`receive-reissue-trust-${role}`, "sourceTrust"],
    [`receive-reissue-${role}`, "issue"],
  ]),
  ["receive-native-transfer", "transfer", "native"],
  ["receive-letter", "letter"],
  ["receive-native-unshield", "unshield", "native"],
  ["receive-native-unshield4", "unshield4", "native"],
  ["receive-native-claim", "claim", "native"],
];
const RECEIVE_TRANSACTION_RECEIPTS = Object.fromEntries(
  RECEIVE_TRANSACTION_SPECS.map(([label], index) => [label, {
    hash: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    blockNumber: 100 + index,
    blockHash: `0x${(100 + index).toString(16).padStart(64, "0")}`,
    status: 1,
  }]),
);
const REPORT_TRANSACTIONS = {
  "critical-transaction": {
    hash: FINALIZED_TRANSACTION_HASH,
    blockNumber: 100,
    blockHash: FINALIZED_BLOCK_HASH,
    status: 1,
  },
  ...RECEIVE_TRANSACTION_RECEIPTS,
};
const SHIELDED_ADDRESSES = Object.fromEntries(
  INTEGRATED_DEPLOYMENT_RECORDS.filter(
    (record) =>
      record.transactionLabel.startsWith("shielded") ||
      record.transactionLabel.startsWith("protocol") ||
      RECEIVE_DEPLOYMENT_CONTRACTS.some(({ property }) => property === record.property) ||
      ["poseidonT3", "poseidonT4", "poseidonT6", "deepFamilyLineageIndex"].includes(
        record.transactionLabel,
      ),
  ).map((record, index) => [
    record.property === "shieldedErc20Pool" ? "shieldedErc20Pool" : record.transactionLabel,
    address(200 + index),
  ]),
);
const ADAPTER_BINDINGS = groth16VerifierAdapterBindingsFromAddresses({
  groth16VerifierAdapter: VERIFIER_ADAPTER,
  personCommitmentVerifier: PERSON_VERIFIER,
  disclosureBindingVerifier: DISCLOSURE_BINDING_VERIFIER,
  ...SHIELDED_ADDRESSES,
});
const SHIELDED_BINDINGS = shieldedDeploymentBindings({
  deepFamily: DEEP_FAMILY,
  token: TOKEN,
  groth16VerifierAdapter: VERIFIER_ADAPTER,
  ...SHIELDED_ADDRESSES,
});
const SHIELDED_DEPLOYMENT_ARTIFACTS = {
  ...Object.fromEntries(
    ["shieldedVerifiers", "generatedVerifiers", "protocolVerifiers"].map((kind) => [
      kind,
      Object.fromEntries(
        Object.keys(SHIELDED_BINDINGS[kind]).map((action) => [
          action,
          { artifactSha256: SHIELDED_ARTIFACT_SHA256, runtimeSha256: SHIELDED_RUNTIME_SHA256 },
        ]),
      ),
    ]),
  ),
  ...Object.fromEntries(
    [
      "shieldedBoundaryVerifierAdapter",
      "shieldedErc20Pool",
      "shieldedNativePool",
      "shieldedPoolFactory",
      ...RECEIVE_DEPLOYMENT_CONTRACTS.map((spec) => spec.property),
    ].map((key) => [
      key,
      { artifactSha256: SHIELDED_ARTIFACT_SHA256, runtimeSha256: SHIELDED_RUNTIME_SHA256 },
    ]),
  ),
};
const SHIELDED_DEPLOYMENT_EVIDENCE = shieldedDeploymentEvidence(
  SHIELDED_BINDINGS,
  SHIELDED_DEPLOYMENT_ARTIFACTS,
);
const SHIELDED_MANIFEST_CIRCUITS = Object.fromEntries(
  Object.entries(ACCEPTANCE_SOURCES).map(([action, source]) => [
    action,
    {
      source,
      sourceSha256: SHIELDED_SOURCE_SHA256,
      wasmSha256: SHIELDED_WASM_SHA256,
      zkeySha256: SHIELDED_ZKEY_SHA256,
      verificationKeySha256: SHIELDED_VERIFICATION_KEY_SHA256,
    },
  ]),
);
const shieldedArtifactInspector = () => ({
  manifestSha256: SHIELDED_MANIFEST_SHA256,
  manifest: {
    circuits: structuredClone(SHIELDED_MANIFEST_CIRCUITS),
    releaseCriteria: {
      fundMaxGas: 300_000,
      claim3MaxGas: 300_000,
      browserFundMaxMs: 60_000,
      browserClaim3MaxMs: 60_000,
      recoveryMaxMs: 60_000,
      recoveryMinEvents: 1,
    },
  },
});
const VERIFIED_CONTRACTS = [
  ...[
    "GovernanceTimelock",
    "UUPSProxy",
    ...INTEGRATED_DEPLOYMENT_RECORDS.map((record) => record.deploymentName),
  ].map((name) => ["initial-deployment", name]),
];
const EXPECTED_INITIAL_RELEASE_STEPS = [
  "acceptance-source-inputs-unchanged",
  "canonical-safe-1.3.0-two-of-three",
  "canonical-safe-mainnet-infrastructure",
  "canonical-safe-testnet-infrastructure",
  "critical-transactions-finalized",
  "deployment-directory-unchanged",
  "fund-isolated-run-deployer",
  "isolated-integrated-protocol-wiring",
  "production-build-manifest-preflight",
  "protocol-release-manifest-preflight",
  "real-zk-endorsement-nft-story",
  "real-zk-receive-business",
  "release-rehearsal-clean-source-preflight",
  "source-verified-initial-deployment",
  "terminal-governance-state-verified",
  "zk-artifact-trust-preflight",
];

const terminalSafe = (safeAddress, owners, nonce) => ({
  chainId: String(CHAIN_ID),
  safeAddress,
  safeVersion: "1.3.0",
  singleton: address(20),
  owners,
  threshold: 2,
  nonce: String(nonce),
  modules: [],
  guard: ZERO_ADDRESS,
  fallbackHandler: address(21),
  proxyCodeHash: COMPONENT_HASH,
  canonicalProxyCodeHash: COMPONENT_HASH,
  componentCodeHashes: {
    singleton: COMPONENT_HASH,
    proxyFactory: COMPONENT_HASH,
    fallbackHandler: COMPONENT_HASH,
  },
});

const terminalTimelock = (timelockAddress, minDelay) => ({
  address: timelockAddress,
  adminRole: ZERO_HASH,
  admin: timelockAddress,
  roles: {
    PROPOSER_ROLE: ROLE_HASH,
    CANCELLER_ROLE: ROLE_HASH,
    EXECUTOR_ROLE: ROLE_HASH,
  },
  currentMultisig: GOVERNANCE_SAFE,
  minDelay: String(minDelay),
});

const protocolManifestInspector = ({ root, requireProduction }) => {
  if (requireProduction !== true) {
    throw new Error("test protocol manifest inspector requires production validation");
  }
  return {
    manifestPath: path.join(root, "protocol-release-manifest.json"),
    manifestSha256: PROTOCOL_MANIFEST_SHA256,
    manifest: {
      protocol: PROTOCOL,
      protocolGeneration: PROTOCOL_GENERATION,
      releaseStatus: "production",
      goldenVectors: { sha256: GOLDEN_VECTOR_SHA256 },
      proofRoutes: [
        {
          purpose: "PersonRelation",
          purposeOrdinal: 0,
          circuitId: 1,
          proofEncodingId: 1,
        },
        {
          purpose: "DisclosureBinding",
          purposeOrdinal: 1,
          circuitId: 1,
          proofEncodingId: 1,
        },
      ],
      deployments: {
        groth16VerifierAdapter: { artifactSha256: ADAPTER_ARTIFACT_SHA256 },
        deepFamilyArchive: { artifactSha256: ARCHIVE_ARTIFACT_SHA256 },
        deepFamilyReader: { artifactSha256: READER_ARTIFACT_SHA256 },
        shieldedVerifiers: SHIELDED_DEPLOYMENT_EVIDENCE.shieldedVerifiers,
        shieldedBoundaryVerifierAdapter:
          SHIELDED_DEPLOYMENT_EVIDENCE.shieldedBoundaryVerifierAdapter,
        generatedVerifiers: SHIELDED_DEPLOYMENT_EVIDENCE.generatedVerifiers,
        protocolVerifiers: SHIELDED_DEPLOYMENT_EVIDENCE.protocolVerifiers,
        shieldedErc20Pool: SHIELDED_DEPLOYMENT_EVIDENCE.shieldedErc20Pool,
        shieldedNativePool: SHIELDED_DEPLOYMENT_EVIDENCE.shieldedNativePool,
        shieldedPoolFactory: SHIELDED_DEPLOYMENT_EVIDENCE.shieldedPoolFactory,
        ...Object.fromEntries(
          RECEIVE_DEPLOYMENT_CONTRACTS.map(({ property }) => [
            property,
            SHIELDED_DEPLOYMENT_EVIDENCE[property],
          ]),
        ),
      },
    },
  };
};

const protocolDeploymentArtifactInspector = ({ deployments }) => {
  expect({
    groth16VerifierAdapter: deployments.groth16VerifierAdapter,
    deepFamilyArchive: deployments.deepFamilyArchive,
    deepFamilyReader: deployments.deepFamilyReader,
  }).to.deep.equal({
    groth16VerifierAdapter: {
      personVerifierImmutable: PERSON_VERIFIER,
      disclosureBindingVerifierImmutable: DISCLOSURE_BINDING_VERIFIER,
    },
    deepFamilyArchive: { deepFamilyImmutable: DEEP_FAMILY },
    deepFamilyReader: {
      deepFamilyImmutable: DEEP_FAMILY,
      archiveImmutable: ARCHIVE,
    },
  });
  return {
    ...SHIELDED_DEPLOYMENT_ARTIFACTS,
    groth16VerifierAdapter: {
      artifactSha256: ADAPTER_ARTIFACT_SHA256,
      runtimeSha256: ADAPTER_RUNTIME_SHA256,
    },
    deepFamilyArchive: {
      artifactSha256: ARCHIVE_ARTIFACT_SHA256,
      runtimeSha256: ARCHIVE_RUNTIME_SHA256,
    },
    deepFamilyReader: {
      artifactSha256: READER_ARTIFACT_SHA256,
      runtimeSha256: READER_RUNTIME_SHA256,
    },
  };
};

const bindDeploymentEvidence = (report) => {
  report.terminalGovernanceState.deploymentEvidenceSha256 = protocolDeploymentEvidenceSha256(
    protocolDeploymentEvidenceFromAcceptanceReport(report),
  );
  return report;
};

const SCOPES = {
  sourceFact: [3, 4, "eligibilitySource"],
  sourceTrust: [2, 3, "eligibilitySource"],
  issue: [1, 2, "receiveRegistry"],
  code: [3, 4, "receiveRegistry"],
  capability: [5, 6, "receiveRegistry"],
};
const receiveProofs = (chainId) => Object.fromEntries(
  Object.entries(ACCEPTANCE_CIRCUITS).map(([action, spec]) => {
    const signals = Array(spec.publicSignals).fill("0");
    const [chainIndex, scopeIndex, scope] = SCOPES[action] ?? [0,1,"shieldedErc20Pool"];
    signals[chainIndex] = String(chainId);
    signals[scopeIndex] = BigInt(SHIELDED_ADDRESSES[scope]).toString();
    return [action, [{
      source: spec.source,
      verified: true,
      verifierAddress: SHIELDED_ADDRESSES[spec.verifierLabel],
      wasmSha256: SHIELDED_WASM_SHA256,
      zkeySha256: SHIELDED_ZKEY_SHA256,
      verificationKeySha256: SHIELDED_VERIFICATION_KEY_SHA256,
      proofSha256: SHIELDED_PROOF_SHA256,
      publicSignals: signals,
      publicSignalsSha256: createHash("sha256").update(JSON.stringify(signals)).digest("hex"),
      execution: "verifier-call",
      ...(SCOPES[action] ? {} : {asset:"erc20",poolAddress:SHIELDED_ADDRESSES.shieldedErc20Pool}),
    }]];
  }),
);
const RECEIVE_SCOPE = {
  sourceFact: "eligibilitySource", sourceTrust:"eligibilitySource", issue:"receiveRegistry",
  revokeRole:"deepFamily", letter:"letterArchive",
};
const RECEIVE_METHODS = {
  sourceFact:"publishFact(uint256,uint256,address,uint256,uint256,uint256,uint256,bytes)",
  sourceTrust:"publishTrust(uint256,address,uint256,uint256,uint256,bytes)",
  issue:"registerCredential(uint256,uint256,uint256,bytes)",
  revokeRole:"revokeEligibilityRoles(uint8[],uint256[])",
  letter:"registerLetter(uint128,(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint64),bytes,bytes)",
};
const sampleRoleIndices = (generation) => [0,1,2].map((role) => String(computeRoleStatusIndex({role:["child","endorsement","trusted"][role],roleSecret:BigInt(generation * 100 + role)})));
const receiveReceipts = () => Object.fromEntries(RECEIVE_TRANSACTION_SPECS.map(([label,action,asset]) => {
  const record = RECEIVE_TRANSACTION_RECEIPTS[label];
  const key = RECEIVE_SCOPE[action] ?? (asset === "native" ? "shieldedNativePool" : "shieldedErc20Pool");
  const targetAddress = key === "deepFamily" ? DEEP_FAMILY : SHIELDED_ADDRESSES[key];
  const role = Number(label.at(-1));
  const second = label.endsWith("second"), other = label.includes("other-append");
  const binding = other ? "99" : second ? "62" : "61";
  const roles = other ? sampleRoleIndices(9) : action === "claim" && asset === "native" ? sampleRoleIndices(4) : sampleRoleIndices(1);
  const budgetKey = other ? "7999" : asset === "erc20" ? "8000" : second ? "7001" : "7000";
  const code = ["31",binding,"2","3","4","5","6","1000000"];
  const capability = ["100","1","2","3",...roles];
  const inputCount = action === "shield" ? 0 : action === "unshield4" ? 4 : 1;
  const data = [Array(inputCount).fill("0"),Array(inputCount).fill("22"),Array.from({length:inputCount},(_,index)=>String(33+index)),["44","55"],["0x12","0x34"]];
  const proofHashes = {}, publicInput = {};
  const method = action === "fund" || action === "append" ? "depositBudget" : action === "claim" ? "claimBudget" : action === "unshield4" ? "unshield" : action;
  let calldata;
  if (["shield","fund","append","claim","transfer","unshield","unshield4"].includes(action)) {
    Object.assign(publicInput,{inputNullifiers:data[2],outputCommitments:data[3],ciphertextHashes:data[4].map(keccak256)});
    if (action === "shield") { calldata = RECEIVE_POOL_INTERFACE.encodeFunctionData(method,[1000,data,"0x1234"]); publicInput.amount="1000"; }
    if (["fund","append"].includes(action)) {
      calldata = RECEIVE_POOL_INTERFACE.encodeFunctionData(method,[code,capability,"0x1234","0x1234",["71",budgetKey,"1000"],data,"0x1234"]);
      Object.assign(publicInput,{commonBinding:binding,budgetKey,eligibleFrom:"1000",policyCommitment:"71",issuanceRoot:"100",roleIndices:roles,created:action === "fund"});
    }
    if (action === "claim") {
      calldata = RECEIVE_POOL_INTERFACE.encodeFunctionData(method,[[budgetKey,"500","99","100",...roles],data,"0x1234"]);
      Object.assign(publicInput,{commonBinding:binding,budgetKey,eligibleFrom:"1000",policyCommitment:"71",issuanceRoot:"100",periodNullifier:"99",roleIndices:roles});
    }
    if (action === "transfer") { calldata=RECEIVE_POOL_INTERFACE.encodeFunctionData(method,[code,"0x1234",data,"0x1234"]); publicInput.commonBinding=binding; }
    if (["unshield","unshield4"].includes(action)) { calldata=RECEIVE_POOL_INTERFACE.encodeFunctionData(method,[address(99),2,data,"0x1234"]); Object.assign(publicInput,{amount:"2",recipient:address(99)}); }
    proofHashes[action === "append" ? "fund" : action] = SHIELDED_PROOF_SHA256;
    if (["fund","append","transfer"].includes(action)) proofHashes.code=SHIELDED_PROOF_SHA256;
    if (["fund","append"].includes(action)) proofHashes.capability=SHIELDED_PROOF_SHA256;
  } else {
    const iface = new Interface([`function ${RECEIVE_METHODS[action]}`]);
    let args;
    if (action === "sourceFact") { args=[201,202,address(90),1,41,42,43,"0x1234"]; Object.assign(publicInput,{treeId:0,leafIndex:"0",leaf:"41",root:"52",roleCommitments:["42","43"]}); }
    if (action === "sourceTrust") { args=[202,address(90),1,51,52,"0x1234"]; Object.assign(publicInput,{treeId:1,leafIndex:"0",leaf:"51",root:"53",roleCommitments:["52"]}); }
    if (action === "issue") { const credential=label.includes("reissue") ? String(302+role) : "301"; args=[credential,52,53,"0x1234"]; Object.assign(publicInput,{credential,sourceRoot:"52",trustedRoot:"53",issuanceRoot:"100"}); }
    if (action === "revokeRole") { args=[[role],[(role+1)*100+role]]; Object.assign(publicInput,{roles:[role],roleIndices:[sampleRoleIndices(role+1)[role]]}); }
    if (action === "letter") { args=[1,code,"0x1234","0x1234"]; Object.assign(publicInput,{messageId:"1",commonBinding:binding,ciphertextHash:keccak256("0x1234")}); }
    calldata=iface.encodeFunctionData(iface.fragments[0],args);
    if (["sourceFact","sourceTrust","issue"].includes(action)) proofHashes[action]=SHIELDED_PROOF_SHA256;
    if (action === "letter") proofHashes.code=SHIELDED_PROOF_SHA256;
  }
  return [label,{action,...(asset ? {asset} : {}),targetAddress,txHash:record.hash,blockNumber:record.blockNumber,blockHash:record.blockHash,selector:calldata.slice(0,10),gasUsed:"200000",transactionGasLimit:"300000",blockGasLimit:"30000000",data:calldata,calldataHash:keccak256(calldata),proofHashes,publicInput}];
}));
const receiveRoleRevocations = () => [0,1,2].map((role) => {
  const oldIndices = sampleRoleIndices(role+1), otherIndices = sampleRoleIndices(9);
  const rejections = [];
  for (const codeIndex of [0,1]) for (const operation of ["first","append","claim"]) for (const kind of ["revoked","index-substitution","credential-substitution"]) {
    const indices = kind === "credential-substitution" ? [...otherIndices] : [...oldIndices];
    if (kind === "index-substitution") indices[role] = otherIndices[role];
    const code = ["1",String(61+codeIndex),"2","3","4","5","6","1000000"];
    const capability = ["100","1","2","3",...indices];
    const budgetKey = String((operation === "first" ? 9000 : 7000) + codeIndex);
    const data = [["0"],["22"],["33"],["44","55"],["0x12","0x34"]];
    const callData = operation === "claim" ? RECEIVE_POOL_INTERFACE.encodeFunctionData("claimBudget",[[budgetKey,"500","99","100",...indices],data,"0x1234"]) : RECEIVE_POOL_INTERFACE.encodeFunctionData("depositBudget",[code,capability,"0x1234","0x5678",["71",budgetKey,"1000"],data,"0x1234"]);
    const recorded = RECEIVE_TRANSACTION_RECEIPTS[`receive-revoke-${role}`];
    rejections.push({operation,kind,errorName:kind === "revoked" ? "QualificationRevoked" : operation === "claim" ? "InvalidZKProof" : "InvalidProof",errorArgs:kind === "revoked" ? [String(role)] : [],blockNumber:recorded.blockNumber,blockHash:recorded.blockHash,to:SHIELDED_ADDRESSES.shieldedNativePool,from:address(987),data:callData,calldataHash:keccak256(callData),rpcChecks:"passed",publicInput:{commonBinding:String(61+codeIndex),budgetKey,roleIndices:indices,inputNullifiers:["33"],outputCommitments:["44","55"],ciphertextHashes:[keccak256("0x12"),keccak256("0x34")],budgetExists:operation !== "first"}});
  }
  return {role,roleIndex:oldIndices[role],otherRoleIndex:otherIndices[role],transactionLabel:`receive-revoke-${role}`,rejections};
});
const receiveEvidence = (chainId) => ({
  schemaVersion:1,status:"passed",chainId,manifestSha256:SHIELDED_MANIFEST_SHA256,
  proofs:receiveProofs(chainId),checks:Object.fromEntries(RECEIVE_PROTOCOL_CHECKS.map((name)=>[name,true])),
  receipts:{schema:"deepfamily/receive-protocol-receipts@1",chainId,rpcChecks:"passed",transactions:receiveReceipts()},
  roleRevocations:receiveRoleRevocations(),
  reissues:[0,1,2].map((role)=>({role,oldCredential:String(301+role),newCredential:String(302+role),oldRoleIndices:sampleRoleIndices(role+1),newRoleIndices:sampleRoleIndices(role+2),originalBudgetKey:"7000",depositTransactionLabel:"receive-native-fund",claimTransactionLabel:"receive-native-claim"})),
});

const validReportTemplate = () => ({
  schemaVersion: TESTNET_RELEASE_REPORT_SCHEMA_VERSION,
  evidenceType: TESTNET_RELEASE_EVIDENCE_TYPE,
  governanceLifecycleIncluded: false,
  mode: "acceptance",
  acceptanceMode: "release-rehearsal",
  status: "passed",
  releaseReady: true,
  failedStep: null,
  error: null,
  runId: "release-rehearsal-20260728",
  startedAt: "2026-07-28T01:00:00.000Z",
  finishedAt: "2026-07-28T02:00:00.000Z",
  releaseCommit: COMMIT,
  sourceState: {
    commit: COMMIT,
    clean: true,
    changedPathCount: 0,
    unchanged: true,
    acceptanceInputDigest: INPUT_DIGEST,
    acceptanceInputs: { digest: INPUT_DIGEST },
    after: {
      commit: COMMIT,
      clean: true,
      changedPathCount: 0,
      acceptanceInputDigest: INPUT_DIGEST,
      acceptanceInputs: { digest: INPUT_DIGEST },
    },
  },
  network: {
    name: "confluxTestnet",
    chainId: String(CHAIN_ID),
    confirmations: 2,
    finality: {
      required: true,
      status: "passed",
      lastCriticalBlock: Math.max(...Object.values(REPORT_TRANSACTIONS).map((record) => record.blockNumber)),
      finalizedBlockNumber: 200,
      finalizedBlockHash: FINALIZED_BLOCK_HASH,
      revalidatedTransactionCount: Object.keys(REPORT_TRANSACTIONS).length,
      revalidatedTransactions: Object.entries(REPORT_TRANSACTIONS).map(([label, receipt]) => ({
        label,
        ...receipt,
      })),
    },
  },
  transactions: structuredClone(REPORT_TRANSACTIONS),
  addresses: {
    governanceSafe: GOVERNANCE_SAFE,
    safeOwners: SAFE_OWNERS,
    timelock: TIMELOCK,
    deepFamily: DEEP_FAMILY,
    deepFamilyImplementation: DEEP_FAMILY_IMPLEMENTATION,
    token: TOKEN,
    personCommitmentVerifier: PERSON_VERIFIER,
    disclosureBindingVerifier: DISCLOSURE_BINDING_VERIFIER,
    groth16VerifierAdapter: VERIFIER_ADAPTER,
    archive: ARCHIVE,
    deepFamilyReader: READER,
    ...SHIELDED_ADDRESSES,
  },
  timelockDeployment: { minDelaySeconds: MIN_DELAY },
  buildState: {
    hardhatBuildProfile: "production",
    artifactsFileCount: 49,
    buildInfoFileCount: 2,
    productionSettingsMatched: true,
  },
  isolatedDeploymentArtifacts: {
    productionWriterExercised: true,
  },
  protocolManifestEvidence: {
    path: "protocol-release-manifest.json",
    sha256: PROTOCOL_MANIFEST_SHA256,
    protocol: PROTOCOL,
    protocolGeneration: PROTOCOL_GENERATION,
    releaseStatus: "production",
    goldenVectorSha256: GOLDEN_VECTOR_SHA256,
  },
  zkArtifactTrust: {
    status: "passed",
    trustedSetupStatus: "production",
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    productionReady: true,
    ceremonyId: "deepfamily-production-2026-01",
    manifestSha256: "11".repeat(32),
    transcriptSha256: "22".repeat(32),
    phase1Source: ZK_PRODUCTION_PHASE1.source,
    phase1Sha256: ZK_PRODUCTION_PHASE1.sha256,
    phase1Blake2b512: ZK_PRODUCTION_PHASE1.blake2b512,
    phase1Bytes: ZK_PRODUCTION_PHASE1.bytes,
    minimumContributors: MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
    contributorCount: MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
  },
  zkCeremonyVerification: {
    status: "passed",
    ceremonyId: "deepfamily-production-2026-01",
    manifestSha256: "11".repeat(32),
    transcriptSha256: "22".repeat(32),
    trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
    minimumContributors: MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
    contributorCount: MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
    ptau: {
      bytes: ZK_PRODUCTION_PHASE1.bytes,
      sha256: ZK_PRODUCTION_PHASE1.sha256,
      blake2b512: ZK_PRODUCTION_PHASE1.blake2b512,
    },
    circuits: Object.keys(ZK_RELEASE_ARTIFACTS),
    circuitCount:
      Object.keys(ZK_RELEASE_ARTIFACTS).length + Object.keys(ACCEPTANCE_CIRCUITS).length,
    shielded: {
      status: "passed",
      circuitCount: Object.keys(ACCEPTANCE_CIRCUITS).length,
      manifestSha256: SHIELDED_MANIFEST_SHA256,
      ptau: {
        bytes: ZK_PRODUCTION_PHASE1.bytes,
        sha256: ZK_PRODUCTION_PHASE1.sha256,
        blake2b512: ZK_PRODUCTION_PHASE1.blake2b512,
      },
    },
  },
  shieldedArtifacts: {
    status: "passed",
    productionReady: true,
    manifestSha256: SHIELDED_MANIFEST_SHA256,
    circuits: structuredClone(SHIELDED_MANIFEST_CIRCUITS),
  },
  receiveProtocol: receiveEvidence(CHAIN_ID),
  productionParity: {
    canonicalSafeImplementationMatched: true,
    sameSafeManifestOnTestnetAndMainnet: true,
    mainnetCanonicalSafeInfrastructureMatched: true,
    sameTimelockArtifactAndConfigResolver: true,
    sameProtocolDeploymentHelper: true,
    sameDeploymentMetadataWriter: true,
    criticalTransactionsFinalized: true,
    cleanReleaseCommit: true,
    productionBuildProfileMatched: true,
    productionSafeProfileMatched: true,
    artifactManifestCaptured: true,
    productionCompilerSettingsMatched: true,
    productionTrustedSetupMatched: true,
    productionCeremonyVerified: true,
  },
  releaseReadinessGates: Object.fromEntries(
    TESTNET_RELEASE_READINESS_GATES.map((name) => [name, true]),
  ),
  verification: {
    enabled: true,
    status: "passed",
    contracts: VERIFIED_CONTRACTS.map(([phase, label], index) => ({
      phase,
      label,
      address: address(100 + index),
      attempts: 1,
      status: "passed",
    })),
    phases: [{ phase: "initial-deployment", status: "passed" }],
  },
  terminalGovernanceState: {
    status: "passed",
    observedAfterFinality: true,
    observedAtBlock: 201,
    safe: terminalSafe(GOVERNANCE_SAFE, SAFE_OWNERS, 8),
    timelock: terminalTimelock(TIMELOCK, MIN_DELAY),
    deepFamily: {
      address: DEEP_FAMILY,
      owner: TIMELOCK,
      implementation: DEEP_FAMILY_IMPLEMENTATION,
      archive: ARCHIVE,
      personCommitmentVerifier: VERIFIER_ADAPTER,
      disclosureBindingVerifier: VERIFIER_ADAPTER,
      protocolEndorsementFeeBps: "500",
    },
    token: {
      address: TOKEN,
      owner: ZERO_ADDRESS,
      deepFamilyContract: DEEP_FAMILY,
      deepFamilyTokenFromProtocol: TOKEN,
    },
    reader: {
      address: READER,
      deepFamily: DEEP_FAMILY,
      archive: ARCHIVE,
      artifactSha256: READER_ARTIFACT_SHA256,
      runtimeSha256: READER_RUNTIME_SHA256,
    },
    verifierAdapter: {
      address: VERIFIER_ADAPTER,
      personVerifier: PERSON_VERIFIER,
      disclosureBindingVerifier: DISCLOSURE_BINDING_VERIFIER,
      ...Object.fromEntries(
        GROTH16_ADAPTER_IMMUTABLE_FIELDS.map((getter) => [
          getter,
          ADAPTER_BINDINGS[`${getter}Immutable`],
        ]),
      ),
      artifactSha256: ADAPTER_ARTIFACT_SHA256,
      runtimeSha256: ADAPTER_RUNTIME_SHA256,
    },
    archive: {
      address: ARCHIVE,
      deepFamily: DEEP_FAMILY,
      artifactSha256: ARCHIVE_ARTIFACT_SHA256,
      runtimeSha256: ARCHIVE_RUNTIME_SHA256,
    },
    ...structuredClone(SHIELDED_DEPLOYMENT_EVIDENCE),
    proofRoutes: [
      {
        purpose: "PersonRelation",
        purposeOrdinal: 0,
        circuitId: 1,
        proofEncodingId: 1,
      },
      {
        purpose: "DisclosureBinding",
        purposeOrdinal: 1,
        circuitId: 1,
        proofEncodingId: 1,
      },
    ],
    deploymentEvidenceSha256: null,
  },
  budget: {
    refund: {
      status: "passed",
      transaction: { hash: REFUND_TRANSACTION_HASH, status: 1 },
    },
  },
  onchain: { status: "passed" },
  deploymentsDirectory: { unchanged: true },
  steps: EXPECTED_INITIAL_RELEASE_STEPS.map((name) => ({ name, status: "passed" })),
});

const validReport = () => bindDeploymentEvidence(validReportTemplate());

const expectRejected = async (operation, pattern) => {
  let error;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  }
  expect(error, "expected operation to reject").to.be.an("error");
  expect(error.message).to.match(pattern);
};

describe("schema v1 initial-mainnet-release rehearsal evidence", function () {
  let repositoryRoot;
  let reportPath;
  let destinationPath;

  const validate = (overrides = {}) =>
    validateTestnetReleaseEvidence({
      reportPath,
      repositoryRoot,
      expectedTestnetChainId: CHAIN_ID,
      expectedTestnetNetworkName: "confluxTestnet",
      mainnetMinDelaySeconds: MIN_DELAY,
      currentCommit: COMMIT,
      protocolManifestInspector,
      protocolDeploymentArtifactInspector,
      shieldedArtifactInspector,
      ...overrides,
    });

  const writeReport = async (report = validReport(), target = reportPath) => {
    const raw = `${JSON.stringify(report, null, 2)}\n`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, raw);
    return raw;
  };

  const publish = (overrides = {}) =>
    publishTestnetReleaseEvidence({
      sourceReportPath: reportPath,
      destinationRelativePath: DESTINATION_RELATIVE_PATH,
      repositoryRoot,
      expectedTestnetChainId: CHAIN_ID,
      expectedTestnetNetworkName: "confluxTestnet",
      mainnetMinDelaySeconds: MIN_DELAY,
      currentCommit: COMMIT,
      expectedAcceptanceInputDigest: INPUT_DIGEST,
      protocolManifestInspector,
      protocolDeploymentArtifactInspector,
      shieldedArtifactInspector,
      ...overrides,
    });

  const expectNoStagedEvidence = async () => {
    let entries = [];
    try {
      entries = await fs.readdir(path.dirname(destinationPath));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    expect(entries.filter((entry) => entry.endsWith(".staged.json"))).to.deep.equal([]);
  };

  beforeEach(async function () {
    repositoryRoot = await createCanonicalTemporaryDirectory(
      "deepfamily-testnet-release-evidence-",
    );
    reportPath = path.join(repositoryRoot, "archive", "release-rehearsal.json");
    destinationPath = path.join(repositoryRoot, ...DESTINATION_RELATIVE_PATH.split("/"));
  });

  afterEach(async function () {
    await fs.rm(repositoryRoot, { recursive: true, force: true });
  });

  it("pins the exact initial-release evidence identity and required step policy", function () {
    expect(TESTNET_RELEASE_REPORT_SCHEMA_VERSION).to.equal(1);
    expect(TESTNET_RELEASE_EVIDENCE_TYPE).to.equal("initial-mainnet-release");
    expect(TESTNET_RELEASE_REQUIRED_STEPS).to.deep.equal(EXPECTED_INITIAL_RELEASE_STEPS);
  });

  it("accepts an explicit in-repository report and returns a frozen public summary and SHA-256", async function () {
    const raw = await writeReport();
    const result = await validate();

    expect(result.reportPath).to.equal(reportPath);
    expect(result.reportSha256).to.equal(createHash("sha256").update(raw).digest("hex"));
    expect(result.publicSummary.evidenceFile).to.deep.include({
      fileName: "release-rehearsal.json",
      location: "repository",
      repositoryRelativePath: "archive/release-rehearsal.json",
      sha256: result.reportSha256,
    });
    expect(result.publicSummary).to.deep.include({
      schemaVersion: 1,
      evidenceType: TESTNET_RELEASE_EVIDENCE_TYPE,
      governanceLifecycleIncluded: false,
      acceptanceMode: "release-rehearsal",
      releaseReady: true,
      releaseCommit: COMMIT,
      minDelaySeconds: MIN_DELAY,
      readinessGateCount: TESTNET_RELEASE_READINESS_GATES.length,
      passedStepCount: EXPECTED_INITIAL_RELEASE_STEPS.length,
    });
    expect(result.publicSummary.network).to.deep.equal({
      name: "confluxTestnet",
      chainId: "71",
      confirmations: 2,
    });
    expect(result.publicSummary.verification.verifiedContractCount).to.equal(
      VERIFIED_CONTRACTS.length,
    );
    expect(result.publicSummary.zkArtifacts).to.deep.equal({
      status: "passed",
      trustedSetupStatus: "production",
      trustModel: ZK_TRUST_MODEL_SINGLE_OPERATOR,
      contributorCount: MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
      minimumContributors: MINIMUM_SINGLE_OPERATOR_CONTRIBUTORS,
      productionReady: true,
    });
    expect(result.publicSummary.protocolManifest).to.deep.equal({
      sha256: PROTOCOL_MANIFEST_SHA256,
      protocol: PROTOCOL,
      protocolGeneration: PROTOCOL_GENERATION,
      goldenVectorSha256: GOLDEN_VECTOR_SHA256,
    });
    expect(result.publicSummary.finality.revalidatedTransactionCount).to.equal(
      Object.keys(REPORT_TRANSACTIONS).length,
    );
    expect(result.publicSummary.receiveProtocol).to.deep.include({
      manifestSha256: SHIELDED_MANIFEST_SHA256,
      proofCount: Object.keys(ACCEPTANCE_CIRCUITS).length,
    });
    expect(result.publicSummary.receiveProtocol.verifierCallActions).to.deep.equal(Object.keys(ACCEPTANCE_CIRCUITS));
    expect(result.publicSummary.receiveProtocol.transactionCount).to.equal(RECEIVE_TRANSACTION_SPECS.length);
    expect(result.publicSummary.receiveProtocol.rejectionCount).to.equal(54);
    expect(result.publicSummary.receiveProtocol.reissueCount).to.equal(3);
    expect(result.publicSummary.refund.transactionHash).to.equal(REFUND_TRANSACTION_HASH);
    expect(Object.isFrozen(result)).to.equal(true);
    expect(Object.isFrozen(result.publicSummary)).to.equal(true);
    expect(Object.isFrozen(result.publicSummary.finality)).to.equal(true);
  });

  it("publishes the exact validated bytes to the fixed repository-relative path with private permissions", async function () {
    const raw = await writeReport();
    const expectedSha256 = createHash("sha256").update(raw).digest("hex");

    const result = await publish();

    expect(result).to.deep.equal({
      reportPath: destinationPath,
      repositoryRelativePath: DESTINATION_RELATIVE_PATH,
      reportSha256: expectedSha256,
    });
    expect(await fs.readFile(destinationPath, "utf8")).to.equal(raw);
    if (process.platform !== "win32") {
      expect((await fs.lstat(destinationPath)).mode & 0o777).to.equal(0o600);
    }
    expect((await validate({ reportPath: destinationPath })).reportSha256).to.equal(expectedSha256);
    await expectNoStagedEvidence();
  });

  it("atomically replaces an existing regular evidence file with newly validated evidence", async function () {
    const priorBytes = '{"prior":"evidence"}\n';
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, priorBytes, { mode: 0o644 });
    const stateBefore = await fs.lstat(destinationPath);
    const report = validReport();
    report.runId = "release-rehearsal-20260728-replacement";
    const raw = await writeReport(report);

    const result = await publish();
    const stateAfter = await fs.lstat(destinationPath);

    expect(await fs.readFile(destinationPath, "utf8")).to.equal(raw);
    expect(result.reportSha256).to.equal(createHash("sha256").update(raw).digest("hex"));
    expect(stateAfter.ino).to.not.equal(stateBefore.ino);
    if (process.platform !== "win32") {
      expect(stateAfter.mode & 0o777).to.equal(0o600);
    }
    await expectNoStagedEvidence();
  });

  it("does not replace existing evidence when the source report is invalid", async function () {
    const priorBytes = Buffer.from('{"prior":"validated-evidence"}\n');
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, priorBytes, { mode: 0o600 });
    const stateBefore = await fs.lstat(destinationPath);
    const report = validReport();
    report.status = "failed";
    await writeReport(report);

    await expectRejected(() => publish(), /status must be "passed"/iu);

    expect(await fs.readFile(destinationPath)).to.deep.equal(priorBytes);
    expect((await fs.lstat(destinationPath)).ino).to.equal(stateBefore.ino);
    await expectNoStagedEvidence();
  });

  it("rejects a destination symlink without writing through it", async function () {
    const victimPath = path.join(repositoryRoot, "victim.json");
    const victimBytes = Buffer.from('{"must":"remain-unchanged"}\n');
    await writeReport();
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(victimPath, victimBytes);
    await fs.symlink(victimPath, destinationPath);

    await expectRejected(
      () => publish(),
      /existing release evidence destination must be a regular non-symlink file/iu,
    );

    expect((await fs.lstat(destinationPath)).isSymbolicLink()).to.equal(true);
    expect(await fs.readFile(victimPath)).to.deep.equal(victimBytes);
    await expectNoStagedEvidence();
  });

  it("rejects a symlinked destination parent without writing outside the repository", async function () {
    const externalRoot = await createCanonicalTemporaryDirectory(
      "deepfamily-release-evidence-symlink-target-",
    );
    try {
      await writeReport();
      await fs.mkdir(path.join(repositoryRoot, "tmp"));
      await fs.symlink(externalRoot, path.join(repositoryRoot, "tmp", "release-evidence"), "dir");

      await expectRejected(
        () => publish(),
        /release evidence directory must be a real directory/iu,
      );

      expect(await fs.readdir(externalRoot)).to.deep.equal([]);
    } finally {
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("removes the staged file when the final atomic rename fails", async function () {
    const priorBytes = Buffer.from('{"prior":"validated-evidence"}\n');
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.writeFile(destinationPath, priorBytes, { mode: 0o600 });
    await writeReport();
    const originalRename = fs.rename;
    fs.rename = async (source, destination) => {
      if (destination === destinationPath) {
        throw new Error("simulated atomic rename failure");
      }
      return originalRename(source, destination);
    };
    try {
      await expectRejected(() => publish(), /simulated atomic rename failure/iu);
    } finally {
      fs.rename = originalRename;
    }

    expect(await fs.readFile(destinationPath)).to.deep.equal(priorBytes);
    await expectNoStagedEvidence();
  });

  it("uses caller-selected chain evidence and is not hard-coded to eSpace", async function () {
    const sepoliaChainId = 11155111;
    const report = validReport();
    report.network.name = "sepolia";
    report.network.chainId = String(sepoliaChainId);
    report.terminalGovernanceState.safe.chainId = String(sepoliaChainId);
    report.receiveProtocol.receipts.chainId = sepoliaChainId;
    report.receiveProtocol.chainId = sepoliaChainId;
    for (const [action, samples] of Object.entries(report.receiveProtocol.proofs)) for (const proof of samples) {
      proof.publicSignals[SCOPES[action]?.[0] ?? 0] = String(sepoliaChainId);
      proof.publicSignalsSha256 = createHash("sha256")
        .update(JSON.stringify(proof.publicSignals))
        .digest("hex");
    }
    bindDeploymentEvidence(report);
    await writeReport(report);

    const result = await validate({
      expectedTestnetChainId: sepoliaChainId,
      expectedTestnetNetworkName: "sepolia",
    });
    expect(result.publicSummary.network).to.deep.equal({
      name: "sepolia",
      chainId: String(sepoliaChainId),
      confirmations: 2,
    });
  });

  it("binds the report to the currently inspected production protocol manifest", async function () {
    const cases = [
      ["path", "other-manifest.json", /protocolManifestEvidence\.path/iu],
      ["sha256", "ab".repeat(32), /protocolManifestEvidence\.sha256/iu],
      ["protocol", "deepfamily/other-protocol", /protocolManifestEvidence\.protocol/iu],
      ["protocolGeneration", "other-generation", /protocolManifestEvidence\.protocolGeneration/iu],
      ["releaseStatus", "candidate", /protocolManifestEvidence\.releaseStatus/iu],
      ["goldenVectorSha256", "ab".repeat(32), /protocolManifestEvidence\.goldenVectorSha256/iu],
    ];
    for (const [field, value, pattern] of cases) {
      const report = validReport();
      report.protocolManifestEvidence[field] = value;
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }

    await writeReport(validReport());
    await expectRejected(
      () => validate({ protocolManifestInspector: null }),
      /protocolManifestInspector must be a function/iu,
    );
    await expectRejected(
      () => validate({ protocolDeploymentArtifactInspector: null }),
      /protocolDeploymentArtifactInspector must be a function/iu,
    );
  });

  it("requires an explicit regular JSON file and rejects symlinks", async function () {
    await writeReport();
    await expectRejected(
      () => validate({ reportPath: undefined }),
      /reportPath must be supplied explicitly/iu,
    );

    const textPath = path.join(repositoryRoot, "report.txt");
    await fs.writeFile(textPath, "{}");
    await expectRejected(() => validate({ reportPath: textPath }), /explicit \.json file/iu);

    const directoryPath = path.join(repositoryRoot, "directory.json");
    await fs.mkdir(directoryPath);
    await expectRejected(() => validate({ reportPath: directoryPath }), /must be a regular file/iu);

    const symlinkPath = path.join(repositoryRoot, "linked-report.json");
    await fs.symlink(reportPath, symlinkPath);
    await expectRejected(
      () => validate({ reportPath: symlinkPath }),
      /must not be a symbolic link/iu,
    );

    const symlinkedDirectory = path.join(repositoryRoot, "linked-archive");
    await fs.symlink(path.dirname(reportPath), symlinkedDirectory, "dir");
    await expectRejected(
      () =>
        validate({
          reportPath: path.join(symlinkedDirectory, path.basename(reportPath)),
        }),
      /must not traverse a symbolic link/iu,
    );

    const invalidJsonPath = path.join(repositoryRoot, "invalid.json");
    await fs.writeFile(invalidJsonPath, "{not-json");
    await expectRejected(
      () => validate({ reportPath: invalidJsonPath }),
      /must contain valid JSON/iu,
    );
  });

  it("rejects an external archive by default and accepts one only through the explicit opt-in", async function () {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    const externalRoot = await createCanonicalTemporaryDirectory(
      "deepfamily-external-release-archive-",
    );
    const externalReportPath = path.join(externalRoot, "release.json");
    try {
      await writeReport(validReport(), externalReportPath);
      await expectRejected(
        () => validate({ reportPath: externalReportPath }),
        /inside repositoryRoot unless allowExternalArchive=true/iu,
      );
      const result = await validate({
        reportPath: externalReportPath,
        allowExternalArchive: true,
      });
      expect(result.publicSummary.evidenceFile.location).to.equal("external-archive");
      expect(result.publicSummary.evidenceFile.repositoryRelativePath).to.equal(null);
    } finally {
      await fs.rm(externalRoot, { recursive: true, force: true });
    }
  });

  it("strictly requires the release report identity and exact target chain", async function () {
    const mutations = [
      ["schemaVersion", 5, /schemaVersion must be 1/iu],
      ["schemaVersion", 6, /schemaVersion must be 1/iu],
      ["evidenceType", "governance-lifecycle", /evidenceType must be "initial-mainnet-release"/iu],
      ["governanceLifecycleIncluded", true, /governanceLifecycleIncluded must be false/iu],
      ["mode", "recovery", /mode must be "acceptance"/iu],
      ["acceptanceMode", "diagnostic", /acceptanceMode must be "release-rehearsal"/iu],
      ["status", "failed", /status must be "passed"/iu],
      ["releaseReady", false, /releaseReady must be true/iu],
    ];
    for (const [field, value, pattern] of mutations) {
      const report = validReport();
      report[field] = value;
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }

    await writeReport(validReport());
    await expectRejected(
      () => validate({ expectedTestnetChainId: 11155111 }),
      /network\.chainId must be 11155111/iu,
    );
    await expectRejected(
      () => validate({ expectedTestnetNetworkName: "sepolia" }),
      /network\.name must be "sepolia"/iu,
    );
  });

  it("rejects governance lifecycle fields, contracts, steps, addresses and transactions", async function () {
    const forbiddenCases = [
      [(report) => (report.governance = {}), /forbidden governance lifecycle fields: governance/iu],
      [
        (report) => (report.governanceLifecycle = {}),
        /forbidden governance lifecycle fields: governanceLifecycle/iu,
      ],
      [(report) => (report.treasury = {}), /forbidden governance lifecycle fields: treasury/iu],
      [(report) => (report.upgrade = {}), /forbidden governance lifecycle fields: upgrade/iu],
      [
        (report) => (report.addresses.replacementTimelock = address(90)),
        /addresses contains forbidden governance lifecycle fields: replacementTimelock/iu,
      ],
      [
        (report) => (report.productionParity.sharedGovernanceOperationBuildersMatched = true),
        /sharedGovernanceOperationBuildersMatched is forbidden/iu,
      ],
      [
        (report) => (report.verification.gateBeforeUpgradeSchedule = true),
        /gateBeforeUpgradeSchedule is forbidden/iu,
      ],
      ...[
        ["initial-deployment", "GovernedVerifierCandidate"],
        ["upgrade-candidate", "DeepFamilyUpgradeMock"],
        ["governance-replacements", "ReplacementGovernanceTimelock"],
      ].map(([phase, label], index) => [
        (report) =>
          report.verification.contracts.push({
            phase,
            label,
            address: address(300 + index),
            attempts: 1,
            status: "passed",
          }),
        /exactly the schema v1 initial-release contract set/iu,
      ]),
      ...[
        "delayed-deep-treasury-transfer",
        "safe-delay-timelock-and-treasury-migrations",
        "safe-timelock-schedule-wait-execute-cancel",
        "storage-safe-timelocked-uups-upgrade",
      ].map((name) => [
        (report) => report.steps.push({ name, status: "passed" }),
        /exactly the schema v1 initial-release step set/iu,
      ]),
      ...[
        "fee-update-schedule",
        "fee-update-execute",
        "uups-upgrade",
        "governance-safe-migration",
        "treasury-transfer",
        "deploy-Groth16VerifierAdapter",
        "deploy-DeepFamilyUpgradeMock",
        "deploy-ReplacementGovernanceTimelock",
      ].map((label) => [
        (report) => {
          const receipt = report.transactions["critical-transaction"];
          delete report.transactions["critical-transaction"];
          report.transactions[label] = receipt;
          report.network.finality.revalidatedTransactions[0].label = label;
        },
        /forbidden governance lifecycle content/iu,
      ]),
    ];

    for (const [mutate, pattern] of forbiddenCases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("binds releaseCommit and both source snapshots to the current clean commit and digest", async function () {
    const cases = [
      [(report) => (report.releaseCommit = "ab".repeat(20)), /releaseCommit must be "1212/iu],
      [(report) => (report.sourceState.clean = false), /sourceState\.clean must be true/iu],
      [(report) => (report.sourceState.unchanged = false), /sourceState\.unchanged must be true/iu],
      [
        (report) => (report.sourceState.after.commit = "ab".repeat(20)),
        /sourceState\.after\.commit/iu,
      ],
      [
        (report) => (report.sourceState.after.acceptanceInputDigest = `0x${"cd".repeat(32)}`),
        /sourceState\.after\.acceptanceInputDigest/iu,
      ],
      [
        (report) => (report.sourceState.after.acceptanceInputs.digest = `0x${"ef".repeat(32)}`),
        /sourceState\.after\.acceptanceInputs\.digest/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }

    await writeReport(validReport());
    await expectRejected(
      () =>
        validate({
          expectedAcceptanceInputDigest: `0x${"fe".repeat(32)}`,
        }),
      /sourceState\.acceptanceInputDigest must be "0xfefe/iu,
    );
    const result = await validate({ expectedAcceptanceInputDigest: INPUT_DIGEST });
    expect(result.publicSummary.sourceInputDigest).to.equal(INPUT_DIGEST);
  });

  it("requires report and terminal Timelock delays to equal the Mainnet MIN_DELAY", async function () {
    const deploymentMismatch = validReport();
    deploymentMismatch.timelockDeployment.minDelaySeconds = MIN_DELAY + 1;
    await writeReport(deploymentMismatch);
    await expectRejected(() => validate(), /timelockDeployment\.minDelaySeconds must be 604800/iu);

    const terminalMismatch = validReport();
    terminalMismatch.terminalGovernanceState.timelock.minDelay = String(MIN_DELAY + 1);
    await writeReport(terminalMismatch);
    await expectRejected(
      () => validate(),
      /terminalGovernanceState\.timelock\.minDelay must be 604800/iu,
    );

    await writeReport(validReport());
    for (const minDelay of [30, 86400, 172800, 604799]) {
      await expectRejected(
        () => validate({ mainnetMinDelaySeconds: minDelay }),
        /mainnetMinDelaySeconds must be a safe integer >= 604800/iu,
      );
    }
  });

  it("requires the exact schema v1 readiness gate set and every gate to be true", async function () {
    const failedGate = validReport();
    failedGate.releaseReadinessGates.refundCompleted = false;
    await writeReport(failedGate);
    await expectRejected(() => validate(), /releaseReadinessGates\.refundCompleted must be true/iu);

    const missingGate = validReport();
    delete missingGate.releaseReadinessGates.cleanReleaseCommit;
    await writeReport(missingGate);
    await expectRejected(() => validate(), /exactly the schema v1 initial-release gate set/iu);

    const extraGate = validReport();
    extraGate.releaseReadinessGates.unrecognizedGate = true;
    await writeReport(extraGate);
    await expectRejected(() => validate(), /exactly the schema v1 initial-release gate set/iu);
  });

  it("requires production Trusted Setup evidence behind the production configuration gate", async function () {
    const cases = [
      [(report) => (report.zkArtifactTrust.status = "failed"), /zkArtifactTrust\.status/iu],
      [
        (report) => (report.zkArtifactTrust.trustedSetupStatus = "development"),
        /zkArtifactTrust\.trustedSetupStatus/iu,
      ],
      [
        (report) => (report.zkArtifactTrust.productionReady = false),
        /zkArtifactTrust\.productionReady/iu,
      ],
      [
        (report) => (report.productionParity.productionTrustedSetupMatched = false),
        /productionParity\.productionTrustedSetupMatched/iu,
      ],
      [
        (report) => (report.releaseReadinessGates.productionConfigurationMatched = false),
        /releaseReadinessGates\.productionConfigurationMatched/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("accepts a valid multi-party report with at least two declared contributors", async function () {
    const report = validReport();
    for (const evidence of [report.zkArtifactTrust, report.zkCeremonyVerification]) {
      evidence.trustModel = ZK_TRUST_MODEL_MULTI_PARTY;
      evidence.minimumContributors = MINIMUM_MULTI_PARTY_CONTRIBUTORS;
      evidence.contributorCount = MINIMUM_MULTI_PARTY_CONTRIBUTORS;
    }
    await writeReport(report);

    const result = await validate();

    expect(result.publicSummary.zkArtifacts).to.deep.include({
      trustModel: ZK_TRUST_MODEL_MULTI_PARTY,
      contributorCount: MINIMUM_MULTI_PARTY_CONTRIBUTORS,
      minimumContributors: MINIMUM_MULTI_PARTY_CONTRIBUTORS,
    });
  });

  it("cross-checks ZK trustModel, contributor thresholds and Phase 1 evidence", async function () {
    const cases = [
      [
        (report) => (report.zkArtifactTrust.trustModel = "unknown-model"),
        /zkArtifactTrust\.trustModel is unsupported/iu,
      ],
      [
        (report) => (report.zkArtifactTrust.minimumContributors = 2),
        /zkArtifactTrust\.minimumContributors must be 1/iu,
      ],
      [
        (report) => (report.zkArtifactTrust.contributorCount = 2),
        /zkArtifactTrust\.contributorCount must be 1/iu,
      ],
      [
        (report) => (report.zkArtifactTrust.phase1Source = "https://example.invalid/tampered.ptau"),
        /zkArtifactTrust\.phase1Source/iu,
      ],
      [(report) => (report.zkArtifactTrust.phase1Bytes += 1), /zkArtifactTrust\.phase1Bytes/iu],
      [
        (report) => (report.zkArtifactTrust.phase1Sha256 = "55".repeat(32)),
        /zkArtifactTrust\.phase1Sha256/iu,
      ],
      [
        (report) => (report.zkArtifactTrust.phase1Blake2b512 = "66".repeat(64)),
        /zkArtifactTrust\.phase1Blake2b512/iu,
      ],
      [
        (report) => (report.zkCeremonyVerification.trustModel = ZK_TRUST_MODEL_MULTI_PARTY),
        /zkCeremonyVerification\.trustModel/iu,
      ],
      [
        (report) => (report.zkCeremonyVerification.minimumContributors = 2),
        /zkCeremonyVerification\.minimumContributors/iu,
      ],
      [
        (report) => (report.zkCeremonyVerification.contributorCount = 2),
        /zkCeremonyVerification\.contributorCount/iu,
      ],
      [
        (report) => (report.zkCeremonyVerification.ptau.blake2b512 = "55".repeat(64)),
        /zkCeremonyVerification\.ptau\.blake2b512/iu,
      ],
      [
        (report) => (report.zkCeremonyVerification.ptau.bytes += 1),
        /zkCeremonyVerification\.ptau\.bytes/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }

    const weakMultiParty = validReport();
    for (const evidence of [
      weakMultiParty.zkArtifactTrust,
      weakMultiParty.zkCeremonyVerification,
    ]) {
      evidence.trustModel = ZK_TRUST_MODEL_MULTI_PARTY;
      evidence.minimumContributors = 1;
      evidence.contributorCount = 1;
    }
    await writeReport(weakMultiParty);
    await expectRejected(
      () => validate(),
      /multi-party contributor counts do not meet the declared threshold/iu,
    );
  });

  it("cross-checks readiness gates against their production parity and build inputs", async function () {
    const cases = [
      [
        (report) => (report.productionParity.canonicalSafeImplementationMatched = false),
        /productionParity\.canonicalSafeImplementationMatched/iu,
      ],
      [
        (report) => (report.productionParity.sameProtocolDeploymentHelper = false),
        /productionParity\.sameProtocolDeploymentHelper/iu,
      ],
      [
        (report) => (report.productionParity.productionCompilerSettingsMatched = false),
        /productionParity\.productionCompilerSettingsMatched/iu,
      ],
      [
        (report) => (report.buildState.hardhatBuildProfile = "default"),
        /buildState\.hardhatBuildProfile/iu,
      ],
      [(report) => (report.buildState.artifactsFileCount = 0), /buildState\.artifactsFileCount/iu],
      [
        (report) => (report.isolatedDeploymentArtifacts.productionWriterExercised = false),
        /isolatedDeploymentArtifacts\.productionWriterExercised/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("fails closed when verification, finality, terminal governance or refund evidence is weak", async function () {
    const cases = [
      [(report) => (report.verification.status = "failed"), /verification\.status/iu],
      [
        (report) => (report.verification.contracts[0].status = "pending"),
        /verification\.contracts\[0\]\.status/iu,
      ],
      [(report) => (report.network.finality.status = "pending"), /network\.finality\.status/iu],
      [
        (report) => (report.network.finality.revalidatedTransactionCount = 2),
        /transactions must be non-empty and match/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.status = "pending"),
        /terminalGovernanceState\.status/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.observedAfterFinality = false),
        /observedAfterFinality/iu,
      ],
      [(report) => (report.budget.refund.status = "failed"), /budget\.refund\.status/iu],
      [
        (report) => (report.budget.refund.transaction.status = 0),
        /budget\.refund\.transaction\.status/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("accepts a schema-valid not-needed refund and rejects inconsistent zero-balance claims", async function () {
    const report = validReport();
    report.budget.refund = {
      status: "not-needed",
      balanceBefore: "0",
      amount: "0",
      balanceAfter: "0",
    };
    await writeReport(report);
    const result = await validate();
    expect(result.publicSummary.refund).to.deep.equal({
      status: "not-needed",
      transactionHash: null,
    });

    report.budget.refund.transaction = { hash: REFUND_TRANSACTION_HASH, status: 1 };
    await writeReport(report);
    await expectRejected(
      () => validate(),
      /transaction must be absent when refund is not-needed/iu,
    );
  });

  it("requires complete transaction finality, verification, step and terminal state evidence", async function () {
    const cases = [
      [
        (report) => delete report.transactions["critical-transaction"],
        /transactions must be non-empty and match/iu,
      ],
      [
        (report) => (report.network.finality.revalidatedTransactions[0].blockNumber = 99),
        /revalidatedTransactions\[0\]\.blockNumber/iu,
      ],
      [
        (report) => report.verification.contracts.pop(),
        /exactly the schema v1 initial-release contract set/iu,
      ],
      [
        (report) =>
          (report.steps = report.steps.filter(
            (step) => step.name !== "terminal-governance-state-verified",
          )),
        /exactly the schema v1 initial-release step set/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.safe.threshold = 1),
        /terminalGovernanceState\.safe\.threshold/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.token.owner = address(999)),
        /terminalGovernanceState\.token\.owner/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.deepFamily.owner = address(998)),
        /terminalGovernanceState\.deepFamily\.owner/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.deepFamily.implementation = address(997)),
        /terminalGovernanceState\.deepFamily\.implementation/iu,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.deepFamily.personCommitmentVerifier = address(996)),
        /terminalGovernanceState\.deepFamily\.personCommitmentVerifier/iu,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.deepFamily.disclosureBindingVerifier = address(995)),
        /terminalGovernanceState\.deepFamily\.disclosureBindingVerifier/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.deepFamily.protocolEndorsementFeeBps = "502"),
        /terminalGovernanceState\.deepFamily\.protocolEndorsementFeeBps/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.reader.deepFamily = address(999)),
        /terminalGovernanceState\.reader\.deepFamily/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.deepFamily.archive = address(999)),
        /terminalGovernanceState\.deepFamily\.archive/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.verifierAdapter.personVerifier = address(999)),
        /terminalGovernanceState\.verifierAdapter\.personVerifier/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.archive.deepFamily = address(999)),
        /terminalGovernanceState\.archive\.deepFamily/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.reader.archive = address(999)),
        /terminalGovernanceState\.reader\.archive/iu,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.verifierAdapter.artifactSha256 = "91".repeat(32)),
        /Groth16VerifierAdapter artifactSha256/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.archive.runtimeSha256 = "92".repeat(32)),
        /DeepFamilyArchive runtimeSha256/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.proofRoutes[0].proofEncodingId = 2),
        /terminalGovernanceState\.proofRoutes/iu,
      ],
      [
        (report) => (report.terminalGovernanceState.deploymentEvidenceSha256 = "93".repeat(32)),
        /terminalGovernanceState\.deploymentEvidenceSha256/iu,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("binds every catalogued proof artifact, statement and scope to the selected chain", async function () {
    const cases = [
      [
        (report) => (report.shieldedArtifacts.manifestSha256 = "ff".repeat(32)),
        /shieldedArtifacts.manifestSha256/u,
      ],
      [(report) => delete report.shieldedArtifacts.circuits.code, /shieldedArtifacts.circuits/u],
      [
        (report) => (report.shieldedArtifacts.circuits.fund.zkeySha256 = "ff".repeat(32)),
        /shieldedArtifacts.fund.zkeySha256/u,
      ],
      [
        (report) => (report.zkCeremonyVerification.circuitCount = 5),
        /zkCeremonyVerification.circuitCount/u,
      ],
      [
        (report) => (report.zkCeremonyVerification.shielded.circuitCount = 3),
        /zkCeremonyVerification.shielded.circuitCount/u,
      ],
      [(report) => delete report.receiveProtocol.proofs.claim, /receiveProtocol.proofs/u],
      [
        (report) => (report.receiveProtocol.proofs.fund[0].verified = false),
        /receiveProtocol.proofs.fund.*verified/u,
      ],
      [
        (report) => (report.receiveProtocol.proofs.shield[0].verifierAddress = address(999)),
        /receiveProtocol.proofs.shield.*verifierAddress/u,
      ],
      [
        (report) => (report.receiveProtocol.proofs.sourceFact[0].publicSignals[3] = "11155111"),
        /receiveProtocol.proofs.sourceFact.*publicSignalsSha256/u,
      ],
      [
        (report) => (report.receiveProtocol.proofs.claim[0].execution = "transaction"),
        /transactionLabel is required/u,
      ],
      [
        (report) => (report.receiveProtocol.checks.sameCodeAppends = false),
        /receiveProtocol.checks.sameCodeAppends/u,
      ],
      [
        (report) => (report.receiveProtocol.checks.offlinePayer = false),
        /receiveProtocol.checks.offlinePayer/u,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });
  it("rejects receiving receipt and canonical immutable binding tampering", async function () {
    const cases = [
      [(report) => (report.receiveProtocol.receipts.chainId = 11155111), /receiveProtocol.receipts.chainId/u],
      [
        (report) => (report.receiveProtocol.receipts.transactions["receive-native-fund"].selector = "0x12345678"),
        /receiveProtocol receipt selector/u,
      ],
      [
        (report) => { report.receiveProtocol.receipts.transactions["receive-native-fund"].gasUsed = "300001"; report.receiveProtocol.receipts.transactions["receive-native-fund"].transactionGasLimit = "400000"; },
        /receiveProtocol deposit exceeds/u,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.shieldedErc20Pool.tokenImmutable = address(999)),
        /ShieldedErc20Pool must bind/u,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.shieldedErc20Pool.receiveRegistryImmutable =
            address(999)),
        /shared receiving registry/u,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.protocolVerifiers.fund.verifierImmutable = address(999)),
        /adapter must bind/u,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.shieldedBoundaryVerifierAdapter.shieldVerifierImmutable =
            address(999)),
        /boundary route/u,
      ],
      [
        (report) =>
          (report.terminalGovernanceState.shieldedErc20Pool.runtimeSha256 = "ff".repeat(32)),
        /ShieldedErc20Pool runtimeSha256/u,
      ],
    ];
    for (const [mutate, pattern] of cases) {
      const report = validReport();
      mutate(report);
      await writeReport(report);
      await expectRejected(() => validate(), pattern);
    }
  });

  it("enforces a bounded report size before parsing", async function () {
    await writeReport();
    await expectRejected(() => validate({ maxReportBytes: 10 }), /exceeds maxReportBytes/iu);
  });
});
