import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Plus, Image, Star, Wallet, AlertCircle, ArrowRight } from "lucide-react";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import { AddVersionModal, EndorseModal, MintNFTModal } from "../domains/transactions";
import { PageContainer } from "../shared/ui";

type ActionTab = "add-version" | "mint-nft" | "endorse";

export default function ActionsPage() {
  const { t } = useTranslation();
  const { address } = useWallet();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = useMemo(() => {
    const param = searchParams.get("tab") as ActionTab;
    return param && ["add-version", "mint-nft", "endorse"].includes(param) ? param : null;
  }, [searchParams]);

  const shouldAutoOpen = useMemo(() => {
    const openParam = searchParams.get("open") || searchParams.get("autoOpen") || "";
    return openParam === "1" || openParam.toLowerCase() === "true";
  }, [searchParams]);

  // `open=1` is a one-shot command rather than persistent state: consume it once
  // handled, so the floating action button can issue the same request again
  // without the URL already carrying the flag.
  useEffect(() => {
    if (!address || !shouldAutoOpen || !tabParam) return;

    if (tabParam === "add-version") {
      setAddVersionModal({ isOpen: true });
    }
    if (tabParam === "mint-nft") {
      setMintNFTModal({ isOpen: true, personHash: undefined, versionIndex: undefined });
    }
    if (tabParam === "endorse") {
      setEndorseModal({ isOpen: true, personHash: undefined, versionIndex: undefined });
    }

    const consumed = new URLSearchParams(searchParams);
    consumed.delete("open");
    consumed.delete("autoOpen");
    setSearchParams(consumed, { replace: true });
  }, [address, shouldAutoOpen, tabParam, searchParams, setSearchParams]);

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

  // Accent classes are written out in full: Tailwind cannot see composed names.
  const actionCards = useMemo(
    () => [
      {
        id: "add-version" as ActionTab,
        title: t("actions.addVersion", "Add Version"),
        icon: Plus,
        description: t(
          "actions.addVersionDesc",
          "Add a new version of person data with zero-knowledge proofs",
        ),
        cta: t("actions.startAddVersion", "Start Adding Version"),
        iconClass: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
        ctaClass: "text-blue-600 dark:text-blue-400",
        onOpen: () => setAddVersionModal({ isOpen: true }),
      },
      {
        id: "endorse" as ActionTab,
        title: t("actions.endorsement", "Endorsement"),
        icon: Star,
        description: t(
          "actions.endorseDesc",
          "Support quality data by endorsing versions with DEEP tokens",
        ),
        cta: t("actions.openEndorse", "Open Endorsement"),
        iconClass: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
        ctaClass: "text-emerald-600 dark:text-emerald-400",
        onOpen: () =>
          setEndorseModal({ isOpen: true, personHash: undefined, versionIndex: undefined }),
      },
      {
        id: "mint-nft" as ActionTab,
        title: t("actions.mintNFT", "Mint NFT"),
        icon: Image,
        description: t(
          "actions.mintNFTDesc",
          "Convert endorsed person data into valuable NFT collectibles",
        ),
        cta: t("actions.openMintNFT", "Open NFT Minting"),
        iconClass: "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
        ctaClass: "text-purple-600 dark:text-purple-400",
        onOpen: () =>
          setMintNFTModal({ isOpen: true, personHash: undefined, versionIndex: undefined }),
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
            <div className="absolute inset-0 bg-linear-to-r from-orange-400 to-red-500 blur-xl opacity-20 rounded-full"></div>
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

        {/* One card per action: a single click opens each modal. */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {actionCards.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.onOpen}
                className="group flex h-full flex-col items-start gap-4 rounded-3xl border border-gray-100 bg-white p-8 text-left shadow-xl shadow-gray-200/50 transition-all duration-300 hover:-translate-y-1 hover:border-orange-200 hover:shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 active:translate-y-0 dark:border-gray-700 dark:bg-gray-800 dark:shadow-none dark:hover:border-orange-500/40"
              >
                <span
                  className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl ${action.iconClass}`}
                >
                  <Icon className="h-7 w-7" />
                </span>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{action.title}</h2>
                <p className="flex-1 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  {action.description}
                </p>
                <span
                  className={`inline-flex items-center gap-1.5 text-sm font-semibold ${action.ctaClass}`}
                >
                  {action.cta}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </button>
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
