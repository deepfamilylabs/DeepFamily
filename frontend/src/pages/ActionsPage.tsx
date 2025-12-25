import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Plus, Image, Star, Wallet, AlertCircle } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import WalletConnectButton from "../components/WalletConnectButton";
import AddVersionModal from "../components/modals/AddVersionModal";
import MintNFTModal from "../components/modals/MintNFTModal";
import EndorseModal from "../components/modals/EndorseModal";
import PageContainer from "../components/PageContainer";

type ActionTab = "add-version" | "mint-nft" | "endorse";

export default function ActionsPage() {
  const { t } = useTranslation();
  const { address } = useWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ActionTab>("add-version");

  // Handle URL tab parameter
  useEffect(() => {
    const tabParam = searchParams.get("tab") as ActionTab;
    if (tabParam && ["add-version", "mint-nft", "endorse"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Auto-open Endorse modal if URL carries target hash/index
  useEffect(() => {
    if (!address) return;
    const tabParam = searchParams.get("tab") as ActionTab;
    if (tabParam !== "endorse") return;
    const qHash = searchParams.get("hash") || searchParams.get("personHash") || "";
    const qIndexStr =
      searchParams.get("vi") ||
      searchParams.get("version") ||
      searchParams.get("versionIndex") ||
      "";
    const qIndex = qIndexStr ? parseInt(qIndexStr, 10) : NaN;
    if (qHash && Number.isFinite(qIndex) && qIndex > 0) {
      setEndorseModal({ isOpen: true, personHash: qHash, versionIndex: qIndex });
    }
  }, [address, searchParams]);

  // Auto-open MintNFT modal if URL carries target hash/index
  useEffect(() => {
    if (!address) return;
    const tabParam = searchParams.get("tab") as ActionTab;
    if (tabParam !== "mint-nft") return;
    const qHash = searchParams.get("hash") || searchParams.get("personHash") || "";
    const qIndexStr =
      searchParams.get("vi") ||
      searchParams.get("version") ||
      searchParams.get("versionIndex") ||
      "";
    const qIndex = qIndexStr ? parseInt(qIndexStr, 10) : NaN;
    if (qHash && Number.isFinite(qIndex) && qIndex > 0) {
      setMintNFTModal({ isOpen: true, personHash: qHash, versionIndex: qIndex });
    }
  }, [address, searchParams]);

  // Modal states
  const [addVersionModal, setAddVersionModal] = useState<{
    isOpen: boolean;
    existingPersonData?: any;
  }>({ isOpen: false });

  const [mintNFTModal, setMintNFTModal] = useState<{
    isOpen: boolean;
    personHash?: string;
    versionIndex?: number;
    versionData?: any;
  }>({ isOpen: false });

  const [endorseModal, setEndorseModal] = useState<{
    isOpen: boolean;
    personHash?: string;
    versionIndex?: number;
    versionData?: any;
  }>({ isOpen: false });

  const tabs = useMemo(
    () => [
      {
        id: "add-version" as ActionTab,
        name: t("actions.add", "Add"),
        subtitle: t("actions.addVersion", "Add Version"),
        icon: Plus,
        description: t(
          "actions.addVersionDesc",
          "Add a new version of person data with zero-knowledge proofs",
        ),
        color: "blue",
      },
      {
        id: "endorse" as ActionTab,
        name: t("actions.endorse", "Endorse"),
        subtitle: t("actions.endorsement", "Endorsement"),
        icon: Star,
        description: t(
          "actions.endorseDesc",
          "Support quality data by endorsing versions with DEEP tokens",
        ),
        color: "green",
      },
      {
        id: "mint-nft" as ActionTab,
        name: t("actions.mint", "Mint"),
        subtitle: t("actions.mintNFT", "Mint NFT"),
        icon: Image,
        description: t(
          "actions.mintNFTDesc",
          "Convert endorsed person data into valuable NFT collectibles",
        ),
        color: "purple",
      },
    ],
    [t],
  );

  // Wallet not connected view
  if (!address) {
    return (
      <PageContainer className="py-12">
        <div className="max-w-2xl mx-auto text-center">
          <div className="mb-8 relative inline-block">
            <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-red-500 blur-xl opacity-20 rounded-full"></div>
            <div className="relative bg-white dark:bg-gray-800 p-4 rounded-2xl shadow-lg">
              <Wallet className="w-12 h-12 text-orange-500" />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">
            {t("actions.walletRequired", "Wallet Connection Required")}
          </h1>

          <p className="text-lg text-gray-500 dark:text-gray-400 mb-10 max-w-lg mx-auto leading-relaxed">
            {t(
              "actions.walletRequiredDesc",
              "Connect your wallet to access blockchain features like adding versions, endorsing data, and minting NFTs.",
            )}
          </p>

          <div className="space-y-8">
            <div className="transform hover:scale-105 transition-transform duration-300">
              <WalletConnectButton className="mx-auto" alwaysShowLabel />
            </div>

            <div className="bg-white dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-3xl p-8 shadow-xl shadow-gray-200/50 dark:shadow-none backdrop-blur-sm">
              <div className="flex items-start gap-5">
                <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-xl">
                  <AlertCircle className="w-6 h-6 text-orange-500" />
                </div>
                <div className="text-left flex-1">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
                    {t("actions.whatYouCanDo", "What you can do after connecting:")}
                  </h3>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                      {t("actions.feature1", "Add new person versions with privacy protection")}
                    </li>
                    <li className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                      {t("actions.feature2", "Endorse quality data and earn rewards")}
                    </li>
                    <li className="flex items-center gap-3 text-gray-600 dark:text-gray-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                      {t("actions.feature3", "Mint NFTs from endorsed data")}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-12">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4 tracking-tight">
            {t("actions.title", "Blockchain Actions")}
          </h1>
          <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto">
            {t(
              "actions.subtitle",
              "Interact with the DeepFamily protocol using your connected wallet",
            )}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-10 flex justify-center">
          <nav className="inline-flex p-1.5 bg-gray-100 dark:bg-gray-800/50 rounded-full border border-gray-200 dark:border-gray-700/50 backdrop-blur-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSearchParams({ tab: tab.id });
                  }}
                  className={`flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 ${
                    isActive
                      ? "bg-white dark:bg-gray-800 text-orange-500 shadow-md shadow-gray-200/50 dark:shadow-none ring-1 ring-black/5 dark:ring-white/10"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? "stroke-[2.5px]" : ""}`} />
                  <span className="whitespace-nowrap">{tab.name}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="bg-white dark:bg-gray-800 rounded-3xl shadow-2xl shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-700 overflow-hidden transition-all duration-500">
          {tabs.map((tab) => {
            if (activeTab !== tab.id) return null;

            const Icon = tab.icon;

            return (
              <div
                key={tab.id}
                className="p-12 animate-in fade-in slide-in-from-bottom-4 duration-500"
              >
                <div className="text-center mb-10">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/10 mb-6 shadow-inner">
                    <Icon className="w-10 h-10 text-orange-500" />
                  </div>
                  <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                    {tab.subtitle}
                  </h2>
                  <p className="text-lg text-gray-500 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
                    {tab.description}
                  </p>
                </div>

                <div className="max-w-xs mx-auto">
                  {tab.id === "add-version" && (
                    <button
                      onClick={() => setAddVersionModal({ isOpen: true })}
                      className="w-full px-8 py-4 bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full font-semibold shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02] active:scale-95 transition-all duration-300"
                    >
                      {t("actions.startAddVersion", "Start Adding Version")}
                    </button>
                  )}

                  {tab.id === "mint-nft" && (
                    <div className="text-center">
                      <button
                        onClick={() =>
                          setMintNFTModal({
                            isOpen: true,
                            personHash: undefined,
                            versionIndex: undefined,
                          })
                        }
                        className="w-full px-8 py-4 bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full font-semibold shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02] active:scale-95 transition-all duration-300"
                      >
                        {t("actions.openMintNFT", "Open NFT Minting")}
                      </button>
                    </div>
                  )}

                  {tab.id === "endorse" && (
                    <div className="text-center">
                      <button
                        onClick={() =>
                          setEndorseModal({
                            isOpen: true,
                            personHash: undefined,
                            versionIndex: undefined,
                          })
                        }
                        className="w-full px-8 py-4 bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full font-semibold shadow-lg shadow-orange-500/30 hover:shadow-orange-500/50 hover:scale-[1.02] active:scale-95 transition-all duration-300"
                      >
                        {t("actions.openEndorse", "Open Endorsement")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Modals - Simplified navigation logic:
            1. Parent component only controls open/close and passes initial data
            2. Modal internal state is fully self-contained and auto-resets on close
            3. When navigating: close current modal → open target modal (with data)
        */}
        <AddVersionModal
          isOpen={addVersionModal.isOpen}
          onClose={() => setAddVersionModal({ isOpen: false })}
          onSuccess={(result) => console.log("Version added:", result)}
          onEndorse={(personHash, versionIndex) => {
            setAddVersionModal({ isOpen: false });
            setEndorseModal({ isOpen: true, personHash, versionIndex });
          }}
          initialPersonData={addVersionModal.existingPersonData}
        />

        <MintNFTModal
          isOpen={mintNFTModal.isOpen}
          onClose={() => setMintNFTModal({ isOpen: false })}
          onSuccess={(tokenId) => console.log("NFT minted:", tokenId)}
          onGoEndorse={(personHash, versionIndex) => {
            setMintNFTModal({ isOpen: false });
            setEndorseModal({ isOpen: true, personHash, versionIndex });
          }}
          initialPersonHash={mintNFTModal.personHash}
          initialVersionIndex={mintNFTModal.versionIndex}
        />

        <EndorseModal
          isOpen={endorseModal.isOpen}
          onClose={() => setEndorseModal({ isOpen: false })}
          onSuccess={(result) => console.log("Endorsement submitted:", result)}
          onMintNFT={(personHash, versionIndex) => {
            setEndorseModal({ isOpen: false });
            setMintNFTModal({ isOpen: true, personHash, versionIndex });
          }}
          initialPersonHash={endorseModal.personHash}
          initialVersionIndex={endorseModal.versionIndex}
        />
      </div>
    </PageContainer>
  );
}
