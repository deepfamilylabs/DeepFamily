# Multicall (Frontend Read Batching)

This project has **planned/optional** support for a Multicall contract to batch many read-only on-chain calls into fewer RPC requests.

## Current status

- The frontend already contains a code path that can use Multicall when `VITE_MULTICALL_ADDRESS` is configured.
- This repository does **not** currently deploy/provide a Multicall contract by default.
- Until you deploy (or choose) a Multicall contract and set `VITE_MULTICALL_ADDRESS`, the app will keep using normal individual `eth_call` reads.

## What it is

Multicall is a small helper contract that aggregates multiple `staticcall`/`eth_call` operations into a single call. The frontend can encode many contract reads (e.g. `endorsementCount`, `tokenId`, etc.) and send them to Multicall once, then decode the returned results.

## Why we use it

- Fewer RPC requests (especially important on public RPC endpoints)
- Less rate limiting / throttling risk
- Faster initial loading for pages that need many reads (tree pages, stats, etc.)

Multicall does **not** replace transactions and does **not** batch state-changing operations. It is for read-only calls only.

## Configuration

If/when you deploy (or select) a Multicall contract on your target network, set its address in the frontend environment:

- `frontend/.env.local` (local dev) or `frontend/.env` (custom environment)

Example:

```bash
VITE_MULTICALL_ADDRESS=0x...
```

Notes:

- The address is **network-specific** (each chain/network has a different deployment).
- Only set it if your target network has a deployed Multicall contract at that address.
- If it is unset, the frontend falls back to individual RPC reads.

## Where it's used

The batching behavior is used inside the frontend data-fetching layer:

- `frontend/src/context/TreeDataContext.tsx` reads `import.meta.env.VITE_MULTICALL_ADDRESS` and enables multicall when present.

## How to validate

1. Open a data-heavy page (e.g. family tree / people / editor flows that load many items).
2. Compare network activity with and without `VITE_MULTICALL_ADDRESS`:
   - Without Multicall: many `eth_call` requests.
   - With Multicall: fewer `eth_call` requests (larger payloads).

If reads fail after enabling Multicall, verify:

- The address is correct for the current network.
- The deployed contract matches the ABI expected by the frontend.
