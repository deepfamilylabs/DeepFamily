/**
 * Contract-test helpers for the v1 proof and encrypted-metadata ABI.
 *
 * These helpers intentionally use always-true verifier stubs. They exercise the
 * contract's routing and business bindings without generating Groth16 proofs.
 */
import { AbiCoder, ethers as ethersLib } from "ethers";
import { poseidon4 } from "poseidon-lite";
import { buildDisclosureBindingInput } from "../../lib/disclosureBindingProof.js";
import {
  buildPersonRelationInput,
  canonicalizeFullName,
  computeAtomicSuiteCommitment,
} from "../../lib/personCommitmentProof.js";

export const PROOF_PURPOSE_PERSON_RELATION = 0;
export const PROOF_PURPOSE_DISCLOSURE_BINDING = 1;
export const STUB_CIRCUIT_ID = 0x7fff0001;
export const STUB_PROOF_ENCODING_ID = 1;

const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DOMAIN_NAME_SECRET = 1001n;
const DOMAIN_IDENTITY = 1002n;
const DOMAIN_DISCLOSURE = 1003n;

function resolveIdentitySuiteId(source = {}, fallback = 1) {
  const identitySuiteId = source.identitySuiteId;
  const roleSuiteId = source.selfSuiteId;
  if (
    identitySuiteId !== undefined &&
    roleSuiteId !== undefined &&
    BigInt(identitySuiteId) !== BigInt(roleSuiteId)
  ) {
    throw new Error("identitySuiteId and selfSuiteId must identify the same atomic suite");
  }
  return BigInt(identitySuiteId ?? roleSuiteId ?? fallback);
}

function defaultContentDigest(ethers, tag = "v1") {
  return ethers.keccak256(ethers.toUtf8Bytes(`DeepFamily:test-version-content:${String(tag)}`));
}

function withContentDigest(ethers, opts = {}) {
  if (opts.contentDigest !== undefined) {
    return { contentDigest: opts.contentDigest };
  }
  if (opts.contentDigestLo !== undefined || opts.contentDigestHi !== undefined) {
    if (opts.contentDigestLo === undefined || opts.contentDigestHi === undefined) {
      throw new Error("contentDigestLo and contentDigestHi must be provided together");
    }
    return {
      contentDigestLo: opts.contentDigestLo,
      contentDigestHi: opts.contentDigestHi,
    };
  }
  return { contentDigest: defaultContentDigest(ethers, opts.tag) };
}

export function computeSuiteCommitment(identitySuiteId = 1) {
  return computeAtomicSuiteCommitment(BigInt(identitySuiteId));
}

export function computeNameField(ethers, fullName) {
  const canonicalFullName = canonicalizeFullName(fullName);
  const domainBytes = ethers.toUtf8Bytes("deepfamily:name-prehash:v2");
  const nameBytes = ethers.toUtf8Bytes(canonicalFullName);
  return BigInt(ethers.keccak256(ethers.concat([domainBytes, nameBytes]))) % SNARK_FIELD;
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

export function computeNameSecretCommitment(
  ethers,
  fullName,
  derivedSecretField,
  identitySuiteId = 1,
) {
  return poseidon4([
    DOMAIN_NAME_SECRET,
    computeNameField(ethers, fullName),
    BigInt(derivedSecretField),
    computeSuiteCommitment(identitySuiteId),
  ]);
}

export function computeIdentityCommitment(
  ethers,
  fullName,
  basicInfo,
  identitySuiteId = 1,
  derivedSecretField = 0n,
) {
  if (arguments.length > 5) {
    throw new Error(
      "computeIdentityCommitment accepts one atomic identitySuiteId, not legacy version fields",
    );
  }
  const suiteCommitment = computeSuiteCommitment(identitySuiteId);
  const nameSecretCommitment = computeNameSecretCommitment(
    ethers,
    fullName,
    derivedSecretField,
    identitySuiteId,
  );
  return poseidon4([
    DOMAIN_IDENTITY,
    nameSecretCommitment,
    packBirthGenderField(basicInfo),
    suiteCommitment,
  ]);
}

export function computeDisclosureBinding(ethers, fullName, basicInfo, identitySuiteId = 1) {
  if (arguments.length > 4) {
    throw new Error(
      "computeDisclosureBinding accepts one atomic identitySuiteId, not legacy version fields",
    );
  }
  return poseidon4([
    DOMAIN_DISCLOSURE,
    computeNameField(ethers, fullName),
    packBirthGenderField(basicInfo),
    computeSuiteCommitment(identitySuiteId),
  ]);
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
  const identitySuiteId = resolveIdentitySuiteId(opts, resolveIdentitySuiteId(person));
  return computeIdentityCommitment(
    ethers,
    person.fullName,
    person,
    identitySuiteId,
    person.derivedSecretField ?? 0n,
  );
}

export function computePersonHash(ethers, identityCommitment) {
  return ethers.keccak256(ethers.zeroPadValue(ethers.toBeHex(identityCommitment), 32));
}

export function buildPersonCommitmentCircuitInput(
  person,
  father,
  mother,
  submitterAddress,
  opts = {},
) {
  const ethers = opts.ethers ?? ethersLib;
  const selfSuiteId = resolveIdentitySuiteId(opts, resolveIdentitySuiteId(person));
  const fatherSuiteId = father
    ? resolveIdentitySuiteId({ selfSuiteId: opts.fatherSuiteId }, resolveIdentitySuiteId(father))
    : 0n;
  const motherSuiteId = mother
    ? resolveIdentitySuiteId({ selfSuiteId: opts.motherSuiteId }, resolveIdentitySuiteId(mother))
    : 0n;

  return buildPersonRelationInput(person, father, mother, submitterAddress, {
    selfSuiteId,
    fatherSuiteId,
    motherSuiteId,
    ...withContentDigest(ethers, opts),
  });
}

export function makeMetadataEnvelope(ethers, identitySuiteId = 1, opts = {}) {
  const suiteId = BigInt(identitySuiteId);
  if (suiteId < 0n || suiteId > 0xffffffffn) {
    throw new Error("identitySuiteId must fit uint32");
  }

  const bytes = new Uint8Array(opts.length ?? 20);
  if (bytes.length < 20) throw new Error("test metadata envelope must be at least 20 bytes");
  bytes.set([0x44, 0x46, 0x4d, 0x31, Number(opts.formatVersion ?? 1)], 0);
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    16,
    Number(suiteId),
    false,
  );

  if (opts.tag !== undefined) {
    const marker = ethers.getBytes(defaultContentDigest(ethers, opts.tag));
    bytes.set(marker.slice(0, Math.min(11, bytes.length - 5)), 5);
  }
  return ethers.hexlify(bytes);
}

export async function setupStubVerifiers(ethers, deepFamily) {
  const relationRoute = await deepFamily.verifierRegistry(
    PROOF_PURPOSE_PERSON_RELATION,
    STUB_CIRCUIT_ID,
  );
  const disclosureRoute = await deepFamily.verifierRegistry(
    PROOF_PURPOSE_DISCLOSURE_BINDING,
    STUB_CIRCUIT_ID,
  );
  if (relationRoute !== ethers.ZeroAddress || disclosureRoute !== ethers.ZeroAddress) {
    if (relationRoute === ethers.ZeroAddress || disclosureRoute === ethers.ZeroAddress) {
      throw new Error("Stub verifier routes are only partially configured");
    }
    return {
      adapter: await ethers.getContractAt("Groth16VerifierAdapter", relationRoute),
      personVerifier: null,
      disclosureVerifier: null,
    };
  }

  const PersonVerifier = await ethers.getContractFactory(
    "contracts/test/StubPersonCommitmentVerifier.sol:StubPersonCommitmentVerifier",
  );
  const personVerifier = await PersonVerifier.deploy(true);
  await personVerifier.waitForDeployment();

  const DisclosureVerifier = await ethers.getContractFactory(
    "contracts/test/StubDisclosureBindingVerifier.sol:StubDisclosureBindingVerifier",
  );
  const disclosureVerifier = await DisclosureVerifier.deploy(true);
  await disclosureVerifier.waitForDeployment();

  const Adapter = await ethers.getContractFactory("Groth16VerifierAdapter");
  const adapter = await Adapter.deploy(
    await personVerifier.getAddress(),
    await disclosureVerifier.getAddress(),
  );
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();

  await (
    await deepFamily.setCircuitVerifier(
      PROOF_PURPOSE_PERSON_RELATION,
      STUB_CIRCUIT_ID,
      adapterAddress,
    )
  ).wait();
  await (
    await deepFamily.setCircuitVerifier(
      PROOF_PURPOSE_DISCLOSURE_BINDING,
      STUB_CIRCUIT_ID,
      adapterAddress,
    )
  ).wait();

  return { personVerifier, disclosureVerifier, adapter };
}

export function makeStubProof(overrides = {}) {
  const normalizedOverrides = typeof overrides === "number" ? { circuitId: overrides } : overrides;
  return {
    circuitId: STUB_CIRCUIT_ID,
    proofEncodingId: STUB_PROOF_ENCODING_ID,
    proofData: AbiCoder.defaultAbiCoder().encode(
      ["uint256[2]", "uint256[2][2]", "uint256[2]"],
      [
        [0, 0],
        [
          [0, 0],
          [0, 0],
        ],
        [0, 0],
      ],
    ),
    ...normalizedOverrides,
  };
}

export function makeAddPersonPublicSignals(identityCommitment, submitterAddress, opts = {}) {
  const identitySuiteId = resolveIdentitySuiteId(opts);
  const defaultVersionCommitment =
    BigInt(
      ethersLib.keccak256(
        ethersLib.solidityPacked(
          ["uint256", "string"],
          [BigInt(identityCommitment), String(opts.tag ?? "v1")],
        ),
      ),
    ) % SNARK_FIELD;
  return {
    identityCommitment: BigInt(identityCommitment),
    fatherIdentityCommitment: BigInt(opts.fatherIdentityCommitment ?? 0n),
    motherIdentityCommitment: BigInt(opts.motherIdentityCommitment ?? 0n),
    submitterAndSelfSuiteId:
      opts.submitterAndSelfSuiteId ?? BigInt(submitterAddress) | (identitySuiteId << 160n),
    versionCommitment: BigInt(opts.versionCommitment ?? defaultVersionCommitment),
  };
}

function resolveTestPerson(opts, prefix = "") {
  const key = prefix ? `${prefix}Person` : "person";
  if (opts[key] !== undefined) return opts[key];
  if (prefix) return null;
  return makeTestPerson(opts.fullName ?? "Test Person", {
    derivedSecretField: opts.derivedSecretField ?? 0n,
    isBirthBC: opts.isBirthBC ?? false,
    birthYear: opts.birthYear ?? 1999,
    birthMonth: opts.birthMonth ?? 0,
    birthDay: opts.birthDay ?? 0,
    gender: opts.gender ?? 1,
    identitySuiteId: opts.identitySuiteId ?? opts.selfSuiteId,
  });
}

/** Add one encrypted-metadata person version through the stub relation route. */
export async function addPerson(ethers, deepFamily, signer, identityCommitment, opts = {}) {
  const signerAddress = await signer.getAddress();
  const person = resolveTestPerson(opts);
  const fatherPerson = resolveTestPerson(opts, "father");
  const motherPerson = resolveTestPerson(opts, "mother");
  const identitySuiteId = resolveIdentitySuiteId(opts, resolveIdentitySuiteId(person));
  const built = buildPersonCommitmentCircuitInput(
    person,
    fatherPerson,
    motherPerson,
    signerAddress,
    {
      ...opts,
      ethers,
      selfSuiteId: identitySuiteId,
      tag: opts.tag ?? "v1",
    },
  );

  const resolvedIdentityCommitment = built.person.identityCommitment;
  if (
    identityCommitment !== undefined &&
    identityCommitment !== null &&
    BigInt(identityCommitment) !== resolvedIdentityCommitment
  ) {
    throw new Error(
      "addPerson stub helper requires identityCommitment to match the relation input",
    );
  }

  const derivedFatherCommitment = built.father?.identityCommitment ?? 0n;
  const derivedMotherCommitment = built.mother?.identityCommitment ?? 0n;
  const fatherIdentityCommitment = BigInt(opts.fatherIdentityCommitment ?? derivedFatherCommitment);
  const motherIdentityCommitment = BigInt(opts.motherIdentityCommitment ?? derivedMotherCommitment);
  if (fatherPerson && fatherIdentityCommitment !== derivedFatherCommitment) {
    throw new Error("fatherIdentityCommitment does not match fatherPerson");
  }
  if (motherPerson && motherIdentityCommitment !== derivedMotherCommitment) {
    throw new Error("motherIdentityCommitment does not match motherPerson");
  }

  const versionCommitment = BigInt(opts.versionCommitment ?? built.versionCommitment);
  const publicSignals = makeAddPersonPublicSignals(resolvedIdentityCommitment, signerAddress, {
    selfSuiteId: identitySuiteId,
    fatherIdentityCommitment,
    motherIdentityCommitment,
    versionCommitment,
  });
  const metadataEnvelope =
    opts.metadataEnvelope ??
    makeMetadataEnvelope(ethers, identitySuiteId, {
      tag: opts.tag ?? "v1",
      formatVersion: opts.formatVersion,
    });

  const tx = await deepFamily
    .connect(signer)
    .addPersonVersion(
      makeStubProof(opts.proofOverrides),
      publicSignals,
      fatherIdentityCommitment === 0n ? 0 : (opts.fatherVersionIndex ?? 0),
      motherIdentityCommitment === 0n ? 0 : (opts.motherVersionIndex ?? 0),
      metadataEnvelope,
    );
  await tx.wait();
  return built.person.personHash;
}

/** Full stubbed mint flow: add encrypted version, endorse, and mint. */
export async function mintPerson(
  ethers,
  deepFamily,
  signer,
  identityCommitment,
  fullName,
  opts = {},
) {
  const canonicalFullName = canonicalizeFullName(fullName);
  const identitySuiteId = resolveIdentitySuiteId(opts);
  const person = makeTestPerson(canonicalFullName, {
    derivedSecretField: opts.derivedSecretField ?? 0n,
    isBirthBC: opts.isBirthBC ?? false,
    birthYear: opts.birthYear ?? 1999,
    birthMonth: opts.birthMonth ?? 0,
    birthDay: opts.birthDay ?? 0,
    gender: opts.gender ?? 1,
    identitySuiteId,
  });
  const signerAddress = await signer.getAddress();
  const disclosure = buildDisclosureBindingInput(person, signerAddress, {
    selfSuiteId: identitySuiteId,
  });
  const resolvedIdentityCommitment = disclosure.person.identityCommitment;
  if (
    identityCommitment !== undefined &&
    identityCommitment !== null &&
    BigInt(identityCommitment) !== resolvedIdentityCommitment
  ) {
    throw new Error(
      "mintPerson stub helper requires identityCommitment to match the disclosure input",
    );
  }

  const personHash = await addPerson(ethers, deepFamily, signer, resolvedIdentityCommitment, {
    ...opts,
    person,
    selfSuiteId: identitySuiteId,
  });
  await (await deepFamily.connect(signer).endorseVersion(personHash, 1)).wait();

  const basicInfo = {
    identityCommitment: ethers.zeroPadValue(ethers.toBeHex(resolvedIdentityCommitment), 32),
    isBirthBC: person.isBirthBC,
    birthYear: person.birthYear,
    birthMonth: person.birthMonth,
    birthDay: person.birthDay,
    gender: person.gender,
  };
  const publicSignals = {
    identityCommitment: resolvedIdentityCommitment,
    disclosureBinding: disclosure.disclosureBinding,
    minter: BigInt(signerAddress),
    suiteCommitment: disclosure.suiteCommitment,
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
    .mintPersonVersionNFT(
      makeStubProof(opts.mintProofOverrides),
      publicSignals,
      1,
      opts.tokenURI ?? "",
      coreInfo,
    );
  const receipt = await tx.wait();

  return {
    personHash,
    identityCommitment: resolvedIdentityCommitment,
    circuitInput: disclosure.input,
    coreInfo,
    publicSignals,
    receipt,
  };
}
