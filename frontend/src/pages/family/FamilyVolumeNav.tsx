import { Book, Network, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { BambooSlipsIcon } from "../../shared/ui";

/** The three peer views of the active family. */
export interface FamilyVolumeNavProps {
  settingsOpen: boolean;
  onToggleSettings: () => void;
  className?: string;
}

export function FamilyVolumeNav({
  settingsOpen,
  onToggleSettings,
  className = "",
}: FamilyVolumeNavProps) {
  const { t, i18n } = useTranslation();
  const showPaperVolume = (i18n?.language ?? "").toLowerCase().startsWith("zh");

  return (
    <div className={`flex min-w-0 items-stretch gap-3 md:gap-5 ${className}`}>
      <span className="flex shrink-0 items-center">
        <button
          type="button"
          onClick={onToggleSettings}
          title={t("familyTree.actions.openConfig", "Family settings")}
          aria-label={t("familyTree.actions.openConfig", "Family settings")}
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
            settingsOpen
              ? "border-hairline-strong bg-surface-muted text-ink"
              : "border-hairline bg-surface text-ink-muted hover:border-hairline-strong hover:text-ink"
          }`}
        >
          <SlidersHorizontal className="h-[15px] w-[15px]" />
        </button>
      </span>

      <h1 className="hidden shrink-0 items-center text-xl text-ink md:flex">
        {t("familyTree.title", "Family")}
      </h1>

      <nav
        className="flex min-w-0 items-stretch gap-4 md:gap-5"
        aria-label={t("familyTree.title", "Family")}
      >
        <VolumeTab to="/familyTree" label={t("familyTree.volumes.chart", "Lineage")} end>
          <Network className="h-[15px] w-[15px] shrink-0" />
        </VolumeTab>
        <VolumeTab to="/people" label={t("familyTree.volumes.people", "People")}>
          <Book className="h-[15px] w-[15px] shrink-0" />
        </VolumeTab>
        {showPaperVolume ? (
          <VolumeTab to="/genealogyBook" label={t("familyTree.volumes.paper", "Genealogy")}>
            <BambooSlipsIcon className="h-[15px] w-[15px] shrink-0" />
          </VolumeTab>
        ) : null}
      </nav>
    </div>
  );
}

function VolumeTab({
  to,
  label,
  end,
  children,
}: {
  to: string;
  label: string;
  end?: boolean;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 text-[13px] transition-colors md:gap-2 ${
          isActive
            ? "border-primary font-semibold text-ink"
            : "border-transparent font-medium text-ink-muted hover:text-ink"
        }`
      }
    >
      {children}
      {label}
    </NavLink>
  );
}
