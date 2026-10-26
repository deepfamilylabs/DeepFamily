import { poseidon3 } from "poseidon-lite";
import { bigintFrom } from "./bytes.js";
import { MAX_UINT64, SNARK_SCALAR_FIELD } from "./constants.js";
import { protocolAssert } from "./errors.js";

export const REVOCATION_SCAN_BATCH_SIZE = 32;
export const REVOCATION_SCAN_TAIL_SIZE = 8;
const fail = (condition, message) => protocolAssert(condition, "INVALID_REVOCATION_SCAN", message);
const field = (value, name) => bigintFrom(value, name, SNARK_SCALAR_FIELD - 1n);
const nonzero = (value, name) => {
  const parsed = field(value, name);
  fail(parsed > 0n, `${name} must be nonzero`);
  return parsed;
};
const roleOf = value => bigintFrom(value, "role", 2n);
function scope(input) {
  const chainId = bigintFrom(input.chainId, "chainId", MAX_UINT64);
  const address = typeof input.sourceAddress === "string" && /^0x[\da-f]{40}$/iu.test(input.sourceAddress)
    ? BigInt(input.sourceAddress) : input.sourceAddress;
  const sourceAddress = bigintFrom(address, "sourceAddress", (1n << 160n) - 1n);
  fail(chainId > 0n && sourceAddress > 0n, "Invalid revocation source scope");
  return { chainId, sourceAddress, role: roleOf(input.role) };
}

export function computeRevocationGenesis(input) {
  const { chainId, sourceAddress, role } = scope(input);
  return poseidon3([74300n + role, chainId, sourceAddress]);
}

export function computeRevocationDigest(input) {
  return poseidon3([74310n + roleOf(input.role), field(input.previousHash, "previousHash"), nonzero(input.secret, "secret")]);
}

/** Authenticate an ordered public page against a trusted on-chain endpoint. */
export function verifyRevocationPage(input) {
  const context = scope(input);
  const start = bigintFrom(input.start, "start", MAX_UINT64);
  const startHash = field(input.startHash, "startHash");
  const expectedEndHash = field(input.endHash, "endHash");
  fail(Array.isArray(input.secrets), "Expected revocation secrets");
  const end = start + BigInt(input.secrets.length);
  fail(end <= MAX_UINT64, "Revocation range exceeds uint64");
  if (start === 0n) fail(startHash === computeRevocationGenesis(context), "Invalid revocation genesis");
  const checkingTag = input.nonce !== undefined || input.tag !== undefined;
  const nonce = checkingTag ? nonzero(input.nonce, "nonce") : undefined;
  const tag = checkingTag ? nonzero(input.tag, "tag") : undefined;
  const checkpoints = [startHash];
  let digest = startHash, revoked = false;
  for (const value of input.secrets) {
    const secret = nonzero(value, "secret");
    if (checkingTag && poseidon3([73301n + context.role, secret, nonce]) === tag) revoked = true;
    digest = computeRevocationDigest({ role: context.role, previousHash: digest, secret });
    checkpoints.push(digest);
  }
  fail(digest === expectedEndHash, "Revocation page digest mismatch");
  return { start, end, startHash, endHash: digest, checkpoints, revoked };
}

/** No holder secrets are needed: the source has already published every log opening. */
export function prepareRevocationScan(input) {
  const context = scope(input);
  const nonce = nonzero(input.nonce, "nonce"), tag = nonzero(input.tag, "tag");
  fail(Array.isArray(input.secrets) && input.secrets.length > 0 && input.secrets.length <= REVOCATION_SCAN_BATCH_SIZE,
    "Expected between one and 32 revocation entries");
  const page = verifyRevocationPage({ ...input, ...context, nonce, tag });
  protocolAssert(!page.revoked, "QUALIFICATION_REVOKED", `Qualification role ${context.role} is revoked`);
  const secrets = input.secrets.map(value => nonzero(value, "secret"));
  const witness = { ...context, nonce, tag, start: page.start, end: page.end,
    startHash: page.startHash, endHash: page.endHash,
    secrets: [...secrets, ...Array(REVOCATION_SCAN_BATCH_SIZE - secrets.length).fill(0n)] };
  return { witness, publicSignals: [context.chainId, context.sourceAddress, context.role, nonce, tag,
    page.start, page.end, page.startHash, page.endHash],
    start: page.start, end: page.end, startHash: page.startHash, endHash: page.endHash };
}

/** Plan continuous proofs from already checked progress, leaving only a bounded live tail. */
export function planRevocationScans(input) {
  const context = scope(input);
  const nonce = nonzero(input.nonce, "nonce"), tag = nonzero(input.tag, "tag");
  const tailSize = input.tailSize ?? REVOCATION_SCAN_TAIL_SIZE;
  fail(Number.isSafeInteger(tailSize) && tailSize >= 0 && tailSize <= REVOCATION_SCAN_TAIL_SIZE,
    "Invalid revocation tail size");
  const page = verifyRevocationPage({ ...input, ...context, nonce, tag });
  protocolAssert(!page.revoked, "QUALIFICATION_REVOKED", `Qualification role ${context.role} is revoked`);
  const scans = [];
  let offset = 0;
  while (input.secrets.length - offset > tailSize) {
    const length = Math.min(REVOCATION_SCAN_BATCH_SIZE, input.secrets.length - offset);
    scans.push(prepareRevocationScan({ ...context, nonce, tag, start: page.start + BigInt(offset),
      startHash: page.checkpoints[offset], endHash: page.checkpoints[offset + length],
      secrets: input.secrets.slice(offset, offset + length) }));
    offset += length;
  }
  return { scans, checkedThrough: page.start + BigInt(offset), end: page.end, endHash: page.endHash };
}
