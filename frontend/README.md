# DeepFamily Frontend

React/Vite SPA for exploring family-tree data, generating ZK proofs, submitting protocol transactions, and managing encrypted metadata.

For the full architecture and integration guide, see [docs/frontend.md](../docs/frontend.md). For frontend security guidance, see [docs/frontend-security.md](../docs/frontend-security.md).

## Quick Start

```bash
# From repo root
npm run frontend:dev
npm run frontend:build
npm run frontend:check

# Or from frontend/
cd frontend/
npm install
npm run dev
npm run build
npm run test
```

`npm run dev` and `npm run build` automatically sync the contract ABI into `src/abi/DeepFamily.json` before starting Vite.

## Configuration

### Local Development

```bash
npm run config:local
npm run dev:local
```

`config:local` reads deployment data from `../deployments/localhost/` and writes `frontend/.env.local`.

### Manual Configuration

```bash
cp .env.example .env
```

Required values for a manually configured environment:

- `VITE_RPC_URL`
- `VITE_CONTRACT_ADDRESS`
- `VITE_ROOT_PERSON_HASH`
- `VITE_ROOT_VERSION_INDEX`

## Source Layout

```text
src/
├── app/                 # App shell context and layout UI
├── domains/             # Config, person, tree, transactions, wallet
├── pages/               # Route-level composition
├── shared/              # Cache, clients, config, model, crypto, ZK, IPFS, common UI shells
├── workers/             # Crypto and ZK worker entrypoints
├── assets/              # Static assets imported by the app
├── i18n/                # i18next initialization
├── locales/             # i18n resources
├── shims/               # Browser/library shims and ambient declarations
└── abi/                 # Synced contract ABI
```

## Checks

```bash
npm run lint
npm run test
npx tsc --noEmit -p tsconfig.json
```

From the repo root, use `npm run frontend:check` to run lint, architecture guards, typecheck, and Vitest together.

## Common Issues

**Contract / RPC issues**

- Verify `VITE_RPC_URL` and `VITE_CONTRACT_ADDRESS`.
- Confirm `src/abi/DeepFamily.json` exists and matches the deployed contract.
- Re-sync manually with `node scripts/sync-abi.mjs` if contract interfaces changed.

**ZK proof issues**

- Confirm files exist under `public/zk/`.
- Make sure the browser can fetch `/zk/person_commitment_final.zkey` and the matching `.vkey.json`.

**Data not found**

- Verify `VITE_ROOT_PERSON_HASH` and `VITE_ROOT_VERSION_INDEX`.
- Clear local storage if stale tree/query cache data is suspected.
