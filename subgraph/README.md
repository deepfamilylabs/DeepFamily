# DeepFamily Subgraph

This subgraph indexes persons, versions, and parent-child relationships based on the `PersonVersionAdded` event from the `DeepFamily` contract, enabling efficient frontend construction of family trees (DAG).

## Directory Structure

- `schema.graphql`: Entity models
- `subgraph.yaml`: Data source and event mapping configuration
- `src/mapping.ts`: Event handling logic
- `abis/DeepFamily.json`: Contract ABI (requires copying from `artifacts/`)

## Setup

1. Update the deployed contract address in `subgraph.yaml` under `source.address`.
2. Copy the ABI:
   ```bash
   mkdir -p subgraph/abis
   cp artifacts/contracts/DeepFamily.sol/DeepFamily.json subgraph/abis/DeepFamily.json
   ```

## Local Development (Optional)

Requires starting local Graph Node and IPFS first.

```bash
cd subgraph
npm i
npm run codegen
npm run build
npm run create-local
npm run deploy-local
```

## Hosted Service/Studio Deployment

Modify the `deploy-local` script for your target environment and deploy according to The Graph's official documentation.


