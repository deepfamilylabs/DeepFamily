import { usePersonPageController } from "./person/hooks/usePersonPageController";
import { PersonContents } from "./person/sections/PersonContents";
import { PersonBiography, PersonHeader } from "./person/sections/PersonHeader";
import {
  PersonActionsCard,
  PersonMobileRecord,
  PersonRecordCard,
} from "./person/sections/PersonRecordPanel";
import { PersonErrorAlert, PersonLoadingState } from "./person/sections/PersonStatusPanels";
import { PersonStory } from "./person/sections/PersonStory";

/**
 * Person encyclopedia page — the read-only face of the story editor, laid out
 * the same way: Contents, the story, and the on-chain record with the page's
 * actions. Narrower than xl the story leads alone; the actions and the record
 * move under the life facts and the sections become a sticky row of chips.
 */
export default function PersonPage() {
  const person = usePersonPageController();

  if (person.loading) {
    return <PersonLoadingState />;
  }

  if (person.error || !person.data) {
    return <PersonErrorAlert person={person} />;
  }

  return (
    <div className="grid items-start gap-7 xl:grid-cols-[248px_minmax(0,1fr)_256px]">
      <div className="hidden xl:sticky xl:top-20 xl:block">
        <PersonContents person={person} />
      </div>

      <article className="min-w-0">
        <PersonHeader person={person} />
        <PersonMobileRecord person={person} />
        <PersonBiography person={person} />
        <PersonStory person={person} />
      </article>

      <aside className="hidden xl:sticky xl:top-20 xl:flex xl:flex-col xl:gap-4">
        <PersonRecordCard person={person} />
        <PersonActionsCard person={person} />
      </aside>
    </div>
  );
}
