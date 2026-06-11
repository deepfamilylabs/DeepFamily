import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Globe, Database, SlidersHorizontal } from "lucide-react";
import { useFamilyTreeConfigForm } from "./hooks/useFamilyTreeConfigForm";
import {
  ChildrenModeControls,
  ConfigFormActions,
  ContractAddressField,
  CustomNetworkForm,
  DeduplicateControl,
  NetworkPicker,
  RootHashField,
  RootHashHistory,
  TraversalControls,
  TrustedSourceFilterControl,
  VersionStepper,
} from "./sections";

interface FormSectionProps {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function FormSection({ title, icon: Icon, defaultOpen = false, children }: FormSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isAnimating, setIsAnimating] = useState(false);

  const toggle = () => {
    setIsOpen(!isOpen);
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <div className="relative z-10 hover:z-40 focus-within:z-50 border border-slate-200/60 dark:border-slate-700/50 rounded-xl mb-3 bg-slate-50/50 dark:bg-slate-800/30 transition-all duration-300 shadow-sm hover:shadow-md dark:shadow-none">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between p-3.5 bg-slate-50/60 dark:bg-slate-800/60 hover:bg-slate-100/80 dark:hover:bg-slate-700/80 transition-colors rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/30"
      >
        <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200">
          <div className="p-1.5 bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-100 dark:border-slate-700 text-orange-500">
            <Icon className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight">{title}</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <div
        className={`transition-all duration-300 ease-in-out ${
          isOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"
        } ${isAnimating || !isOpen ? "overflow-hidden" : "overflow-visible"}`}
      >
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export default function FamilyTreeConfigForm() {
  const ctrl = useFamilyTreeConfigForm();
  const { t } = useTranslation();

  return (
    <div className="text-sm text-slate-600 dark:text-slate-300 flex flex-col relative h-full">
      <div className="flex-1 pb-4">
        <div className="mb-4 flex justify-end">
          <ConfigFormActions
            hasDiff={ctrl.actions.hasDiff}
            onReset={ctrl.actions.reset}
            onSave={ctrl.actions.save}
          />
        </div>

        <FormSection
          title={t("familyTree.config.networkAndContract", "Network & Contract")}
          icon={Globe}
          defaultOpen={true}
        >
          <div className="flex flex-col gap-4">
            <NetworkPicker {...ctrl.network} />
            {ctrl.customForm.visible && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <CustomNetworkForm {...ctrl.customForm} />
              </div>
            )}
            <ContractAddressField {...ctrl.contract} />
          </div>
        </FormSection>

        <FormSection
          title={t("familyTree.config.dataSource", "Data Source")}
          icon={Database}
          defaultOpen={true}
        >
          <div className="flex flex-col gap-4">
            <RootHashField {...ctrl.root} />
            <VersionStepper {...ctrl.version} />
            <div className="pt-2 border-t border-slate-100 dark:border-slate-700/50">
              <RootHashHistory {...ctrl.history} />
            </div>
          </div>
        </FormSection>

        <FormSection
          title={t("familyTree.config.displayOptions", "Display Options")}
          icon={SlidersHorizontal}
          defaultOpen={true}
        >
          <div className="flex flex-col gap-4">
            {(ctrl.showTrustedSourceFilterToggle ||
              ctrl.showNodeModeToggle ||
              ctrl.showDeduplicateToggle) && (
              <>
                <div className="space-y-4">
                  {ctrl.showNodeModeToggle && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                      <ChildrenModeControls {...ctrl.children} />
                    </div>
                  )}
                  {ctrl.showDeduplicateToggle && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                      <DeduplicateControl {...ctrl.deduplicate} />
                    </div>
                  )}
                  {ctrl.showTrustedSourceFilterToggle && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                      <TrustedSourceFilterControl {...ctrl.trustedSourceFilter} />
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-100 dark:border-slate-700/50" />
              </>
            )}

            <TraversalControls {...ctrl.traversal} />
          </div>
        </FormSection>
      </div>
    </div>
  );
}
