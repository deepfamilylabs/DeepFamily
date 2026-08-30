import { Star } from "lucide-react";
import { ModalSectionHeading, ResponsiveModalFrame } from "../../../../shared/ui";
import { useEndorseModalController } from "./hooks/useEndorseModalController";
import { EndorseBenefitsPanel } from "./sections/EndorseBenefitsPanel";
import { EndorseFeePanel } from "./sections/EndorseFeePanel";
import { EndorseFooter } from "./sections/EndorseFooter";
import { EndorseStatusPanel } from "./sections/EndorseStatusPanel";
import { EndorseTargetForm } from "./sections/EndorseTargetForm";

export interface EndorseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onMintNFT?: (personHash: string, versionIndex: number) => void;
  initialPersonHash?: string;
  initialVersionIndex?: number;
}

export default function EndorseModal(props: EndorseModalProps) {
  const endorse = useEndorseModalController(props);
  const { t } = endorse;

  return (
    <ResponsiveModalFrame
      {...endorse.frame}
      accent="emerald"
      ariaLabel="Endorse"
      icon={<Star className="w-[18px] h-[18px]" />}
      title={t("endorse.title", "Endorse Version")}
      description={t("endorse.description", "Support quality data by endorsing versions")}
    >
      <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
        <div className="flex-1 p-5 space-y-4">
          <EndorseTargetForm t={t} {...endorse.targetForm} />

          <div className="space-y-2.5">
            <ModalSectionHeading>{t("endorse.cost", "Cost")}</ModalSectionHeading>
            <EndorseFeePanel t={t} {...endorse.feePanel} />
          </div>

          <div className="space-y-2.5">
            <ModalSectionHeading>
              {t("endorse.benefits", "Benefits of Endorsing")}
            </ModalSectionHeading>
            <EndorseBenefitsPanel t={t} />
          </div>
          <EndorseStatusPanel t={t} {...endorse.statusPanel} />
        </div>

        <EndorseFooter t={t} {...endorse.footer} />
      </div>
    </ResponsiveModalFrame>
  );
}
