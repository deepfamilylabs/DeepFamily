import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCircuitArguments,
  selectCircuitNames,
} from "../../scripts/lib/zkCircuitSelection.mjs";
import { calculateCircuitProofIsolated, calculateWitnessIsolated } from "./witness_helper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "proof", name), "utf8"));

async function expectRejected(label, operation) {
  try {
    await operation();
  } catch {
    console.log(`PASS: ${label}`);
    return;
  }
  throw new Error(`${label}: circuit accepted an invalid witness`);
}

const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MAX_UINT160 = (1n << 160n) - 1n;
const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const withPresentParent = (input, role) => {
  const result = {
    ...input,
    [`has${role[0].toUpperCase()}${role.slice(1)}`]: 1,
    [`${role}SuiteId`]: input.selfSuiteId,
  };
  for (const field of [
    "nameField",
    "derivedSecretField",
    "isBirthBC",
    "birthYear",
    "birthMonth",
    "birthDay",
    "gender",
  ]) {
    result[`${role}${field[0].toUpperCase()}${field.slice(1)}`] = input[field];
  }
  return result;
};

async function runPersonConstraintTests() {
  const personInput = readFixture("person_commitment_input.json");
  const personResult = await calculateWitnessIsolated(personInput);
  if (personResult.publicSignals.length !== 5) {
    throw new Error(
      `PersonRelation must expose exactly 5 signals, got ${personResult.publicSignals.length}`,
    );
  }
  console.log("PASS: PersonRelation valid five-signal proof");

  const maximumPersonInput = {
    ...personInput,
    selfSuiteId: MAX_UINT32.toString(),
    submitter: MAX_UINT160.toString(),
    contentDigestLo: MAX_UINT128.toString(),
    contentDigestHi: MAX_UINT128.toString(),
  };
  const maximumPerson = await calculateWitnessIsolated(maximumPersonInput);
  const expectedPacked = MAX_UINT160 + (MAX_UINT32 << 160n);
  if (maximumPerson.publicSignals[3] !== expectedPacked.toString()) {
    throw new Error("PersonRelation maximum uint160/uint32 packed signal changed");
  }
  console.log("PASS: PersonRelation accepts exact uint160/uint32/uint128 maxima");

  // All three roles instantiate IdentityCommitmentCore. Present parents ensure
  // rejection comes from its month constraint, not the canonical null mask.
  for (const [role, input, monthField] of [
    ["self", personInput, "birthMonth"],
    ["father", withPresentParent(personInput, "father"), "fatherBirthMonth"],
    ["mother", withPresentParent(personInput, "mother"), "motherBirthMonth"],
  ]) {
    for (const birthMonth of [0, 12]) {
      await calculateWitnessIsolated({ ...input, [monthField]: birthMonth });
      console.log(`PASS: PersonRelation accepts ${role} birthMonth == ${birthMonth}`);
    }
    await expectRejected(`PersonRelation rejects ${role} birthMonth > 12`, () =>
      calculateWitnessIsolated({ ...input, [monthField]: 13 }),
    );
    // The old comparator accepted these negative field representatives because
    // its input was not independently constrained to the advertised bit width.
    for (const offset of [3n, 2n, 1n]) {
      await expectRejected(`PersonRelation rejects ${role} birthMonth == p-${offset}`, () =>
        calculateWitnessIsolated({
          ...input,
          [monthField]: (SNARK_FIELD - offset).toString(),
        }),
      );
    }
  }
  await expectRejected("PersonRelation rejects birthDay > 31", () =>
    calculateWitnessIsolated({ ...personInput, birthDay: 32 }),
  );
  await expectRejected("PersonRelation rejects selfSuiteId == 0", () =>
    calculateWitnessIsolated({ ...personInput, selfSuiteId: 0 }),
  );
  await expectRejected("PersonRelation rejects a 129-bit low digest limb", () =>
    calculateWitnessIsolated({ ...personInput, contentDigestLo: (1n << 128n).toString() }),
  );
  await expectRejected("PersonRelation rejects a 129-bit high digest limb", () =>
    calculateWitnessIsolated({ ...personInput, contentDigestHi: (1n << 128n).toString() }),
  );
  await expectRejected("PersonRelation rejects a 161-bit submitter", () =>
    calculateWitnessIsolated({ ...personInput, submitter: (1n << 160n).toString() }),
  );
  await expectRejected("PersonRelation rejects a 33-bit selfSuiteId", () =>
    calculateWitnessIsolated({ ...personInput, selfSuiteId: (1n << 32n).toString() }),
  );
}

async function runDisclosureConstraintTests() {
  const disclosureInput = readFixture("disclosure_binding_input.json");
  const disclosureResult = await calculateCircuitProofIsolated(
    disclosureInput,
    "disclosure_binding",
  );
  if (disclosureResult.publicSignals.length !== 4) {
    throw new Error(
      `DisclosureBinding must expose exactly 4 signals, got ${disclosureResult.publicSignals.length}`,
    );
  }
  console.log("PASS: DisclosureBinding valid four-signal proof");

  const maximumDisclosure = await calculateCircuitProofIsolated(
    {
      ...disclosureInput,
      minter: MAX_UINT160.toString(),
      selfSuiteId: MAX_UINT32.toString(),
    },
    "disclosure_binding",
  );
  if (maximumDisclosure.publicSignals[2] !== MAX_UINT160.toString()) {
    throw new Error("DisclosureBinding maximum uint160 minter changed");
  }
  console.log("PASS: DisclosureBinding accepts exact uint160/uint32 maxima");

  await expectRejected("DisclosureBinding rejects selfSuiteId == 0", () =>
    calculateCircuitProofIsolated({ ...disclosureInput, selfSuiteId: 0 }, "disclosure_binding"),
  );
  await expectRejected("DisclosureBinding rejects a 33-bit selfSuiteId", () =>
    calculateCircuitProofIsolated(
      { ...disclosureInput, selfSuiteId: (1n << 32n).toString() },
      "disclosure_binding",
    ),
  );
  await expectRejected("DisclosureBinding rejects a 161-bit minter", () =>
    calculateCircuitProofIsolated(
      { ...disclosureInput, minter: (1n << 160n).toString() },
      "disclosure_binding",
    ),
  );
}

async function runInheritanceConstraintTests() {
  const { buildFamilyInheritanceFixture } = await import("./generate_family_inheritance_input.mjs");
  const { witness } = buildFamilyInheritanceFixture();
  const committed = readFixture("family_inheritance_claim_input.json");
  if (JSON.stringify(committed) !== JSON.stringify(witness)) {
    throw new Error("family_inheritance_claim_input.json is stale; rerun its generator");
  }
  const circuitName = "family_inheritance_claim";
  const result = await calculateCircuitProofIsolated(witness, circuitName);
  if (result.publicSignals.length !== 6) {
    throw new Error(
      `FamilyInheritanceClaim must expose exactly 6 signals, got ${result.publicSignals.length}`,
    );
  }
  console.log("PASS: FamilyInheritanceClaim valid six-signal proof");

  const period = 2592000n;
  const rejected = [
    [
      "an endorsement younger than one period",
      { eligibleFrom: (BigInt(witness.writtenAt) + period - 1n).toString() },
    ],
    ["a root that is not the selected parent", { rootIsMother: "1" }],
    ["a non-binary parent selector", { rootIsMother: "2" }],
    ["a different heir secret", { derivedSecretField: "333334" }],
    ["a wrong root secret", { rootDerivedSecretField: "111112" }],
    ["an endorser missing from the trusted tree", { endorser: "1" }],
    ["a 161-bit endorser", { endorser: (1n << 160n).toString() }],
    ["a 65-bit write time", { writtenAt: (1n << 64n).toString() }],
    ["a stale endorsement root", { endorsementRoot: "1" }],
    ["a stale trusted root", { trustedRoot: "1" }],
    ["a mismatched claim tag", { claimTag: "1" }],
    ["a proof depth beyond the maximum", { endorsementDepth: "33" }],
    [
      "a zero root",
      {
        fatherIdentityCommitment: "0",
        rootIsMother: "0",
      },
    ],
  ];
  for (const [label, override] of rejected) {
    await expectRejected(`FamilyInheritanceClaim rejects ${label}`, () =>
      calculateCircuitProofIsolated({ ...witness, ...override }, circuitName),
    );
  }
}

async function runCircuitConstraintTests(argv = process.argv.slice(2)) {
  const parsed = parseCircuitArguments(argv);
  if (parsed.help) {
    console.log(
      "Usage: node circuits/test/test_circuit_constraints.js --circuit <all|person|disclosure|inheritance>",
    );
    return;
  }
  for (const circuit of selectCircuitNames(parsed.circuit)) {
    if (circuit === "person") await runPersonConstraintTests();
    if (circuit === "disclosure") await runDisclosureConstraintTests();
    if (circuit === "inheritance") await runInheritanceConstraintTests();
  }
}

runCircuitConstraintTests().then(
  () => {
    console.log("All fresh-v1 circuit range tests passed.");
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
