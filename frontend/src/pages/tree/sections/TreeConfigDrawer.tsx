import {
  FamilySettingsDrawer,
  type FamilySettingsDrawerProps,
} from "../../family/FamilySettingsDrawer";

export type TreeConfigDrawerProps = FamilySettingsDrawerProps;

/**
 * Compatibility wrapper for the shared family settings drawer.
 *
 * Keeping this adapter avoids coupling the lineage page to the generic family-page directory.
 */
export function TreeConfigDrawer({ t, open, onClose }: TreeConfigDrawerProps) {
  return <FamilySettingsDrawer t={t} open={open} onClose={onClose} />;
}
