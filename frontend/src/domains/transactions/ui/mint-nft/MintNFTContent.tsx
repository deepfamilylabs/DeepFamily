import { Image } from "lucide-react";
import { ResponsiveModalFrame } from "../../../../shared/ui";
import { useMintNftModalController } from "./hooks/useMintNftModalController";
import { EndorseRequiredDialog } from "./sections/EndorseRequiredDialog";
import { MintConsentSection } from "./sections/MintConsentSection";
import { MintNftFooter } from "./sections/MintNftFooter";
import { MintNftStatusPanel } from "./sections/MintNftStatusPanel";
import { MintPersonProofSection } from "./sections/MintPersonProofSection";
import { MintSupplementForm } from "./sections/MintSupplementForm";
import { MintTargetSection } from "./sections/MintTargetSection";

export interface MintNFTModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (tokenId: number) => void;
  onGoEndorse?: (personHash: string, versionIndex: number) => void;
  initialPersonHash?: string;
  initialVersionIndex?: number;
}

export default function MintNFTModal(props: MintNFTModalProps) {
  const mint = useMintNftModalController(props);
  const { t } = mint;

  return (
    <ResponsiveModalFrame
      {...mint.frame}
      ariaLabel="Mint NFT"
      icon={<Image className="w-6 h-6 text-white" />}
      title={t("mintNFT.title", "Mint NFT")}
      description={t(
        "mintNFT.headerOnChainHint",
        "Minting is public: plain text is permanently on-chain",
      )}
    >
      <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
        <form
          id="mint-nft-form"
          onSubmit={mint.form.handleSubmit(mint.form.onSubmit)}
          className="min-h-full flex flex-col"
        >
          <div className="flex-1 p-6 space-y-6">
            <MintTargetSection t={t} {...mint.targetSection} />

            {!mint.statusPanel.isAlreadyMinted && (
              <>
                <MintPersonProofSection t={t} {...mint.personProofSection} />
                <MintSupplementForm t={t} {...mint.supplementForm} />
              </>
            )}

            {!mint.statusPanel.successResult && !mint.statusPanel.isAlreadyMinted && (
              <MintConsentSection t={t} {...mint.consentSection} />
            )}

            <MintNftStatusPanel t={t} {...mint.statusPanel} />
          </div>

          <MintNftFooter t={t} {...mint.footer} />
        </form>
      </div>

      <EndorseRequiredDialog t={t} {...mint.endorseDialog} />
    </ResponsiveModalFrame>
  );
}
