import {
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
  poseidon8,
} from "poseidon-lite";

export const hashes = {
  poseidon2,
  poseidon3,
  poseidon4,
  poseidon5,
  poseidon6,
  poseidon7,
  poseidon8,
};
export const strings = (value) =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v)));
export function receiveCodeFixture(overrides = {}) {
  const witness = {
    chainId: 31337n,
    authorizerScope: 0x1111111111111111111111111111111111111111n,
    nonce: 9001n,
    viewKeyLo: 221n,
    viewKeyHi: 222n,
    expiresAt: 1900000000n,
    codeRootSecret: 123456n,
    codeSecret: 333n,
    ownerSecret: 444n,
    ...overrides,
  };
  witness.ownerCommitment = poseidon2([1013n, witness.ownerSecret]);
  const domain = poseidon3([74000n, witness.chainId, witness.authorizerScope]);
  const codeAlias = poseidon4([73103n, witness.codeRootSecret, witness.nonce, witness.codeSecret]);
  const revocationSecret = poseidon4([
    74020n,
    witness.codeRootSecret,
    witness.nonce,
    witness.codeSecret,
  ]);
  const revocationTag = poseidon2([74021n, revocationSecret]);
  const keys = poseidon5([
    74001n,
    codeAlias,
    witness.ownerCommitment,
    witness.viewKeyLo,
    witness.viewKeyHi,
  ]);
  const header = poseidon4([74002n, keys, witness.nonce, witness.expiresAt]);
  const commonBinding = poseidon4([74003n, domain, header, revocationTag]);
  return {
    witness: strings(witness),
    domain,
    codeAlias,
    commonBinding,
    revocationTag,
    revocationSecret,
    publicSignals: [
      codeAlias,
      commonBinding,
      revocationTag,
      witness.chainId,
      witness.authorizerScope,
      witness.nonce,
      witness.ownerCommitment,
      witness.viewKeyLo,
      witness.viewKeyHi,
      witness.expiresAt,
    ],
  };
}

export function eligibilityFixture(overrides = {}) {
  const witness = {
    chainId: 31337n,
    authorizerScope: 0x1111111111111111111111111111111111111111n,
    nameField: 10101n,
    derivedSecretField: 123456n,
    isBirthBC: 0n,
    birthYear: 2010n,
    birthMonth: 5n,
    birthDay: 17n,
    gender: 1n,
    suiteId: 1n,
    parentIdentity: 10202n,
    familySalt: 30404n,
    issueNonce: 40505n,
    parentVersion: 1n,
    endorser: 0x2222222222222222222222222222222222222222n,
    xChild: 50606n,
    xEndorse: 60707n,
    xTrust: 70808n,
    sourceFactSalt: 80909n,
    sourceTrustSalt: 90101n,
    credentialSalt: 11011n,
    sourceDepth: 0n,
    sourceIndex: 0n,
    sourceSiblings: Array(64).fill(0n),
    trustedDepth: 0n,
    trustedIndex: 0n,
    trustedSiblings: Array(64).fill(0n),
    ...overrides,
  };
  const w = witness;
  const suite = poseidon4([1000n, w.suiteId, 0n, 0n]);
  const packed =
    w.birthYear * 33554432n +
    w.birthMonth * 131072n +
    w.birthDay * 512n +
    w.gender * 2n +
    w.isBirthBC;
  const identity = poseidon4([
    1002n,
    poseidon4([1001n, w.nameField, w.derivedSecretField, suite]),
    packed,
    suite,
  ]);
  const sourceLeaf = poseidon8([
    71002n,
    identity,
    w.parentIdentity,
    w.endorser,
    w.xChild,
    w.xEndorse,
    w.parentVersion,
    w.sourceFactSalt,
  ]);
  const trustedLeaf = poseidon6([
    71003n,
    w.parentIdentity,
    w.endorser,
    w.xTrust,
    w.parentVersion,
    w.sourceTrustSalt,
  ]);
  const pathRoot = (leaf, depth, index, siblings) => {
    let root = leaf;
    for (let i = 0; i < Number(depth); i++)
      root =
        (index >> BigInt(i)) & 1n ? poseidon2([siblings[i], root]) : poseidon2([root, siblings[i]]);
    return root;
  };
  w.sourceRoot = pathRoot(sourceLeaf, w.sourceDepth, w.sourceIndex, w.sourceSiblings);
  w.trustedRoot = pathRoot(trustedLeaf, w.trustedDepth, w.trustedIndex, w.trustedSiblings);
  const familyRoot = poseidon3([73201n, w.parentIdentity, w.familySalt]);
  const u = poseidon3([73204n, w.derivedSecretField, w.issueNonce]);
  const factMessage = poseidon7([
    73101n,
    u,
    familyRoot,
    w.endorser,
    w.parentVersion,
    w.xChild,
    w.xEndorse,
  ]);
  const trustMessage = poseidon5([73102n, familyRoot, w.endorser, w.parentVersion, w.xTrust]);
  const domain = poseidon3([74000n, w.chainId, w.authorizerScope]);
  const credentialCommitment = poseidon5([
    73400n,
    factMessage,
    trustMessage,
    w.credentialSalt,
    domain,
  ]);
  return {
    witness: strings(w),
    identity,
    sourceLeaf,
    trustedLeaf,
    familyRoot,
    credentialCommitment,
    publicSignals: [
      credentialCommitment,
      w.chainId,
      w.authorizerScope,
      w.sourceRoot,
      w.trustedRoot,
    ],
  };
}

export function capabilityFixture(
  issue = eligibilityFixture(),
  common = receiveCodeFixture(),
  options = {},
) {
  const names = [
    "chainId",
    "authorizerScope",
    "derivedSecretField",
    "issueNonce",
    "endorser",
    "parentVersion",
    "xChild",
    "xEndorse",
    "xTrust",
    "credentialSalt",
  ];
  const witness = Object.fromEntries(names.map((name) => [name, issue.witness[name]]));
  for (const name of [
    "nonce",
    "ownerCommitment",
    "viewKeyLo",
    "viewKeyHi",
    "expiresAt",
    "codeSecret",
    "ownerSecret",
  ])
    witness[name] = common.witness[name];
  Object.assign(witness, {
    familyRoot: String(issue.familyRoot),
    commonBinding: String(common.commonBinding),
    credentialDepth: "0",
    credentialIndex: "0",
    credentialSiblings: Array(32).fill("0"),
    ...strings(options),
  });
  let issuanceRoot = issue.credentialCommitment;
  for (let i = 0; i < Number(witness.credentialDepth); i++)
    issuanceRoot =
      (BigInt(witness.credentialIndex) >> BigInt(i)) & 1n
        ? poseidon2([BigInt(witness.credentialSiblings[i]), issuanceRoot])
        : poseidon2([issuanceRoot, BigInt(witness.credentialSiblings[i])]);
  witness.issuanceRoot = String(issuanceRoot);
  const familyTag = poseidon3([73104n, BigInt(witness.familyRoot), BigInt(witness.nonce)]);
  const childRoleIndex = poseidon2([74321n, BigInt(witness.xChild)]);
  const endorsementRoleIndex = poseidon2([74322n, BigInt(witness.xEndorse)]);
  const trustedRoleIndex = poseidon2([74323n, BigInt(witness.xTrust)]);
  const capabilityBinding = poseidon8([
    74004n,
    common.commonBinding,
    BigInt(witness.parentVersion),
    familyTag,
    childRoleIndex,
    endorsementRoleIndex,
    trustedRoleIndex,
    issuanceRoot,
  ]);
  return {
    witness,
    publicSignals: [
      capabilityBinding,
      familyTag,
      childRoleIndex,
      endorsementRoleIndex,
      trustedRoleIndex,
      BigInt(witness.chainId),
      BigInt(witness.authorizerScope),
      issuanceRoot,
      common.commonBinding,
      BigInt(witness.parentVersion),
    ],
  };
}
