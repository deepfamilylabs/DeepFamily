import { poseidon2, poseidon3, poseidon5, poseidon6, poseidon7, poseidon8 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import { SNARK_SCALAR_FIELD, MAX_UINT64 } from "./constants.js";
import { protocolAssert } from "./errors.js";
import { generateShieldedRandomField } from "./shielded-inheritance.js";
import { computeIdentityFromDerivedSecret } from "./identity.js";

const field = (value, name) => bigintFrom(value, name, SNARK_SCALAR_FIELD - 1n);
const nz = (value, name) => {
  const result = field(value, name);
  protocolAssert(result > 0n, "INVALID_ELIGIBILITY", `${name} must be nonzero`);
  return result;
};
const version = (value) => {
  const result = bigintFrom(value, "parentVersion", MAX_UINT64);
  protocolAssert(result > 0n, "INVALID_ELIGIBILITY", "parentVersion must be nonzero");
  return result;
};

/** Private role openings belong to the existing eligibility controllers, never to payers. */
export function createRoleOpening(role) {
  const index = { child: 0n, endorsement: 1n, trusted: 2n }[role];
  protocolAssert(index !== undefined, "INVALID_ELIGIBILITY", "Unknown role");
  const secret = generateShieldedRandomField();
  return { secret, commitment: poseidon2([74201n + index, secret]) };
}

export function createFamilyCommitment(input) {
  const parentIdentity = nz(input.parentIdentity, "parentIdentity");
  const familySalt = nz(input.familySalt ?? generateShieldedRandomField(), "familySalt");
  return { familyCommitment: poseidon3([73201n, parentIdentity, familySalt]), familySalt };
}

export function createSourceFact(input) {
  const xChild = nz(input.xChild ?? generateShieldedRandomField(), "xChild");
  const xEndorse = nz(input.xEndorse ?? generateShieldedRandomField(), "xEndorse");
  const sourceFactSalt = nz(
    input.sourceFactSalt ?? generateShieldedRandomField(),
    "sourceFactSalt",
  );
  const parentVersion = version(input.parentVersion);
  const childIdentity = nz(input.childIdentity, "childIdentity");
  const parentIdentity = nz(input.parentIdentity, "parentIdentity");
  const endorser = bigintFrom(input.endorser, "endorser", (1n << 160n) - 1n);
  protocolAssert(endorser !== 0n, "INVALID_ELIGIBILITY", "endorser must be nonzero");
  return {
    childIdentity,
    parentIdentity,
    endorser,
    parentVersion,
    xChild,
    xEndorse,
    sourceFactSalt,
    factLeaf: poseidon8([
      71002n,
      childIdentity,
      parentIdentity,
      endorser,
      xChild,
      xEndorse,
      parentVersion,
      sourceFactSalt,
    ]),
    childRoleCommitment: poseidon2([74201n, xChild]),
    endorsementRoleCommitment: poseidon2([74202n, xEndorse]),
  };
}

export function createSourceTrust(input) {
  const parentIdentity = nz(input.parentIdentity, "parentIdentity");
  const endorser = bigintFrom(input.endorser, "endorser", (1n << 160n) - 1n);
  protocolAssert(endorser !== 0n, "INVALID_ELIGIBILITY", "endorser must be nonzero");
  const parentVersion = version(input.parentVersion);
  const xTrust = nz(input.xTrust ?? generateShieldedRandomField(), "xTrust");
  const sourceTrustSalt = nz(
    input.sourceTrustSalt ?? generateShieldedRandomField(),
    "sourceTrustSalt",
  );
  return {
    parentIdentity,
    endorser,
    parentVersion,
    xTrust,
    sourceTrustSalt,
    trustLeaf: poseidon6([
      71003n,
      parentIdentity,
      endorser,
      xTrust,
      parentVersion,
      sourceTrustSalt,
    ]),
    trustRoleCommitment: poseidon2([74203n, xTrust]),
  };
}

function path(leaf, input, name) {
  const depth = Number(bigintFrom(input.depth, `${name}.depth`, 64n));
  const index = bigintFrom(input.index, `${name}.index`, (1n << BigInt(depth)) - 1n);
  protocolAssert(
    Array.isArray(input.siblings) && input.siblings.length >= depth && input.siblings.length <= 64,
    "INVALID_ELIGIBILITY",
    "Invalid source Merkle path",
  );
  const siblings = Array.from({ length: 64 }, (_, i) => field(input.siblings[i] ?? 0n, "sibling"));
  let root = leaf;
  for (let i = 0; i < depth; ++i)
    root =
      (index >> BigInt(i)) & 1n ? poseidon2([siblings[i], root]) : poseidon2([root, siblings[i]]);
  protocolAssert(
    root === nz(input.root, `${name}.root`),
    "INVALID_ELIGIBILITY",
    "Source path does not authenticate the role opening",
  );
  return { depth: BigInt(depth), index, siblings, root };
}

/** Build the production-identity Issue witness locally. Only its five public signals are submitted. */
export function prepareEligibilityIssue(input) {
  const material = computeIdentityFromDerivedSecret({
    ...input,
    identitySuiteId: input.identitySuiteId ?? 1,
  });
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const authorizerScope = bigintFrom(input.authorizerScope, "authorizerScope", (1n << 160n) - 1n);
  protocolAssert(
    chainId > 0n && authorizerScope > 0n,
    "INVALID_ELIGIBILITY",
    "Invalid issuance scope",
  );
  const fact = createSourceFact({ ...input, childIdentity: material.identityCommitment });
  const trust = createSourceTrust(input);
  // Never silently generate new role secrets while opening previously authenticated leaves.
  for (const name of [
    "xChild",
    "xEndorse",
    "xTrust",
    "sourceFactSalt",
    "sourceTrustSalt",
    "familySalt",
  ])
    nz(input[name], name);
  const source = path(fact.factLeaf, input.sourcePath, "sourcePath");
  const trusted = path(trust.trustLeaf, input.trustedPath, "trustedPath");
  const { familyCommitment: familyRoot } = createFamilyCommitment(input);
  const issueNonce = nz(input.issueNonce ?? generateShieldedRandomField(), "issueNonce");
  const credentialSalt = nz(
    input.credentialSalt ?? generateShieldedRandomField(),
    "credentialSalt",
  );
  const u = poseidon3([73204n, material.derivedSecretField, issueNonce]);
  const a = poseidon7([
    73101n,
    u,
    familyRoot,
    fact.endorser,
    fact.parentVersion,
    fact.xChild,
    fact.xEndorse,
  ]);
  const b = poseidon5([73102n, familyRoot, trust.endorser, trust.parentVersion, trust.xTrust]);
  const domain = poseidon3([74000n, chainId, authorizerScope]);
  const credentialCommitment = poseidon5([73400n, a, b, credentialSalt, domain]);
  const witness = {
    chainId,
    authorizerScope,
    sourceRoot: source.root,
    trustedRoot: trusted.root,
    nameField: material.nameField,
    derivedSecretField: material.derivedSecretField,
    isBirthBC: BigInt(material.identity.isBirthBC),
    birthYear: BigInt(material.identity.birthYear),
    birthMonth: BigInt(material.identity.birthMonth),
    birthDay: BigInt(material.identity.birthDay),
    gender: BigInt(material.identity.gender),
    suiteId: BigInt(material.identitySuiteId),
    parentIdentity: fact.parentIdentity,
    familySalt: field(input.familySalt, "familySalt"),
    issueNonce,
    parentVersion: fact.parentVersion,
    endorser: fact.endorser,
    xChild: fact.xChild,
    xEndorse: fact.xEndorse,
    xTrust: trust.xTrust,
    sourceFactSalt: fact.sourceFactSalt,
    sourceTrustSalt: trust.sourceTrustSalt,
    credentialSalt,
    sourceDepth: source.depth,
    sourceIndex: source.index,
    sourceSiblings: source.siblings,
    trustedDepth: trusted.depth,
    trustedIndex: trusted.index,
    trustedSiblings: trusted.siblings,
  };
  return {
    witness,
    credentialCommitment,
    familyRoot,
    publicSignals: [credentialCommitment, chainId, authorizerScope, source.root, trusted.root],
  };
}
