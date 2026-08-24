import { AbiCoder, getBytes, keccak256, toBeHex, zeroPadValue } from "ethers";
import { poseidon4 } from "poseidon-lite";
import {
  DOMAIN_VERSION_COMMITMENT,
  MAX_UINT128,
  MAX_UINT160,
  MAX_UINT256,
  MAX_UINT32,
  SNARK_SCALAR_FIELD,
  VERSION_HASH_DOMAIN,
} from "./constants.js";
import { bigintFrom, copyBytes, wipeBytes } from "./bytes.js";
import { assertAddress } from "./identity.js";
import { ProtocolError, protocolAssert } from "./errors.js";

const abiCoder = AbiCoder.defaultAbiCoder();

function bytes32(value, label) {
  try {
    const bytes = getBytes(value);
    protocolAssert(bytes.length === 32, "INVALID_BYTES32", `${label} must be 32 bytes`);
    return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError("INVALID_BYTES32", `${label} must be 32-byte hex`, { cause: error });
  }
}

export function computeContentDigest(canonicalJsonBytes) {
  const bytes = copyBytes(canonicalJsonBytes, "canonical JSON bytes");
  try {
    const contentDigest = keccak256(bytes);
    const digestInteger = BigInt(contentDigest);
    const contentDigestLo = digestInteger & MAX_UINT128;
    const contentDigestHi = digestInteger >> 128n;
    return {
      contentDigest,
      contentDigestBytes: getBytes(contentDigest),
      contentDigestLo,
      contentDigestHi,
    };
  } finally {
    wipeBytes(bytes);
  }
}

export function computeVersionCommitment(input) {
  const derivedSecretField = bigintFrom(
    input.derivedSecretField,
    "derivedSecretField",
    SNARK_SCALAR_FIELD - 1n,
  );
  const contentDigestLo = bigintFrom(input.contentDigestLo, "contentDigestLo", MAX_UINT128);
  const contentDigestHi = bigintFrom(input.contentDigestHi, "contentDigestHi", MAX_UINT128);
  return poseidon4([
    DOMAIN_VERSION_COMMITMENT,
    derivedSecretField,
    contentDigestLo,
    contentDigestHi,
  ]);
}

export function computeVersionHash(input) {
  const encoded = abiCoder.encode(
    ["bytes32", "bytes32", "bytes32", "uint256", "bytes32", "uint256", "uint256"],
    [
      VERSION_HASH_DOMAIN,
      bytes32(input.personHash, "personHash"),
      bytes32(input.fatherHash, "fatherHash"),
      bigintFrom(input.fatherVersionIndex, "fatherVersionIndex", MAX_UINT256),
      bytes32(input.motherHash, "motherHash"),
      bigintFrom(input.motherVersionIndex, "motherVersionIndex", MAX_UINT256),
      bigintFrom(input.versionCommitment, "versionCommitment", MAX_UINT256),
    ],
  );
  return keccak256(encoded);
}

export function packSubmitterAndSelfSuiteId(submitter, selfSuiteId) {
  const address = BigInt(assertAddress(submitter, "submitter"));
  const suite = bigintFrom(selfSuiteId, "selfSuiteId", MAX_UINT32);
  protocolAssert(suite !== 0n, "ZERO_IDENTITY_SUITE", "selfSuiteId must be nonzero");
  return address | (suite << 160n);
}

export function unpackSubmitterAndSelfSuiteId(value) {
  const packed = bigintFrom(value, "submitterAndSelfSuiteId", MAX_UINT256);
  protocolAssert(
    packed >> 192n === 0n,
    "PACKED_SIGNAL_OUT_OF_RANGE",
    "submitterAndSelfSuiteId has nonzero bits above bit 191",
  );
  const submitter = packed & MAX_UINT160;
  const selfSuiteId = (packed >> 160n) & MAX_UINT32;
  protocolAssert(selfSuiteId !== 0n, "ZERO_IDENTITY_SUITE", "Packed selfSuiteId must be nonzero");
  return {
    submitter: assertAddress(zeroPadValue(toBeHex(submitter), 20), "packed submitter"),
    selfSuiteId: Number(selfSuiteId),
  };
}

export function assertSubmitterAndSelfSuiteId(input) {
  const unpacked = unpackSubmitterAndSelfSuiteId(input.submitterAndSelfSuiteId);
  if (input.expectedSubmitter !== undefined) {
    protocolAssert(
      unpacked.submitter.toLowerCase() ===
        assertAddress(input.expectedSubmitter, "expectedSubmitter").toLowerCase(),
      "PACKED_SUBMITTER_MISMATCH",
      "Packed submitter does not match the expected wallet",
    );
  }
  if (input.expectedSelfSuiteId !== undefined) {
    const expectedSuite = bigintFrom(input.expectedSelfSuiteId, "expectedSelfSuiteId", MAX_UINT32);
    protocolAssert(
      BigInt(unpacked.selfSuiteId) === expectedSuite,
      "PACKED_IDENTITY_SUITE_MISMATCH",
      "Packed selfSuiteId does not match the envelope header",
    );
  }
  return unpacked;
}
