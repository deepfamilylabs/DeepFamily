import {
  MAX_UINT64,
  REVOCATION_SCAN_BATCH_SIZE,
  REVOCATION_SCAN_TAIL_SIZE,
  SNARK_SCALAR_FIELD,
  verifyRevocationPage,
} from "@deepfamily/protocol-core";
import { getAddress, getBigInt, type Contract } from "ethers";
import { assertReceiveTreeAnchor, type ReceiveTreeAnchor } from "./receiveTree";

export type RoleRevocationState = ReceiveTreeAnchor & {
  chainId: bigint;
  sourceAddress: string;
  role: 0 | 1 | 2;
  nonce: bigint;
  tag: bigint;
  count: bigint;
  checkedThrough: bigint;
  start: bigint;
  end: bigint;
  startHash: bigint;
  endHash: bigint;
  secrets: bigint[];
  revoked: boolean;
};

function field(value: unknown, label: string, nonzero = false): bigint {
  const parsed = getBigInt(value as bigint);
  if (parsed < 0n || parsed >= SNARK_SCALAR_FIELD || (nonzero && parsed === 0n))
    throw new Error(`Noncanonical revocation ${label}`);
  return parsed;
}
function uint64(value: unknown, label: string): bigint {
  const parsed = getBigInt(value as bigint);
  if (parsed < 0n || parsed > MAX_UINT64) throw new Error(`Invalid revocation ${label}`);
  return parsed;
}

/**
 * Read only public openings after the on-chain proof cache's authenticated progress.
 * Every read uses one block, and the complete ordered interval must match its checkpoint.
 * maxEntries authenticates only a bounded interval for one preparation proof. Its
 * revoked=false does not establish validity of the remaining log when end<count.
 * A Source synchronization requirement is not a revocation and is never queried here.
 */
export async function readRoleRevocationState(input: {
  source: Contract;
  chainId: bigint;
  anchor: ReceiveTreeAnchor;
  role: 0 | 1 | 2;
  nonce: bigint;
  tag: bigint;
  maxEntries?: number;
}): Promise<RoleRevocationState> {
  const { source, chainId, anchor, role } = input;
  if (input.maxEntries !== undefined && (!Number.isInteger(input.maxEntries)
    || input.maxEntries < 1 || input.maxEntries > REVOCATION_SCAN_BATCH_SIZE))
    throw new Error("Invalid revocation interval limit");
  if (role !== 0 && role !== 1 && role !== 2) throw new Error("Invalid revocation role");
  const nonce = field(input.nonce, "nonce", true), tag = field(input.tag, "tag", true);
  if (typeof chainId !== "bigint" || chainId <= 0n || chainId > MAX_UINT64)
    throw new Error("Invalid revocation chain");
  const provider = source.runner?.provider;
  if (!provider) throw new Error("Revocation state requires a provider");
  const sourceAddress = getAddress(await source.getAddress());
  if (BigInt(sourceAddress) === 0n) throw new Error("Invalid revocation source");
  if ((await provider.getNetwork()).chainId !== chainId)
    throw new Error("Revocation source belongs to another chain");
  await assertReceiveTreeAnchor(provider, anchor);
  const overrides = { blockTag: anchor.blockNumber };
  const [rawCount, rawChecked, rawBatch, rawTail] = await Promise.all([
    source.revokedRoleCount(role, overrides),
    source.roleScanProgress(role, nonce, tag, overrides),
    source.MAX_REVOCATION_BATCH(overrides),
    source.MAX_REVOCATION_TAIL(overrides),
  ]);
  const count = uint64(rawCount, "count"), checkedThrough = uint64(rawChecked, "progress");
  if (checkedThrough > count) throw new Error("Revocation progress exceeds its log");
  if (getBigInt(rawBatch) !== BigInt(REVOCATION_SCAN_BATCH_SIZE)
    || getBigInt(rawTail) !== BigInt(REVOCATION_SCAN_TAIL_SIZE))
    throw new Error("Revocation proof limits do not match the source");
  const requestedEnd = input.maxEntries === undefined ? count : checkedThrough + BigInt(input.maxEntries);
  const end = requestedEnd < count ? requestedEnd : count;
  const [rawStartHash, rawEndHash] = await Promise.all([
    source.revocationCheckpoint(role, checkedThrough, overrides),
    source.revocationCheckpoint(role, end, overrides),
  ]);
  const startHash = field(rawStartHash, "start checkpoint"), endHash = field(rawEndHash, "end checkpoint");
  const secrets: bigint[] = [];
  for (let start = checkedThrough; start < end;) {
    const limit = Number(end - start > 256n ? 256n : end - start);
    const page: unknown = await source.getRevokedRolePage(role, start, limit, overrides);
    if (!Array.isArray(page) || page.length !== limit) throw new Error("Incomplete revocation page");
    for (const secret of page) secrets.push(field(secret, "secret", true));
    start += BigInt(limit);
  }
  const authenticated = verifyRevocationPage({ chainId, sourceAddress, role, nonce, tag,
    start: checkedThrough, startHash, endHash, secrets });
  if (authenticated.end !== end) throw new Error("Revocation interval does not cover its endpoint");
  await assertReceiveTreeAnchor(provider, anchor);
  return { chainId, sourceAddress, role, nonce, tag, count, checkedThrough, start: checkedThrough, end,
    startHash, endHash, secrets, revoked: authenticated.revoked, ...anchor };
}
