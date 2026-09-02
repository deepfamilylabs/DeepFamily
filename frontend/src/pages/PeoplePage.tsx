import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PersonStoryModal, type EndorseSuccessHandler } from "../domains/person";
import { useTreeMutations, useTreeNodeAccess } from "../domains/tree";
import { usePeoplePageController } from "./people/hooks/usePeoplePageController";
import { PeoplePageHead } from "./people/sections/PeoplePageHead";
import { PeopleResultsSection } from "./people/sections/PeopleResultsSection";
import { PeopleToolbar } from "./people/sections/PeopleToolbar";

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
    <div className="min-h-screen bg-surface-body text-ink selection:bg-primary/30">
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
  );
}
