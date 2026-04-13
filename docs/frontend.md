# Frontend Guide

The DeepFamily frontend is a React + TypeScript SPA built with Vite. It reads and writes on-chain data over JSON-RPC, generates/verifies Groth16 proofs in-browser, and encrypts/decrypts metadata client-side.

This document is the single source of truth for frontend architecture. [frontend/README.md](../frontend/README.md) only covers quick start and required env vars.

## Tech Stack

- React 18 + TypeScript, Vite 7, TailwindCSS
- Ethers v6 for chain reads and transactions
- snarkjs for Groth16 proof workflows
- React Hook Form + Zod for forms and validation
- React Router v7 for routing
- i18next for localization
- Vitest + Testing Library for unit/component tests

## Architecture

### Layered source layout

```
frontend/src/
├── app/         # App shell: providers, router, error boundary, layout/header/footer, shell-wide context
├── pages/       # Route-level composition; imports from domains + shared only
├── domains/     # Feature code grouped by bounded context
│   ├── config/        # Network/contract config context and UI
│   ├── wallet/        # Wallet + network selection
│   ├── person/        # Person model, queries, UI coordination
│   ├── tree/          # Family-tree context/queries/selectors/services and view UI
│   └── transactions/  # Transaction flows and services
├── shared/      # Cross-domain utilities (no React Router, no page-specific logic)
│   ├── cache/         # Query cache + IndexedDB persistence
│   ├── clients/       # Ethers provider/contract clients
│   ├── config/        # Env-driven runtime config
│   ├── crypto/        # Worker-safe crypto (scrypt, key derivation, metadata encryption)
│   ├── zk/            # Worker-safe ZK helpers (proof I/O, hashing)
│   ├── ipfs/          # IPFS gateways + CID helpers
│   ├── model/         # Shared domain types
│   ├── lib/           # Small framework-agnostic utilities
│   ├── ui/             # Reusable presentational primitives (no domain coupling)
│   └── workers/       # Worker client wrappers (main-thread side)
├── workers/     # Web Worker entrypoints (crypto.worker.ts, zk.worker.ts)
├── abi/         # Synced contract ABI (do not edit by hand)
├── i18n/        # i18next initialization
├── locales/     # Translation resources
├── assets/      # Static assets imported by the app
└── shims/       # Browser/library shims and ambient declarations
```

### Dependency direction

Imports must flow **downward** through the layers:

```
app  →  pages  →  domains  →  shared  →  (workers / abi / i18n / assets)
```

- `shared/` must not import from `domains/`, `pages/`, or `app/`.
- `domains/*` must not import from sibling domains. Cross-domain needs belong in `shared/` or are wired at the `pages/` / `app/` layer.
- `pages/` compose domains; they should not contain reusable logic — extract to the relevant domain instead.
- Code imported by a worker (`workers/*.worker.ts`) must stay worker-safe: no React, no DOM, no `window`. Put such code under `shared/crypto/`, `shared/zk/`, or `shared/lib/`.

`frontend:legacy-entrypoints` enforces that retired entrypoints stay removed; re-run it after large refactors.

### FamilyTree rendering pipeline

The tree UI is a **pipes-and-filters** pipeline. Every view renders by passing data through the same fixed sequence:

```
ViewModel  →  Layout  →  Viewport  →  Renderer
```

- The pipeline order is fixed (Template Method). Views orchestrate stages; they do not reshuffle responsibilities.
- **Layout** and **Renderer** are pluggable strategies. New views swap only geometry and visuals while sharing ViewModel and Viewport.

| Stage     | Responsibility                                               | Code |
|-----------|--------------------------------------------------------------|------|
| ViewModel | Single source of truth for `graph`, `nodeUiById`, selection, and user actions (open/copy/endorse). | `domains/tree/ui/useFamilyTreeViewModel.ts` |
| Layout    | Pure geometry: positions, simulation coordinates. No DOM, no modals, no filtering. | `domains/tree/ui/layout/` |
| Viewport  | Zoom, pan, and minimap; shared across graph-based views.     | `domains/tree/ui/GraphViewport.tsx` |
| Renderer  | Draws nodes/edges and wires view-specific interactions using ViewModel + Layout output. | `domains/tree/ui/renderers/` |

**Rules for view code**

- Do not re-assemble node UI fields or re-derive graph structure inside a view — consume ViewModel output.
- Do not put filtering, modal wiring, or data fetching inside Layout.
- To add a new view, implement a new Layout and/or Renderer and plug it into the pipeline. Do not duplicate ViewModel logic.

### Workers (crypto + ZK)

Heavy and sensitive computation runs off the main thread:

- Worker entries: `frontend/src/workers/crypto.worker.ts`, `frontend/src/workers/zk.worker.ts`
- Main-thread clients: `frontend/src/shared/workers/cryptoWorkerClient.ts`, `frontend/src/shared/workers/zkWorkerClient.ts`
- Worker-safe logic: `frontend/src/shared/crypto/`, `frontend/src/shared/zk/`

The most common worker crash is accidentally pulling React or DOM code into the worker bundle via a transitive import. If a worker breaks after a refactor, check the new import graph under `shared/crypto` and `shared/zk` first.

### On-chain integration

- Contract ABIs live in `frontend/src/abi/` and are copied from Hardhat build output by `frontend/scripts/sync-abi.mjs`. The script runs automatically in `npm run dev` and `npm run build`.
- Providers and contract instances are constructed in `frontend/src/shared/clients/`.
- RPC URL and contract address come from `VITE_*` env vars (see below).
- If the frontend breaks after a Solidity interface change, re-run dev/build or `node frontend/scripts/sync-abi.mjs` directly.

## Configuration

The frontend reads configuration from `frontend/.env` and `frontend/.env.local` (local override). See `frontend/.env.example` for the authoritative list.

**Required**

```bash
VITE_RPC_URL=...
VITE_CONTRACT_ADDRESS=...
VITE_ROOT_PERSON_HASH=...
VITE_ROOT_VERSION_INDEX=...
```

**Commonly used optional vars**

| Variable | Purpose |
|----------|---------|
| `VITE_ROOT_PERSON_HASH_<LANG>`, `VITE_ROOT_VERSION_INDEX_<LANG>` | Per-language root overrides (e.g. `_EN`, `_ZH`) |
| `VITE_IPFS_GATEWAY_BASE_URLS` | Override IPFS gateway dropdown; must match CSP allowlist |
| `VITE_DF_HARD_NODE_LIMIT` | Cap tree node count for public/low-budget RPCs |
| `VITE_DF_*_TTL_MS`, `VITE_DF_QUERY_PAGE_LIMIT` | Query cache tuning |
| `VITE_USE_INDEXEDDB_CACHE` | Persist tree caches in IndexedDB |
| `VITE_SHOW_DEBUG` | Enable debug UI (tree debug panel, etc.) |
| `VITE_BRAND_BADGE` | Show a build/brand badge in the header |

### Local auto-config

For a local Hardhat stack you normally do not edit addresses by hand:

```bash
npm run frontend:config    # repo root, or `npm run config:local` inside frontend/
```

This reads `deployments/localhost/` and writes `frontend/.env.local`, including per-language root variants.

## Development Commands

### Day-to-day (from repo root)

```bash
npm run frontend:dev        # Vite dev server (auto ABI sync)
npm run frontend:build      # Production build
npm run frontend:preview    # Serve the built bundle
npm run frontend:check      # lint + legacy-entrypoints + typecheck + vitest
```

`frontend:check` is the gate to run before committing — it matches what CI runs.

### Full local stack (contracts + UI)

```bash
npm run dev:all
```

This starts a Hardhat node, deploys the integrated system, seeds demo data, generates `frontend/.env.local`, and starts the Vite dev server. For step-by-step control, use `dev:node`, `dev:deploy`, `dev:seed`, `frontend:config`, `dev:frontend` individually.

### Inside `frontend/`

```bash
npm run dev
npm run build
npm run preview
npm run lint
npm run test                 # vitest
npx tsc --noEmit -p tsconfig.json
```

### Locales

```bash
npm run frontend:locales:check     # compare keys + unused-key usage scan
```

Run this after adding or removing i18n keys. Translations live under `frontend/src/locales/`.

## Testing

- Framework: **Vitest** + `@testing-library/react` (jsdom environment).
- Test files sit next to source, named `*.test.ts` / `*.test.tsx`.
- Keep tests at the layer where the behavior lives: render tests for components, pure unit tests for `shared/lib` and domain selectors, integration tests for pages only when the behavior spans multiple domains.
- Worker modules are hard to test end-to-end. Prefer testing the worker-safe logic under `shared/crypto` / `shared/zk` directly, and mock the worker client at the boundary.

## ZK Artifacts

Proof workflows load public artifacts from `/zk/*` at runtime:

- Inputs: `.wasm`, `.zkey`, `.vkey.json`
- Default location: `frontend/public/zk/` (served as `/zk/…`)
- Generation and verification details: see [zk-proofs.md](zk-proofs.md)

If proof generation or verification fails, first confirm the expected files exist in `public/zk/` and are reachable under `/zk/…` in dev/preview.

## Security

- Passphrases and other sensitive inputs must not be placed in React state/props or persistent storage. Pass them directly to a worker and clear as soon as possible.
- CSP is strict in preview/production. Iterate with Report-Only and `csp:scan`, then enforce.
- Security commands (from repo root):

  ```bash
  npm run security:audit       # prod dependency audit (root + frontend)
  npm run security:xss-scan    # grep-based XSS sink check
  ```

- From `frontend/`: `npm run csp:scan` runs a Playwright-based route scan to collect CSP violations.

See [frontend-security.md](frontend-security.md) for the threat model, CSP guidance, and detailed handling rules.

## Recipes

### Add a new page

1. Create `frontend/src/pages/MyPage.tsx` and register the route in `frontend/src/app/router.tsx`.
2. Import data/actions from the relevant `domains/*` module. If the logic does not yet exist, add it to that domain — not to the page file.
3. Add a test under `pages/MyPage.test.tsx` for user-visible behavior that spans domains. Leave unit coverage for the domain layer.
4. Add any new i18n keys under `src/locales/<lang>/…` and run `npm run frontend:locales:check`.

### Add a new tree view

1. Implement a Layout strategy under `domains/tree/ui/layout/` (pure geometry).
2. Implement a Renderer under `domains/tree/ui/renderers/` consuming `useFamilyTreeViewModel` output.
3. Register the new view in `ViewModeSwitch` and the view container. Do not duplicate ViewModel logic.

### Add a new env var

1. Document it in `frontend/.env.example` with a short comment.
2. Read it through `shared/config/` — do not sprinkle `import.meta.env` across the codebase.
3. If it controls an allowlisted origin (RPC, IPFS gateway), update CSP configuration and re-run `csp:scan`.

## Troubleshooting

| Symptom | First thing to check |
|---------|----------------------|
| "Network Error" / read failures | `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS`, and that the node is reachable |
| ABI mismatch / missing methods | Re-run `npm run frontend:sync:abi` (or restart `frontend:dev`) |
| Proof generation fails | Confirm `/zk/*` artifacts exist and match the deployed verifier version |
| Worker crashes on import | A React/DOM import leaked into `shared/crypto` or `shared/zk` — inspect the import graph |
| Stale tree/query data | Clear IndexedDB (`VITE_USE_INDEXEDDB_CACHE=1`) or toggle it off for a run |
| Root node not found | Verify `VITE_ROOT_PERSON_HASH` / `VITE_ROOT_VERSION_INDEX` (or their per-language variants) |
