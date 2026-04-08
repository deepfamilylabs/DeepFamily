# CLAUDE.md

## Project Overview

DeepFamily is a blockchain-based decentralized global digital family tree protocol leveraging zero-knowledge proofs, NFTs, and community governance to create a collaborative, verifiable, and perpetual family history recording system.

## Architecture

### Layer 1: Family Relationship Network
- Build a global family tree graph through personHash/fatherHash/motherHash connections
- Groth16 ZK proofs protect privacy — only cryptographic commitments stored on-chain
- Domain-separated Poseidon commitment (nameField, derivedSecret, birthData, suiteCommitment) prevents identity inference and pollution attacks
- Dual tree models: public collaborative trees (shared passphrase) vs. private protected trees (unique passphrase)
- DEEP token mining triggered only when both fatherHash and motherHash are provided (complete family data)
- Multiple versions per person allow different contributors to record the same individual

### Layer 2: Value & Public Records
- Community endorsement validates data quality (costs `recentReward` amount of DEEP tokens)
- Endorsed versions can be minted as NFTs, revealing full personal information on-chain
- NFT minting requires ZK proof of name ownership (DisclosureBindingVerifier) + prior endorsement
- Story sharding: biographical data in sequentially indexed, hash-verified chunks (up to 2KB per chunk)
- Stories can be permanently sealed for historical preservation
- Fee distribution: majority flows to NFT holders or contributors, protocol share (default 5%, max 20%)

## Smart Contracts

| Contract | Purpose |
|----------|---------|
| **DeepFamily.sol** | Core protocol — ZK proof validation, multi-version person data, endorsement governance, NFT minting, story sharding. 50+ custom errors, reentrancy guards, paginated queries (max 200) |
| **DeepFamilyToken.sol** | ERC20 utility token with progressive halving: initial reward 113,777 DEEP, cycles 1→10→100→1K→10K→100K→1M→10M→100M→Fixed 100M, 100B supply cap |
| **PersonCommitmentVerifier.sol** | Groth16 verifier for family relationship proofs (7 public signals: identity/father/mother commitment + submitter + schema/suite/algo versions) |
| **DisclosureBindingVerifier.sol** | Groth16 verifier for disclosure binding proofs (6 public signals: identityCommitment + disclosureBinding + minter + schema/suite/algo versions) |

## Key Technical Details

### Zero-Knowledge System
- Domain-separated Poseidon commitment tree: suiteCommitment → nameSecretCommitment → identityCommitment
- Versioned crypto suite (schemaVersion, cryptoSuiteVersion, hashAlgoId) for forward compatibility
- PersonCommitmentVerifier: validates addPersonVersion submissions (person + father + mother identity commitments)
- DisclosureBindingVerifier: validates mintPersonVersionNFT disclosure binding (proves identity ↔ disclosure link for NFT minting)

### Data Management
- Multi-version system with duplicate prevention (keccak256 of version fields)
- Parent-child relationship tracking via `childrenOf` mapping with version references
- Gas-optimized paginated queries (MAX_QUERY_PAGE_SIZE = 200)

### Security
- Reentrancy guards on all external value transfers
- Role-based access control with explicit custom error types
- Contract rejects direct ETH transfers (receive/fallback revert)

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
- **Circuits**: person_commitment.circom (identity commitment with family links), disclosure_binding.circom (identity ↔ disclosure binding for NFT minting)
- **Libraries**: circomlib v2.0.5, keccak256-circom
- **Hashing**: Poseidon-lite v0.3, @noble/hashes v1.8
- **Proof Generation**: snarkjs with Powers of Tau ceremony support
- **Verifiers**: Auto-generated Solidity verifiers (PersonCommitmentVerifier.sol, DisclosureBindingVerifier.sol)

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
│   ├── PersonCommitmentVerifier.sol  # ZK verifier for identity commitment (person + parents)
│   └── DisclosureBindingVerifier.sol # ZK verifier for disclosure binding (NFT minting)
├── circuits/               # ZK Circuit Development
│   ├── person_commitment.circom     # Identity commitment with family links (domain-separated Poseidon)
│   ├── disclosure_binding.circom    # Identity ↔ disclosure binding for NFT minting
│   ├── sync-zk-assets.mjs         # ZK asset synchronization utility
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
│   ├── zk-disclosure-binding-check.test.mjs   # Name proof tests
│   ├── zk-generate-disclosure-binding-proof.test.mjs
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
│   ├── zk-generate-disclosure-binding-proof.mjs
│   ├── zk-disclosure-binding-check.mjs        # Name proof validation
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
npm run zk:build             # Build all circuits (person_commitment + disclosure_binding)
npm run zk:build:person      # Build person_commitment circuit
npm run zk:build:disclosure  # Build disclosure_binding circuit
npm run zk:ptau              # Generate Powers of Tau (trusted setup)
npm run zk:setup             # Setup both circuits with zkey generation
npm run zk:setup:person      # Setup person_commitment circuit
npm run zk:setup:disclosure  # Setup disclosure_binding circuit
npm run zk:check             # Validate both proof systems
npm run zk:check:person      # Check person commitment proof generation
npm run zk:check:disclosure  # Check disclosure binding proof generation
npm run zk:verifier          # Export both Solidity verifiers
npm run zk:verifier:person   # Export PersonCommitmentVerifier.sol
npm run zk:verifier:disclosure # Export DisclosureBindingVerifier.sol
npm run zk:sync              # Sync compiled artifacts to frontend/public/zk
npm run zk:refresh           # Full rebuild: build + setup + verifier + sync
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
- **Domain Separation**: unique domain constants (1000–1003) in Poseidon inputs prevent cross-purpose hash collisions

### Frontend Security
- **Wallet Integration**: Secure Web3 provider handling
- **Input Sanitization**: All user inputs validated
- **State Management**: Immutable state patterns
- **Error Handling**: Graceful error recovery and user feedback

## **Development Guidelines**
- English documentation
- Synchronized test updates with new features
- Pre-production auditing required
