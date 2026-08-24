import { argon2id } from "hash-wasm";
import { getAddress, getBytes, keccak256, solidityPacked, toBeHex, zeroPadValue } from "ethers";
import { poseidon4 } from "poseidon-lite";
import {
  CANDIDATE_ARGON2ID_PROFILE,
  DOMAIN_DISCLOSURE,
  DOMAIN_IDENTITY,
  DOMAIN_NAME_SECRET,
  DOMAIN_SUITE,
  FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1,
  FILE_PASSWORD_DOMAIN,
  IDENTITY_PASSWORD_DOMAIN,
  IDENTITY_SALT_DOMAIN,
  IDENTITY_SUITE_CANDIDATE_1,
  MAX_UINT32,
  NAME_PREHASH_DOMAIN,
  SNARK_SCALAR_FIELD,
} from "./constants.js";
import {
  assertUnicodeScalarString,
  bigintFrom,
  bytesToHex,
  concatBytes,
  copyBytes,
  utf8Bytes,
  wipeBytes,
} from "./bytes.js";
import { canonicalizeFullName } from "./canonical.js";
import { ProtocolError, UnsupportedProtocolError, protocolAssert } from "./errors.js";

function assertSmallUnsigned(value, maximum, label) {
  return Number(bigintFrom(value, label, BigInt(maximum)));
}

export function normalizeIdentityFields(input) {
  protocolAssert(
    input && typeof input === "object",
    "INVALID_IDENTITY",
    "Identity fields are required",
  );
  return {
    fullName: canonicalizeFullName(input.fullName),
    gender: assertSmallUnsigned(input.gender, 255, "gender"),
    birthYear: assertSmallUnsigned(input.birthYear, 65_535, "birthYear"),
    birthMonth: assertSmallUnsigned(input.birthMonth, 12, "birthMonth"),
    birthDay: assertSmallUnsigned(input.birthDay, 31, "birthDay"),
    isBirthBC: (() => {
      protocolAssert(
        typeof input.isBirthBC === "boolean",
        "INVALID_BOOLEAN",
        "isBirthBC must be boolean",
      );
      return input.isBirthBC;
    })(),
  };
}

export function packBirthGenderField(input) {
  const identity = normalizeIdentityFields(input);
  return (
    (BigInt(identity.birthYear) << 25n) |
    (BigInt(identity.birthMonth) << 17n) |
    (BigInt(identity.birthDay) << 9n) |
    (BigInt(identity.gender) << 1n) |
    (identity.isBirthBC ? 1n : 0n)
  );
}

export function assertIdentitySuiteSupported(identitySuiteId) {
  const suite = bigintFrom(identitySuiteId, "identitySuiteId", MAX_UINT32);
  protocolAssert(suite !== 0n, "ZERO_IDENTITY_SUITE", "identitySuiteId must be nonzero");
  if (suite !== BigInt(IDENTITY_SUITE_CANDIDATE_1)) {
    throw new UnsupportedProtocolError(
      "UNSUPPORTED_IDENTITY_SUITE",
      `Unsupported identity suite ${suite.toString()}`,
    );
  }
  return Number(suite);
}

export function assertFileKdfSuiteSupported(kdfSuite) {
  const suite = bigintFrom(kdfSuite, "kdfSuite", 0xffn);
  protocolAssert(suite !== 0n, "ZERO_FILE_KDF_SUITE", "kdfSuite must be nonzero");
  if (suite !== BigInt(FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1)) {
    throw new UnsupportedProtocolError(
      "UNSUPPORTED_FILE_KDF_SUITE",
      `Unsupported file KDF suite ${suite.toString()}`,
    );
  }
  return Number(suite);
}

export function normalizePassphrase(rawPassphrase) {
  protocolAssert(
    typeof rawPassphrase === "string",
    "INVALID_PASSPHRASE",
    "Passphrase must be a string",
  );
  assertUnicodeScalarString(rawPassphrase, "passphrase");
  return rawPassphrase.normalize("NFKD");
}

export function buildDomainSeparatedPasswordBytes(domain, rawPassphrase) {
  protocolAssert(
    typeof domain === "string" && domain.length > 0 && !domain.includes("\u0000"),
    "INVALID_PASSWORD_DOMAIN",
    "Password domain must be a nonempty string without NUL",
  );
  const normalized = normalizePassphrase(rawPassphrase);
  return concatBytes(utf8Bytes(domain), Uint8Array.of(0), utf8Bytes(normalized));
}

export function buildIdentityPasswordBytes(rawPassphrase) {
  return buildDomainSeparatedPasswordBytes(IDENTITY_PASSWORD_DOMAIN, rawPassphrase);
}

export function buildFilePasswordBytes(rawPassphrase) {
  return buildDomainSeparatedPasswordBytes(FILE_PASSWORD_DOMAIN, rawPassphrase);
}

export function deriveDeterministicIdentitySalt(
  input,
  identitySuiteId = IDENTITY_SUITE_CANDIDATE_1,
) {
  const suite = assertIdentitySuiteSupported(identitySuiteId);
  const identity = normalizeIdentityFields(input);
  const packedBirthGenderField = packBirthGenderField(identity);
  const packed = solidityPacked(
    ["string", "uint32", "string", "bytes32"],
    [
      IDENTITY_SALT_DOMAIN,
      suite,
      identity.fullName,
      zeroPadValue(toBeHex(packedBirthGenderField), 32),
    ],
  );
  return getBytes(keccak256(packed)).slice(0, CANDIDATE_ARGON2ID_PROFILE.saltBytes);
}

async function deriveCandidateArgon2id(passwordBytes, saltBytes) {
  const password = copyBytes(passwordBytes, "Argon2 password input");
  const salt = copyBytes(saltBytes, "Argon2 salt");
  protocolAssert(
    password.length > 0,
    "EMPTY_ARGON2_INPUT",
    "Domain-separated Argon2 input is empty",
  );
  protocolAssert(
    salt.length === CANDIDATE_ARGON2ID_PROFILE.saltBytes,
    "INVALID_ARGON2_SALT",
    `Argon2 salt must be ${CANDIDATE_ARGON2ID_PROFILE.saltBytes} bytes`,
  );
  try {
    const output = await argon2id({
      password,
      salt,
      parallelism: CANDIDATE_ARGON2ID_PROFILE.parallelism,
      iterations: CANDIDATE_ARGON2ID_PROFILE.iterations,
      memorySize: CANDIDATE_ARGON2ID_PROFILE.memoryKiB,
      hashLength: CANDIDATE_ARGON2ID_PROFILE.outputBytes,
      outputType: "binary",
    });
    protocolAssert(
      output instanceof Uint8Array && output.length === CANDIDATE_ARGON2ID_PROFILE.outputBytes,
      "INVALID_ARGON2_OUTPUT",
      "Argon2id returned an unexpected output length",
    );
    return new Uint8Array(output);
  } finally {
    wipeBytes(password);
    wipeBytes(salt);
  }
}

export async function deriveIdentitySecretBytes(input) {
  const suite = assertIdentitySuiteSupported(input.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1);
  const identity = normalizeIdentityFields(input.identity);
  const salt = deriveDeterministicIdentitySalt(identity, suite);
  const password = buildIdentityPasswordBytes(input.rawPassphrase);
  try {
    return await deriveCandidateArgon2id(password, salt);
  } finally {
    wipeBytes(password);
    wipeBytes(salt);
  }
}

export async function deriveFileKekBytes(input) {
  assertFileKdfSuiteSupported(input.kdfSuite ?? FILE_KDF_SUITE_ARGON2ID_CANDIDATE_1);
  const salt = copyBytes(input.fileSalt, "fileSalt");
  protocolAssert(salt.length === 16, "INVALID_FILE_SALT", "fileSalt must be 16 bytes");
  const password = buildFilePasswordBytes(input.rawPassphrase);
  try {
    return await deriveCandidateArgon2id(password, salt);
  } finally {
    wipeBytes(password);
    wipeBytes(salt);
  }
}

export function mapBytesToSnarkField(bytes) {
  const hex = bytesToHex(bytes);
  protocolAssert(hex.length > 2, "EMPTY_FIELD_INPUT", "Field input cannot be empty");
  return BigInt(hex) % SNARK_SCALAR_FIELD;
}

export function computeNameField(canonicalFullName) {
  const fullName = canonicalizeFullName(canonicalFullName);
  protocolAssert(
    fullName === canonicalFullName,
    "NON_CANONICAL_FULL_NAME",
    "Name field input must already be canonical",
  );
  const preimage = concatBytes(utf8Bytes(NAME_PREHASH_DOMAIN), utf8Bytes(fullName));
  return BigInt(keccak256(preimage)) % SNARK_SCALAR_FIELD;
}

export function computeSuiteCommitment(identitySuiteId) {
  const suite = assertIdentitySuiteSupported(identitySuiteId);
  return poseidon4([DOMAIN_SUITE, BigInt(suite), 0n, 0n]);
}

export function computeDisclosureBinding(input) {
  const nameField = bigintFrom(input.nameField, "nameField", SNARK_SCALAR_FIELD - 1n);
  const packedBirthGenderField = bigintFrom(
    input.packedBirthGenderField,
    "packedBirthGenderField",
    SNARK_SCALAR_FIELD - 1n,
  );
  const suiteCommitment = bigintFrom(
    input.suiteCommitment,
    "suiteCommitment",
    SNARK_SCALAR_FIELD - 1n,
  );
  return poseidon4([DOMAIN_DISCLOSURE, nameField, packedBirthGenderField, suiteCommitment]);
}

export function computeIdentityFromDerivedSecret(input) {
  const identitySuiteId = assertIdentitySuiteSupported(input.identitySuiteId);
  const identity = normalizeIdentityFields(input.identity);
  const derivedSecretField = bigintFrom(
    input.derivedSecretField,
    "derivedSecretField",
    SNARK_SCALAR_FIELD - 1n,
  );
  const nameField = computeNameField(identity.fullName);
  const packedBirthGenderField = packBirthGenderField(identity);
  const suiteCommitment = computeSuiteCommitment(identitySuiteId);
  const nameSecretCommitment = poseidon4([
    DOMAIN_NAME_SECRET,
    nameField,
    derivedSecretField,
    suiteCommitment,
  ]);
  const identityCommitment = poseidon4([
    DOMAIN_IDENTITY,
    nameSecretCommitment,
    packedBirthGenderField,
    suiteCommitment,
  ]);
  const personHash = keccak256(zeroPadValue(toBeHex(identityCommitment), 32));
  return {
    identitySuiteId,
    identity,
    derivedSecretField,
    nameField,
    packedBirthGenderField,
    suiteCommitment,
    nameSecretCommitment,
    identityCommitment,
    personHash,
  };
}

export async function deriveIdentityMaterial(input) {
  const identitySuiteId = assertIdentitySuiteSupported(
    input.identitySuiteId ?? IDENTITY_SUITE_CANDIDATE_1,
  );
  const identity = normalizeIdentityFields(input.identity);
  const identitySalt = deriveDeterministicIdentitySalt(identity, identitySuiteId);
  const password = buildIdentityPasswordBytes(input.rawPassphrase);
  let derivedSecretBytes;
  try {
    derivedSecretBytes = await deriveCandidateArgon2id(password, identitySalt);
  } catch (error) {
    wipeBytes(identitySalt);
    throw error;
  } finally {
    wipeBytes(password);
  }
  try {
    const result = computeIdentityFromDerivedSecret({
      identity,
      identitySuiteId,
      derivedSecretField: mapBytesToSnarkField(derivedSecretBytes),
    });
    return {
      ...result,
      // These two byte arrays are sensitive working material. Callers that need
      // them for proof construction must wipe them as soon as the package freezes.
      identitySalt: new Uint8Array(identitySalt),
      derivedSecretBytes,
    };
  } catch (error) {
    wipeBytes(identitySalt);
    wipeBytes(derivedSecretBytes);
    throw error;
  }
}

export function assertAddress(value, label = "address") {
  try {
    return getAddress(value);
  } catch (error) {
    throw new ProtocolError("INVALID_ADDRESS", `${label} is not a valid EVM address`, {
      cause: error,
    });
  }
}
