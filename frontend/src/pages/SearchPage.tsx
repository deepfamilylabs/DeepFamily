import { useSearchPageController } from "./search/hooks/useSearchPageController";
import { SearchHashCalculatorSection } from "./search/sections/SearchHashCalculatorSection";
import {
  ChildrenQuerySection,
  EndorsementQuerySection,
  StoryChunksQuerySection,
  UriHistoryQuerySection,
  VersionsQuerySection,
} from "./search/sections/SearchQuerySections";

export default function SearchPage() {
  const search = useSearchPageController();

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100 pb-8 md:pb-0 max-w-7xl mx-auto">
      <SearchHashCalculatorSection search={search} />
      <VersionsQuerySection search={search} />
      <EndorsementQuerySection search={search} />
      <ChildrenQuerySection search={search} />
      <StoryChunksQuerySection search={search} />
      <UriHistoryQuerySection search={search} />
    </div>
  );
}
