# Repository Guidelines

## Project Structure & Modules
- `contracts/`: Solidity 0.8.20 source.
- `deploy/` + `tasks/`: Hardhat-deploy scripts and custom tasks.
- `scripts/`: Utilities (e.g., `seed-demo.js`).
- `test/`: Mocha/Chai tests via Hardhat.
- `frontend/`: React 18 + TypeScript + Vite app (Tailwind).
- `docs/`: Architecture, API, tokenomics, etc.

## Build, Test, and Dev
- Install: `npm install`
- Compile contracts: `npm run build`
- Test contracts: `npm test` (gas: `npm run test:gas`, coverage: `npm run test:coverage`)
- Local chain: `npm run dev:node`
- Deploy+seed (local): `npm run dev:deploy && npm run dev:seed`
- Frontend dev: `npm run frontend:dev`
- All-in-one dev: `npm run dev:all` (node + deploy + seed + web)
- Lint/format: `npm run lint` and `npm run format`

## Coding Style & Naming
- Formatting: Prettier (2 spaces, width 100, trailing commas). Solidity uses `prettier-plugin-solidity`.
- Linting: Solhint (see `.solhint.json`); fix with `npm run lint:fix`.
- Solidity: explicit visibility; target `^0.8.20`.
- Frontend: TypeScript; components/pages `PascalCase.tsx`, hooks `useX.ts`, functions/vars `camelCase`.

## Testing Guidelines
- Framework: Hardhat + Mocha + Chai.
- Location: `test/*.test.js` (keep tests close to features; group by contract behavior).
- Coverage: `npm run test:coverage` (aim for meaningful coverage on public/external paths).
- Gas: `npm run test:gas` for gas insights during PRs.

## Commit & Pull Requests
- Commits: Conventional Commits style (`feat:`, `fix:`, `refactor:`). Keep changes focused.
- PRs must: describe changes, link issues, include screenshots for UI, list test steps. Ensure CI passes (lint, build, tests).
- ABI/front-end sync: contract changes regenerate artifacts on build; frontend auto-syncs ABI via `frontend/scripts/sync-abi.mjs` (run frontend scripts after compiling).

## Security & Configuration
- Never commit secrets. Copy `.env.example` to `.env` and set keys: `PRIVATE_KEY`, `INFURA_API_KEY`, scanners, etc.
- Use a throwaway account for testnets; avoid mainnet keys in local testing.
- Local settings: `UNLIMITED_SIZE=true` and `EVM_VERSION` can be tuned via `.env`.

## Quick Local Example
```bash
npm install
npm run dev:node &
npm run dev:deploy && npm run dev:seed
npm run frontend:dev
```
