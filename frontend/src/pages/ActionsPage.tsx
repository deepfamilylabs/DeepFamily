import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Plus, Image, Star, Wallet, AlertCircle } from "lucide-react";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import { AddVersionModal, EndorseModal, MintNFTModal } from "../domains/transactions";
import { PageContainer } from "../shared/ui";

type ActionTab = "add-version" | "mint-nft" | "endorse";

export default function ActionsPage() {
  const { t } = useTranslation();
  const { address } = useWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<ActionTab>("add-version");
  const hasAutoOpenedRef = useRef(false);
  const tabParam = useMemo(() => {
    const param = searchParams.get("tab") as ActionTab;
    return param && ["add-version", "mint-nft", "endorse"].includes(param) ? param : null;
  }, [searchParams]);

  const shouldAutoOpen = useMemo(() => {
    const openParam = searchParams.get("open") || searchParams.get("autoOpen") || "";
    return openParam === "1" || openParam.toLowerCase() === "true";
  }, [searchParams]);

  // Handle URL tab parameter
  useEffect(() => {
    if (tabParam) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  // Auto-open modal when arriving with explicit open flag
  useEffect(() => {
    if (!address || !shouldAutoOpen || hasAutoOpenedRef.current) return;
    if (!tabParam) return;

    if (tabParam === "add-version") {
      setAddVersionModal({ isOpen: true });
    }
    if (tabParam === "mint-nft") {
      setMintNFTModal({ isOpen: true, personHash: undefined, versionIndex: undefined });
    }
    if (tabParam === "endorse") {
      setEndorseModal({ isOpen: true, personHash: undefined, versionIndex: undefined });
    }

    hasAutoOpenedRef.current = true;
  }, [address, shouldAutoOpen, tabParam]);

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
      <PageContainer className="py-10">
        <div className="max-w-3xl mx-auto">
          <div className="mb-8 flex items-start gap-4">
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-3 rounded-lg shadow-sm">
              <Wallet className="w-7 h-7 text-orange-600 dark:text-orange-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white tracking-tight">
                {t("actions.walletRequired", "Wallet Connection Required")}
              </h1>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 leading-6 max-w-2xl">
                {t(
                  "actions.walletRequiredDesc",
                  "Connect your wallet to access blockchain features like adding versions, endorsing data, and minting NFTs.",
                )}
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <WalletConnectButton className="mx-auto" alwaysShowLabel />
            </div>

            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-5 shadow-sm">
              <div className="flex items-start gap-5">
                <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded-md">
                  <AlertCircle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="text-left flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                    {t("actions.whatYouCanDo", "What you can do after connecting:")}
                  </h3>
                  <ul className="space-y-2">
                    <li className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                      {t("actions.feature1", "Add new person versions with privacy protection")}
                    </li>
                    <li className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-400"></div>
                      {t("actions.feature2", "Endorse quality data and earn rewards")}
                    </li>
                    <li className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
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
    <PageContainer className="py-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 dark:text-white tracking-tight">
            {t("actions.title", "Blockchain Actions")}
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-2xl">
            {t(
              "actions.subtitle",
              "Interact with the DeepFamily protocol using your connected wallet",
            )}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="mb-4">
          <nav className="grid grid-cols-3 gap-1 p-1 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
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
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white dark:bg-gray-800 text-orange-700 dark:text-orange-300 shadow-sm ring-1 ring-black/5 dark:ring-white/10"
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
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          {tabs.map((tab) => {
            if (activeTab !== tab.id) return null;

            const Icon = tab.icon;

            return (
              <div key={tab.id} className="p-6 sm:p-8">
                <div className="mb-6 flex items-start gap-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-900/30">
                    <Icon className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                      {tab.subtitle}
                    </h2>
                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 max-w-2xl leading-6">
                      {tab.description}
                    </p>
                  </div>
                </div>

                <div className="max-w-sm">
                  {tab.id === "add-version" && (
                    <button
                      onClick={() => setAddVersionModal({ isOpen: true })}
                      className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-md font-semibold shadow-sm transition-colors"
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
                        className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-md font-semibold shadow-sm transition-colors"
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
                        className="w-full px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-md font-semibold shadow-sm transition-colors"
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
