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

  await expectRejected("PersonRelation rejects birthMonth > 12", () =>
    calculateWitnessIsolated({ ...personInput, birthMonth: 13 }),
  );
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

async function runCircuitConstraintTests(argv = process.argv.slice(2)) {
  const parsed = parseCircuitArguments(argv);
  if (parsed.help) {
    console.log(
      "Usage: node circuits/test/test_circuit_constraints.js --circuit <all|person|disclosure>",
    );
    return;
  }
  for (const circuit of selectCircuitNames(parsed.circuit)) {
    if (circuit === "person") await runPersonConstraintTests();
    if (circuit === "disclosure") await runDisclosureConstraintTests();
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
