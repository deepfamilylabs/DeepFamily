import { calculateWitnessIsolated } from "./witness_helper.js";

const baseInput = {
  nameField: "101",
  derivedSecretField: "11",
  isBirthBC: 0,
  birthYear: 1990,
  birthMonth: 12,
  birthDay: 25,
  gender: 2,
  selfSuiteId: 2,
  fatherNameField: "202",
  fatherDerivedSecretField: "22",
  fatherIsBirthBC: 0,
  fatherBirthYear: 1960,
  fatherBirthMonth: 5,
  fatherBirthDay: 15,
  fatherGender: 1,
  fatherSuiteId: 1,
  motherNameField: "303",
  motherDerivedSecretField: "33",
  motherIsBirthBC: 0,
  motherBirthYear: 1965,
  motherBirthMonth: 8,
  motherBirthDay: 20,
  motherGender: 2,
  motherSuiteId: 1,
  hasFather: 1,
  hasMother: 1,
  submitter: "103929005307130220006098923584552504982110632080",
  contentDigestLo: "7",
  contentDigestHi: "8",
};

const zeroRole = (input, role) => ({
  ...input,
  [`${role}NameField`]: "0",
  [`${role}DerivedSecretField`]: "0",
  [`${role}IsBirthBC`]: 0,
  [`${role}BirthYear`]: 0,
  [`${role}BirthMonth`]: 0,
  [`${role}BirthDay`]: 0,
  [`${role}Gender`]: 0,
  [`${role}SuiteId`]: 0,
  [`has${role[0].toUpperCase()}${role.slice(1)}`]: 0,
});

async function expectRejected(label, input) {
  try {
    await calculateWitnessIsolated(input);
  } catch {
    console.log(`PASS: ${label}`);
    return;
  }
  throw new Error(`${label}: circuit accepted a non-canonical parent witness`);
}

async function testParentExistence() {
  const both = await calculateWitnessIsolated(baseInput);
  const noFatherInput = zeroRole(baseInput, "father");
  const noMotherInput = zeroRole(baseInput, "mother");
  const orphanInput = zeroRole(noFatherInput, "mother");
  const noFather = await calculateWitnessIsolated(noFatherInput);
  const noMother = await calculateWitnessIsolated(noMotherInput);
  const orphan = await calculateWitnessIsolated(orphanInput);

  if (noFather.publicSignals[1] !== "0") throw new Error("Absent father output must be zero");
  if (noMother.publicSignals[2] !== "0") throw new Error("Absent mother output must be zero");
  if (orphan.publicSignals[1] !== "0" || orphan.publicSignals[2] !== "0") {
    throw new Error("Orphan parent outputs must both be zero");
  }
  for (const result of [noFather, noMother, orphan]) {
    if (result.publicSignals[0] !== both.publicSignals[0]) {
      throw new Error("Self identity commitment changed with parent presence");
    }
    if (result.publicSignals[3] !== both.publicSignals[3]) {
      throw new Error("Packed submitter/self suite changed with parent presence");
    }
    if (result.publicSignals[4] !== both.publicSignals[4]) {
      throw new Error("Version commitment changed with parent presence");
    }
  }
  console.log("PASS: canonical null parents produce zero outputs without changing self/version");

  await expectRejected("hasFather is boolean", { ...baseInput, hasFather: 2 });
  await expectRejected("present father suite is nonzero", { ...baseInput, fatherSuiteId: 0 });
  await expectRejected("absent father suite is zero", {
    ...noFatherInput,
    fatherSuiteId: 1,
  });
  await expectRejected("absent father name witness is zero", {
    ...noFatherInput,
    fatherNameField: 99,
  });
  await expectRejected("absent father derived-secret witness is zero", {
    ...noFatherInput,
    fatherDerivedSecretField: 99,
  });
  await expectRejected("absent mother gender witness is zero", {
    ...noMotherInput,
    motherGender: 1,
  });

  const changedFatherSuite = await calculateWitnessIsolated({ ...baseInput, fatherSuiteId: 3 });
  if (changedFatherSuite.publicSignals[0] !== both.publicSignals[0]) {
    throw new Error("Father suite changed the self identity commitment");
  }
  if (changedFatherSuite.publicSignals[1] === both.publicSignals[1]) {
    throw new Error("Father suite did not change the father identity commitment");
  }
  console.log("PASS: role suite IDs affect only their own identity commitments");
}

testParentExistence().then(
  () => {
    console.log("All fresh-v1 parent mask tests passed.");
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
