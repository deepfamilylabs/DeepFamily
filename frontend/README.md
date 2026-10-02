# DeepFamily Frontend

React/Vite SPA for exploring family-tree data, generating ZK proofs, submitting protocol transactions, and managing encrypted metadata.

For local shielded inheritance development, run `npm run dev:all` from the repository root.
The first run builds missing circuit outputs and reuses the checked-in public keys. It generates
development proving keys only if they are missing or stale. Key generation can take several minutes.
To regenerate them manually, run
`npm run zk:development:setup`.
The local deploy command binds the shielded pool to the same DeepFamily token
and lineage index. `npm run frontend:config` writes their addresses and deployment blocks to
`.env.local` from the integrated deployment records.
Both setup commands synchronize browser WASM/zkey/vkey files to `public/zk/shielded/` and generated
verifiers to `contracts/`, following the identity/disclosure flow. Vite serves the files directly
at `/zk/shielded/`, including built previews. `zk:artifacts:check` validates all 9 artifact sets;
`zk:check` and `zk:ceremony:verify` perform the cryptographic checks.
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
- Environment variable: `SKIP_DEPENDENCY_INSTALL=1`
- Build watch paths: `frontend/*`, `packages/proof-core/*`, `package.json`, `package-lock.json`

`pages:build` performs a clean filtered workspace install for only `deepfamily-frontend` and
`@deepfamily/proof-core`, so Cloudflare does not install the Hardhat toolchain.
Cloudflare Pages currently limits each site asset to [25 MiB](https://developers.cloudflare.com/pages/platform/limits/#file-size).
The production shielded zkeys have not been generated or measured yet. If any exceed this limit,
the current Pages deployment path cannot serve them and needs a separate asset hosting plan.

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
