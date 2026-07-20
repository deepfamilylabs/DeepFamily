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

### Key frontend files

Use the directory tree for ownership boundaries, and these files as first-read entry points when tracing behavior:

- App shell: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/app/router.tsx`, `frontend/src/app/AppProviders.tsx`, `frontend/src/app/ui/Layout.tsx`
- Runtime config: `frontend/src/shared/config/env.ts`, `frontend/src/shared/config/networks.ts`, `frontend/src/app/config/brandBadge.ts`, `frontend/src/domains/tree/config/familyTreeConfig.ts`, `frontend/src/shared/ipfs/config.ts`
- Domain gateways: `frontend/src/domains/tree/api/treeReadGateway.ts`, `frontend/src/domains/person/api/personReadGateway.ts`, `frontend/src/domains/transactions/api/txGateway.ts`, `frontend/src/domains/transactions/api/invalidationCoordinator.ts`
- Tree runtime: `frontend/src/domains/tree/context/TreeViewContext.tsx`, `frontend/src/domains/tree/context/useTreeGraphState.ts`, `frontend/src/domains/tree/services/treeTraversalOrchestrator.ts`
- Worker/ZK/crypto boundaries: `frontend/src/workers/crypto.worker.ts`, `frontend/src/workers/zk.worker.ts`, `frontend/src/shared/workers/`, `frontend/src/shared/crypto/identityCommitment.ts`, `frontend/src/shared/zk/proofDescriptors.ts`
- Boundary tests: `frontend/src/shared/config/env.test.ts`, `frontend/src/pages/TreePage.test.tsx`, `frontend/src/domains/tree/api/treeReadGateway.test.ts`, `frontend/src/domains/transactions/api/txGateway.test.ts`

Update this section when adding or moving stable entry points, route groups, domain gateways, app providers, shared config/client/cache layers, worker boundaries, or boundary-level tests. Do not list ordinary leaf components, local renderers, or one-off helpers here; keep them discoverable through their owning directory.

### Dependency direction

Imports must flow **downward** through the layers:

```
app  →  pages  →  domains  →  shared  →  (workers / abi / i18n / assets)
```

- `shared/` must not import from `domains/`, `pages/`, or `app/`.
- `domains/*` must not import from sibling domains. Cross-domain needs belong in `shared/` or are wired at the `pages/` / `app/` layer.
- Contract result parsers, `NodeData` merge helpers, and shared read gateways used by multiple domains live under `shared/model` or `shared/clients`; domain-local files may re-export them for compatibility.
- `pages/` compose domains; they should not contain reusable logic — extract to the relevant domain instead.
- Code imported by a worker (`workers/*.worker.ts`) must stay worker-safe: no React, no DOM, no `window`. Put such code under `shared/crypto/`, `shared/zk/`, or `shared/lib/`.

Cross-runtime ZK protocol definitions live in the private `@deepfamily/proof-core` workspace.
That package must remain browser- and Node-neutral: no filesystem access, `snarkjs`, artifact
paths, or browser URLs. Node artifact candidates belong in `lib/proofDescriptors.js`; browser
artifact URLs belong in `frontend/src/shared/zk/proofDescriptors.ts`.

`frontend:legacy-entrypoints` enforces that retired entrypoints stay removed; re-run it after large refactors.

### React page and transaction UI structure

Pages and modal contents are composition shells. They should wire route/modal inputs, feature hooks, and presentational sections, but should not own large business flows, contract calls, worker calls, cache mutation, or long JSX blocks.

Use this responsibility split for React page and transaction UI code:

| Responsibility            | Preferred location                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| UI rendering              | Pure component / section component                                                                           |
| Stateful UI coordination  | Feature hook, such as `useAddVersionFlow` or `useEndorseTargetStatus`                                        |
| Complex flow state        | Reducer or explicit state machine in the owning domain or feature `model/`                                   |
| Pure domain logic         | Types, schema, parser, reducer, transition function, and framework-free helper in domain or feature `model/` |
| Side effects              | Service, gateway, worker client, contract client, or cache coordinator                                       |
| Route / modal composition | Page shell or modal content shell                                                                            |

Component props should describe the data and actions a section needs. Do not pass a whole domain object through a section when a smaller view model is enough. DOM events should stay at input boundaries; pass parsed business values upward.

For TypeScript:

- Exported props and public contracts should prefer `interface`.
- Union state, literal steps, mapped types, utility types, and composed internal types should use `type`.
- Shared section/hook/service types belong in the owning domain or feature `model/*Types.ts`; private one-off types can stay near their usage.
- Generics should be limited to genuinely reusable hooks, helpers, and adapters.

Transaction modal flow models may start under `domains/transactions/ui/<flow>/model/` when they are local to one UI flow. Move them upward only after another flow or non-UI caller has a real reuse need.

Each transaction flow should have one canonical React flow hook. When the flow is owned by a transaction modal, place that hook under `domains/transactions/ui/<flow>/hooks/useXxxFlow.ts` and make it the only React orchestration entry point for that flow. Do not keep a parallel `domains/transactions/flows/useXxxFlow.ts` compatibility hook. Shared non-React behavior belongs in `domains/transactions/services/*`, `domains/transactions/api/*`, `domains/transactions/model/*`, or `shared/*`.

### Transaction flow state

Complex transaction UI must use an explicit state machine. Avoid representing mutually exclusive states with independent booleans such as `isSubmitting`, `isSuccess`, and `hasError`.

Prefer a discriminated union that makes illegal combinations impossible:

```ts
type TransactionState<TResult> =
  | { step: "idle"; message?: undefined; result?: undefined; error?: undefined }
  | { step: "checking-target"; message: string; result?: undefined; error?: undefined }
  | { step: "validating"; message: string; result?: undefined; error?: undefined }
  | { step: "preparing-proof"; message: string; result?: undefined; error?: undefined }
  | { step: "encrypting"; message: string; result?: undefined; error?: undefined }
  | { step: "waiting-wallet"; message: string; result?: undefined; error?: undefined }
  | { step: "approving"; message: string; result?: undefined; error?: undefined }
  | { step: "submitting"; message: string; result?: undefined; error?: undefined }
  | { step: "confirming"; message: string; result?: undefined; error?: undefined }
  | { step: "success"; message?: string; result: TResult; error?: undefined }
  | { step: "error"; message?: string; result?: undefined; error: FriendlyError };
```

UI should derive rendering from `state.step`, `state.result`, and `state.error`, not from scattered local flags.

`FriendlyError` means the app's normalized user-facing error shape, such as the result of `getFriendlyError` or a transaction-domain type with the same fields. Do not invent a new incompatible error object for each flow.

Avoid long-lived nullable transaction state shapes such as `status + error | null + result | null` for complex flows. If multiple transaction UIs need a shared state model, make the shared model a discriminated union instead of adapting UI code around nullable fields.

Sensitive inputs must not enter React state, reducer state, props, persistent storage, or logs. Passphrases, seeds, and raw identity material should be read only at the user action boundary and passed directly to a worker client or service, then cleared as soon as possible. Reducers may store non-sensitive derived status, validation results, task progress, friendly errors, and final non-sensitive results.

### Error handling

Use the narrowest recoverable error surface:

- Field validation errors: inline field error, with `aria-describedby` where relevant.
- User action failures: toast or action feedback with a retry path when possible.
- Transaction failures: transaction error panel or flow state error with a friendly message.
- Async RPC, network, and worker errors: catch in the feature hook/service boundary and convert to friendly flow state or toast.
- Render crashes and unrecoverable UI failures: app-level Error Boundary.

Do not add new `alert()` calls. Existing `alert()` usage should be replaced as the owning flow is refactored.

### Data fetching strategy

Keep the existing service/gateway boundary as the default data access pattern. Components should not bypass domain services or gateways to talk directly to providers, contract clients, worker clients, or low-level cache internals.

Do not introduce TanStack Query, React Query, or SWR as a prerequisite for page cleanup. They may be evaluated later for read-only, idempotent, cacheable data where repeated hand-written loading/error/cache/refetch logic becomes costly.

Good candidates for a future data fetching library:

- Read-only chain queries such as person details, version lists, and tree summaries.
- NFT/story metadata and other remote resources.
- Repeated cross-page queries that need request deduplication, background refresh, polling, pagination, or unified cache invalidation.

Poor candidates:

- Wallet transaction submission, approval, confirmation, success, and error flows.
- ZK proof generation, metadata encryption, file upload/download, or other one-shot task flows.
- WebSocket or event subscriptions with dedicated lifecycle management.
- Optimistic updates that need strong pending/confirmed/reverted semantics before the state model is designed.

If a data fetching library is introduced, query keys must include all result-affecting dimensions such as `chainId`, network, account, contract, person hash, and version. Defaults such as `staleTime`, `gcTime`, `retry`, and `refetchOnWindowFocus` must be configured intentionally to avoid accidental RPC load.

### FamilyTree rendering pipeline

The tree UI is a **pipes-and-filters** pipeline. Every view renders by passing data through the same fixed sequence:

```
ViewModel  →  Layout  →  Viewport  →  Renderer
```

- The pipeline order is fixed (Template Method). Views orchestrate stages; they do not reshuffle responsibilities.
- **Layout** and **Renderer** are pluggable strategies. New views swap only geometry and visuals while sharing ViewModel and Viewport.

| Stage     | Responsibility                                                                                     | Code                                        |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| ViewModel | Single source of truth for `graph`, `nodeUiById`, selection, and user actions (open/copy/endorse). | `domains/tree/ui/useFamilyTreeViewModel.ts` |
| Layout    | Pure geometry: positions, simulation coordinates. No DOM, no modals, no filtering.                 | `domains/tree/ui/layout/`                   |
| Viewport  | Zoom, pan, and minimap; shared across graph-based views.                                           | `domains/tree/ui/GraphViewport.tsx`         |
| Renderer  | Draws nodes/edges and wires view-specific interactions using ViewModel + Layout output.            | `domains/tree/ui/renderers/`                |

**Rules for view code**

- Do not re-assemble node UI fields or re-derive graph structure inside a view — consume ViewModel output.
- Do not put filtering, modal wiring, or data fetching inside Layout.
- Tree view actions should flow through `TreeInteractionProvider`; page shells bridge those actions to person modals and transaction side effects.
- To add a new view, implement a new Layout and/or Renderer and plug it into the pipeline. Do not duplicate ViewModel logic.

### Trusted-source filtering

The tree can hide person versions that aren't vouched for by a root-defined allowlist. It is gated by the `VITE_SHOW_TRUSTED_SOURCE_FILTER_TOGGLE` env var and the in-app **Trusted Sources** switch (Family Tree config panel); the choice persists per browser.

- **Trusted sources** = the `trustedEndorsers` of the _root_ version (`DeepFamilyReader.listTrustedEndorsers`), not of each node.
- **Visibility rule**: a node `(personHash, versionIndex)` is shown only if some trusted account has endorsed exactly that version — i.e. `endorsedVersionIndex(personHash, account) == versionIndex` for some account in the list (`isVersionEndorsedByAny`).
- **Default**: on, so a fresh user already sees the filtered view.
- **Edge cases**:
  - Root version has _no_ trusted endorsers → nothing to filter by, so the full tree is shown and the switch has no visible effect.
  - The root version itself isn't trusted-endorsed → the whole tree renders empty with a "root not endorsed by any recommended source" message.
  - Toggle hidden via env (`VITE_SHOW_TRUSTED_SOURCE_FILTER_TOGGLE=0`) → filtering is forced on and cannot be turned off in the UI.
- **Where it lives**: the allowlist fetch and per-node predicate live in `domains/tree/context/useTreeGraphState.ts`; pruning runs during traversal (`domains/tree/services/treeTraversalOrchestrator.ts`) and is enforced again at projection time (`domains/tree/selectors/buildViewGraph.ts`), so hidden versions never leak into the view even from shared edge caches.

### Workers (crypto + ZK)

Heavy and sensitive computation runs off the main thread:

- Worker entries: `frontend/src/workers/crypto.worker.ts`, `frontend/src/workers/zk.worker.ts`
- Main-thread clients: `frontend/src/shared/workers/cryptoWorkerClient.ts`, `frontend/src/shared/workers/zkWorkerClient.ts`
- Worker-safe logic: `frontend/src/shared/crypto/`, `frontend/src/shared/zk/`

The most common worker crash is accidentally pulling React or DOM code into the worker bundle via a transitive import. If a worker breaks after a refactor, check the new import graph under `shared/crypto` and `shared/zk` first.

### On-chain integration

- Contract ABIs live in `frontend/src/abi/` and are copied from Hardhat build output by `frontend/scripts/sync-abi.mjs`. The script runs automatically in `npm run dev` and `npm run build`.
- Providers and contract instances are constructed in `frontend/src/shared/clients/`.
- RPC URL plus the DeepFamilyReader module entry address come from `VITE_*` env vars; main and token addresses are derived on startup.
- If the frontend breaks after a Solidity interface change, re-run dev/build or `node frontend/scripts/sync-abi.mjs` directly.

## Configuration

The frontend reads configuration from `frontend/.env` and `frontend/.env.local` (local override). See `frontend/.env.example` for the authoritative list.

**Required**

```bash
VITE_RPC_URL=...
VITE_CONTRACT_ADDRESS=... # DeepFamilyReader address
VITE_ROOT_PERSON_HASH=...
VITE_ROOT_VERSION_INDEX=...
```

**Commonly used optional vars**

| Variable                                                         | Purpose                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| `VITE_ROOT_PERSON_HASH_<LANG>`, `VITE_ROOT_VERSION_INDEX_<LANG>` | Per-language root overrides (e.g. `_EN`, `_ZH`)          |
| `VITE_IPFS_GATEWAY_BASE_URLS`                                    | Override IPFS gateway dropdown; must match CSP allowlist |
| `VITE_DF_HARD_NODE_LIMIT`                                        | Cap tree node count for public/low-budget RPCs           |
| `VITE_DF_*_TTL_MS`, `VITE_DF_QUERY_PAGE_LIMIT`                   | Query cache tuning                                       |
| `VITE_USE_INDEXEDDB_CACHE`                                       | Persist tree caches in IndexedDB                         |
| `VITE_SHOW_DEBUG`                                                | Enable debug UI (tree debug panel, etc.)                 |
| `VITE_SHOW_TRUSTED_SOURCE_FILTER_TOGGLE`                         | Show trusted-source filter toggle (on by default; `0` forces filtering on) |
| `VITE_BRAND_BADGE`                                               | Show a build/brand badge in the header                   |

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
npm run frontend:check      # lint + legacy-entrypoints + typecheck + build + vitest
```

`frontend:check` is the gate to run before committing — it matches what CI runs.

### Full local stack (contracts + UI)

```bash
npm run dev:all
```

This starts a Hardhat node, deploys the integrated system, seeds demo data, generates `frontend/.env.local`, and starts the Vite dev server. For step-by-step control, use `dev:node`, `dev:deploy`, `dev:seed`, `frontend:config`, `dev:frontend` individually.

### Inside `frontend/`

Install dependencies once from the repository root before running workspace-local commands.

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

## Metadata CIDs

Metadata CID generation uses CIDv1 with the raw codec and sha2-256 multihash:

- Frontend worker path: `frontend/src/shared/ipfs/cid.ts`
- Node seed path: `lib/versionMetadata.js`
- Fixture check: `node frontend/scripts/verify-cid-methods.mjs`

Do not reintroduce IPFS hashing runtime wrappers for metadata CID generation unless they are audited and necessary. The current `multiformats` + `@noble/hashes` path avoids Node polyfills in the browser and keeps the vulnerable protobuf-based hashing dependency chain out of production installs.

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

| Symptom                         | First thing to check                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| "Network Error" / read failures | `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS` (DeepFamilyReader), and that the node is reachable |
| ABI mismatch / missing methods  | Re-run `npm run frontend:sync:abi` (or restart `frontend:dev`)                              |
| Proof generation fails          | Confirm `/zk/*` artifacts exist and match the deployed verifier version                     |
| Worker crashes on import        | A React/DOM import leaked into `shared/crypto` or `shared/zk` — inspect the import graph    |
| Stale tree/query data           | Clear IndexedDB (`VITE_USE_INDEXEDDB_CACHE=1`) or toggle it off for a run                   |
| Root node not found             | Verify `VITE_ROOT_PERSON_HASH` / `VITE_ROOT_VERSION_INDEX` (or their per-language variants) |
