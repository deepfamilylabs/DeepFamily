import { Image } from "lucide-react";
import { ResponsiveModalFrame } from "../../../../shared/ui";
import { useMintNftModalController } from "./hooks/useMintNftModalController";
import { assertPhaseHandled, type TransactionPhase } from "../shared/transactionPhase";
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
  const standing = standingSections(mint.statusPanel.phase);

  return (
    <ResponsiveModalFrame
      {...mint.frame}
      accent="purple"
      ariaLabel="Mint NFT"
      icon={<Image className="w-[18px] h-[18px]" />}
      title={t("mintNFT.title", "Mint NFT")}
      description={t(
        "mintNFT.headerOnChainHint",
        "Minting is public: plain text is permanently on-chain",
      )}
    >
      <form
        id="mint-nft-form"
        onSubmit={mint.form.handleSubmit(mint.form.onSubmit)}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y p-5 space-y-4">
          {/* Hidden rather than unmounted: the identity passphrase lives inside
              PersonHashCalculator, so a cancelled preview must not wipe it. */}
          {/* First in the scroll area, not last: whatever the flow has to say is
              visible the moment it appears, whether or not the form is hidden. */}
          <MintNftStatusPanel t={t} {...mint.statusPanel} />

          <div
            className="space-y-4"
            hidden={standing === "none"}
            data-testid="transaction-form-sections"
          >
            <MintTargetSection t={t} {...mint.targetSection} />

            {standing === "all" && (
              <>
                <MintPersonProofSection t={t} {...mint.personProofSection} />
                <MintSupplementForm t={t} {...mint.supplementForm} />
                <MintConsentSection t={t} {...mint.consentSection} />
              </>
            )}
          </div>
        </div>

        <MintNftFooter t={t} {...mint.footer} />
      </form>

      <EndorseRequiredDialog t={t} {...mint.endorseDialog} />
    </ResponsiveModalFrame>
  );
}

/**
 * Which editable sections a phase leaves standing. A blocked target keeps the
 * picker — changing the target is the only way forward — while a failure keeps
 * everything, because correcting the form is how it gets retried.
 */
function standingSections(phase: TransactionPhase): "all" | "target" | "none" {
  switch (phase) {
    case "form":
    case "failed":
      return "all";
    case "blocked":
      return "target";
    case "busy":
    case "review":
    case "done":
      return "none";
    default:
      return assertPhaseHandled(phase);
  }
}
