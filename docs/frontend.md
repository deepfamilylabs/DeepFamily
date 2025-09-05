# Frontend Integration

## Tech Stack
- React 18 + Vite + TypeScript
- Tailwind CSS for utility styling
- Ethers v6 for contract calls

## ABI Sync
Script `frontend/scripts/sync-abi.mjs` expected to pull compiled artifact ABIs from Hardhat `artifacts/` into `frontend/src/abi/`.

## Environment Variables
Use `VITE_` prefix for client-exposed vars:
```
VITE_RPC_URL=
VITE_CHAIN_ID=31337
VITE_DEEPFAMILY_ADDRESS=0x...
VITE_DEEPFAMILY_TOKEN_ADDRESS=0x...
```

## Basic Flow
1. List recent persons via name search (calls `listPersonHashesByFullName`).
2. Display versions with endorsement counts.
3. User endorses -> triggers allowance + tx.
4. User mints NFT -> displays core info form.
5. Story editing UI manages chunk sizes & sealing.

## Caching Strategy
- Cache person/version queries locally using React state and context for optimal performance.

## Error Mapping
Map custom Solidity errors to human labels (e.g. `MustEndorseVersionFirst` -> "Endorse before minting").

## Security Notes
- Validate chunk length client-side (<=1000 bytes)
- Hash verify story chunk before sending (expectedHash parameter)
