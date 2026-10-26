import { poseidon3 } from "poseidon-lite";
import { strings } from "./receive_fixture.mjs";

/** Independent fixture: each input opening already belongs to the public source log. */
export function revocationScanFixture(options = {}) {
  const chainId = BigInt(options.chainId ?? 31337n);
  const sourceAddress = BigInt(options.sourceAddress ?? 0x3333333333333333333333333333333333333333n);
  const role = BigInt(options.role ?? 1n);
  const nonce = BigInt(options.nonce ?? 9001n);
  const targetSecret = BigInt(options.targetSecret ?? 999991n);
  const tag = BigInt(options.tag ?? poseidon3([73301n + role, targetSecret, nonce]));
  const prefixSecrets = (options.prefixSecrets ?? []).map(BigInt);
  const entries = (options.secrets ?? Array.from({ length: 32 }, (_, index) => 40000n + BigInt(index))).map(BigInt);
  let startHash = poseidon3([74300n + role, chainId, sourceAddress]);
  for (const secret of prefixSecrets) startHash = poseidon3([74310n + role, startHash, secret]);
  startHash = BigInt(options.startHash ?? startHash);
  let endHash = startHash;
  for (const secret of entries) endHash = poseidon3([74310n + role, endHash, secret]);
  endHash = BigInt(options.endHash ?? endHash);
  const start = BigInt(options.start ?? prefixSecrets.length);
  const end = BigInt(options.end ?? start + BigInt(entries.length));
  const witness = { chainId, sourceAddress, role, nonce, tag, start, end, startHash, endHash,
    secrets: [...entries, ...Array(Math.max(0, 32 - entries.length)).fill(0n)] };
  return { witness: strings(witness), publicSignals: [chainId, sourceAddress, role, nonce, tag, start, end, startHash, endHash],
    targetSecret, entries, prefixSecrets };
}
