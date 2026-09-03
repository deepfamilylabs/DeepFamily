import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonStoryModal, type EndorseSuccessHandler } from "../domains/person";
import {
  MetadataUnlockControl,
  useTreeGraphData,
  useTreeMutations,
  useTreeNodeAccess,
  useTreeStatus,
} from "../domains/tree";
import { useConfig } from "../domains/config";
import { isMetadataUnlockUsable } from "../shared/model";
import { usePeoplePageController } from "./people/hooks/usePeoplePageController";
import { PeoplePageHead } from "./people/sections/PeoplePageHead";
import { PeopleResultsSection } from "./people/sections/PeopleResultsSection";
import { PeopleToolbar } from "./people/sections/PeopleToolbar";
import { FamilySettingsDrawer } from "./family/FamilySettingsDrawer";
import { TreePageBar } from "./tree/sections/TreePageBar";

export default function PeoplePage() {
  const { t } = useTranslation();
  const peoplePage = usePeoplePageController();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metadataUnlockOpen, setMetadataUnlockOpen] = useState(false);
  const { rootId, rootExists, nodesData } = useTreeGraphData();
  const { loading, progress, refresh, clearAllCaches } = useTreeStatus();
  const { rootHash, rootVersionIndex } = useConfig();
  const { getOwnerOf, getStoryData, preloadStoryData } = useTreeNodeAccess();
  const { bumpEndorsementCount, invalidateByTx } = useTreeMutations();

  const handleEndorseSuccess = useCallback<EndorseSuccessHandler>(
    (target, delta, receipt) => {
      bumpEndorsementCount(target.personHash, target.versionIndex, delta);
      invalidateByTx({
        receipt,
        hints: { personHash: target.personHash, versionIndex: target.versionIndex },
      });
    },
    [bumpEndorsementCount, invalidateByTx],
  );

  const rootLabel = useMemo(() => {
    const fullName = (rootId ? nodesData[rootId]?.fullName : "")?.trim();
    if (fullName) return fullName;
    const hash = (rootHash || "").trim();
    return hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
  }, [nodesData, rootHash, rootId]);
  const unlockedCount = useMemo(
    () => Object.values(nodesData).filter(isMetadataUnlockUsable).length,
    [nodesData],
  );

  return (
    <div className="min-h-screen bg-surface-body text-ink selection:bg-primary/30">
      <TreePageBar
        t={t}
        rootLabel={rootLabel}
        rootVersion={Number(rootVersionIndex || 1)}
        hasRoot={Boolean(rootId && rootExists)}
        peopleCount={progress?.created || 0}
        generationCount={progress?.depth || 0}
        loading={loading}
        unlockedCount={unlockedCount}
        onOpenUnlock={() => setMetadataUnlockOpen(true)}
        onRefresh={refresh}
        onClearCaches={clearAllCaches}
        configOpen={settingsOpen}
        onToggleConfig={() => setSettingsOpen((value) => !value)}
      />
      <div className="relative flex items-start">
        <FamilySettingsDrawer
          t={t}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          layout="document"
        />
        <div className="min-w-0 flex-1">
          <PeoplePageHead t={t} stats={peoplePage.stats} personNotice={peoplePage.personNotice} />

          <PeopleToolbar
            t={t}
            filters={peoplePage.filters}
            view={peoplePage.view}
            loading={peoplePage.loading}
            filteredCount={peoplePage.results.filteredPeople.length}
          />

          <PeopleResultsSection
            t={t}
            projectionEnabled={peoplePage.projectionEnabled}
            loading={peoplePage.loading}
            error={peoplePage.error}
            retry={peoplePage.retry}
            filters={peoplePage.filters}
            view={peoplePage.view}
            results={peoplePage.results}
            modal={peoplePage.modal}
            preloadStoryData={preloadStoryData}
            onEndorseSuccess={handleEndorseSuccess}
          />

          {peoplePage.modal.selectedPerson ? (
            <PersonStoryModal
              person={peoplePage.modal.selectedPerson}
              isOpen={!!peoplePage.modal.selectedPerson}
              onClose={peoplePage.modal.closePerson}
              getStoryData={getStoryData}
              getOwnerOf={getOwnerOf}
              onEndorseSuccess={handleEndorseSuccess}
            />
          ) : null}
        </div>
      </div>
      <MetadataUnlockControl
        open={metadataUnlockOpen}
        onOpenChange={setMetadataUnlockOpen}
        showTrigger={false}
      />
    </div>
  );
}
