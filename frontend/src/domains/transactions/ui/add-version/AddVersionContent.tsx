import { UserPlus } from "lucide-react";
import { ModalSectionHeading, ResponsiveModalFrame } from "../../../../shared/ui";
import { useAddVersionModalController } from "./hooks/useAddVersionModalController";
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

  return (
    <ResponsiveModalFrame
      {...addVersion.frame}
      accent="blue"
      ariaLabel="Add Version"
      icon={<UserPlus className="w-[18px] h-[18px]" />}
      title={t("addVersion.title", "Add Version")}
      description={t("addVersion.personInfoHint", "Secure zero-knowledge proof generation")}
    >
      <div className="flex-1 overflow-y-auto overscroll-contain overflow-x-hidden min-h-0 touch-pan-y">
        <form
          id="add-version-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void addVersion.form.handleSubmit(addVersion.form.onSubmit)(event);
          }}
          className="min-h-full flex flex-col"
        >
          <div className="flex-1 p-5 space-y-4">
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

            {!addVersion.statusPanel.successResult && (
              <AddVersionConsentSection t={t} {...addVersion.consentSection} />
            )}

            <AddVersionStatusPanel t={t} {...addVersion.statusPanel} />
          </div>

          <AddVersionFooter t={t} {...addVersion.footer} />
        </form>
      </div>
    </ResponsiveModalFrame>
  );
}
