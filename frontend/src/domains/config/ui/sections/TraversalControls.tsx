import { useTranslation } from "react-i18next";
import { Field, SegmentedControl } from "./ConfigControls";

export interface TraversalControlsProps {
  value: "dfs" | "bfs";
  onChange: (v: "dfs" | "bfs") => void;
}

export default function TraversalControls({ value, onChange }: TraversalControlsProps) {
  const { t } = useTranslation();
  const label = t("familyTree.ui.traversal", "Traversal");

  return (
    <Field
      label={label}
      hint={
        value === "dfs"
          ? t(
              "familyTree.ui.traversalDFS",
              "DFS: load down one branch first, then return to sibling branches",
            )
          : t(
              "familyTree.ui.traversalBFS",
              "BFS: load the current generation first, then continue to the next",
            )
      }
    >
      <SegmentedControl
        label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: "dfs", label: "DFS" },
          { value: "bfs", label: "BFS" },
        ]}
      />
    </Field>
  );
}
