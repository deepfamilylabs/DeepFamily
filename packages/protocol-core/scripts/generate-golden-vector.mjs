import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFilePasswordBytes,
  buildIdentityPasswordBytes,
  bytesToHex,
  compressPersonVersionContent,
  computeDisclosureBinding,
  computeFormat1Aad,
  computePersonVersionContentCommitment,
  computeVersionHash,
  deriveIdentityMaterial,
  encryptPersonVersionEnvelope,
  packSubmitterAndSelfSuiteId,
  parseFormat1Envelope,
} from "../index.js";
import {
  DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
  PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC,
} from "../../proof-core/index.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const vectorPath = path.join(repositoryRoot, "protocol-vectors/onchain-biography-v1.json");

const rawPassphrase = "";
const identitySuiteId = 1;
const submitter = "0x2222222222222222222222222222222222222222";
const identity = Object.freeze({
  fullName: "Alice Smith",
  gender: 2,
  birthYear: 1980,
  birthMonth: 1,
  birthDay: 2,
  isBirthBC: false,
});

function sequentialRandom(start = 0) {
  let next = start;
  return (length) => Uint8Array.from({ length }, () => next++ & 0xff);
}

function decimal(value) {
  return BigInt(value).toString();
}

function orderedSignals(spec, values) {
  return spec.fieldOrder.map((fieldName) => decimal(values[fieldName]));
}

const material = await deriveIdentityMaterial({
  identity,
  rawPassphrase,
  identitySuiteId,
});
const metadata = {
  schema: "deepfamily/person-version@1.0",
  person: {
    ...identity,
    personHash: material.personHash,
  },
  parents: { father: null, mother: null },
  tag: "v1",
  biography: "Hello 世界\n",
};
const prepared = computePersonVersionContentCommitment({
  metadata,
  derivedSecretField: material.derivedSecretField,
});
const context = {
  chainId: 31_337n,
  deepFamilyProxy: "0x1111111111111111111111111111111111111111",
  personHash: material.personHash,
  fatherHash: `0x${"00".repeat(32)}`,
  fatherVersionIndex: 0n,
  motherHash: `0x${"00".repeat(32)}`,
  motherVersionIndex: 0n,
  versionCommitment: prepared.versionCommitment,
};
const packedSubmitter = packSubmitterAndSelfSuiteId(submitter, identitySuiteId);
const disclosureBinding = computeDisclosureBinding({
  nameField: material.nameField,
  packedBirthGenderField: material.packedBirthGenderField,
  suiteCommitment: material.suiteCommitment,
});
const personRelationValues = {
  identityCommitment: material.identityCommitment,
  fatherIdentityCommitment: 0n,
  motherIdentityCommitment: 0n,
  submitterAndSelfSuiteId: packedSubmitter,
  versionCommitment: prepared.versionCommitment,
};
const disclosureBindingValues = {
  identityCommitment: material.identityCommitment,
  disclosureBinding,
  minter: BigInt(submitter),
  suiteCommitment: material.suiteCommitment,
};
const aad = computeFormat1Aad({ context, identitySuiteId });
const compressed = compressPersonVersionContent(prepared.canonicalJsonBytes);
const encrypted = await encryptPersonVersionEnvelope({
  metadata,
  rawPassphrase,
  identitySuiteId,
  context,
  randomBytes: sequentialRandom(),
});
const parsed = parseFormat1Envelope(encrypted.envelope);

const vector = {
  schemaVersion: 1,
  status: "candidate-not-production-frozen",
  identity: {
    rawPassphrase,
    identitySuiteId,
    canonicalFullName: material.identity.fullName,
    identityPasswordInputHex: bytesToHex(buildIdentityPasswordBytes(rawPassphrase)),
    filePasswordInputHex: bytesToHex(buildFilePasswordBytes(rawPassphrase)),
    packedBirthGenderField: decimal(material.packedBirthGenderField),
    identitySaltHex: bytesToHex(material.identitySalt),
    argon2idOutputHex: bytesToHex(material.derivedSecretBytes),
    derivedSecretField: decimal(material.derivedSecretField),
    nameField: decimal(material.nameField),
    suiteCommitment: decimal(material.suiteCommitment),
    nameSecretCommitment: decimal(material.nameSecretCommitment),
    identityCommitment: decimal(material.identityCommitment),
    personHash: material.personHash,
  },
  metadata: {
    canonicalJsonUtf8: new TextDecoder().decode(prepared.canonicalJsonBytes),
    canonicalJsonHex: bytesToHex(prepared.canonicalJsonBytes),
    contentDigest: prepared.contentDigest,
    contentDigestLo: decimal(prepared.contentDigestLo),
    contentDigestHi: decimal(prepared.contentDigestHi),
    versionCommitment: decimal(prepared.versionCommitment),
    gzipHex: bytesToHex(compressed),
  },
  context: {
    chainId: decimal(context.chainId),
    deepFamilyProxy: context.deepFamilyProxy,
    personHash: context.personHash,
    fatherHash: context.fatherHash,
    fatherVersionIndex: decimal(context.fatherVersionIndex),
    motherHash: context.motherHash,
    motherVersionIndex: decimal(context.motherVersionIndex),
    versionCommitment: decimal(context.versionCommitment),
    contextPreimageHex: bytesToHex(aad.contextPreimage),
    contextHash: aad.contextHash,
    wrapAADHex: bytesToHex(aad.wrapAAD),
    contentAADHex: bytesToHex(aad.contentAAD),
    submitter,
    submitterAndSelfSuiteId: decimal(packedSubmitter),
    versionHash: computeVersionHash(context),
  },
  zkPublicSignals: {
    personRelation: {
      purpose: PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.purpose,
      circuitId: 1,
      publicSignalOrder: [...PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC.fieldOrder],
      publicSignals: orderedSignals(PERSON_RELATION_V1_PUBLIC_SIGNAL_SPEC, personRelationValues),
    },
    disclosureBinding: {
      purpose: DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.purpose,
      circuitId: 1,
      publicSignalOrder: [...DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC.fieldOrder],
      publicSignals: orderedSignals(
        DISCLOSURE_BINDING_V1_PUBLIC_SIGNAL_SPEC,
        disclosureBindingValues,
      ),
    },
  },
  envelope: {
    randomSource:
      "sequential bytes 0x00.. in call order DEK(32), fileSalt(16), wrapIV(12), contentIV(12)",
    headerHex: bytesToHex(encrypted.envelope.slice(0, 112)),
    fileSaltHex: bytesToHex(parsed.fileSalt),
    wrapIVHex: bytesToHex(parsed.wrapIV),
    contentIVHex: bytesToHex(parsed.contentIV),
    wrappedDEKHex: bytesToHex(parsed.wrappedDEK),
    wrappedDEKTagHex: bytesToHex(parsed.wrappedDEKTag),
    contentCiphertextHex: bytesToHex(parsed.contentCiphertext),
    contentTagHex: bytesToHex(parsed.contentTag),
    envelopeHex: bytesToHex(encrypted.envelope),
    payloadHash: encrypted.payloadHash,
    payloadLength: encrypted.envelopeLength,
  },
};

const serialized = `${JSON.stringify(vector, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (!fs.existsSync(vectorPath) || fs.readFileSync(vectorPath, "utf8") !== serialized) {
    throw new Error(
      "protocol-vectors/onchain-biography-v1.json is stale; regenerate it with this script",
    );
  }
} else {
  fs.writeFileSync(vectorPath, serialized);
}
process.stdout.write(
  `${path.relative(repositoryRoot, vectorPath)} sha256=${createHash("sha256")
    .update(serialized)
    .digest("hex")}\n`,
);
