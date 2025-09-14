# 🎨 Frontend Integration Guide

## 🛠️ Technology Stack

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

## 🏗️ Application Architecture

### **Project Structure**
```
frontend/src/
├── components/          # Reusable UI Components (33 files)
│   ├── FamilyTree.tsx      # Main family tree container
│   ├── FlexibleDAGView.tsx # Customizable tree layout
│   ├── ForceDAGView.tsx    # Physics-based tree visualization
│   ├── NodeDetailModal.tsx # Person information modal
│   ├── WalletConnectButton.tsx # Web3 wallet integration
│   └── ...                 # Additional UI components
├── pages/               # Route Components (9 pages)
│   ├── Home.tsx            # Landing page
│   ├── TreePage.tsx        # Family tree visualization
│   ├── SearchPage.tsx      # Person search interface
│   ├── PersonPage.tsx      # Individual person details
│   ├── StoryEditorPage.tsx # Biography editing
│   └── ...                 # Additional pages
├── context/            # React Context Providers (7 contexts)
│   ├── WalletContext.tsx   # Web3 wallet state management
│   ├── TreeDataContext.tsx # Family tree data caching
│   ├── ConfigContext.tsx   # Application configuration
│   └── ...                 # Additional context providers
├── hooks/              # Custom React Hooks (8 hooks)
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
```tsx
// App.tsx - Main application component
function App() {
  return (
    <BrowserRouter>
      <WalletProvider>
        <TreeDataProvider>
          <ConfigProvider>
            <VizOptionsProvider>
              <ToastProvider>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/familyTree" element={<TreePage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/person/:hash" element={<PersonPage />} />
                  <Route path="/editor/:tokenId" element={<StoryEditorPage />} />
                  {/* Additional routes */}
                </Routes>
              </ToastProvider>
            </VizOptionsProvider>
          </ConfigProvider>
        </TreeDataProvider>
      </WalletProvider>
    </BrowserRouter>
  );
}
```

## 🔧 Development Setup

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

**FlexibleDAGView.tsx** - Customizable Tree Layout
```tsx
interface FlexibleDAGViewProps {
  data: TreeNode[];
  layout: 'horizontal' | 'vertical' | 'radial';
  nodeSpacing: number;
  levelSpacing: number;
  onNodeClick: (node: TreeNode) => void;
  onNodeHover: (node: TreeNode | null) => void;
}

// Supports multiple layout algorithms with smooth transitions
const FlexibleDAGView: React.FC<FlexibleDAGViewProps> = ({
  data, layout, nodeSpacing, levelSpacing, onNodeClick, onNodeHover
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const { calculateLayout, renderNodes, renderEdges } = useTreeLayout(layout);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const { nodes, edges } = calculateLayout(data, nodeSpacing, levelSpacing);

    renderNodes(svg, nodes, onNodeClick, onNodeHover);
    renderEdges(svg, edges);
  }, [data, layout, nodeSpacing, levelSpacing]);

  return <svg ref={svgRef} className="w-full h-full" />;
};
```

**ForceDAGView.tsx** - Physics-Based Tree
```tsx
// Uses D3 force simulation for dynamic, interactive family trees
const ForceDAGView: React.FC<ForceDAGViewProps> = ({ data, onNodeClick }) => {
  const simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.edges).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(30));

  // Real-time physics simulation with user interaction
  return (
    <svg>
      {/* Render nodes with physics-based positioning */}
      {/* Interactive drag and zoom functionality */}
    </svg>
  );
};
```

### **Blockchain Integration Components**

**WalletConnectButton.tsx** - Web3 Wallet Integration
```tsx
const WalletConnectButton: React.FC = () => {
  const { isConnected, address, connect, disconnect, balance } = useWallet();
  const { t } = useTranslation();

  return (
    <button
      onClick={isConnected ? disconnect : connect}
      className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700"
    >
      <Wallet className="w-4 h-4" />
      <span>
        {isConnected
          ? `${address?.slice(0, 6)}...${address?.slice(-4)}`
          : t('wallet.connect')
        }
      </span>
    </button>
  );
};
```

**NodeDetailModal.tsx** - Person Information Display
```tsx
interface NodeDetailModalProps {
  personHash: string;
  versionIndex: number;
  isOpen: boolean;
  onClose: () => void;
}

const NodeDetailModal: React.FC<NodeDetailModalProps> = ({
  personHash, versionIndex, isOpen, onClose
}) => {
  const { data: versionDetails, loading, error } = usePersonVersion(personHash, versionIndex);
  const { endorseVersion, mintNFT } = useDeepFamilyActions();

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 space-y-4">
        <PersonInfo person={versionDetails?.person} />
        <EndorsementSection
          endorsements={versionDetails?.endorsements}
          onEndorse={() => endorseVersion(personHash, versionIndex)}
        />
        <NFTSection
          tokenId={versionDetails?.tokenId}
          onMint={() => mintNFT(personHash, versionIndex)}
        />
      </div>
    </Modal>
  );
};
```

## 🔄 State Management

### **Context Providers**

**WalletContext.tsx** - Web3 Wallet State
```tsx
interface WalletContextType {
  isConnected: boolean;
  address: string | null;
  balance: string | null;
  chainId: number | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: (chainId: number) => Promise<void>;
}

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<WalletState>(initialState);

  // Automatic wallet detection and connection persistence
  useEffect(() => {
    detectWallet();
    restoreConnection();
  }, []);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect, switchNetwork }}>
      {children}
    </WalletContext.Provider>
  );
};
```

**TreeDataContext.tsx** - Family Tree Data Management
```tsx
interface TreeDataContextType {
  treeData: TreeNode[];
  loading: boolean;
  error: string | null;
  refreshTree: () => Promise<void>;
  updateNode: (hash: string, data: Partial<TreeNode>) => void;
  addNode: (node: TreeNode) => void;
}

export const TreeDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const { address } = useWallet();

  // Automatic data fetching and caching
  const fetchTreeData = useCallback(async () => {
    if (!address) return;

    const data = await fetchUserFamilyTree(address);
    setTreeData(data);
  }, [address]);

  // Real-time updates via blockchain events
  useEffect(() => {
    const unsubscribe = subscribeToTreeUpdates(address, (update) => {
      setTreeData(prev => applyTreeUpdate(prev, update));
    });

    return unsubscribe;
  }, [address]);

  return (
    <TreeDataContext.Provider value={{ treeData, loading, error, refreshTree, updateNode, addNode }}>
      {children}
    </TreeDataContext.Provider>
  );
};
```

### **Custom Hooks**

**useContract.ts** - Smart Contract Interaction
```tsx
export function useContract() {
  const { signer, provider } = useWallet()
  const { contractAddress } = useConfig()
  const toast = useToast()
  const { t } = useTranslation()

  const contract = useMemo(() => {
    if (!contractAddress) return null

    if (signer) {
      // Write operations with signer
      return new ethers.Contract(contractAddress, DeepFamily.abi, signer)
    } else if (provider) {
      // Read-only operations with provider
      return new ethers.Contract(contractAddress, DeepFamily.abi, provider)
    }

    return null
  }, [contractAddress, signer, provider])

  // Transaction execution with comprehensive error handling
  const executeTransaction = useCallback(async (
    contractMethod: () => Promise<any>,
    options: {
      onSuccess?: (result: any) => void
      onError?: (error: any) => void
      successMessage?: string
      errorMessage?: string
    } = {}
  ) => {
    if (!contract || !signer) {
      toast.show(t('wallet.notConnected', 'Please connect your wallet'))
      return null
    }

    try {
      const tx = await contractMethod()
      toast.show(t('transaction.submitted', 'Transaction submitted...'))
      const receipt = await tx.wait()

      const successMsg = options.successMessage || t('transaction.success', 'Transaction successful')
      toast.show(successMsg)
      options.onSuccess?.(receipt)
      return receipt
    } catch (error: any) {
      // Custom error parsing and user-friendly messages
      const errorMsg = parseContractError(error, t)
      toast.show(errorMsg)
      options.onError?.(error)
      throw error
    }
  }, [contract, signer, toast, t])

  return {
    contract,
    isContractReady: !!contract && !!signer,
    executeTransaction,
    addPersonZK,
    mintPersonNFT,
    endorseVersion,
    listPersonVersions,
    getVersionDetails,
    getNFTDetails
  }
}
```

**usePersonData.ts** - Person Data Fetching
```tsx
export const usePersonData = (personHash: string, versionIndex?: number) => {
  const contract = useContract('DeepFamily');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchPersonData = useCallback(async () => {
    if (!contract || !personHash) return;

    setLoading(true);
    try {
      const versionDetails = await contract.getVersionDetails(personHash, versionIndex || 1);
      const nftDetails = versionDetails.tokenId > 0
        ? await contract.getNFTDetails(versionDetails.tokenId)
        : null;

      setData({ versionDetails, nftDetails });
    } catch (error) {
      console.error('Error fetching person data:', error);
    } finally {
      setLoading(false);
    }
  }, [contract, personHash, versionIndex]);

  useEffect(() => {
    fetchPersonData();
  }, [fetchPersonData]);

  return { data, loading, refetch: fetchPersonData };
};
```

## 🌐 User Experience Flow

### **Complete User Journey**

1. **Landing & Connection**
   ```tsx
   // Home.tsx - Landing page with wallet connection
   const Home = () => {
     return (
       <div>
         <WelcomeSection />
         <WalletConnectButton />
         <RecentFamiliesPreview />
       </div>
     );
   };
   ```

2. **Family Tree Exploration**
   ```tsx
   // TreePage.tsx - Interactive family tree visualization
   const TreePage = () => {
     const { treeData } = useTreeData();
     const [selectedNode, setSelectedNode] = useState(null);

     return (
       <div className="h-screen flex">
         <TreeSidebar />
         <FlexibleDAGView
           data={treeData}
           onNodeClick={setSelectedNode}
         />
         <NodeDetailModal
           node={selectedNode}
           onClose={() => setSelectedNode(null)}
         />
       </div>
     );
   };
   ```

3. **Person Management**
   ```tsx
   // PersonPage.tsx - Individual person details and actions
   const PersonPage = () => {
     const { hash } = useParams();
     const { data: personData } = usePersonData(hash);

     return (
       <PersonProfile>
         <PersonDetails person={personData} />
         <VersionTabs versions={personData.versions} />
         <ActionButtons>
           <EndorseButton />
           <MintNFTButton />
           <EditStoryButton />
         </ActionButtons>
       </PersonProfile>
     );
   };
   ```

4. **Story Creation & Editing**
   ```tsx
   // StoryEditorPage.tsx - Biography content management
   const StoryEditorPage = () => {
     const { tokenId } = useParams();
     const { chunks, addChunk, updateChunk, sealStory } = useStoryManagement(tokenId);

     return (
       <StoryEditor>
         <ChunkList chunks={chunks} />
         <RichTextEditor onSave={addChunk} />
         <SealButton onClick={sealStory} />
       </StoryEditor>
     );
   };
   ```

## 🔒 Security & Validation

### **Client-Side Validation**
```tsx
// Form validation with Zod schemas
const PersonInfoSchema = z.object({
  fullName: z.string().min(1).max(256),
  birthYear: z.number().min(0).max(9999),
  birthMonth: z.number().min(0).max(12),
  birthDay: z.number().min(0).max(31),
  gender: z.number().min(0).max(3),
});

// Story chunk validation
const StoryChunkSchema = z.object({
  content: z.string().max(1000, 'Story chunk must be ≤1KB'),
  chunkIndex: z.number().min(0).max(99),
});

const validateStoryChunk = (content: string): boolean => {
  const byteSize = new TextEncoder().encode(content).length;
  return byteSize <= 1000;
};
```

### **Error Handling**
```tsx
// Comprehensive error mapping for user-friendly messages
const ERROR_MESSAGES = {
  'MustEndorseVersionFirst': 'Please endorse this version before minting NFT',
  'VersionAlreadyMinted': 'This version already has an NFT',
  'StoryAlreadySealed': 'This story is permanently sealed and cannot be edited',
  'InsufficientAllowance': 'Please approve DEEP token spending first',
  'InvalidChunkContent': 'Story chunk content is invalid or too large',
  'MustBeNFTHolder': 'Only the NFT holder can edit this story',
};

export const handleContractError = (error: Error): string => {
  const errorMessage = error.message;

  for (const [contractError, userMessage] of Object.entries(ERROR_MESSAGES)) {
    if (errorMessage.includes(contractError)) {
      return userMessage;
    }
  }

  return 'Transaction failed. Please try again.';
};
```

## 🚀 Performance Optimization

### **Data Caching Strategy**
```tsx
// React Query integration for smart caching
import { useQuery } from '@tanstack/react-query';

export const usePersonVersions = (personHash: string) => {
  const contract = useContract('DeepFamily');

  return useQuery({
    queryKey: ['personVersions', personHash],
    queryFn: async () => {
      const { items } = await contract.listPersonVersions(personHash, 0, 100);
      return items;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!personHash && !!contract,
  });
};
```

### **Lazy Loading & Code Splitting**
```tsx
// Route-based code splitting
const TreePage = lazy(() => import('./pages/TreePage'));
const StoryEditor = lazy(() => import('./pages/StoryEditorPage'));

// Component-based code splitting
const D3TreeVisualization = lazy(() => import('./components/D3TreeVisualization'));

// Usage with Suspense
<Suspense fallback={<LoadingSpinner />}>
  <TreePage />
</Suspense>
```

### **Event-Driven Updates**
```tsx
// Real-time blockchain event monitoring
export const useBlockchainEvents = () => {
  const contract = useContract('DeepFamily');
  const { address } = useWallet();

  useEffect(() => {
    if (!contract || !address) return;

    const filters = {
      personVersionAdded: contract.filters.PersonVersionAdded(),
      personVersionEndorsed: contract.filters.PersonVersionEndorsed(),
      personNFTMinted: contract.filters.PersonNFTMinted(),
    };

    const handleEvent = (event: any) => {
      // Update local state based on blockchain events
      queryClient.invalidateQueries(['treeData', address]);
    };

    // Subscribe to events
    contract.on(filters.personVersionAdded, handleEvent);
    contract.on(filters.personVersionEndorsed, handleEvent);
    contract.on(filters.personNFTMinted, handleEvent);

    return () => {
      contract.removeAllListeners();
    };
  }, [contract, address]);
};
```

## 🌍 Internationalization

### **i18n Configuration**
```tsx
// i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from '../locales/en.json';
import zh from '../locales/zh.json';
import es from '../locales/es.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, zh: { translation: zh }, es: { translation: es } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
```

### **Multilingual Component Usage**
```tsx
const PersonCard: React.FC<{ person: PersonData }> = ({ person }) => {
  const { t, i18n } = useTranslation();

  return (
    <div className="person-card">
      <h3>{person.fullName}</h3>
      <p>{t('person.born')}: {formatDate(person.birthYear, i18n.language)}</p>
      <p>{t('person.endorsements')}: {person.endorsementCount}</p>
      <button>{t('actions.endorse')}</button>
    </div>
  );
};
```

---

## 🎯 Frontend Integration Summary

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
