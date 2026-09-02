import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Plus, Image, Star, Wallet } from "lucide-react";
import { useWallet, WalletConnectButton } from "../domains/wallet";
import { AddVersionModal, EndorseModal, MintNFTModal } from "../domains/transactions";
import { ActionCard, EmptyState, PageContainer, PageHead } from "../shared/ui";
import type { ActionCardTone } from "../shared/ui";

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

  // `?tab=endorse|mint-nft` plus a target opens that modal on the version the
  // URL names. This is where the person detail dialog's mint button lands — it
  // opens /actions in a new tab carrying hash + version.
  //
  // Opening is one-shot per target: `address` is a dependency, so without this
  // guard switching wallet accounts re-ran the effect and popped the modal back
  // open after the user had closed it. The target stays in the URL (unlike
  // `open=1` above) so the link remains shareable and survives a reload.
  const handledTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!address) return;
    const tab = searchParams.get("tab") as ActionTab;
    if (tab !== "endorse" && tab !== "mint-nft") return;

    const personHash = searchParams.get("hash") || searchParams.get("personHash") || "";
    const rawIndex =
      searchParams.get("vi") ||
      searchParams.get("version") ||
      searchParams.get("versionIndex") ||
      "";
    const versionIndex = rawIndex ? parseInt(rawIndex, 10) : NaN;
    if (!personHash || !Number.isFinite(versionIndex) || versionIndex <= 0) return;

    const target = `${tab}:${personHash}:${versionIndex}`;
    if (handledTargetRef.current === target) return;
    handledTargetRef.current = target;

    const open = { isOpen: true, personHash, versionIndex };
    if (tab === "endorse") {
      setEndorseModal(open);
    } else {
      setMintNFTModal(open);
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
        tone: "primary" as ActionCardTone,
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
        tone: "success" as ActionCardTone,
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
        tone: "info" as ActionCardTone,
        onOpen: () =>
          setMintNFTModal({ isOpen: true, personHash: undefined, versionIndex: undefined }),
      },
    ],
    [t],
  );

  // Wallet not connected view
  if (!address) {
    const features = [
      t("actions.feature1", "Add new person versions with privacy protection"),
      t("actions.feature2", "Endorse quality data and earn rewards"),
      t("actions.feature3", "Mint NFTs from endorsed data"),
    ];

    return (
      <PageContainer className="py-12">
        <EmptyState
          size="page"
          icon={<Wallet className="h-7 w-7" strokeWidth={1.5} />}
          title={t("actions.walletRequired", "Wallet Connection Required")}
          description={t(
            "actions.walletRequiredDesc",
            "Connect your wallet to access blockchain features like adding versions, endorsing data, and minting NFTs.",
          )}
          action={
            <div className="flex flex-col items-center gap-6">
              <WalletConnectButton className="mx-auto" alwaysShowLabel />
              <div className="rounded-2xl border border-hairline bg-surface px-5 py-4 text-left">
                <div className="mb-2.5 text-[11px] font-semibold tracking-wide text-ink-subtle">
                  {t("actions.whatYouCanDo", "What you can do after connecting:")}
                </div>
                <ul className="flex flex-col gap-2">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2.5 text-sm text-ink-muted">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="py-10">
      <PageHead
        title={t("actions.title", "Blockchain Actions")}
        subtitle={t(
          "actions.subtitle",
          "Interact with the DeepFamily protocol using your connected wallet",
        )}
      />

      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {actionCards.map((action) => {
          const Icon = action.icon;
          return (
            <ActionCard
              key={action.id}
              icon={<Icon className="h-6 w-6" />}
              title={action.title}
              description={action.description}
              tone={action.tone}
              cta={action.cta}
              onClick={action.onOpen}
            />
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
    </PageContainer>
  );
}
