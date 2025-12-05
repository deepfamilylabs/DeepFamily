# Frontend Integration Guide

## Technology Stack

### **Core Technologies**
| Technology | Version | Purpose |
|------------|---------|---------|
| **React** | 18.2.0 | Modern UI framework with hooks and concurrent features |
| **TypeScript** | ^5.4.5 | Type safety and enhanced developer experience |
| **Vite** | ^5.2.0 | Fast build tool and development server |
| **TailwindCSS** | ^3.4.10 | Utility-first CSS framework for responsive design |
| **Ethers.js** | ^6.11.1 | Ethereum blockchain interaction library |
| **React Router** | ^7.8.1 | Client-side routing and navigation |

### **Specialized Libraries**
| Library | Purpose | Integration |
|---------|---------|-------------|
| **D3.js** | ^7.9.0 | Interactive family tree visualizations |
| **React Hook Form** | ^7.62.0 | Form state management and validation |
| **React i18next** | ^15.7.1 | Internationalization and localization |
| **Lucide React** | ^0.540.0 | Modern icon system |
| **SnarkJS** | ^0.7.5 | Zero-knowledge proof generation |
| **Zod** | ^4.0.17 | Runtime type validation |

## Application Architecture

### **Project Structure**
```
frontend/src/
├── components/          # Reusable UI Components
│   ├── FamilyTree.tsx      # Main family tree container
│   ├── FlexibleDAGView.tsx # Customizable tree layout
│   ├── ForceDAGView.tsx    # Physics-based tree visualization
│   ├── NodeDetailModal.tsx # Person information modal
│   ├── WalletConnectButton.tsx # Web3 wallet integration
│   └── ...                 # Additional UI components
├── pages/               # Route Components
│   ├── Home.tsx            # Landing page
│   ├── TreePage.tsx        # Family tree visualization
│   ├── SearchPage.tsx      # Person search interface
│   ├── PersonPage.tsx      # Individual person details
│   ├── StoryEditorPage.tsx # Biography editing
│   └── ...                 # Additional pages
├── context/            # React Context Providers
│   ├── WalletContext.tsx   # Web3 wallet state management
│   ├── TreeDataContext.tsx # Family tree data caching
│   ├── ConfigContext.tsx   # Application configuration
│   └── ...                 # Additional context providers
├── hooks/              # Custom React Hooks
│   ├── useContract.ts      # Smart contract interaction
│   ├── usePersonData.ts    # Person data fetching
│   ├── useTreeData.ts      # Tree data management
│   └── ...                 # Additional custom hooks
├── abi/                # Contract ABI Files
├── types/              # TypeScript Type Definitions
├── utils/              # Utility Functions
└── locales/           # Internationalization Files
```

### **React Application Flow**
- Multi-provider architecture with nested context providers
- Route-based navigation with React Router
- Global state management for wallet, tree data, and configuration
- Toast notifications and visualization options

## Development Setup

### **Environment Configuration**
Create `frontend/.env` for production/testnet and `frontend/.env.local` for local development:

**Production/Testnet (.env):**
```bash
# Conflux eSpace Testnet Configuration
VITE_RPC_URL=https://evmtestnet.confluxrpc.com
VITE_CONTRACT_ADDRESS=0x63ea5897C88c9Dac09c3d5Af7a55f1442F08A7E9

# Root Node Configuration (Genesis Person)
VITE_ROOT_PERSON_HASH=0x82ed8e6e1fd21e3dd5413b80e81d2606ae07c16e3372a41468c76178478e1942
VITE_ROOT_VERSION_INDEX=1
```

**Local Development (.env.local):**
```bash
# Local Hardhat Network Configuration
VITE_RPC_URL=http://127.0.0.1:8545
VITE_CONTRACT_ADDRESS=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0

# Root Node Configuration (Genesis Person)
VITE_ROOT_PERSON_HASH=0x82ed8e6e1fd21e3dd5413b80e81d2606ae07c16e3372a41468c76178478e1942
VITE_ROOT_VERSION_INDEX=1

# Optional Network Configuration
# VITE_CHAIN_ID=31337
# VITE_NETWORK_NAME=localhost
# VITE_MULTICALL_ADDRESS=0x...

# Optional Performance Tuning for public RPCs to avoid rate limits
# VITE_DF_PARALLEL=6              # Default parallel requests (default: 6)
# VITE_DF_PAGE_SIZE=25            # Default page size (default: 25)
# VITE_DF_ENDORSE_BATCH=40        # Endorsement batch size (default: 40)
# VITE_DF_MAX_DEPTH=30            # Maximum tree depth (default: 30)
# VITE_DF_HARD_NODE_LIMIT=20000   # Hard limit on nodes (default: 20000)

# Optional Debug and Cache Settings
# VITE_SHOW_DEBUG=1               # Enable debug mode in TreePage
# VITE_STRICT_CACHE_ONLY=true     # Enable strict cache-only mode
```


### **ABI Synchronization System**
The frontend automatically syncs contract ABIs from Hardhat compilation:

```javascript
// frontend/scripts/sync-abi.mjs
import fs from 'fs';
import path from 'path';

const HARDHAT_ARTIFACTS = '../artifacts/contracts';
const FRONTEND_ABI_DIR = './src/abi';

// Automatically copy ABIs after contract compilation
export function syncABIs() {
  const contracts = ['DeepFamily.sol', 'DeepFamilyToken.sol', 'PersonHashVerifier.sol'];

  contracts.forEach(contractFile => {
    const artifactPath = path.join(HARDHAT_ARTIFACTS, contractFile);
    const contractName = contractFile.replace('.sol', '');
    const artifact = JSON.parse(fs.readFileSync(`${artifactPath}/${contractName}.json`));

    // Extract ABI and write to frontend
    fs.writeFileSync(
      path.join(FRONTEND_ABI_DIR, `${contractName}.json`),
      JSON.stringify(artifact.abi, null, 2)
    );
  });
}
```

**Automatic ABI Updates**:
- `npm run predev` and `npm run prebuild` trigger ABI sync
- Ensures frontend always has latest contract interfaces
- No manual ABI copying required during development

## 📱 Core Components

### **Family Tree Visualization**

**FlexibleDAGView.tsx** - Customizable tree layout with multiple algorithms (horizontal/vertical/radial)
**ForceDAGView.tsx** - Physics-based tree using D3 force simulation with interactive drag and zoom

### **Blockchain Integration Components**

**WalletConnectButton.tsx** - Web3 wallet connection with address display and i18n support
**NodeDetailModal.tsx** - Person detail modal with endorsement and NFT minting functionality

## State Management

### **Context Providers**

**WalletContext.tsx** - Web3 wallet state with connection persistence and network switching
**TreeDataContext.tsx** - Family tree data management with real-time blockchain event updates

### **Custom Hooks**

**useContract.ts** - Smart contract interaction with transaction execution and error handling
**usePersonData.ts** - Person data fetching with version details and NFT information

## User Experience Flow

### **User Journey Flow**

1. **Landing & Connection** - Welcome page with wallet connection and recent families preview
2. **Family Tree Exploration** - Interactive visualization with sidebar controls and node details
3. **Person Management** - Individual profiles with version tabs and action buttons
4. **Story Creation & Editing** - Rich text editor with chunk-based content management

## Security & Validation

### **Validation & Error Handling**
- **Client-Side Validation**: Zod schemas for person info and story chunks with size limits
- **Error Mapping**: User-friendly messages for contract errors and transaction failures
- **Input Validation**: Form validation with comprehensive error feedback

## Performance Optimization

### **Performance Optimization**
- **Data Caching**: React Query integration with 5-10 minute cache times
- **Code Splitting**: Route and component-based lazy loading with Suspense
- **Event-Driven Updates**: Real-time blockchain event monitoring with query invalidation

## Internationalization

### **Internationalization**
- **Multi-language Support**: English, Chinese, Spanish with automatic language detection
- **Component Integration**: useTranslation hook with dynamic text and date formatting
- **Fallback Strategy**: English as default with graceful degradation

---

## Frontend Integration Summary

### **Development Best Practices**
- **TypeScript First**: Complete type safety across the application
- **Component Modularity**: Reusable components with clear prop interfaces
- **Performance Focus**: Lazy loading, caching, and event-driven updates
- **User Experience**: Responsive design with comprehensive error handling
- **Blockchain Integration**: Seamless Web3 wallet and contract interaction

### **Key Features**
- **Interactive Family Trees**: Multiple visualization options with D3.js
- **Real-time Updates**: Blockchain event monitoring for live data synchronization
- **Comprehensive i18n**: Multi-language support for global accessibility
- **Story Management**: Rich text editing with chunk-based content organization
- **Progressive Web App**: Mobile-responsive design with offline capability planning

### **Integration Points**
- **Smart Contracts**: Direct integration with DeepFamily protocol via Ethers.js
- **IPFS**: Metadata and story storage via decentralized file systems
- **Wallet Providers**: Support for MetaMask, WalletConnect, and other Web3 wallets
- **Analytics**: Optional integration with privacy-focused analytics solutions
