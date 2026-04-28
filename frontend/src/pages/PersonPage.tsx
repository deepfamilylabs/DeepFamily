import { usePersonPageController } from "./person/hooks/usePersonPageController";
import { PersonMainContent } from "./person/sections/PersonMainContent";
import { PersonSectionNavigation } from "./person/sections/PersonSectionNavigation";
import { PersonSidebar } from "./person/sections/PersonSidebar";
import { PersonErrorAlert, PersonLoadingState } from "./person/sections/PersonStatusPanels";

export default function PersonPage() {
  const person = usePersonPageController();

  if (person.loading) {
    return <PersonLoadingState />;
  }

  return (
    <div>
      <PersonErrorAlert person={person} />
      {!person.error && person.data && (
        <>
          <PersonSectionNavigation person={person} />
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start pb-[67vh]">
            <PersonMainContent person={person} />
            <PersonSidebar person={person} />
          </div>
        </>
      )}
    </div>
  );
}
