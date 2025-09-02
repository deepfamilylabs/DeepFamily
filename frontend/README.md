# DeepFamily Frontend

A React-based blockchain family tree visualization application with dual data sources, three visualization modes, and multi-language support.

## Tech Stack

- **React 18** + TypeScript + Vite
- **Tailwind CSS** for styling
- **Apollo Client** for GraphQL (subgraph data)
- **Ethers.js v6** for blockchain interactions
- **D3.js** for data visualization
- **i18next** for internationalization (EN/ZH-CN/ZH-TW)

## Architecture

```
src/
├── components/          # UI Components (24 files)
│   ├── FlexibleDAGView.tsx      # Hierarchical DAG layout
│   ├── ForceDAGView.tsx         # D3.js force-directed graph
│   ├── MerkleTreeView.tsx       # Traditional tree view
│   ├── NodeDetailModal.tsx      # Node details & NFT display
│   └── ...                      # Layout, navigation, forms, etc.
├── context/             # React Context (4 providers)
│   ├── ConfigContext.tsx        # Global config management
│   ├── TreeDataContext.tsx      # Data fetching & caching
│   └── ...
├── pages/               # Route pages (5 files)
├── hooks/               # Custom hooks (6 files)
├── types/graph.ts       # TypeScript definitions
├── i18n/                # Internationalization
└── abi/DeepFamily.json  # Smart contract ABI (auto-synced)
```

## Key Features

**Dual Data Sources**:
- **Subgraph Mode**: GraphQL queries via Apollo Client (indexed data, faster queries)
- **Contract Mode**: Direct blockchain calls via Ethers.js (authoritative data)
- Automatic fallback when subgraph unavailable

**Three Visualization Modes**:
- **Tree View**: Traditional hierarchical layout with collapsible nodes
- **DAG View**: Directed acyclic graph for complex family relationships
- **Force View**: D3.js physics simulation with interactive layout

**Multi-language Support**: English, Simplified Chinese, Traditional Chinese

## Quick Start

```bash
# From project root
npm run frontend:dev        # Start development server
npm run frontend:build      # Production build

# From frontend/ directory  
cd frontend/
npm install
npm run dev
```

**ABI Auto-sync**: Contract ABI automatically synced from `../artifacts/` or `../out/` on dev/build

## Configuration

Create `frontend/.env`:
```bash
VITE_SUBGRAPH_URL=http://localhost:8000/subgraphs/name/DeepFamily/subgraph
VITE_RPC_URL=http://127.0.0.1:8545
VITE_CONTRACT_ADDRESS=0x...
VITE_ROOT_PERSON_HASH=0x...
VITE_ROOT_VERSION_INDEX=1
```

**Dev Proxy**: `/api/subgraph` → `localhost:8000` (configured in `vite.config.ts`)

## Pages

- **/** - Homepage with project introduction
- **/visualization** - Main visualization page with 3 view modes
- **/settings** - Configuration management
- **/search** - Multi-dimensional search
- **/story/:tokenId** - Story shard editing

**URL Parameters**: `/visualization?root=0x...&v=1` for direct navigation

## Common Issues

**Subgraph Connection**:
- "Failed to fetch" → Check Graph Node on port 8000 or switch to Contract mode
- Try direct URL in settings: `http://localhost:8000/subgraphs/name/DeepFamily/subgraph`

**Contract Issues**:
- "Network Error" → Verify RPC endpoint and contract address
- Check ABI exists: `src/abi/DeepFamily.json`
- Manually sync ABI: `node scripts/sync-abi.mjs`

**Data Not Found**:
- Verify root hash and version index are correct
- Clear localStorage and reset configuration

## License

Icons from [Lucide React](https://lucide.dev) (ISC License)
