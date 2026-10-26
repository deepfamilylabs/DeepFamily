# DeepFamily Frontend

React/Vite SPA for exploring family-tree data, generating ZK proofs, submitting protocol transactions, and managing encrypted metadata.

For a complete local stack, run `npm run dev:all` from the repository root with the manifest-pinned
proving files available. The development bundle has been regenerated and passes `zk:check --
--artifacts-only` for all 13 relations. Local deployment compiles missing outputs and tries to fetch
pinned files; it never regenerates keys. `npm run frontend:config` writes local contract addresses
and deployment blocks from the integrated deployment records.

The current graph has 13 relations: two identity/disclosure, three asset boundaries, and eight
receiving/qualification/budget relations. `npm run zk:build` compiles them; `npm run zk:check`
rebuilds and verifies their pinned artifacts and real proofs. Checks reuse existing keys.
`npm run zk:setup` explicitly compiles all 13 relations, reuses matching identity/disclosure keys,
and regenerates the eight receiving plus three boundary development key sets. Rotation updates
their manifests, vkeys and Solidity verifiers; local contracts and frontend pins must then be
updated together. `npm run zk:check -- --artifacts-only` verifies the complete 13-relation bundle
without changing keys. Setup uses this single entry point and does not approve a production
ceremony. Public deployment and `release:preflight` remain blocked because reviewed ceremony
evidence covering all 13 relations is unavailable.

After local deployment, `npm run zk:frontend -- <chainId> <registry>` synchronizes the eight
receiving and three boundary artifact sets, including boundary aliases, into `public/zk/protocol/`
and writes trusted pins to `src/proof-artifacts.local.json`.
Identity/disclosure files remain under `public/zk/`. Browser verification-key JSON is committed;
WASM/zkey downloads must match the published hashes. Local dev uses same-origin files. Remote
builds load WASM/zkey from `<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>.br`, while vkeys remain
local. The host must send `Content-Encoding: br`; the browser checks the decoded bytes against
the trusted hash. Publish those exact files with `npm run zk:assets:publish` before relying on
remote builds. Builds using the host omit local WASM/zkey files from `dist`.

The inheritance page has one wallet and one `dfreceive` code format. The receiving Worker owns
money secrets, code indices and qualification/controller openings. Users create or restore an
authenticated encrypted wallet backup, then share codes with independently derived owner/viewing
keys. A family wallet derives its canonical subject secret inside the Worker. Its Family
qualifications panel creates public requests, imports recipient-bound encrypted controller
approvals and registers authenticated qualifications. Controllers publish SourceFact/SourceTrust
approvals, retain their revocation openings in encrypted backups and can revoke them or atomically
withdraw the underlying relationship. Reissuing from the same controller family preserves the
anonymous family commitment so a current qualification can claim an existing budget.

Before publication, the page awaits a committed encrypted recovery copy in IndexedDB and exports
an updated backup. No identity secret, source opening or family salt is stored there in plaintext.
The latest local copy still requires its backup password. Confirmed Source/Q operations can be
recovered from their exact canonical public leaves after a page closes, with or without a transaction
hash. Whole-wallet restore replaces the removed qualification-backup merge entry point.

`shield` creates VALUE in the selected native/ERC20 pool. `depositBudget` spends the payer's VALUE
using a recipient code, a matching family capability and the public budget rule. The first deposit
creates a code/policy record; additional deposits add independent contributions and preserve the
original clock. Both recheck current qualification. Claims prove a current qualification and a
matured period, and share the subject/policy/period allowance across codes. Ordinary transfers and
letters use the same code without requiring a family capability.

`VITE_SHIELDED_STATE_READ_MODE` is a build-time choice for qualification Q and Source membership
paths: `rebuild` (default) replays public events locally and validates the resulting paths;
`chain` requests selected paths from the contracts and reveals those indices to the RPC.
Both use anchored block reads and validate roots. Missing, blank or unknown values select
`rebuild`; there is no runtime switch or automatic fallback. Funds-note recovery and paths
continue to use local ledger replay in both modes. This setting does not change the contract's
direct latest-role checks.

Budget deposits, appends and claims check three current Source role indices directly. There are no
revocation scans, preparation proofs or preparation transactions. Codes using the same role
qualification can be linked through the shared indices; owner and viewing keys remain independently
derived. A later revocation rejects an already-prepared business proof at execution.

With `npm run dev:all` running, `npm run acceptance -- --browser` (from the repository root) exercises
three isolated browser wallets, actual identity/Source/Q proofs and the complete qualification,
offline-budget, revocation and reissue flow. This runner accepts localhost development chains only;
its synthetic private inputs and encrypted backups remain beneath `tmp/`.

For architecture, domain layout, ABI sync, workers, ZK artifacts, and troubleshooting, see [docs/frontend.md](../docs/frontend.md). For frontend security guidance, see [docs/frontend-security.md](../docs/frontend-security.md).

## Quick Start

```bash
# From repo root
npm run frontend:dev
npm run frontend:build
npm run frontend:check

# After installing once from the repository root, commands may also run from frontend/
npm run dev
npm run build
npm run test
```

Run `npm install` from the repository root. `npm run dev` and `npm run build` automatically sync
the contract ABI into `src/abi/DeepFamily.json` before starting Vite. The frontend consumes the
private `@deepfamily/protocol-core` workspace through the root lockfile.

## Cloudflare Pages

Configure the Pages project as a monorepo build:

- Root directory: repository root
- Build command: `npm run pages:build`
- Build output directory: `frontend/dist`
- Environment variables (Production and Preview, plain text): `SKIP_DEPENDENCY_INSTALL=1`, and
  `VITE_ZK_ASSET_BASE_URL` set to the proving-file host. The build fails without the second.
- Build watch paths (include): `frontend/*`, `packages/protocol-core/*`,
  `circuits/*`, `functions/*`, `lib/zkPublicAssets.js`, `lib/cspReport.js`, `package.json`,
  `package-lock.json`, `.node-version`. Each directory needs its trailing `*`, and a lone `*`
  would match every file in the repository.

`pages:build` performs a clean install for the `deepfamily-frontend` workspace and its dependencies,
including `@deepfamily/protocol-core`, so Cloudflare does not install the Hardhat toolchain.
`.node-version` pins the build to the CI runtime; the build image's default Node.js is older than
the repository's minimum.
The build writes `dist/_headers` with the same security headers `vite preview` sends. Pages
reads Functions only from the project's root directory, so the CSP report endpoint lives at the
repository root in `functions/__csp-report.ts`.
Cloudflare Pages currently limits each site asset to [25 MiB](https://developers.cloudflare.com/pages/platform/limits/#file-size),
and some raw shielded zkeys exceed it. Proving WASM/zkey files are therefore served as Brotli
objects from the R2 bucket behind `VITE_ZK_ASSET_BASE_URL`, whose CORS policy must allow the site
origins. Published objects retain their original MIME type and carry `Content-Encoding: br`.
The code names no host: each build reads it from its environment
(Pages settings, CI, or `.env.local` locally) and fails without it. The build embeds the file
digests from the circuit manifests and adds the host to `connect-src`; an empty value loads
same-origin `/zk/`.

## Configuration

For local development against a Hardhat node:

```bash
npm run dev:local
```

`config:local` reads deployment data from `../deployments/localhost/` and writes `frontend/.env.local`.

For manual configuration, copy `.env.example` to `.env` and set at minimum:

- `VITE_RPC_URL`
- `VITE_READER_ADDRESS` (DeepFamilyReader entry address; the app derives DeepFamily and the token from it)
- `VITE_ROOT_PERSON_HASH`
- `VITE_ROOT_VERSION_INDEX`

See [docs/frontend.md](../docs/frontend.md) for the full list of env vars and optional knobs.
