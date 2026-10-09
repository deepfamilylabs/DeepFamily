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
│   ├── inheritance/   # Multi-asset pools: private/public funding, claims, transfers, exits
│   ├── wallet/        # Wallet + network selection
│   ├── person/        # Person model, queries, UI coordination
│   ├── tree/          # Family-tree context/queries/selectors/services and view UI
│   └── transactions/  # Transaction flows and services
├── shared/      # Cross-domain utilities (no React Router, no page-specific logic)
│   ├── cache/         # Query cache + IndexedDB persistence
│   ├── clients/       # Ethers provider/contract clients
│   ├── config/        # Env-driven runtime config
│   ├── crypto/        # Worker-safe fresh-v1 identity/hash and key-derivation adapters
│   ├── identity/      # UI-safe adapters around protocol-core identity canonicalization
│   ├── metadata/      # Archive preflight, DFM1 unlock, validation, and batch coordination
│   ├── zk/            # Worker-safe ZK helpers (proof I/O, hashing)
│   ├── ipfs/          # IPFS gateways + CID helpers
│   ├── model/         # Shared domain types
│   ├── lib/           # Small framework-agnostic utilities
│   ├── ui/             # Reusable presentational primitives (no domain coupling)
│   └── workers/       # Worker client wrappers (main-thread side)
├── workers/     # Crypto/ZK entries and the stateful shielded asset session Worker
├── abi/         # Synced contract ABI (do not edit by hand)
├── i18n/        # i18next initialization
├── locales/     # Translation resources
├── assets/      # Static assets imported by the app
└── shims/       # Browser/library shims and ambient declarations
```

### Key frontend files

Use the directory tree for ownership boundaries, and these files as first-read entry points when tracing behavior:

- App shell: `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/app/router.tsx`, `frontend/src/app/AppProviders.tsx`, `frontend/src/app/ui/Layout.tsx`
- Runtime config: `frontend/src/shared/config/env.ts`, `frontend/src/shared/config/networks.ts`, `frontend/src/domains/tree/config/familyTreeConfig.ts`
- Wallet connection and local transaction boundary: `frontend/src/domains/wallet/context/WalletContext.tsx`, `frontend/src/domains/wallet/services/walletProvider.ts`
- Domain gateways: `frontend/src/domains/tree/api/treeReadGateway.ts`, `frontend/src/shared/clients/personReadGateway.ts`, `frontend/src/domains/transactions/api/txGateway.ts`, `frontend/src/domains/transactions/api/invalidationCoordinator.ts`
- Tree runtime: `frontend/src/domains/tree/context/TreeViewContext.tsx`, `frontend/src/domains/tree/context/useTreeGraphState.ts`, `frontend/src/domains/tree/services/treeTraversalOrchestrator.ts`
- Worker/ZK/metadata boundaries: `frontend/src/workers/crypto.worker.ts`,
  `frontend/src/workers/zk.worker.ts`, `frontend/src/workers/shieldedAsset.worker.ts`,
  `frontend/src/workers/shieldedAssetSession.ts`, `frontend/src/shared/workers/`,
  `frontend/src/shared/metadata/metadataArchiveService.ts`,
  `frontend/src/shared/metadata/metadataUnlockCoordinator.ts`,
  `packages/protocol-core/identity.js`, `frontend/src/shared/crypto/identityHash.ts`, and
  `frontend/src/shared/zk/proofDescriptors.ts`
- Family inheritance: `frontend/src/pages/InheritancePage.tsx`,
  `frontend/src/domains/inheritance/services/inheritanceChain.ts` (tree replay and legitimacy
  lookup), `frontend/src/domains/inheritance/services/shieldedFundingPreparation.ts` (unified
  funding), `frontend/src/domains/inheritance/services/shieldedClaimPreparation.ts` (unified
  claims), `frontend/src/domains/inheritance/services/shieldedAssetRegistry.ts` (pool discovery),
  `frontend/src/domains/inheritance/services/shieldedWalletRecovery.ts` (historical recovery),
  and `packages/protocol-core/shielded-inheritance.js` (commitments and claim math)
- Boundary tests: `frontend/src/shared/config/env.test.ts`, `frontend/src/pages/TreePage.test.tsx`, `frontend/src/domains/tree/api/treeReadGateway.test.ts`, `frontend/src/domains/transactions/api/txGateway.test.ts`, `frontend/src/pages/InheritancePage.test.tsx`

Update this section when adding or moving stable entry points, route groups, domain gateways, app providers, shared config/client/cache layers, worker boundaries, or boundary-level tests. Do not list ordinary leaf components, local renderers, or one-off helpers here; keep them discoverable through their owning directory.

### Page layout

`app/ui/Layout.tsx` owns the single `PageContainer` for ordinary routes, including Create, Inheritance, Search, Person, Story Editor, Terms and Privacy. This sets their shared maximum width, responsive horizontal padding and top spacing. Bottom spacing includes the fixed status bar and device safe area through `--app-statusbar-h`. Ordinary page components lay out their own sections and gaps without another page container or outer vertical padding. Content-level reading widths, such as the legal text column, remain local.

Home, People, Family Tree and Genealogy Book use the full-width branch. They place containers inside their own sections or manage their canvas and paper surfaces. `PageHead` remains the shared title component.

### Dependency direction

Imports must flow **downward** through the layers:

```
app  →  pages  →  domains  →  shared  →  (workers / abi / i18n / assets)
```

- `shared/` must not import from `domains/`, `pages/`, or `app/`.
- `domains/*` must not import from sibling domains. Cross-domain needs belong in `shared/` or are wired at the `pages/` / `app/` layer.
- Contract result parsers, `NodeData` merge helpers, and shared read gateways used by multiple domains live under `shared/model` or `shared/clients`; import them from there rather than through domain re-exports.
- `pages/` compose domains; they should not contain reusable logic — extract to the relevant domain instead.
- Code imported by a worker (`workers/*.worker.ts`) must stay worker-safe: no React, no DOM, no `window`. Put such code under `shared/crypto/`, `shared/zk/`, or `shared/lib/`.

Cross-runtime ZK protocol definitions live in the private `@deepfamily/proof-core` workspace.
That package must remain browser- and Node-neutral: no filesystem access, `snarkjs`, artifact
paths, or browser URLs. Node artifact candidates belong in `lib/proofDescriptors.js`; browser
artifact URLs belong in `frontend/src/shared/zk/proofDescriptors.ts`.

`frontend:source-rules` keeps frontend source inside its owning layers, keeps `scripts/check-root.mjs`
from printing a passphrase, and keeps Argon2id behind `@deepfamily/protocol-core`.

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

### Local development wallet transactions

All wallet connections, reconnects, account changes and network changes create their ethers provider through `domains/wallet/services/walletProvider.ts`. In Vite development mode on the built-in Hardhat network (31337, `http://127.0.0.1:8545`), an ordinary transaction without an explicit nonce reads the node's fresh pending transaction count immediately before sending. This bypasses stale injected-wallet nonce tracking after instant mining or local seed transactions. Each approval and subsequent contract call reads separately. Sends for the same wallet provider and account are serialized, including across provider recreation, and failures release that queue without automatic rebroadcast. The adapter checks the node and wallet chain IDs and passes the chain ID with the nonce. Explicit nonces and other networks retain wallet-controlled behavior; production builds do not enable this adapter.

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

### Shielded family inheritance

`/inheritance` discovers canonical pools through `ShieldedPoolFactory` and uses `ShieldedErc20Pool` or `ShieldedNativePool`. The asset toolbar remains available while locked and during root-only recovery. Importing an asset or changing pools locks the secret session. Metadata failures preserve verified raw integer amounts with unknown precision; they do not imply zero balance or an 18-decimal token.

The panel has wallet-key controls, recovery controls and one action selector for deposit, funding, claim, private transfer and withdrawal. Every funding entry follows `shield → donor VALUE → fund → child BUDGET → claim → child VALUE`; funding consumes the donor's recovered VALUE, rather than directly spending an ordinary-wallet token balance.

Initial funding offers three entries:

- Public identity-bound funding fixes `keyMode = 0` and needs only the registered child's person hash. It publishes identity and budget terms, without asking for the child's credentials, independent root or receive code.
- Private convenient funding fixes `keyMode = 0` and verifies an identity-derived receive code. Only this entry offers payer-side code generation from the child's complete identity credentials. Anyone possessing those credentials can reconstruct the corresponding spending and viewing keys.
- Private independent funding fixes `keyMode = 1` and verifies the recipient's identity/ownership receive code. The payer confirms the recipient, mode and full fingerprint; knowing the identity credentials alone cannot reconstruct the independent root.

The funding parent unlocks their own identity, selects a parent person-version index, and chooses from eligible direct children or their recovered original funding templates. A new policy uses a per-period amount, period duration and funded-period count. An existing policy fixes its original terms. Private refills preserve the original owner, mode and viewing key; public refills preserve the original identity-bound schema. A policy draft's public handle survives preparatory consolidation, so a later funding step does not silently create a different policy. The user can explicitly discard that draft.

One asset Worker may hold an identity-derived slot and at most one independent funds slot. Identity unlock reads the original complete identity fields and passphrase directly at the action boundary; identity has no backup file, import/export action or backup status. Independent-root creation is explicit and defaults to 32 random bytes. Wallet-signature derivation is an explicit alternative within independent funds creation, not another funding entry. Its exact message, normalization, KDF and source-independent funds fingerprint are specified in [Shielded asset keys and funds vault v1](shielded-asset-key-spec.md).

New independent funds start behind a recovery gate. Random creation requires exporting the actual encrypted root file, acknowledging external storage, destroying the original Worker and independently importing/decrypting the file with fingerprint verification. Signature creation can instead pass a fresh real re-sign against the original fingerprint. File import does not require the source wallet or identity. A signature candidate restored without an original fingerprint remains unverified until valid owned history confirms it; an empty scan is not success. Failures never generate a replacement root, switch sources or fall back to another key mode.

Root-only recovery can spend matching VALUE. Independent BUDGET records remain pending identity confirmation until the original identity is supplied for claim eligibility. Public budgets and identity-derived VALUE remain recoverable with identity credentials alone. Recovery summaries group by actual owner and pool; changing the selected slot locks the session. VALUE does not carry a permanent historical key-mode/source label.

The page can scan the selected pool or discover every pool in the configured factory. Factory enumeration verifies `PoolCreated` history against `poolCount`. Pool recovery verifies immutable wiring, public trees, action history and `nullifierCount` at a fixed block/hash anchor. Bad pools have independent failure boundaries and unknown balances; healthy pools retain their results. Historical spent and zero-value donor change notes preserve authenticated original Fund templates, private viewing keys, policy openings and allocation keys. Claim remainders cannot replace those templates. Later pools of a recorded factory are discoverable from an old root file; a new chain/factory scope requires separately updating and verifying that file's coverage.

Funding, transfer and withdrawal expose positive VALUE notes as an allowed candidate range. Selection does not require consuming every candidate. The Worker chooses an adequate subset under one actual owner and pool, using the smallest supported capacity. Transfers use 2/8-input circuits and withdrawals use 1/8-input circuits. If more than eight inputs are necessary, the preview displays the complete consolidation/payment sequence and its actual inputs and outputs. It validates integer conservation and output capacity before the first step. Claim options expose compatible budget groups and up to twelve due, unpaid period indices; the selected identity and original budget authorization still control claim eligibility.

Each confirmation executes only the displayed first step. After generating and locally verifying its proof, the flow estimates gas and pauses for a separate fee review. The transaction explicitly carries the reviewed fee caps, nonce and expected chain ID. Later steps need receipt confirmation, a new scan, a new preview and a new quote; their actual fees are not known in advance. There is no automatic next-step submission, automatic retry or consumption outside the candidate range.

The ordinary wallet `G` supplies deposits and gas; it does not determine either slot's owner. Signature source `S` is needed only for signature-root creation/restoration and may differ from `G`. Changing `G` invalidates prepared work without rederiving funds. ERC-20 approval locks the secret session first, checks the public receipt and allowance, and requires unlocking again before deposit preparation. Public wallets, their funding links, deposit/exit amounts, timing and unusual amounts can associate private activity; the panel explains these limits without claiming complete anonymity.

A receive code needs the unlocked identity and selected slot, with independent funds past their recovery gate. Its v2 proof binds identity, owner, viewing key, key mode and suite/derivation versions. The code fingerprint excludes randomized proof bytes. The main-thread verification display and the asset Worker's payment preparation both verify the code; preparation also checks the confirmed fingerprint and intended child/mode before any consolidation. A valid proof does not authenticate which independent root the recipient intended, so fingerprint confirmation remains necessary. The receive code should be shared privately.

Secrets, roots, note openings and witnesses remain in `ShieldedAssetSession`; React receives public handles, display amounts and final proofs. Scope includes chain, factory, family, RPC, lineage and selected pool. Locking, slot/pool/chain changes, disconnect, navigation, hidden/pagehide, idle expiry and explicit cancellation terminate secret processing and invalidate stale responses. Busy computation suspends the idle timer; waiting for fee approval allows idle locking. During an external-wallet jump, hiding destroys the secret session but may retain the public signature request ID. A response is accepted only after a visible return with the same current request, expected wallet and protocol context; cancellation, navigation, timeout or wallet changes invalidate it.

Before requesting a wallet transaction, the flow records its public nonce, block and expected outputs. Unknown results block another submission. Public transaction context and receipt tracking live in the in-memory transaction center, survive secret locking and application navigation, and can be reconstructed when returning to the same pool. Receipt checks can locate unknown hashes by replaying unfiltered public output events and checking the original nonce at the same block. Explicit wallet rejection releases the pending guard; ambiguous RPC failures do not. Clearing secrets cannot revoke a wallet request already issued, and returning to the page never automatically resubmits it.

See [the implementation record](shielded-budget-implementation.md), [contract interfaces](contracts.md#shielded-inheritance-contracts) and [circuit specification](zk-proofs.md#shielded-inheritance-circuits) for validation evidence and release limitations.

### Workers (crypto, ZK and asset sessions)

Heavy and sensitive computation runs off the main thread:

- Worker entries: `frontend/src/workers/crypto.worker.ts`, `frontend/src/workers/zk.worker.ts`, `frontend/src/workers/shieldedAsset.worker.ts`
- Main-thread clients: `frontend/src/shared/workers/cryptoWorkerClient.ts`, `frontend/src/shared/workers/zkWorkerClient.ts`, `frontend/src/shared/workers/shieldedAssetWorkerClient.ts`
- Worker-safe logic: `frontend/src/shared/crypto/`, `frontend/src/shared/zk/`, and
  `packages/protocol-core/`

The general crypto and ZK Workers remain stateless between requests. Identity/file Argon2id,
DFM1 encryption/decryption and general proof generation execute through these boundaries.
The crypto client serializes all jobs, including calls from transaction flows. Foreground
jobs take priority over, and may preempt, an automatic empty-passphrase job. A request's cancellation
only stops that request; unrelated queued calls remain available. Do not add a password-fingerprint cache or retain passphrases, salts, derived
secrets, keys, content digests, or witnesses in these general Workers' state.

The asset Worker deliberately owns an ephemeral secret session through
`ShieldedAssetSession`: optional identity material, one independent root, derived keys,
per-slot/pool snapshots and prepared witnesses. It serializes its mutation queue and runs
asset recovery, code generation/verification and proving inside that boundary. React uses
`ShieldedAssetSessionState` and public wallet/action DTOs only. Identity credentials, raw
signatures and vault credentials cross directly from transient inputs to the Worker, then
are cleared; the exported encrypted file and a briefly displayed generated unlock credential
are explicit export results. Do not persist private openings or return them as display data.
Lock/cancel/timeout terminates the entire asset Worker, rejects its pending calls and ignores
late responses. See [the key/vault specification](shielded-asset-key-spec.md) and
`frontend/src/workers/shieldedAssetSession.test.ts` for the recovery gates and DTO boundaries.

The most common worker crash is accidentally pulling React or DOM code into the worker bundle via a
transitive import. If a worker breaks after a refactor, check the new import graph under
`shared/crypto`, `shared/zk`, and `packages/protocol-core` first.

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
VITE_READER_ADDRESS=...   # DeepFamilyReader entry address
VITE_ROOT_PERSON_HASH=...
VITE_ROOT_VERSION_INDEX=...
```

**Commonly used optional vars**

| Variable                                                             | Purpose                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `VITE_ROOT_PERSON_HASH_<LANG>`, `VITE_ROOT_VERSION_INDEX_<LANG>`     | Per-language root overrides (e.g. `_EN`, `_ZH`)                            |
| `VITE_DF_HARD_NODE_LIMIT`                                            | Cap tree node count for public/low-budget RPCs                             |
| `VITE_DF_*_TTL_MS`, `VITE_DF_QUERY_PAGE_LIMIT`                       | Query cache tuning                                                         |
| `VITE_USE_INDEXEDDB_CACHE`                                           | Persist tree caches in IndexedDB                                           |
| `VITE_SHOW_DEBUG`                                                    | Enable debug UI (tree debug panel, etc.)                                   |
| `VITE_SHOW_TRUSTED_SOURCE_FILTER_TOGGLE`                             | Show trusted-source filter toggle (on by default; `0` forces filtering on) |
| `VITE_SHIELDED_POOL_FACTORY_ADDRESS`, `VITE_SHIELDED_POOL_FACTORY_ADDRESS_<chainId>` | Canonical multi-asset pool factory for `/inheritance`                       |

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
npm run frontend:check      # lint + source-rules + typecheck + build + vitest
```

`frontend:check` is the gate to run before committing — it matches what CI runs.

### Full local stack (contracts + UI)

```bash
npm run dev:all
```

This starts a Hardhat node, checks all 10 circuit artifacts (2 identity and 8 shielded), deploys the complete system with one token and lineage index, seeds demo data, generates `frontend/.env.local`, and starts the Vite dev server. For step-by-step control, use `dev:node`, `dev:deploy`, `dev:fund`, `dev:seed`, `frontend:config`, and `dev:frontend` in that order.

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
- Test general Worker-safe logic under `shared/crypto` / `shared/zk` directly, and mock clients at the component boundary. Test the stateful asset session through `ShieldedAssetSession` with real key/vault derivation and mocked chain/proof boundaries; test client termination and late-result rejection separately.

## ZK Artifacts

Proof workflows load public artifacts at runtime:

- Inputs: `.wasm`, `.zkey`, `.vkey.json`
- Local location: `frontend/public/zk/` (served as `/zk/…` by the dev server); only `.vkey.json` is committed, `npm run zk:assets:fetch` installs the rest
- Builds: `.wasm`/`.zkey` come from `<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>` and are checked against the manifest digests embedded at build time (`shared/zk/zkAssets.ts`); `.vkey.json` stays same-origin
- Circuit catalog: 2 identity circuits plus 8 shielded circuits (`receiveCode`, `shield`, `fund`, `claim`, `privateTransfer`, `unshield`, `privateTransfer8`, `unshield8`), 10 in total
- Generation and verification details: see [zk-proofs.md](zk-proofs.md)

If proof generation or verification fails in dev, first confirm the expected files exist in `public/zk/` (run `npm run zk:assets:fetch`). In a build, a digest mismatch or HTTP 404 means the files for the current manifests were not published with `npm run zk:assets:publish`.

## Encrypted Version Metadata

Person-version metadata uses an on-chain Archive ref. Add Version canonicalizes one JSON snapshot
containing the current person, parent snapshots, `tag`, and private `biography`; computes
the deterministic keyed `versionCommitment`; gzip-compresses and AES-GCM-encrypts the content into
a randomized DFM1 envelope; then submits that envelope in the same transaction as the relation
proof. `tag` and `biography` never appear as plaintext contract fields.

The canonical plaintext has top-level keys in this fixed order:

```json
{
  "schema": "deepfamily/person-version@1.0",
  "person": { "fullName": "…", "personHash": "0x…" },
  "parents": { "father": null, "mother": null },
  "tag": "v1",
  "biography": "private biography"
}
```

The abbreviated identity objects above also contain the frozen gender/birth fields; non-null
parents additionally contain their referenced `versionIndex`. The envelope's
`contentCiphertext` is not readable JSON bytes: it is the AES-GCM ciphertext of
`gzip(canonicalJsonBytes)`. Fresh file salt, DEK, and IV values normally make two envelopes for the
same plaintext different. `versionCommitment`, by contrast, is derived from the pre-gzip canonical
JSON digest and remains deterministic for the same identity secret and plaintext.

Shared protocol primitives live in the browser/Node-neutral `@deepfamily/protocol-core` workspace.
The frontend service boundary is `frontend/src/shared/metadata/`.

The read path is deliberately staged:

1. `DeepFamilyReader` supplies the version and `MetadataRef(pointer,payloadHash,payloadLength)`.
2. Before asking for a passphrase or invoking a KDF, the client reads `eth_getCode(pointer)`, checks
   exact `STOP || envelope` length/encoding, hashes the envelope, validates the DFM1 common prefix,
   and rejects unsupported formats.
3. Format 1 then receives strict selector/header validation, Argon2id/AES-GCM processing, strict
   gzip and canonical JSON decoding, person/parent context checks, person-hash derivation, and
   `versionCommitment` recomputation.
4. Only the complete validated DTO may merge into `NodeData`.

Format-1 AES-GCM AAD includes the chain ID, DeepFamily proxy, person hash, both parent hash/version
references, `versionCommitment`, self identity suite, and the format selectors. Moving a valid
envelope to a different context therefore fails authentication for a holder of the correct key;
this does not create a contract-level global replay check.

The unlock dialog opened from a person detail selects that version and lists that person first;
selecting the whole person adds their other versions in the current family view. Page-level entry
points allow explicit selection by person or version within the same view. The passphrase field
stays in the dialog footer and unlocks only once the selection has passed preflight.
Selection starts public Archive/header preflight automatically; one supplied passphrase is then tried
sequentially against that selection. Per-version results remain visible while the user selects the
next person. Each successful item is cached immediately; a failed item is not written.
Unlocking existing metadata requires no passphrase-risk confirmation. Empty and whitespace-only
inputs may be submitted directly, with whitespace preserved for protocol decoding.

Both manual candidates and background attempts use the current root hash/version's projected family
graph, honoring strict/union child rules, version deduplication, and trusted-source filters. The book
also includes its displayed spouse versions. Other cached families and filtered-out versions are
excluded; scrolling or collapsing a branch does not change this scope. Counts use the same scope.
Switching roots cancels the old work, and removing a version from the view cancels its pending work
and discards late results. Newly loaded descendants join the queue without restarting eligible work.

After local cache hydration, locked versions in this view are also tried once with an empty passphrase
in the background, with the inspected version and root first. The attempt key includes the scope and
public envelope/context anchors. Authentication failure quietly leaves a version locked; read and
validation errors remain distinguishable. Opening the unlock dialog without a selection keeps
background attempts running. Selecting versions in the open dialog pauses background work for
manual unlock; hidden tabs also pause it, and foreground crypto calls take priority. Clearing either
metadata or all tree caches cancels and pauses automatic attempts for that scope for the remainder of this page session, including
navigation/remounts. Cancellation/preemption may retry an incomplete attempt.

"Remember unlocked data on this device" is selected by default. With this scope-specific preference
enabled, subsequent unlocks persist as plaintext in IndexedDB (`metadataUnlockPersistence: "device"`),
including decrypted display fields, `tag`, and `biography`. An explicit opt-out is remembered and
keeps subsequent results in memory for the session (`"session"`). All snapshot write paths strip
session-only private fields, including when another
node is saved. Newly created confirmed versions use the same preference when no explicit mode is
provided. After the submission is verified against Reader/Archive, the confirmed-version cache
can complete missing public anchors on a tree placeholder. Defined anchors must still match; ref,
React state and durable writes use the same reconciliation rule. Deferred state updates safely
reject concurrent anchor changes instead of throwing during rendering. Clear revisions and storage
scope changes invalidate queued plaintext writes. Older device caches remain readable. Cache scope includes chain ID, DeepFamily proxy,
and protocol/cache generation. Refreshing the same scope can display remembered plaintext without
another KDF. Users can clear local unlocked metadata, but this is best-effort and
does not protect browser-profile backups or defend against same-origin XSS. Passphrases, identity
salts, derived secrets, KEK/DEK, witnesses, and `contentDigest` are never part of `NodeData` or the
cache.

Private `biography` is distinct from the NFT supplement `story` and public on-chain DFS1 Story
data. Any UI action that copies private text into an NFT story must require explicit confirmation
that the destination is public. Attachment URIs and NFT token URIs are supported.

## Security

- Passphrases and cryptographic working material must not be placed in React state/props or
  persistent storage. Pass them directly to a Worker/service and clear them as soon as possible.
- Validated unlocked `NodeData` is plaintext in memory. Persist new unlocks only while remembering
  them on this device is enabled (the default); filter session-only nodes at every durable write.
- CSP is strict in preview/production: `frontend/src/shared/config/contentSecurityPolicy.ts` builds
  it and always enforces it, and CI fails on any violation `csp:scan` sees. The dev server only
  reports violations.
- Security commands (from repo root):

  ```bash
  npm run security:audit       # prod dependency audit (root + frontend)
  npm run security:xss-scan    # TypeScript AST XSS sink check; symlinks fail closed
  ```

- From `frontend/`: `npm run csp:scan` builds into `.csp-scan/dist` with proving files on the
  preview origin, serves that build under the production headers, visits every route, and runs the crypto and ZK workers on the
  golden vector (identity derivation, envelope unlock, a receive-code proof). CI fails on any
  violation or broken worker flow. It runs the Google Chrome installed on the machine and reads
  its options from the command line only, never from `.env` files, for example
  `CSP_SCAN_SKIP_BUILD=1 npm run csp:scan`:

  | Variable                                              | Effect                                                                          |
  | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
  | `CSP_SCAN_FAIL_ON_REPORT=1`                           | Exit non-zero on any violation (CI sets it)                                     |
  | `CSP_SCAN_SKIP_BUILD=1`                               | Reuse `.csp-scan/dist`; enough when only the CSP configuration changed          |
  | `CSP_SCAN_WORKERS=0`                                  | Skip the worker flows, for example without local proving files                  |
  | `CSP_SCAN_EXECUTABLE_PATH`, `CSP_SCAN_CHROME_CHANNEL` | Another browser binary, or a Playwright channel such as `chromium` or `msedge` |
  | `CSP_SCAN_HEADLESS=0`                                 | Show the browser window                                                         |
  | `CSP_SCAN_MODE=dev`                                   | Scan the dev server, whose policy only reports                                  |
  | `CSP_SCAN_HOST`, `CSP_SCAN_PORT`, `CSP_SCAN_BASE_URL` | Where the scanned server listens                                                |
  | `CSP_SCAN_STYLE_ATTR_PROBE=1`                         | Set inline styles on purpose to show `style-src-attr` blocks them (debugging)   |

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
3. If it controls an origin the app fetches from (an RPC or asset host), update the CSP configuration and re-run `csp:scan`.

## Troubleshooting

| Symptom                         | First thing to check                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| "Network Error" / read failures | `VITE_RPC_URL`, `VITE_READER_ADDRESS` (DeepFamilyReader), and that the node is reachable    |
| ABI mismatch / missing methods  | Re-run `npm run frontend:sync:abi` (or restart `frontend:dev`)                              |
| Proof generation fails          | Confirm `/zk/*` artifacts exist and match the deployed verifier version                     |
| Worker crashes on import        | A React/DOM import leaked into `shared/crypto` or `shared/zk` — inspect the import graph    |
| Stale tree/query data           | Clear IndexedDB (`VITE_USE_INDEXEDDB_CACHE=1`) or toggle it off for a run                   |
| Root node not found             | Verify `VITE_ROOT_PERSON_HASH` / `VITE_ROOT_VERSION_INDEX` (or their per-language variants) |

## Archive V1 reads and writes

The frontend reads named BlobRef and StoryRecordRef fields and verifies complete segmented bytecode via `protocol-core` before decoding. Story content uses exact canonical DFS1 bytes; unknown schemas remain verified raw records. Metadata and Story submissions require successful full-call gas estimation and a 20% integer-ceiling buffer within network limits. The confirmation preview exposes bytes, segment count, gas and fees. See the [protocol release manifest](../protocol-release-manifest.json) for the frozen protocol rules.

Story records carry an optional user-entered title, encoded as a string in every DFS1 payload.
The composer presents title, classification, content and attachment in that order. Titles are
included in payload hashes and verified on readback. Directories, record lists and search use the
title when it contains non-whitespace text, otherwise the localized classification label.
The initial mint biography supports its own `storyTitle` and falls back to the localized biography
label when untitled. Display fallbacks do not modify the archived title or the record index.

Story edit links and the editor use fresh `ownerOf` and Archive seal-state reads from the configured
network. Only the connected NFT owner on that network can append or seal. Direct editor URLs stay
read-only for other visitors, pending lookups and read failures. Access refreshes on NFT transfers,
sealing and window focus; submissions recheck it before signing. Pending previews are bound to the
original token, contract, network and wallet, and token/config changes reset the editor's draft.
