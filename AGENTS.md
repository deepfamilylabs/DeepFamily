# Repository Guidelines

## Project Structure & Module Organization
This repository is a Hardhat workspace with a React/Vite dashboard.

- Smart contracts: `contracts/`
- Deploy scripts (hardhat-deploy): `deploy/`
- Dev utilities and scripts: `scripts/`, `tasks/`
- Contract tests (Mocha/Chai): `test/`
- Circom circuits + fixtures: `circuits/`, `circuits/test/proof/`
- Generated circuit outputs: `artifacts/circuits/` (avoid committing bulky outputs unless explicitly needed)
- Frontend app: `frontend/`
- Docs/research notes: `docs/`

## Build, Test, and Development Commands
- `npm run setup` — install root + `frontend/` dependencies.
- `npm run build` — compile Solidity (`hardhat compile`).
- `npm test` — run Hardhat tests.
- `npm run test:gas` — run tests with gas reporter.
- `npm run test:coverage` — Solidity coverage (`hardhat coverage`).
- `npm run dev:all` — start local node, deploy, seed demo data, and run the UI.
- ZK workflow: `npm run zk:fetch` (download `circom`), `npm run zk:build`, `npm run zk:setup`, `npm run zk:check`, `npm run zk:verifier`.

## Coding Style & Naming Conventions
- Solidity: 2-space indentation; format with `npm run format`; lint with `npm run lint` / `npm run lint:fix`.
- Naming: custom errors/events/structs in PascalCase (e.g. `DuplicateVersion`), functions/vars in camelCase, constants in `ALL_CAPS`.
- JS/TS: prefer async/await; keep filenames descriptive (e.g. `contract-person-version.test.js`).
- Frontend: components use PascalCase filenames in `frontend/src/` and export a single default component per file.

## Testing Guidelines
- Framework: Hardhat + Mocha/Chai; use event assertions where applicable.
- Naming: keep suites scoped (e.g. `describe('Contract:DeepFamily', ...)`).
- Run a single test file: `npx hardhat test test/contract-person-version.test.js`.
- Aim for >80% coverage for new functionality; update `circuits/test/proof/` fixtures when ZK inputs/outputs change.

## Commit & Pull Request Guidelines
- Commits: Conventional Commits (e.g. `feat: ...`, `fix: ...`, `chore(frontend): ...`), imperative mood.
- PRs: summarize behavior changes, list validation commands run, note any regenerated circuit/verifier artifacts, and include UI screenshots when frontend changes.

## Security & Configuration Tips
- Never commit `.env`, private keys, or `.zkey` materials; use `.env.example`/`frontend/.env.example` as templates.
- Prefer local Hardhat accounts for testing and seeded data; avoid reusing production keys.
