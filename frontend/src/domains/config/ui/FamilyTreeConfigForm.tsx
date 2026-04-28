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
  VersionStepper,
} from "./sections";

export default function FamilyTreeConfigForm() {
  const ctrl = useFamilyTreeConfigForm();

  return (
    <div className="text-sm text-slate-600 dark:text-slate-300 p-4">
      <div className="mb-6">
        <div className="flex items-start justify-end gap-4 mb-4">
          <ConfigFormActions
            hasDiff={ctrl.actions.hasDiff}
            onReset={ctrl.actions.reset}
            onSave={ctrl.actions.save}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-4">
          <NetworkPicker {...ctrl.network} />
          {ctrl.customForm.visible && <CustomNetworkForm {...ctrl.customForm} />}
          <ContractAddressField {...ctrl.contract} />
        </div>
        <div className="flex flex-col gap-4">
          <RootHashField {...ctrl.root} />
          <VersionStepper {...ctrl.version} />
        </div>
        <RootHashHistory {...ctrl.history} />
      </div>

      <div className="border-t border-slate-200/60 dark:border-slate-700/60 mt-4" />

      <div className="mt-4 space-y-3">
        <TraversalControls {...ctrl.traversal} />

        {(ctrl.showChildrenModeToggle || ctrl.showDeduplicateToggle) && (
          <>
            <div className="border-t border-slate-200/60 dark:border-slate-700/60" />
            <div className="space-y-2">
              {ctrl.showChildrenModeToggle && <ChildrenModeControls {...ctrl.children} />}
              {ctrl.showDeduplicateToggle && <DeduplicateControl {...ctrl.deduplicate} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
