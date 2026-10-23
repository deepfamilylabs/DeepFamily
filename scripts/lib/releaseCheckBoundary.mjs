export const RELEASE_CHECK_BOUNDARY_ENV = "DEEPFAMILY_RELEASE_CHECK_BOUNDARY";

export const RELEASE_CHECK_BOUNDARY_FIELDS = Object.freeze([
  "releaseCommit",
  "zkManifestSha256",
  "zkTranscriptSha256",
  "protocolManifestSha256",
  "receiveManifestSha256",
]);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const validateFields = (value, label) => {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  for (const field of RELEASE_CHECK_BOUNDARY_FIELDS) {
    const pattern = field === "releaseCommit" ? /^[0-9a-f]{40}$/u : /^[0-9a-f]{64}$/u;
    if (
      !Object.hasOwn(value, field) ||
      typeof value[field] !== "string" ||
      !pattern.test(value[field])
    ) {
      throw new Error(
        `${label} ${field} must be a lowercase ${field === "releaseCommit" ? 40 : 64}-character hex digest`,
      );
    }
  }
};

/** Discard caller-supplied evidence before a root command runs its own release checks. */
export const withoutReleaseCheckBoundaryEnvironment = (environment = process.env) => {
  if (!isObject(environment)) throw new TypeError("release check environment must be an object");
  return Object.freeze(
    Object.fromEntries(
      Object.entries(environment).filter(
        ([name]) => name.toUpperCase() !== RELEASE_CHECK_BOUNDARY_ENV,
      ),
    ),
  );
};

/** Carry only the successful check result into the final, wrapper-guarded verifier process. */
export const bindReleaseCheckBoundary = ({ environment = process.env, result } = {}) => {
  if (!isObject(result) || !Object.hasOwn(result, "status") || result.status !== "checks-passed") {
    throw new Error(
      "Release checks must return checks-passed evidence before starting the final process",
    );
  }
  validateFields(result, "Release check result");
  const boundary = {
    schemaVersion: 1,
    status: "checks-passed",
    ...Object.fromEntries(RELEASE_CHECK_BOUNDARY_FIELDS.map((field) => [field, result[field]])),
  };
  return Object.freeze({
    ...withoutReleaseCheckBoundaryEnvironment(environment),
    [RELEASE_CHECK_BOUNDARY_ENV]: JSON.stringify(boundary),
  });
};

/** This binds inputs across phases; the caller must still verify its wrapper and the ceremony. */
export const assertReleaseCheckBoundary = ({ environment = process.env, actual } = {}) => {
  if (!isObject(environment)) throw new TypeError("release check environment must be an object");
  const entries = Object.entries(environment).filter(
    ([name]) => name.toUpperCase() === RELEASE_CHECK_BOUNDARY_ENV,
  );
  if (entries.length !== 1 || typeof entries[0][1] !== "string" || entries[0][1] === "") {
    throw new Error("Release check boundary evidence is missing or ambiguous");
  }
  const raw = entries[0][1];
  let boundary;
  try {
    boundary = JSON.parse(raw);
  } catch (error) {
    throw new Error("Release check boundary evidence must be valid JSON", { cause: error });
  }
  const expectedKeys = ["schemaVersion", "status", ...RELEASE_CHECK_BOUNDARY_FIELDS].sort();
  if (
    !isObject(boundary) ||
    JSON.stringify(Object.keys(boundary).sort()) !== JSON.stringify(expectedKeys) ||
    boundary.schemaVersion !== 1 ||
    boundary.status !== "checks-passed" ||
    JSON.stringify(boundary) !== raw
  ) {
    throw new Error(
      "Release check boundary must contain canonical schema-v1 checks-passed evidence",
    );
  }
  validateFields(boundary, "Release check boundary");
  validateFields(actual, "Current release inputs");
  for (const field of RELEASE_CHECK_BOUNDARY_FIELDS) {
    if (boundary[field] !== actual[field]) {
      throw new Error(`Release check boundary ${field} changed after release checks`);
    }
  }
  return Object.freeze(boundary);
};
