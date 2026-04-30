import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PersonStoryModal, type EndorseSuccessHandler } from "../domains/person";
import { useTreeMutations, useTreeNodeAccess } from "../domains/tree";
import { usePeoplePageController } from "./people/hooks/usePeoplePageController";
import { PeopleFiltersPanel } from "./people/sections/PeopleFiltersPanel";
import { PeopleHeroSection } from "./people/sections/PeopleHeroSection";
import { PeopleResultsSection } from "./people/sections/PeopleResultsSection";

export default function PeoplePage() {
  const { t } = useTranslation();
  const peoplePage = usePeoplePageController();
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

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-black text-gray-900 dark:text-gray-100 selection:bg-orange-500/30">
      <PeopleHeroSection t={t} stats={peoplePage.stats} personNotice={peoplePage.personNotice} />

      <PeopleFiltersPanel
        t={t}
        filters={peoplePage.filters}
        loading={peoplePage.loading}
        filteredCount={peoplePage.results.filteredPeople.length}
      />

      <PeopleResultsSection
        t={t}
        projectionEnabled={peoplePage.projectionEnabled}
        loading={peoplePage.loading}
        filters={peoplePage.filters}
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
  );
}
