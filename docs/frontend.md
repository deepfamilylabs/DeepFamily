# Frontend Guide

The DeepFamily frontend is a React/Vite SPA that:
- reads/writes on-chain data via an RPC endpoint (EVM JSON-RPC),
- loads ZK proof artifacts (wasm/zkey/vkey) for proof workflows,
- encrypts/decrypts metadata bundles client-side.

## Tech Stack (high level)
- React + TypeScript + Vite
- TailwindCSS
- Ethers.js (chain reads + transactions)
- SnarkJS (proof workflows)
- React Hook Form + Zod (form handling + validation)
- i18next (localization)

## Architecture Overview

**Routing**
- Pages live under `frontend/src/pages/` and are routed via React Router.

### Rendering Pipeline (FamilyTree)

The FamilyTree UI is designed as a **Rendering Pipeline** (a.k.a. **Pipes & Filters**). Each view renders by passing data through a fixed sequence of stages:

**ViewModel → Layout → Viewport → Renderer**

- The **pipeline order is fixed by the framework** (Template Method): views orchestrate the stages, but should not reshuffle responsibilities.
- **Layout** and **Renderer** are **pluggable strategies** (Strategy Pattern): different views swap only geometry (layout) and visuals (renderer) while sharing the same ViewModel and Viewport.

**Design rules**
- Views should not “re-assemble” node UI fields or re-derive graph structure; they consume ViewModel outputs.
- **ViewModel** is the single source of truth for `graph`, `nodeUiById`, selection state, and user actions (e.g. open/copy/endorse).
- **Layout** is responsible only for geometry (positions / simulation coordinates), not DOM, modals, or filtering.
- **Viewport** handles zoom/pan/minimap and is shared across graph-based views.
- **Renderer** draws nodes/edges and wires view-specific interactions, consuming ViewModel data + Layout output.

**Where to look in code**
- ViewModel: `frontend/src/hooks/useFamilyTreeViewModel.ts`
- Layout engines: `frontend/src/layout/`
- Viewport: `frontend/src/components/GraphViewport.tsx`
- Renderers: `frontend/src/renderers/`

**Extending the system**
To add a new view, implement a new Layout and/or Renderer strategy and plug it into the pipeline; avoid duplicating ViewModel logic or mixing cross-cutting concerns into view components.

**State & data access**
- Providers live under `frontend/src/context/` (wallet/config/tree data).
- Reusable chain/data logic lives under `frontend/src/hooks/`.

**On-chain integration**
- Contract ABIs are stored in `frontend/src/abi/`.
- Contract addresses / chain RPC come from `VITE_*` env vars.

**ZK + crypto isolation**
- Heavy/sensitive operations run in Web Workers where possible (crypto + proof generation).
- ZK artifacts are fetched from `/zk/*` at runtime (wasm/zkey/vkey json).

## Quick Start

From repo root:
- `npm run frontend:dev` (dev server)
- `npm run frontend:build` (production build)
- `npm run frontend:preview` (serve build locally)

Or from `frontend/`:
- `npm run dev`
- `npm run build`
- `npm run preview`

## Local Integrated Development (Contracts + UI)

If you want the full local stack (Hardhat node + deploy + seed + UI):
- From repo root: `npm run dev:all`

If you want to run steps manually:
- `npm run dev:node` (Hardhat node)
- `npm run dev:deploy` (deploy integrated system)
- `npm run dev:seed` (seed demo data)
- `npm run frontend:config` (generate `frontend/.env.local` from local deployments)
- `npm run dev:frontend` (start Vite dev server)

## Configuration

The frontend reads configuration from `frontend/.env` (shared) and `frontend/.env.local` (local overrides).
For the full list and defaults, see `frontend/.env.example`.

**Required (minimum to render the app)**
```bash
VITE_RPC_URL=...
VITE_CONTRACT_ADDRESS=...
VITE_ROOT_PERSON_HASH=...
VITE_ROOT_VERSION_INDEX=...
```

**Common optional**
- Performance knobs: `VITE_DF_HARD_NODE_LIMIT`
- Debug/caching: `VITE_SHOW_DEBUG`, `VITE_STRICT_CACHE_ONLY`, `VITE_USE_INDEXEDDB_CACHE` (tree caches persist in IndexedDB when enabled)

### Auto-config for localhost

For local development you typically do not edit addresses by hand:
- `npm run frontend:config` (repo root) or `npm run config:local` (inside `frontend/`)
- This reads local deployment outputs and writes/updates `frontend/.env.local`.

## ABI Sync (Contracts → Frontend)

ABIs are copied into `frontend/src/abi/` from the Hardhat build outputs so the UI stays in sync with contracts.
- Script: `frontend/scripts/sync-abi.mjs`
- Triggered by the frontend lifecycle scripts (dev/build)

If you changed Solidity interfaces and the frontend breaks, re-run the frontend dev/build scripts (or run `node frontend/scripts/sync-abi.mjs`).

## ZK Artifacts

Proof workflows load public artifacts from `/zk/*` at runtime.
- Inputs: `.wasm`, `.zkey`, and `.vkey.json`
- See `docs/zk-proofs.md` for artifact generation and verification details.

Default location in this repo:
- `frontend/public/zk/` (served by Vite as `/zk/…`)

If proof generation/verification fails, first confirm the expected `/zk/*` files are present and served by Vite preview/dev.

## Workers (Crypto + ZK)

The frontend uses workers to keep heavy and sensitive computations out of UI components:
- Crypto worker entry: `frontend/src/workers/crypto.worker.ts`
- ZK worker entry: `frontend/src/workers/zk.worker.ts`
- Client wrappers: `frontend/src/lib/cryptoWorkerClient.ts`, `frontend/src/lib/zkWorkerClient.ts`

Practical expectation: if a change makes a worker crash, the most common cause is accidentally importing React/DOM code into a worker bundle. Keep shared logic in `frontend/src/lib/` and ensure it is worker-safe.

## Source Layout
```
frontend/src/
├── components/          # UI components
├── pages/               # Routes
├── context/             # App providers
├── hooks/               # Data + contract hooks
├── layout/              # Layout engines (tree/dag/force)
├── renderers/           # View renderers (SVG/D3/list)
├── lib/                 # Shared logic (worker-safe where possible)
├── workers/             # Web worker entrypoints (crypto/ZK)
├── abi/                 # Contract ABIs
├── constants/           # UI/layout constants
├── types/               # TypeScript types
├── utils/               # Misc utilities
└── locales/             # i18n resources
```

## Security Notes

- Sensitive inputs (passphrases/passwords) should not be stored in React state/props or persistent storage.
- CSP is expected to be strict in preview/production; use report-only to iterate.

See `docs/frontend-security.md` for the threat model, CSP guidance, and handling rules for sensitive inputs.

## Security Commands

From repo root:
- `npm run security:audit` (audit root + frontend prod deps)
- `npm run security:xss-scan` (cheap grep-based check for common XSS sinks)

From `frontend/`:
- `npm run csp:scan` (optional; Playwright-based route scan to collect CSP violations)

## Troubleshooting

- “Network Error” / read failures: verify `VITE_RPC_URL` and `VITE_CONTRACT_ADDRESS`.
- ABI mismatch errors: re-run ABI sync (see above).
- Proof errors: confirm `/zk/*` artifacts exist and match the circuit/verifier versions.
