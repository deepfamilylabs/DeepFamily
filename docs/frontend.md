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
- Runtime config: `frontend/src/shared/config/env.ts`, `frontend/src/shared/config/networks.ts`, `frontend/src/domains/tree/config/familyTreeConfig.ts`
- Wallet connection and local transaction boundary: `frontend/src/domains/wallet/context/WalletContext.tsx`, `frontend/src/domains/wallet/services/walletProvider.ts`
- Domain gateways: `frontend/src/domains/tree/api/treeReadGateway.ts`, `frontend/src/shared/clients/personReadGateway.ts`, `frontend/src/domains/transactions/api/txGateway.ts`, `frontend/src/domains/transactions/api/invalidationCoordinator.ts`
- Tree runtime: `frontend/src/domains/tree/context/TreeViewContext.tsx`, `frontend/src/domains/tree/context/useTreeGraphState.ts`, `frontend/src/domains/tree/services/treeTraversalOrchestrator.ts`
- Worker/ZK/metadata boundaries: `frontend/src/workers/crypto.worker.ts`,
  `frontend/src/workers/zk.worker.ts`, `frontend/src/shared/workers/`,
  `frontend/src/shared/metadata/metadataArchiveService.ts`,
  `frontend/src/shared/metadata/metadataUnlockCoordinator.ts`,
  `packages/protocol-core/identity.js`, `frontend/src/shared/crypto/identityHash.ts`, and
  `frontend/src/shared/zk/proofDescriptors.ts`
- Family inheritance: `frontend/src/pages/InheritancePage.tsx`,
  `frontend/src/domains/inheritance/services/inheritanceChain.ts` (tree replay and legitimacy
  lookup), `frontend/src/domains/inheritance/services/shieldedFundingPreparation.ts` (unified
  funding), `frontend/src/domains/inheritance/services/shieldedClaimPreparation.ts` (unified
  claims),
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

`/inheritance` discovers canonical asset pools through `ShieldedPoolFactory`, verifies their immutable configuration, and uses `ShieldedErc20Pool` or `ShieldedNativePool`. The page derives spend and viewing keys from the existing identity passphrase on the device, scans unfiltered public note and lineage events, and creates proofs in the local ZK worker. Both budget visibility choices follow `shield → donor VALUE → fund → child BUDGET → claim → child VALUE`; funding always spends a recovered donor VALUE. Private funding verifies the child's receive code and encrypts an owner-bound budget. Public funding resolves the selected child's `personHash` through the existing identity index and publishes an identity-bound budget's own recovery fields, without a receive code or payment-key registration. Initial and additional funding use the same `fund`; both budget formats use the same `claim` and period-nullifier sequence.

Funding requires the father's or mother's own unlocked identity. The recipient list contains only that identity’s confirmed direct children, validated against the selected parent person version. Both funding modes select a child from this list; there is no manual person-hash input. The selected child's full person hash (`personHash`) remains visible for confirmation. Private funding additionally verifies that the receive code belongs to the selected child; public funding uses the selected child's identity without a receive code. The page does not offer another-family funding or a switch to the child's other parent. Existing arrangements and recovered funding templates must also belong to the currently unlocked parent. Reusing an arrangement scopes recipients to its fixed parent person version and retains its recovered funded-child templates for additional funding.

Arrangements are created automatically during first funding, without a separate setup transaction or a POLICY_NOTE. Their recovery backup is encrypted in the parent’s change VALUE note on chain; the page restores it by replaying and decrypting historical logs, including spent change notes. The arrangement selector appears only when previous arrangements have been recovered. It distinguishes a new schedule from additional funding under the original rule and start time.

New arrangements require an explicit parent person version selection before listing eligible children or allowing submission, even when only one version exists. Unlocking establishes the parent's identity and does not choose a version. The selector displays version indices and starts with no selection; it never defaults to the latest version. Children are filtered by the selected version's trusted endorsers, and changing versions clears the previous child selection, receive code and recipient confirmation. If the selected version or child becomes ineligible, the page requires explicit reselection and never substitutes another version or parent. The confirmation summary identifies the parent and version. Reusing an arrangement fixes its parent, version and original eligibility start time.

The selected index is stored as `rootVersionIndex` in the arrangement and budget terms; it does not change `personHash` or the identity secret. The child's endorsed version has a separate index. Claims read the parent version from the budget and check current endorsements and trusted sources for that version. Binding a version does not freeze its trusted-endorser list: subsequent changes can affect claim eligibility.

The unlocked family identity and the connected ordinary wallet have separate roles. The identity derives the spending and viewing keys for recovered VALUE and fixes the budget parent. Any connected wallet can provide DEEP for `shield` and pay transaction gas; its address does not establish the parent-child relationship or determine the person hash. These are client funding-flow restrictions. The current `fund` circuit independently proves donor VALUE control and the recipient’s direct-child relationship to the policy root; it does not require the donor’s identity commitment to equal that root.

The unlocked header is a compact bar with the identity's name, Available balance, Budget balance, Refresh and Exit. It also shows the unlocked identity's full person hash with a copy button; the hash wraps on narrow screens and follows the identity session rather than the transaction wallet. Task navigation uses small underlined tabs. Private assets contains wallet deposits, private transfers, withdrawals and sharing the identity's receive code. Child budgets opens the funding form directly; Claim budgets opens the claim form directly, including its empty state when there are no budgets. Only Private assets has an action switcher, labeled Deposit, Transfer, Withdraw and Receive code; the operation headings identify the ordinary-wallet direction or private transfer.

The page-level identity session belongs to `chainId + factoryAddress + DeepFamily address`, while notes, balances, arrangements, input selections and pending proof results belong to `chainId + poolAddress`. Selecting another asset within the same protocol context keeps the identity unlocked, clears the previous pool's form and selections, and automatically restores the selected pool from its public events. The identity passphrase need not be entered again. Exit, leaving the page, disconnecting the wallet, switching to the wrong wallet chain, changing the configured chain/factory/family context, or ten idle minutes clears the session. An active proof, recovery or submission suspends the idle lock and gets a fresh idle window on completion; it does not bypass the other lock boundaries. Late results from the previous identity or pool cannot update the new panel.

Each deposit checks the connected ordinary wallet's current DEEP balance before preparing the note, approving tokens or generating a proof. Insufficient funds show the available and required DEEP amounts; recovered private VALUE cannot cover an ordinary-wallet deposit. If the balance changes after that check, an on-chain `ERC20InsufficientBalance` revert still produces a localized token-balance message rather than raw RPC data or a gas-fee warning.

Own-identity unlock and generating a recipient's receive code use the same identity input component and layout. Both identity forms disable live identity-hash computation and derive only when the user starts the action. They omit the generic optional-passphrase help, character count and strength details; required-passphrase and invalid-character checks still apply. The recipient wrapper reads only the identity fields and raw passphrase, then immediately clears the passphrase input before generation begins; it does not open a recipient session. Repeated funding tutorials are omitted, while the amount preview, parent person version and concise privacy and irreversible-funding notices remain visible. The header labels total remaining BUDGET as Budget balance, which includes funds not yet due; the claim view separately reports currently claimable amounts. Claims show checkboxes for the earliest up to 12 funded, due, unpaid periods, selected by default and labeled from Period 1 with an amount and due date. The summary updates to the selected total; clearing all disables submission. Budgets with the same enrollment are grouped, preserving the two-input claim path, and a budget selector appears only when several arrangements are available. There is no optional-settings foldout or manual period-index input. Refresh preserves explicit selections, and submission rechecks the displayed budget commitments, periods and current child eligibility; stale selections require choosing again. Input and receipt failures use localized messages, preserving the distinction between a completed transaction with a failed refresh and an action that did not complete.

Initial funding separates the period allowance from the period duration. Duration defaults to 30 days, offers 1/7/14/21/30/90/180/365-day shortcuts, and accepts a custom positive integer within uint32 without a one-year business cap. Closing or clearing the unlocked identity resets the new-arrangement duration draft to 30 days before another identity is unlocked. Additional funding displays the recovered arrangement's fixed duration and cannot change it. The protocol requires an explicit periodDays in policies, budget payloads and claim preparation; recovery never substitutes a missing duration. Dates and due-period selection use the budget's own duration, and budgets with different durations cannot share a claim. One day is 86400 seconds, not a calendar schedule; the UI uses days rather than ambiguous month/year labels. Timestamp formatting checks the JavaScript Date range with bigint before converting, so an otherwise valid distant schedule never renders Invalid Date.

Funding selects VALUE automatically and does not expose a note picker. The page shows missing or insufficient private balance before submission, including the shortfall when the requested amount is known, and offers a link to the Private assets task, where the selected asset can be moved from the ordinary wallet via `shield`. Wallet deposits are available only in Private assets; the child-funding task contains only `fund`. Ordinary-wallet asset balances is not counted as spendable VALUE. Funding can first consolidate free VALUE fragments when automatic selection needs a larger note. Transfers display positive-balance checkboxes for one or two inputs; withdrawals use a native radio group for exactly one input, with a selected-balance summary. Neither chooses a balance by default, even when only one is available. Selecting another withdrawal radio replaces the prior choice directly. An unavailable withdrawal selection remains visible as a disabled selected radio; the user can choose another balance or clear it. Submission is disabled until a balance is selected and also checks the requirement in the transaction handler. Selected notes must cover the amount and are checked against freshly recovered unspent notes; a missing or spent selection stays visible as unavailable and requires explicit reselection. Transfers and exits never substitute or automatically consolidate other funds. Zero-value notes remain in historical recovery for encrypted backups but are excluded from the balance picker. Claims show period choices directly, without an optional-settings foldout; empty budgets show only the appropriate empty state.

Claims automatically choose up to two compatible budgets, including a mixed-format pair, and consolidate the remainder. Any owner-bound input forces an owner-bound remainder; a pure identity-budget claim retains the identity format. Both claim outputs are encrypted to the child, and the transaction does not publish the input format or identity.

A recipient creates a receive code from their unlocked identity. The ZK worker derives the payment keys and proves that the identity chose them (see [the receive-code circuit](zk-proofs.md#shielded-inheritance-circuits)). Creating a code needs no wallet or transaction, and each generated code differs but all are valid. Senders paste the code for private budget funding and private transfers.

The ZK worker verifies each pasted code before any key is used. It checks the proof against the verification key compiled into the bundle (`__SHIELDED_RECEIVE_CODE_VKEY__`, defined in `vite.config.ts`) and runs a BN254 G2 subgroup check. A code that fails its bech32m checksum is reported as a copying mistake. A code whose contents or proof fail is reported as possibly altered and must not be paid. Only a verified code becomes a `VerifiedShieldedRecipient`, the type required for private funding and transfers; public budget funding uses the selected identity instead.

For private initial funding, the page checks that the code belongs to the selected child. Private additional funding checks the identity against the existing enrollment and preserves the owner of an owner-bound template. A private transfer shows the recipient's name when the locally loaded tree knows the code's person hash. Without a name, the sender must confirm that they checked the identity number with the recipient before submitting. The entered code is cleared after a successful action. Anyone holding a receive code can link the identity to its payment keys, so the code should be shared privately and not published.

A sender can also generate a code for someone else from that person's complete identity details and identity passphrase. The ZK worker derives the keys and proof and returns only the code. The derived secret never reaches the page, and the passphrase input is cleared once the code is generated. Complete identity details and the identity passphrase grant much broader access than a receive code: anyone who knows them can derive the recipient's spend and viewing keys and access their private funds and encrypted content. The page recommends asking the recipient for their receive code and warns before this option.

A receive code does not establish that an identity exists on chain or qualifies as a child. Initial funding checks the current lineage endorsement and trusted source, and additional funding must match an existing budget enrollment.

The factory address is a chain-specific configuration value. A compact asset toolbar selects DEEP, native currency, or an ERC-20 imported by address. Add asset reveals the address input and Import action; a successful import closes it, while an invalid import retains the input. The selector leaves space for its arrow and can shrink on narrow screens. An absent ERC-20 pool can be created permissionlessly for gas only. The selected asset's `symbol` and `decimals` format amounts; every positive amount and per-period rate must fit `uint128` in raw token units. This limit is checked on input and before proof preparation, without displaying the large raw maximum above the page. Native deposits skip approval and reserve deposit value plus gas. The page checks the canonical pool/token/lineage/verifier/version wiring and the connected wallet’s chain. Creating a receive code sends nothing on chain. For private actions, the sender pays native gas and must acknowledge using an independent fee wallet. The page warns about reusing public wallets, funding a private action wallet directly from a known wallet, immediate exits, and unusual amounts. Fee wallets are visible, so a wallet associated with an NFT, or funded from one, can link private actions to a person. Timing and a small user set can also weaken anonymity. Public deposits and exits expose amounts and senders or recipients. A local cache can be cleared and reconstructed from all public events, without a private-note or child-specific RPC filter.

`shieldedWalletRecovery.ts` and the snapshot readers verify roots against the chain while rebuilding the public trees. Recovery recognizes the canonical public kind-5 envelope, validates its commitment and matches the local identity; other outputs are opened with HPKE. Malformed public packets or encrypted notes are skipped without blocking later valid notes. Donor change memos separately encrypt the private rule opening and, on initial funding, the allocation key, allowing recovery of policies and historical funding templates. These private fields never enter the public recovery packet.

Initial funding and claiming check current lineage snapshots before preparing witnesses; additional funding verifies an existing enrollment without restarting its clock. They use a 32-level note shard proof and, where needed, 64-level lineage proofs. A reorg or concurrent write can require a fresh scan and proof. Public funding permanently reveals its chosen parent, child, amount and terms; it does not force subsequent claims to publish their inputs. Previously disclosed facts remain public, and wallet reuse, timing or small candidate sets can still link activity.

### Workers (crypto + ZK)

Heavy and sensitive computation runs off the main thread:

- Worker entries: `frontend/src/workers/crypto.worker.ts`, `frontend/src/workers/zk.worker.ts`
- Main-thread clients: `frontend/src/shared/workers/cryptoWorkerClient.ts`, `frontend/src/shared/workers/zkWorkerClient.ts`
- Worker-safe logic: `frontend/src/shared/crypto/`, `frontend/src/shared/zk/`, and
  `packages/protocol-core/`

Identity/file Argon2id, DFM1 encryption/decryption, and proof generation execute through these
boundaries. The crypto client serializes all jobs, including calls from transaction flows. Foreground
jobs take priority over, and may preempt, an automatic empty-passphrase job. A request's cancellation
only stops that request; unrelated queued calls remain available. Do not add a password-fingerprint cache or retain passphrases, salts, derived
secrets, keys, content digests, or witnesses in Worker state.

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

This starts a Hardhat node, checks all 8 circuit artifacts, deploys the complete system with one token and lineage index, seeds demo data, generates `frontend/.env.local`, and starts the Vite dev server. For step-by-step control, use `dev:node`, `dev:deploy`, `dev:fund`, `dev:seed`, `frontend:config`, and `dev:frontend` in that order.

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

Proof workflows load public artifacts at runtime:

- Inputs: `.wasm`, `.zkey`, `.vkey.json`
- Local location: `frontend/public/zk/` (served as `/zk/…` by the dev server); only `.vkey.json` is committed, `npm run zk:assets:fetch` installs the rest
- Builds: `.wasm`/`.zkey` come from `<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>` and are checked against the manifest digests embedded at build time (`shared/zk/zkAssets.ts`); `.vkey.json` stays same-origin
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
