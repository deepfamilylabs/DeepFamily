# DeepFamily Frontend

React/Vite SPA for exploring family-tree data, generating ZK proofs, submitting protocol transactions, and managing encrypted metadata.

For architecture, domain layout, ABI sync, workers, ZK artifacts, and troubleshooting, see [docs/frontend.md](../docs/frontend.md). For frontend security guidance, see [docs/frontend-security.md](../docs/frontend-security.md).

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

For local development against a Hardhat node:

```bash
npm run config:local
npm run dev:local
```

`config:local` reads deployment data from `../deployments/localhost/` and writes `frontend/.env.local`.

For manual configuration, copy `.env.example` to `.env` and set at minimum:

- `VITE_RPC_URL`
- `VITE_CONTRACT_ADDRESS` (DeepFamilyReader module entry address)
- `VITE_ROOT_PERSON_HASH`
- `VITE_ROOT_VERSION_INDEX`

See [docs/frontend.md](../docs/frontend.md) for the full list of env vars and optional knobs.
