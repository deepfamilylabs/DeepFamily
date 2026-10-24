# DeepFamily Frontend

React/Vite SPA for exploring family-tree data, generating ZK proofs, submitting protocol transactions, and managing encrypted metadata.

For local shielded inheritance development, run `npm run dev:all` from the repository root.
The first run builds missing circuit outputs and downloads the manifest-pinned proving files from R2.
It reuses the pinned keys and stops if they are stale or cannot be obtained. Final key generation
is an explicit repository-root operation: `npm run zk:setup` from a clean, reviewed commit on a
controlled machine outside CI. The resulting artifact set is shared by local development, CI and
release.
The local deploy command binds the shielded pool to the same DeepFamily token
and lineage index. `npm run frontend:config` writes their addresses and deployment blocks to
`.env.local` from the integrated deployment records.
The setup command records the single-operator ceremony evidence and synchronizes browser
WASM/zkey/vkey files to `public/zk/shielded/` and generated verifiers to `contracts/`, following
the identity/disclosure flow. Only the `.vkey.json` files are
committed; publish new WASM/zkey files with `npm run zk:assets:publish` from the repository root.
The dev server serves the local copies at `/zk/`. Builds load WASM/zkey from
`<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>.br`. The host sends `Content-Encoding: br`, so
the browser decodes the download before checking its original SHA-256 against the circuit
manifests. `npm run zk:assets:publish` automatically prepares local Brotli files before uploading.
Builds using this host omit local WASM/zkey files and their compressed
copies from `dist`; local dev and builds with an empty host keep using raw files at `/zk/`.
`npm run zk:check` rebuilds all 16 circuits and checks artifact consistency,
proofs and available ceremony evidence using the same pinned artifact set.
Publish the `.br` objects once before deploying this frontend, even when the circuit keys have
not changed; existing raw objects use different URLs.
The current checked-in keys remain development-only and unattested until the explicit final setup
and review. `release:preflight` requires the final keys, ceremony evidence and other release
evidence before publication. Daily builds, downloads and checks reuse keys without generating them.

The budget dialog offers **Public budget**, **Private (identity credentials)**, and
**Private (independent key)**. All three spend donor VALUE from the selected pool; the ordinary wallet
supplies public `shield` deposits and transaction gas. Public budget needs only the child's
registered person hash and publishes the recipient and budget terms. Private modes need the
child's verified receive code of the matching type. Identity credentials recreate their derived
funds; the independent-key mode uses a separate root that those credentials cannot recreate.
Users explicitly select **Deposit to** for the key controlling new VALUE notes and **Use balance from**
for transfers, withdrawals and donor budget funding. Both identity credentials and the independent key
use the same HPKE encryption; the choice determines spending authority and recovery requirements.
The selected key must be available, and a missing or changed key never silently selects another
owner. An independent deposit or payment choice is bound to its key fingerprint: restoring the
same key preserves the choice, while a different verified key must be explicitly selected again.
Payment planning stays within the selected owner, pool and allowed candidate notes,
including same-owner consolidation when needed. Receive-code type, budget entry and claim filters
separately select recipient authorization.

Claims create private VALUE after identity, current family eligibility, maturity and allowance
checks. Independent-key budgets also require the original independent key. Additional funding preserves the
arrangement's original rate and clock.

The separate **Independent key** wallet entry manages recovery, creation and backup. Receive-code
settings only select credentials and generate a code. **Unlock independent key** accepts 24 English
recovery words or a Shielded Key. New independent keys default
to a random root, with wallet-signature derivation as an alternative. Both methods require saving
and re-importing a backup after clearing the in-memory independent key. For signature-derived keys, the
original signing wallet produces a recovery candidate until matching pool history confirms it. See
[independent keys and recovery](../docs/shielded-independent-key-spec.md) for the exact rules.

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
