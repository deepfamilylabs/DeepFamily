import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

async function runCircuitConstraintTests() {
  const personInput = readFixture("person_commitment_input.json");
  const personResult = await calculateWitnessIsolated(personInput);
  if (personResult.publicSignals.length !== 5) {
    throw new Error(
      `PersonRelation must expose exactly 5 signals, got ${personResult.publicSignals.length}`,
    );
  }
  console.log("PASS: PersonRelation valid five-signal proof");

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
  await expectRejected("PersonRelation rejects a 161-bit submitter", () =>
    calculateWitnessIsolated({ ...personInput, submitter: (1n << 160n).toString() }),
  );

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
  await expectRejected("DisclosureBinding rejects selfSuiteId == 0", () =>
    calculateCircuitProofIsolated({ ...disclosureInput, selfSuiteId: 0 }, "disclosure_binding"),
  );
  await expectRejected("DisclosureBinding rejects a 161-bit minter", () =>
    calculateCircuitProofIsolated(
      { ...disclosureInput, minter: (1n << 160n).toString() },
      "disclosure_binding",
    ),
  );
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
