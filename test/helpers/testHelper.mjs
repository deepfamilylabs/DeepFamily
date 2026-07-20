/**
 * Test helpers for ZK flow using stub verifiers.
 * All tests use stub verifiers (always return true) to test contract logic
 * without requiring real ZK proof generation.
 */
import { AbiCoder } from "ethers";
import { poseidon4 } from "poseidon-lite";
import personCommitmentProof from "../../lib/personCommitmentProof.js";
import disclosureBindingProof from "../../lib/disclosureBindingProof.js";

const { buildPersonCommitmentInput } = personCommitmentProof;
const { buildDisclosureBindingInput } = disclosureBindingProof;

const PROOF_PURPOSE_PERSON_COMMITMENT = 0;
const PROOF_PURPOSE_DISCLOSURE_BINDING = 1;
const STUB_PROOF_SYSTEM_ID = 1;
const STUB_PROOF_ENCODING_ID = 1;

const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function canonicalizeFullName(fullName) {
  if (fullName === undefined || fullName === null) return "";
  const value = String(fullName);
  const normalized = typeof value.normalize === "function" ? value.normalize("NFKC") : value;
  return normalized.replace(/\s+/gu, " ").trim();
}

export function computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId) {
  return poseidon4([1000n, BigInt(schemaVersion), BigInt(cryptoSuiteVersion), BigInt(hashAlgoId)]);
}

export function computeNameField(ethers, fullName) {
  const canonicalFullName = canonicalizeFullName(fullName);
  const domainBytes = ethers.toUtf8Bytes("deepfamily:name-prehash:v2");
  const nameBytes = ethers.toUtf8Bytes(canonicalFullName);
  const namePrehash = ethers.keccak256(ethers.concat([domainBytes, nameBytes]));
  return BigInt(namePrehash) % SNARK_FIELD;
}

export function computeDisclosureBinding(
  ethers,
  fullName,
  basicInfo,
  schemaVersion,
  cryptoSuiteVersion,
  hashAlgoId,
) {
  const nameField = computeNameField(ethers, fullName);
  const packedBirthGenderField = packBirthGenderField(basicInfo);
  const suite = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  return poseidon4([1003n, nameField, packedBirthGenderField, suite]);
}

export function makeTestPerson(fullName, overrides = {}) {
  return {
    fullName,
    derivedSecretField: 0n,
    isBirthBC: false,
    birthYear: 1999,
    birthMonth: 0,
    birthDay: 0,
    gender: 1,
    ...overrides,
  };
}

export function computeProfileIdentityCommitment(ethers, person, opts = {}) {
  const schemaVersion = opts.schemaVersion ?? person.schemaVersion ?? 1;
  const cryptoSuiteVersion = opts.cryptoSuiteVersion ?? person.cryptoSuiteVersion ?? 1;
  const hashAlgoId = opts.hashAlgoId ?? person.hashAlgoId ?? 1;
  return computeIdentityCommitment(
    ethers,
    person.fullName,
    person,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
    person.derivedSecretField ?? 0n,
  );
}

export function buildPersonCommitmentCircuitInput(
  person,
  father,
  mother,
  submitterAddress,
  opts = {},
) {
  return buildPersonCommitmentInput(person, father, mother, submitterAddress, opts);
}

export function computeNameSecretCommitment(
  ethers,
  fullName,
  derivedSecretField,
  schemaVersion,
  cryptoSuiteVersion,
  hashAlgoId,
) {
  const nameField = computeNameField(ethers, fullName);
  const suite = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  return poseidon4([1001n, nameField, BigInt(derivedSecretField), suite]);
}

export function computeIdentityCommitment(
  ethers,
  fullName,
  basicInfo,
  schemaVersion,
  cryptoSuiteVersion,
  hashAlgoId,
  derivedSecretField = 0n,
) {
  const packedBirthGenderField = packBirthGenderField(basicInfo);
  const suite = computeSuiteCommitment(schemaVersion, cryptoSuiteVersion, hashAlgoId);
  const nameSecretCommitment = computeNameSecretCommitment(
    ethers,
    fullName,
    derivedSecretField,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  );
  return poseidon4([1002n, nameSecretCommitment, packedBirthGenderField, suite]);
}

export function computePersonHash(ethers, identityCommitment) {
  const hex = ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32);
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [hex]));
}

export function packBirthGenderField({
  birthYear = 0,
  birthMonth = 0,
  birthDay = 0,
  gender = 0,
  isBirthBC = false,
}) {
  return (
    (BigInt(birthYear) << 25n) |
    (BigInt(birthMonth) << 17n) |
    (BigInt(birthDay) << 9n) |
    (BigInt(gender) << 1n) |
    (isBirthBC ? 1n : 0n)
  );
}

export async function setupStubVerifiers(ethers, deepFamily) {
  const personStubFactory = await ethers.getContractFactory(
    "contracts/test/StubPersonCommitmentVerifier.sol:StubPersonCommitmentVerifier",
  );
  const personVerifier = await personStubFactory.deploy(true);
  await personVerifier.waitForDeployment();

  const nameStubFactory = await ethers.getContractFactory(
    "contracts/test/StubDisclosureBindingVerifier.sol:StubDisclosureBindingVerifier",
  );
  const nameVerifier = await nameStubFactory.deploy(true);
  await nameVerifier.waitForDeployment();

  const adapterFactory = await ethers.getContractFactory("Groth16VerifierAdapter");
  const adapter = await adapterFactory.deploy(
    await personVerifier.getAddress(),
    await nameVerifier.getAddress(),
  );
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();

  await deepFamily.setVerifier(
    STUB_PROOF_SYSTEM_ID,
    PROOF_PURPOSE_PERSON_COMMITMENT,
    adapterAddress,
  );
  await deepFamily.setVerifier(
    STUB_PROOF_SYSTEM_ID,
    PROOF_PURPOSE_DISCLOSURE_BINDING,
    adapterAddress,
  );

  return { personVerifier, nameVerifier, adapter };
}

export function makeStubProof() {
  const proofData = AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [
      [0, 0],
      [
        [0, 0],
        [0, 0],
      ],
      [0, 0],
    ],
  );
  return {
    proofSystemId: STUB_PROOF_SYSTEM_ID,
    proofEncodingId: STUB_PROOF_ENCODING_ID,
    proofData,
  };
}

export function makeAddPersonPublicSignals(identityCommitment, submitterAddress, opts = {}) {
  const {
    fatherIdentityCommitment = 0n,
    motherIdentityCommitment = 0n,
    schemaVersion = 1,
    cryptoSuiteVersion = 1,
    hashAlgoId = 1,
  } = opts;
  return {
    identityCommitment: BigInt(identityCommitment),
    fatherIdentityCommitment: BigInt(fatherIdentityCommitment),
    motherIdentityCommitment: BigInt(motherIdentityCommitment),
    submitter: BigInt(submitterAddress),
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  };
}

function resolveTestPerson(opts, prefix = "") {
  const key = prefix ? `${prefix}Person` : "person";
  if (opts[key] !== undefined) {
    return opts[key];
  }
  if (prefix) {
    return null;
  }
  return makeTestPerson(opts.fullName ?? "Test Person", {
    derivedSecretField: opts.derivedSecretField ?? 0n,
    isBirthBC: opts.isBirthBC ?? false,
    birthYear: opts.birthYear ?? 1999,
    birthMonth: opts.birthMonth ?? 0,
    birthDay: opts.birthDay ?? 0,
    gender: opts.gender ?? 1,
    schemaVersion: opts.schemaVersion,
    cryptoSuiteVersion: opts.cryptoSuiteVersion,
    hashAlgoId: opts.hashAlgoId,
  });
}

/**
 * Add a person using stub verifiers. Returns personHash.
 */
export async function addPerson(ethers, deepFamily, signer, identityCommitment, opts = {}) {
  const {
    fatherIdentityCommitment = 0n,
    motherIdentityCommitment = 0n,
    fatherVersionIndex = 0,
    motherVersionIndex = 0,
    tag = "v1",
    metadataCID = "ipfs://test",
    schemaVersion = 1,
    cryptoSuiteVersion = 1,
    hashAlgoId = 1,
  } = opts;

  const signerAddr = await signer.getAddress();
  const person = resolveTestPerson(opts);
  const fatherPerson = resolveTestPerson(opts, "father");
  const motherPerson = resolveTestPerson(opts, "mother");
  const circuit = buildPersonCommitmentCircuitInput(
    person,
    fatherPerson,
    motherPerson,
    signerAddr,
    { schemaVersion, cryptoSuiteVersion, hashAlgoId },
  );
  const resolvedIdentityCommitment = circuit.person.identityCommitment;
  const resolvedFatherIdentityCommitment = circuit.father?.identityCommitment ?? 0n;
  const resolvedMotherIdentityCommitment = circuit.mother?.identityCommitment ?? 0n;

  if (
    identityCommitment !== undefined &&
    identityCommitment !== null &&
    BigInt(identityCommitment) !== resolvedIdentityCommitment
  ) {
    throw new Error(
      "addPerson stub helper requires identityCommitment to match the person-commitment circuit input",
    );
  }
  if (BigInt(fatherIdentityCommitment) !== resolvedFatherIdentityCommitment) {
    throw new Error(
      "addPerson stub helper requires fatherIdentityCommitment to match the person-commitment circuit input",
    );
  }
  if (BigInt(motherIdentityCommitment) !== resolvedMotherIdentityCommitment) {
    throw new Error(
      "addPerson stub helper requires motherIdentityCommitment to match the person-commitment circuit input",
    );
  }

  const proof = makeStubProof();
  const publicSignals = makeAddPersonPublicSignals(resolvedIdentityCommitment, signerAddr, {
    fatherIdentityCommitment: resolvedFatherIdentityCommitment,
    motherIdentityCommitment: resolvedMotherIdentityCommitment,
    schemaVersion,
    cryptoSuiteVersion,
    hashAlgoId,
  });

  const tx = await deepFamily
    .connect(signer)
    .addPersonVersion(
      proof,
      publicSignals,
      resolvedFatherIdentityCommitment === 0n ? 0 : fatherVersionIndex,
      resolvedMotherIdentityCommitment === 0n ? 0 : motherVersionIndex,
      tag,
      metadataCID,
    );
  await tx.wait();

  return circuit.person.personHash;
}

/**
 * Full mint flow using stub verifiers: add person -> endorse -> mint.
 */
export async function mintPerson(
  ethers,
  deepFamily,
  signer,
  identityCommitment,
  fullName,
  opts = {},
) {
  const canonicalFullName = canonicalizeFullName(fullName);
  const schemaVersion = opts.schemaVersion ?? 1;
  const cryptoSuiteVersion = opts.cryptoSuiteVersion ?? 1;
  const hashAlgoId = opts.hashAlgoId ?? 1;
  const basicInfo = {
    isBirthBC: opts.isBirthBC ?? false,
    birthYear: opts.birthYear ?? 1999,
    birthMonth: opts.birthMonth ?? 0,
    birthDay: opts.birthDay ?? 0,
    gender: opts.gender ?? 1,
  };
  const signerAddr = await signer.getAddress();
  const disclosureBindingBuilt = buildDisclosureBindingInput(
    makeTestPerson(canonicalFullName, {
      derivedSecretField: opts.derivedSecretField ?? 0n,
      isBirthBC: basicInfo.isBirthBC,
      birthYear: basicInfo.birthYear,
      birthMonth: basicInfo.birthMonth,
      birthDay: basicInfo.birthDay,
      gender: basicInfo.gender,
    }),
    signerAddr,
    {
      schemaVersion,
      cryptoSuiteVersion,
      hashAlgoId,
    },
  );
  const circuitInput = disclosureBindingBuilt.input;
  const consistentIdentityCommitment = disclosureBindingBuilt.person.identityCommitment;
  if (
    identityCommitment !== undefined &&
    identityCommitment !== null &&
    BigInt(identityCommitment) !== consistentIdentityCommitment
  ) {
    throw new Error(
      "mintPerson stub helper requires identityCommitment to match the disclosure-binding circuit input",
    );
  }
  const resolvedIdentityCommitment = consistentIdentityCommitment;
  basicInfo.identityCommitment = ethers.zeroPadValue(
    ethers.toBeHex(resolvedIdentityCommitment),
    32,
  );

  const personHash = await addPerson(ethers, deepFamily, signer, resolvedIdentityCommitment, {
    ...opts,
    person: makeTestPerson(canonicalFullName, {
      derivedSecretField: BigInt(circuitInput.derivedSecretField),
      isBirthBC: basicInfo.isBirthBC,
      birthYear: basicInfo.birthYear,
      birthMonth: basicInfo.birthMonth,
      birthDay: basicInfo.birthDay,
      gender: basicInfo.gender,
    }),
  });

  await deepFamily.connect(signer).endorseVersion(personHash, 1);

  const disclosureBindingValue = disclosureBindingBuilt.disclosureBinding;

  const proof = makeStubProof();
  const publicSignals = {
    identityCommitment: consistentIdentityCommitment,
    disclosureBinding: disclosureBindingValue,
    minter: BigInt(circuitInput.minter),
    schemaVersion: circuitInput.schemaVersion,
    cryptoSuiteVersion: circuitInput.cryptoSuiteVersion,
    hashAlgoId: circuitInput.hashAlgoId,
  };

  const coreInfo = {
    basicInfo,
    supplementInfo: {
      fullName: canonicalFullName,
      birthPlace: opts.birthPlace ?? "",
      isDeathBC: false,
      deathYear: 0,
      deathMonth: 0,
      deathDay: 0,
      deathPlace: "",
      story: opts.story ?? "",
    },
  };

  const tx = await deepFamily
    .connect(signer)
    .mintPersonVersionNFT(proof, publicSignals, 1, opts.tokenURI ?? "", coreInfo);
  const receipt = await tx.wait();

  return {
    personHash,
    identityCommitment: resolvedIdentityCommitment,
    circuitInput,
    coreInfo,
    publicSignals,
    receipt,
  };
}
