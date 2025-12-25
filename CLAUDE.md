# CLAUDE.md

## Project Overview

DeepFamily is a blockchain-based decentralized global digital family tree protocol leveraging zero-knowledge proofs, NFTs, ERC20 token economics, and community governance to create a collaborative, verifiable, and perpetual family history recording system.

## Two-Layer Value System

The system implements a two-layer value model that balances privacy protection with community validation:

### Layer 1: Privacy Protection (Hash Storage)
- **Zero-Knowledge Proofs**: Uses Groth16 proofs to add family tree members privately
- **Salted Passphrase Unlinkability**: Uses cryptographic hash combinations with unique passphrases to prevent identity inference
- **Anti-Pollution Protection**: Unique passphrases prevent malicious users from creating fake versions pointing to real people
- **Dual Tree Models**: Supports both public collaborative trees (shared passphrase) and private protected trees (unique passphrase)
- **Family Tree Networks**: Build relationships through personHash/fatherHash/motherHash connections
- **Token Incentives**: Receive DEEP tokens only when both parent relationships exist (complete family data)

### Layer 2: Value Confirmation (NFT Assets)
- **Public Disclosure**: Community-endorsed versions can be minted as NFTs, revealing full personal information
- **Story Sharding**: Detailed biographical data stored in up to 100×1KB on-chain chunks
- **Community Validation**: Must endorse a version before minting its NFT
- **Value Recognition**: NFTs represent community-validated family tree data

### Key Advantages
- **Progressive Privacy Model**: Private submission → Community endorsement → Optional public disclosure
- **Smart Incentives**: Tokens reward complete family data, NFTs reward quality information
- **Risk Management**: Private layer allows exploration, public layer ensures quality
- **Value Discovery**: Natural evolution from private data to community-validated assets

## Smart Contract Architecture

### DeepFamily.sol - Main Protocol
- Multi-version person data with ZK proof validation
- Community endorsement system with automatic fee distribution
- NFT minting with on-chain biographical storage
- Story sharding system for detailed life narratives
- Mining rewards for complete family connections
- Comprehensive security with 50+ custom errors

### DeepFamilyToken.sol - DEEP Token
- ERC20 with progressive halving mining mechanism
- 100 billion supply cap with 10 halving cycles
- Expanding cycle lengths: 1→10→100→1K→10K→100K→1M→10M→100M→Fixed 100M
- Authorized minting only by DeepFamily contract

### ZK Verifier Contracts
- **PersonHashVerifier**: Validates family relationships for private submissions
- **NamePoseidonVerifier**: Proves name ownership for NFT minting
- Both use Groth16 proofs with circom circuits

## Key Features

### Zero-Knowledge Privacy System
- **Private Family Tree Construction**: Add members without revealing personal information
- **Salted Passphrase Unlinkability**: Prevents identity inference and pollution attacks through unique passphrases
- **Dual Tree Architecture**: Public collaborative trees vs. private protected trees for relationship correctness
- **Selective Disclosure**: Users choose when to reveal information through NFT minting
- **Dual-Hash Design**: Poseidon commitments + keccak256 wrapping for security
- **Limb-Based Verification**: Efficient on-chain ZK proof validation

### Economic Incentives
- **Smart Mining**: Rewards mint when parent hash commitments are submitted (encourages structured family data without exposing plaintext)
- **Community Endorsement**: Pay current mining reward to endorse trusted versions
- **Fee Distribution**: Majority flows to NFT holders or contributors, with a small protocol share (default 5%, max 20%) for sustainability
- **Progressive Halving**: Advanced tokenomics with 10 halving cycles

### Data Management
- **Multi-Version System**: Each person supports multiple data versions with duplicate prevention
- **Family Relationships**: Complete parent-child relationship tracking with version references
- **Story Sharding**: Biographical data in sequentially indexed, hash-verified chunks
- **Immutable Sealing**: Stories can be permanently locked for historical preservation

### Scalability & Security
- **Paginated Queries**: Gas-optimized queries with 100-record limits
- **Reentrancy Protection**: Comprehensive security against attacks
- **Access Control**: Role-based permissions with explicit error handling
- **ETH Rejection**: Contract rejects direct ETH transfers

## Technology Stack

### Smart Contracts
- **Solidity**: ^0.8.20 with OpenZeppelin v5 security primitives
- **Zero-Knowledge**: Groth16 proofs, circom v2.1.6, Poseidon hashing, snarkjs v0.7.4+
- **Testing**: Hardhat v2.19+, comprehensive test coverage, gas optimization
- **Deployment**: Multi-network support with hardhat-deploy, 12+ network configurations
- **Security**: Reentrancy guards, custom error types (50+), access controls

### Frontend
- **Core**: React 18 with TypeScript for type safety
- **Build**: Vite v5 for fast development and optimized builds
- **Styling**: TailwindCSS v3.4+ with @tailwindcss/forms for responsive design
- **Visualization**: D3.js v7.9 for interactive family tree displays (FlexibleDAGView, ForceDAGView, MerkleTreeView)
- **Web3**: Ethers v6.11+ for blockchain interaction
- **Routing**: React Router DOM v7.8+ for SPA navigation
- **Forms**: React Hook Form v7.62+ with Zod v4 validation, @hookform/resolvers
- **i18n**: i18next v25.4+, react-i18next v15.7+ with browser language detection
- **UI Components**: Lucide React v0.540+ for icons
- **Virtualization**: React Window v1.8+ for performance optimization
- **Utils**: Axios v1.11+ for HTTP, scrypt-js v3 for key derivation

### Zero-Knowledge Infrastructure
- **Circuits**: person_hash_zk.circom (family relationships), name_poseidon_zk.circom (name binding)
- **Libraries**: circomlib v2.0.5, keccak256-circom
- **Hashing**: Poseidon-lite v0.3, @noble/hashes v1.8
- **Proof Generation**: snarkjs with Powers of Tau ceremony support
- **Verifiers**: Auto-generated Solidity verifiers (PersonHashVerifier.sol, NamePoseidonVerifier.sol)

### Development Tools
- **Testing**: Hardhat toolbox, Chai matchers, Mocha with 20min timeout for ZK operations
- **Linting**: Solhint v4, Prettier v3 with solidity plugin, lint-staged v15, husky v9 pre-commit hooks
- **Coverage**: Solidity coverage v0.8.1
- **Contract Analysis**: hardhat-contract-sizer v2.10
- **Gas Reporting**: hardhat-gas-reporter v1.0.8 with CoinMarketCap integration
- **Type Safety**: TypeChain v8.3 with ethers-v6 target
- **Utilities**: concurrently, cross-env, wait-on for multi-process development

## Project Structure

```
DeepFamily/
├── contracts/              # Smart Contracts
│   ├── DeepFamily.sol             # Main family tree protocol (ERC721Enumerable + ZK)
│   ├── DeepFamilyToken.sol        # DEEP ERC20 token with halving mechanism
│   ├── PersonHashVerifier.sol     # ZK verifier for family relationships
│   └── NamePoseidonVerifier.sol   # ZK verifier for name binding
├── circuits/               # ZK Circuit Development
│   ├── person_hash_zk.circom      # Family relationship proofs (Poseidon + keccak256)
│   ├── name_poseidon_zk.circom    # Name binding proofs for NFT minting
│   ├── sync-zk-assets.js          # ZK asset synchronization utility
│   └── test/                      # Circuit test data and inputs
├── frontend/               # React dApp
│   ├── src/
│   │   ├── components/            # React components
│   │   │   ├── DagView.tsx              # DAG-based family tree view
│   │   │   ├── ForceGraphView.tsx       # Force-directed graph view
│   │   │   ├── TreeLayoutView.tsx       # Hierarchical tree layout view
│   │   │   ├── TreeListView.tsx         # List-based tree view
│   │   │   ├── GraphViewport.tsx        # Shared viewport container for graph views
│   │   │   ├── ViewContainer.tsx        # View container wrapper
│   │   │   ├── ViewModeSwitch.tsx       # View mode toggle component
│   │   │   ├── ZoomControls.tsx         # Zoom control panel
│   │   │   ├── FamilyTreeConfigForm.tsx # Tree configuration form
│   │   │   ├── NodeDetailModal.tsx      # Person details modal
│   │   │   ├── NodeCard.tsx             # Tree node display card
│   │   │   ├── HashBadge.tsx            # Hash display badge component
│   │   │   ├── PersonHashCalculator.tsx # ZK hash calculator
│   │   │   ├── PersonStoryCard.tsx      # Story display component
│   │   │   ├── StoryChunksModal.tsx     # Story chunks editor
│   │   │   ├── SecureKeyDerivation.tsx  # Passphrase derivation UI
│   │   │   ├── SiteHeader.tsx           # Application header
│   │   │   ├── Layout.tsx               # Main app layout wrapper
│   │   │   ├── PageContainer.tsx        # Page container component
│   │   │   ├── BottomNav.tsx            # Mobile bottom navigation
│   │   │   ├── FloatingActionButton.tsx # Floating action button
│   │   │   ├── WalletConnectButton.tsx  # Web3 wallet connection
│   │   │   ├── NetworkSelectionLayer.tsx# Network selection overlay
│   │   │   ├── WalletSelectionLayer.tsx # Wallet selection overlay
│   │   │   ├── LanguageSwitch.tsx       # i18n language selector
│   │   │   ├── HeaderControls.tsx       # Header control panel
│   │   │   ├── Logo.tsx                 # App logo component
│   │   │   ├── LogoWithBackground.tsx   # Logo with background
│   │   │   ├── LoadingSkeleton.tsx      # Loading placeholder
│   │   │   ├── ConfirmDialog.tsx        # Confirmation dialog
│   │   │   ├── ToastProvider.tsx        # Toast notification provider
│   │   │   ├── SortButton.tsx           # Sort control button
│   │   │   ├── TreeDebugPanel.tsx       # Debug panel for tree data
│   │   │   ├── WorkflowSection.tsx      # Workflow section component
│   │   │   ├── ZKProofTest.tsx          # ZK proof testing component
│   │   │   ├── home/                    # Home page components
│   │   │   │   ├── Audience.tsx               # Target audience section
│   │   │   │   ├── CallToAction.tsx           # CTA section
│   │   │   │   ├── CoreFeatures.tsx           # Core features section
│   │   │   │   ├── DynamicIcon.tsx            # Dynamic icon component
│   │   │   │   ├── LoadingFallback.tsx        # Loading fallback
│   │   │   │   ├── Tokenomics.tsx             # Token economics section
│   │   │   │   ├── TwoLayerValueSystem.tsx    # Value system section
│   │   │   │   └── ValuePropositions.tsx      # Value propositions
│   │   │   └── modals/                  # Modal components
│   │   │       ├── AddVersionModal.tsx        # Add version modal
│   │   │       ├── EndorseModal.tsx           # Endorsement modal
│   │   │       ├── EndorseCompactModal.tsx    # Compact endorsement modal
│   │   │       ├── MintNFTModal.tsx           # NFT minting modal
│   │   │       ├── NetworkSelectionModal.tsx  # Network selection modal
│   │   │       └── WalletSelectionModal.tsx   # Wallet selection modal
│   │   ├── pages/                 # Application routes
│   │   │   ├── Home.tsx                 # Landing page
│   │   │   ├── TreePage.tsx             # Family tree view page
│   │   │   ├── SearchPage.tsx           # Person search page
│   │   │   ├── PeoplePage.tsx           # People listing page
│   │   │   ├── PersonPage.tsx           # Person detail page
│   │   │   ├── ActionsPage.tsx          # Action center page
│   │   │   ├── StoryEditorPage.tsx      # Story editing page
│   │   │   ├── KeyDerivationPage.tsx    # Key derivation utility
│   │   │   └── DecryptMetadataPage.tsx  # Metadata decryption page
│   │   ├── context/               # React Context state management
│   │   │   ├── ConfigContext.tsx        # App configuration context
│   │   │   ├── WalletContext.tsx        # Wallet connection context
│   │   │   ├── TreeDataContext.tsx      # Tree data state context
│   │   │   ├── NodeDetailContext.tsx    # Node detail state context
│   │   │   ├── EndorseModalContext.tsx  # Endorsement modal context
│   │   │   ├── FamilyTreeViewConfigContext.tsx # Tree view config
│   │   │   └── VizOptionsContext.tsx    # Visualization options
│   │   ├── hooks/                 # Custom React hooks
│   │   │   ├── useContract.ts           # Contract interaction hook
│   │   │   ├── useFamilyTreeViewModel.ts # Tree view model hook
│   │   │   ├── useZoom.ts               # Zoom control hook
│   │   │   ├── useMiniMap.ts            # Minimap functionality
│   │   │   ├── useDebounce.ts           # Debounce utility hook
│   │   │   └── useErrorMonitor.ts       # Error monitoring hook
│   │   ├── lib/                   # Core utility libraries
│   │   │   ├── zk.ts                    # ZK proof generation utilities
│   │   │   ├── zkSnark.ts               # ZK SNARK core utilities
│   │   │   ├── zkWorkerClient.ts        # ZK Web Worker client
│   │   │   ├── cryptoWorkerClient.ts    # Crypto Web Worker client
│   │   │   ├── story.ts                 # Story sharding utilities
│   │   │   ├── cid.ts                   # IPFS CID handling
│   │   │   ├── errors.ts                # Error handling utilities
│   │   │   ├── hooks.ts                 # Shared hook utilities
│   │   │   ├── identityHash.ts          # Identity hash utilities
│   │   │   ├── metadataCrypto.ts        # Metadata encryption/decryption
│   │   │   ├── secureKeyDerivation.ts   # Key derivation functions
│   │   │   └── passphraseStrength.ts    # Passphrase strength checker
│   │   ├── layout/                # Layout algorithms
│   │   │   ├── dagLayout.ts             # DAG layout algorithm
│   │   │   ├── forceLayout.ts           # Force-directed layout
│   │   │   └── treeLayout.ts            # Tree hierarchy layout
│   │   ├── renderers/             # View renderers
│   │   │   ├── dagRenderer.tsx          # DAG view renderer
│   │   │   ├── forceGraphRenderer.ts    # Force graph renderer
│   │   │   ├── treeLayoutRenderer.tsx   # Tree layout renderer
│   │   │   ├── treeListRenderer.tsx     # Tree list renderer
│   │   │   └── treeListRowRenderer.tsx  # Tree list row renderer
│   │   ├── workers/               # Web Workers
│   │   │   ├── zk.worker.ts             # ZK proof generation worker
│   │   │   └── crypto.worker.ts         # Cryptographic operations worker
│   │   ├── utils/                 # General utilities
│   │   │   ├── deepFamilyApi.ts         # Contract API wrapper
│   │   │   ├── treeData.ts              # Tree data processing
│   │   │   ├── treeInvalidation.ts      # Tree cache invalidation
│   │   │   ├── queryCache.ts            # Query caching utilities
│   │   │   ├── queryKeys.ts             # Query key management
│   │   │   ├── idbCache.ts              # IndexedDB caching
│   │   │   ├── familyTreeNodeUi.ts      # Node UI utilities
│   │   │   ├── familyTreeTheme.ts       # Theme configuration
│   │   │   ├── provider.ts              # Provider utilities
│   │   │   └── noPropsForwardRef.tsx    # Forward ref utility
│   │   ├── types/                 # TypeScript types
│   │   │   ├── familyTreeTypes.ts       # Family tree types
│   │   │   ├── familyTreeViewHandle.ts  # View handle types
│   │   │   ├── familyTreeViewProps.ts   # View props types
│   │   │   ├── graph.ts                 # Graph data types
│   │   │   └── treeStore.ts             # Tree store types
│   │   ├── config/                # Configuration
│   │   │   ├── networks.ts              # Network configurations
│   │   │   ├── wallets.ts               # Wallet configurations
│   │   │   ├── ipfs.ts                  # IPFS configuration
│   │   │   ├── languages.ts             # Language settings
│   │   │   ├── familyTreeConfig.ts      # Tree display config
│   │   │   └── brandBadge.ts            # Brand badge config
│   │   ├── constants/             # Constants
│   │   │   ├── layout.ts                # Layout constants
│   │   │   ├── genderColors.ts          # Gender color scheme
│   │   │   ├── chunkTypes.ts            # Story chunk types
│   │   │   ├── animationStyles.ts       # Animation definitions
│   │   │   └── homeStyles.ts            # Home page styles
│   │   ├── abi/                   # Contract ABIs (auto-synced)
│   │   ├── locales/               # i18n translation files
│   │   ├── i18n/                  # i18n configuration
│   │   └── shims/                 # Module shims
│   ├── scripts/
│   │   ├── sync-abi.mjs               # ABI synchronization script
│   │   └── update-local-config.mjs    # Local config generator
│   └── public/                    # Static assets
├── test/                   # Smart contract tests
│   ├── contract-person-version.test.mjs  # Person version management tests
│   ├── contract-endorse.test.mjs         # Endorsement system tests
│   ├── contract-mint-nft.test.mjs        # NFT minting tests
│   ├── story-tasks.test.mjs              # Story sharding tests
│   ├── story-errors.test.mjs             # Story error handling tests
│   ├── zk-hash-consistency.test.mjs      # ZK hash validation tests
│   ├── zk-name-poseidon-check.test.mjs   # Name proof tests
│   ├── zk-generate-name-poseidon-proof.test.mjs
│   └── lib-seed-helpers.test.mjs         # Seeding utility tests
├── deploy/                 # Hardhat deployment scripts
│   └── 00_deploy_integrated_system.js   # Integrated deployment
├── tasks/                  # Hardhat tasks
│   ├── contract-add-person.mjs           # Add person task
│   ├── contract-endorse.mjs              # Endorsement task
│   ├── contract-mint-nft.mjs             # NFT minting task
│   ├── story-add-chunk.mjs               # Story chunk addition
│   ├── story-list-chunks.mjs             # Story chunk listing
│   ├── story-seal.mjs                    # Story sealing task
│   ├── zk-add-person.mjs                 # ZK person addition
│   ├── zk-generate-name-poseidon-proof.mjs
│   ├── zk-name-poseidon-check.mjs        # Name proof validation
│   ├── zk-person-hash-check.mjs          # Person hash validation
│   ├── networks-check.mjs                # Network validation
│   └── networks-list.mjs                 # Network listing
├── scripts/                # Utility scripts
│   ├── seed-historical.mjs         # Historical demo data seeding
│   ├── check-root.mjs              # Root node validation
│   ├── fund-wallet.mjs             # Local wallet funding
│   ├── verify-data.mjs            # Data verification
│   └── test-keygen-demo.mjs       # Key generation demo
└── docs/                   # Technical documentation
```

## Development Commands

### Core Development
```bash
npm run setup                # Install root + frontend dependencies
npm run build                # Compile contracts and generate TypeChain types
npm run test                 # Run comprehensive test suite
npm run test:gas             # Run tests with gas reporting
npm run test:coverage        # Generate Solidity coverage report
npm run dev:all              # Start complete development environment (node + deploy + seed + frontend)
npm run frontend:dev         # Frontend development server only (localhost:5173)
```

### Frontend CSP Scan (Playwright)
```bash
cd frontend
npm run csp:scan                     # Default: preview-mode scan (build + preview)
CSP_SCAN_MODE=dev npm run csp:scan   # Dev-mode scan (vite dev server)
```

Notes:
- `csp:scan` is a route-level smoke test; it does not click through modals/flows, so CSP issues that only happen after user interaction may not be discovered.
- When `DEEP_CSP_STYLE_ATTR_NONE=1` is set, violations only appear if a visited route actually renders elements with inline `style=...` (or sets them dynamically); if needed, reproduce the interaction manually in the browser to confirm.

### Frontend CSP Environment Flags
- `DEEP_CSP_ENFORCE=1`: use `Content-Security-Policy` (enforced) for `vite preview`; otherwise uses `Content-Security-Policy-Report-Only`.
- `DEEP_CSP_INCLUDE_NETWORK_PRESETS=0`: do not auto-allow `NETWORK_PRESETS` RPC origins in `connect-src` (use `DEEP_CSP_CONNECT_SRC` instead).
- `DEEP_CSP_INCLUDE_IPFS_GATEWAYS=0`: do not auto-allow IPFS gateway origins in `connect-src`/`img-src` (use `DEEP_CSP_CONNECT_SRC` / `DEEP_CSP_IMG_SRC` instead).
- `DEEP_CSP_REPORT_FILE`: write CSP reports to a JSONL file (useful for `npm run csp:scan`).
- `DEEP_CSP_STYLE_ATTR_NONE=1`: set `style-src-attr 'none'` for `vite preview` to audit remaining inline `style={...}` usage.
- `DEEP_CSP_CONNECT_SRC`: extra `connect-src` origins (space-separated), e.g. `https://rpc.example.com https://ipfs.example.com` (the origin of `VITE_RPC_URL` is already included automatically).
- `DEEP_CSP_IMG_SRC`: extra `img-src` origins (space-separated), e.g. `https://ipfs.example.com`.
- `VITE_IPFS_GATEWAY_BASE_URLS`: override the IPFS gateway dropdown list (comma/space/newline-separated); used by both UI and CSP auto-allowlisting.

### Deployment & Network Management
```bash
npm run dev:deploy         # Deploy to local Hardhat network
npm run deploy:net --net=<network>  # Deploy to specific network (e.g., holesky, polygonAmoy)
npm run verify:net --net=<network>  # Verify contracts on block explorer
npm run check-networks       # Validate network configurations
npm run list-networks        # List all configured networks
npm run dev:seed             # Seed demo data to local network
npm run seed:net --net=<network>  # Seed demo data to specific network
npm run check:root --net=<network>  # Check root node on network
```

### Zero-Knowledge Proof Development
```bash
npm run zk:fetch             # Download circom compiler v2.1.6
npm run zk:build             # Build all circuits (person_hash + name_poseidon)
npm run zk:build:person      # Build person_hash_zk circuit
npm run zk:build:name        # Build name_poseidon_zk circuit
npm run zk:ptau              # Generate Powers of Tau (trusted setup)
npm run zk:setup             # Setup both circuits with zkey generation
npm run zk:setup:person      # Setup person_hash circuit
npm run zk:setup:name        # Setup name_poseidon circuit
npm run zk:check             # Validate both proof systems
npm run zk:check:person      # Check person hash proof generation
npm run zk:check:name        # Check name poseidon proof generation
npm run zk:verifier          # Export both Solidity verifiers
npm run zk:verifier:person   # Export PersonHashVerifier.sol
npm run zk:verifier:name     # Export NamePoseidonVerifier.sol
```

### Frontend Development
```bash
npm run frontend:dev         # Start Vite dev server (auto ABI sync)
npm run frontend:build       # Build production frontend
npm run frontend:preview     # Preview production build
npm run frontend:config      # Generate local config from deployed contracts
```

`frontend:config` (`cd frontend && npm run config:local`) updates `frontend/.env.local` with `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS`, root hash/index, and per-language root variants.


### Code Quality & Maintenance
```bash
npm run lint                 # Lint Solidity contracts with Solhint
npm run lint:fix             # Auto-fix Solidity linting issues
npm run format               # Format all Solidity, JS, and circuit files
npm run clean                # Clean Hardhat artifacts and cache
npm run size                 # Analyze contract sizes
```

### Local Development Workflow (Manual)
```bash
npm run dev:node             # Start local Hardhat node (port 8545)
npm run dev:deploy           # Deploy contracts to local network
npm run dev:contract         # Deploy + seed demo data
npm run dev:frontend         # Start frontend on 0.0.0.0:5173
```

## Network Support

### Supported Networks
- **Conflux**: Conflux eSpace (Mainnet/Testnet)
- **Ethereum**: Mainnet, Sepolia, Holesky
- **Layer 2**: Polygon (Mainnet/Amoy), Arbitrum (Mainnet/Sepolia), Optimism (Mainnet/Sepolia)
- **Other Chains**: BSC (Mainnet/Testnet)
- **Local**: Hardhat Network (chainId: 31337)

### Environment Configuration
Required `.env` variables:
```bash
PRIVATE_KEY=0x...           # Deployer wallet private key (KEEP SECURE!)
```

## Testing & Development Standards

### Comprehensive Testing
- **Unit Tests**: Individual contract function testing
- **Integration Tests**: Cross-contract interaction testing
- **ZK Proof Tests**: Circuit validation and proof generation
- **Economic Tests**: Token mining and halving mechanism validation
- **Security Tests**: Reentrancy, access control, edge case testin

## Security Considerations

### Smart Contract Security
- **Reentrancy Protection**: All external calls protected
- **Access Control**: Role-based permissions with explicit error types
- **Input Validation**: Comprehensive parameter checking
- **Overflow Protection**: SafeMath patterns and Solidity 0.8+ built-ins

### ZK Proof Security
- **Trusted Setup**: Uses community-audited Powers of Tau
- **Circuit Validation**: All constraints properly implemented
- **Proof Verification**: On-chain Groth16 verification
- **Domain Separation**: keccak256 wrapper prevents hash collisions

### Frontend Security
- **Wallet Integration**: Secure Web3 provider handling
- **Input Sanitization**: All user inputs validated
- **State Management**: Immutable state patterns
- **Error Handling**: Graceful error recovery and user feedback

## **Development Guidelines**
- English documentation
- Synchronized test updates with new features
- Pre-production auditing required
- **STRICTLY FORBIDDEN**: Never include any AI identifiers, signatures, or acknowledgments in commit messages
  - No "Generated with Claude", "Co-Authored-By: Claude", "By AI", "AI-generated", "Assisted by", etc.
  - No references to artificial intelligence, automation tools, or AI assistance
  - Commit messages must appear as if written by a human developer
