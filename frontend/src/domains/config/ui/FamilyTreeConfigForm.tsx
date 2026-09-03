import { useTranslation } from "react-i18next";
import { useFamilyTreeConfigForm } from "./hooks/useFamilyTreeConfigForm";
import {
  ChildrenModeControls,
  ConfigFormActions,
  ContractAddressField,
  CustomNetworkForm,
  DeduplicateControl,
  GroupHeading,
  NetworkPicker,
  RootHashField,
  RootHashHistory,
  TraversalControls,
  TrustedSourceFilterControl,
  VersionPicker,
} from "./sections";

/**
 * The genealogy settings panel: one flat, scrolling column under three group
 * headings, with the save actions docked at the bottom.
 *
 * It used to be three collapsible cards, which put every field at least one
 * disclosure click away and hid each control's meaning behind a help icon and a
 * floating tooltip. In a 320px drawer there is room to simply show the fields
 * and say what each one does, so the structure is carried by headings and
 * hairlines instead.
 *
 * The two halves behave differently, and the panel says so: network and data
 * source are staged locally and only applied on save (the footer tracks that),
 * while the display options drive the current view as soon as they are touched.
 */
export default function FamilyTreeConfigForm() {
  const ctrl = useFamilyTreeConfigForm();
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface text-ink">
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-3 py-3.5">
        <GroupHeading title={t("familyTree.config.networkAndContract", "Network & Contract")} />
        <NetworkPicker {...ctrl.network} />
        {ctrl.customForm.visible ? <CustomNetworkForm {...ctrl.customForm} /> : null}
        <ContractAddressField {...ctrl.contract} />

        <GroupHeading title={t("familyTree.config.dataSource", "Data Source")} />
        <RootHashField {...ctrl.root} />
        <RootHashHistory {...ctrl.history} />
        <VersionPicker {...ctrl.version} />

        <GroupHeading
          title={t("familyTree.config.displayOptions", "Display Options")}
          note={t("familyTree.config.displayAppliesInstantly", "Applies instantly")}
        />
        {ctrl.showNodeModeToggle ? <ChildrenModeControls {...ctrl.children} /> : null}
        {ctrl.showDeduplicateToggle ? <DeduplicateControl {...ctrl.deduplicate} /> : null}
        {ctrl.showTrustedSourceFilterToggle ? (
          <TrustedSourceFilterControl {...ctrl.trustedSourceFilter} />
        ) : null}
        <TraversalControls {...ctrl.traversal} />
      </div>

      <ConfigFormActions
        hasDiff={ctrl.actions.hasDiff}
        onReset={ctrl.actions.reset}
        onSave={ctrl.actions.save}
      />
    </div>
  );
}
