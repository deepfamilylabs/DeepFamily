import { UserPlus } from "lucide-react";
import { ModalSectionHeading, ResponsiveModalFrame } from "../../../../shared/ui";
import { useAddVersionModalController } from "./hooks/useAddVersionModalController";
import { assertPhaseHandled, type TransactionPhase } from "../shared/transactionPhase";
import { AddVersionConsentSection } from "./sections/AddVersionConsentSection";
import { AddVersionFooter } from "./sections/AddVersionFooter";
import { AddVersionStatusPanel } from "./sections/AddVersionStatusPanel";
import { MetadataEncryptionSection } from "./sections/MetadataEncryptionSection";
import { ParentIdentitySection } from "./sections/ParentIdentitySection";
import { PersonIdentitySection } from "./sections/PersonIdentitySection";

export interface AddVersionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (result: any) => void;
  onEndorse?: (personHash: string, versionIndex: number) => void;
  initialPersonData?: {
    fullName?: string;
    gender?: number;
    birthYear?: number;
    birthMonth?: number;
    birthDay?: number;
    isBirthBC?: boolean;
  };
}

export default function AddVersionModal(props: AddVersionModalProps) {
  const addVersion = useAddVersionModalController(props);
  const { t } = addVersion;
  const formHidden = addVersionFormHidden(addVersion.statusPanel.phase);

  return (
    <ResponsiveModalFrame
      {...addVersion.frame}
      accent="blue"
      ariaLabel="Add Version"
      icon={<UserPlus className="w-[18px] h-[18px]" />}
      title={t("addVersion.title", "Add Version")}
      description={t("addVersion.personInfoHint", "Secure zero-knowledge proof generation")}
    >
      <form
        id="add-version-form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void addVersion.form.handleSubmit(addVersion.form.onSubmit)(event);
        }}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y p-5 space-y-4">
          {/* Hidden rather than unmounted: the identity passphrase lives inside
              PersonHashCalculator, so a cancelled preview must not wipe it. */}
          {/* First in the scroll area, not last: whatever the flow has to say is
              visible the moment it appears, whether or not the form is hidden. */}
          <AddVersionStatusPanel t={t} {...addVersion.statusPanel} />

          <div className="space-y-4" hidden={formHidden} data-testid="transaction-form-sections">
            <PersonIdentitySection t={t} {...addVersion.personSection} />
            <div className="space-y-2.5">
              <ModalSectionHeading
                aside={t("addVersion.parentsMiningHint", "Both required to mine DEEP")}
              >
                {t("addVersion.parents", "Parents")}
              </ModalSectionHeading>
              <div className="space-y-2">
                <ParentIdentitySection t={t} {...addVersion.fatherSection} />
                <ParentIdentitySection t={t} {...addVersion.motherSection} />
              </div>
            </div>
            <MetadataEncryptionSection t={t} {...addVersion.metadataSection} />

            <AddVersionConsentSection t={t} {...addVersion.consentSection} />
          </div>
        </div>

        <AddVersionFooter t={t} {...addVersion.footer} />
      </form>
    </ResponsiveModalFrame>
  );
}

/** Waiting, deciding and done each own the whole view; a failure keeps the form to fix. */
function addVersionFormHidden(phase: TransactionPhase): boolean {
  switch (phase) {
    case "busy":
    case "review":
    case "done":
      return true;
    case "form":
    case "failed":
    case "blocked":
      return false;
    default:
      return assertPhaseHandled(phase);
  }
}
