# DeepFamily Frontend

React/Vite SPA for exploring family-tree data, generating ZK proofs, submitting protocol transactions, and managing encrypted metadata.

For local shielded inheritance development, run `npm run dev:all` from the repository root.
The first run builds missing circuit outputs and downloads the manifest-pinned public keys from R2.
It generates development proving keys only if they are still missing or stale. Key generation can
take several minutes.
To regenerate them manually, run
`npm run zk:development:setup`.
The local deploy command binds the shielded pool to the same DeepFamily token
and lineage index. `npm run frontend:config` writes their addresses and deployment blocks to
`.env.local` from the integrated deployment records.
Both setup commands synchronize browser WASM/zkey/vkey files to `public/zk/shielded/` and generated
verifiers to `contracts/`, following the identity/disclosure flow. Only the `.vkey.json` files are
committed; publish new WASM/zkey files with `npm run zk:assets:publish` from the repository root.
The dev server serves the local copies at `/zk/`. Builds load WASM/zkey from
`<VITE_ZK_ASSET_BASE_URL>/<sha256>/<file name>` and reject any file whose SHA-256 differs from the
circuit manifests. `zk:artifacts:check` validates all 9 artifact sets; `zk:check` and
`zk:ceremony:verify` perform the cryptographic checks.
The checked-in keys are development-only. `release:preflight` requires production keys and release
evidence before publication.

The inheritance funding dialog offers private and public funding. Private funding spends the
parent's private balance and needs the child's verified receive code. Public funding spends
ordinary-wallet DEEP, needs only the selected child's identity hash, and shows a token approval
step when required. Its arrangement details are public. Both budget types use the same pool;
claims create private VALUE balances after identity, current family eligibility, maturity and
allowance checks. Additional public funding preserves the arrangement's original rate and clock.

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
private `@deepfamily/proof-core` workspace through the root lockfile.

## Cloudflare Pages

Configure the Pages project as a monorepo build:

- Root directory: repository root
- Build command: `npm run pages:build`
- Build output directory: `frontend/dist`
- Environment variables (Production and Preview, plain text): `SKIP_DEPENDENCY_INSTALL=1`, and
  `VITE_ZK_ASSET_BASE_URL` set to the proving-file host. The build fails without the second.
- Build watch paths (include): `frontend/*`, `packages/proof-core/*`, `packages/protocol-core/*`,
  `circuits/*`, `functions/*`, `lib/zkPublicAssets.js`, `lib/cspReport.js`, `package.json`,
  `package-lock.json`, `.node-version`. Each directory needs its trailing `*`, and a lone `*`
  would match every file in the repository.

`pages:build` performs a clean filtered workspace install for only `deepfamily-frontend` and
`@deepfamily/proof-core`, so Cloudflare does not install the Hardhat toolchain.
`.node-version` pins the build to the CI runtime; the build image's default Node.js is older than
the repository's minimum.
The build writes `dist/_headers` with the same security headers `vite preview` sends. Pages
reads Functions only from the project's root directory, so the CSP report endpoint lives at the
repository root in `functions/__csp-report.ts`.
Cloudflare Pages currently limits each site asset to [25 MiB](https://developers.cloudflare.com/pages/platform/limits/#file-size),
and the shielded claim and fund zkeys exceed it. Proving WASM/zkey files are therefore served from
the R2 bucket behind `VITE_ZK_ASSET_BASE_URL`, whose CORS policy must allow the site origins. The code names no host: each build reads it from its environment
(Pages settings, CI, or `.env.local` locally) and fails without it. The build embeds the file
digests from the circuit manifests and adds the host to `connect-src`; an empty value loads
same-origin `/zk/`.

## Configuration

For local development against a Hardhat node:

```bash
npm run config:local
npm run dev:local
```

`config:local` reads deployment data from `../deployments/localhost/` and writes `frontend/.env.local`.

For manual configuration, copy `.env.example` to `.env` and set at minimum:

- `VITE_RPC_URL`
- `VITE_READER_ADDRESS` (DeepFamilyReader entry address; the app derives DeepFamily and the token from it)
- `VITE_ROOT_PERSON_HASH`
- `VITE_ROOT_VERSION_INDEX`

See [docs/frontend.md](../docs/frontend.md) for the full list of env vars and optional knobs.
